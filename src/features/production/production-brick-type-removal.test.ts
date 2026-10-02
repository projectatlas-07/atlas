import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260924000065_remove_production_brick_types.sql", import.meta.url),
  "utf8",
);
const entryModel = readFileSync(new URL("./production-entry-model.ts", import.meta.url), "utf8");
const entrySchema = readFileSync(new URL("./schemas/production-record-schema.ts", import.meta.url), "utf8");
const entryScreen = readFileSync(new URL("./components/production-entry-screen.tsx", import.meta.url), "utf8");
const entryService = readFileSync(new URL("./services/production-entry-service.ts", import.meta.url), "utf8");
const office = readFileSync(new URL("../office/components/office-dashboard.tsx", import.meta.url), "utf8");
const productionWorkspace = readFileSync(new URL("../office/components/production-office-workspace.tsx", import.meta.url), "utf8");
const productionReader = readFileSync(new URL("../office/services/todays-production-service.ts", import.meta.url), "utf8");
const accountDrawer = readFileSync(new URL("../office/components/production-worker-account-drawer.tsx", import.meta.url), "utf8");
const salesMigration = readFileSync(
  new URL("../../../supabase/migrations/20260826000020_create_sales_challan_foundation.sql", import.meta.url),
  "utf8",
);

const addLabourer = office.slice(
  office.indexOf("async function createProductionLabourer"),
  office.indexOf('if (factoryAccessStatus === "loading")'),
);
const productionWorkers = office.slice(
  office.indexOf("function LabourerManagement"),
  office.indexOf("function LabourerProductionRateOverrideControls"),
);

test("forward migration removes only Production-side Brick Type schema and contracts", () => {
  assert.match(migration, /alter table public\.labourers[\s\S]*drop column assigned_brick_type_id/);
  assert.match(migration, /alter table public\.production_entries[\s\S]*drop column brick_type_id/);
  assert.match(migration, /drop index if exists public\.production_entries_brick_type_date_idx/);
  assert.match(migration, /drop function if exists public\.save_production_entry\(uuid, uuid, uuid, uuid, date, integer\)/);
  assert.match(migration, /function public\.save_production_entry\([\s\S]*p_labourer_id uuid,[\s\S]*p_production_date date,[\s\S]*p_quantity integer/);
  assert.doesNotMatch(migration, /alter table public\.brick_types|drop table public\.brick_types/);
  assert.doesNotMatch(migration, /alter table public\.(?:weekly_earnings|production_earning_settlements|production_earning_settlement_details|withdrawals|challans|challan_items)/);
});

test("labourer writes remain factory-isolated without a finished Brick Type check", () => {
  const policySection = migration.slice(
    migration.indexOf("create policy \"Authenticated users can insert their factory labourers\""),
    migration.indexOf("create or replace function public.protect_settled_production_entry"),
  );
  assert.match(policySection, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(policySection, /factory_users\.factory_id = labourers\.factory_id/);
  assert.match(policySection, /factory_users\.is_active = true/);
  assert.doesNotMatch(policySection, /brick_types|assigned_brick_type_id/);
});

test("daily Production records and edits only worker, date, and raw quantity", () => {
  const runtime = `${entryModel}\n${entrySchema}\n${entryScreen}\n${entryService}`;
  assert.doesNotMatch(runtime, /brickType|brick_type|assigned_brick_type/i);
  assert.match(entryScreen, /select\("id, factory_id, name"\)/);
  assert.match(entryScreen, /select\("id, labourer_id, quantity"\)/);
  assert.match(entryService, /p_quantity: payload\.quantity/);
  assert.match(migration, /unique \(factory_id, labourer_id, production_date\)|on conflict \(factory_id, labourer_id, production_date\)/);
  assert.match(migration, /do update set quantity = excluded\.quantity/);
});

test("worker creation and V2 presentation contain no Production Brick Type dependency", () => {
  assert.match(addLabourer, /from\("labourers"\)\.insert/);
  assert.doesNotMatch(addLabourer, /brickType|brick_type|assigned/i);
  assert.match(productionWorkers, /placeholder="Search worker or origin"/);
  assert.doesNotMatch(productionWorkers, /brickType|brick type|Change Brick Type|Assigned brick/i);
  assert.doesNotMatch(accountDrawer, /brickType|brick type/i);
});

test("Production history reports raw quantity without finished-type lookups or grouping", () => {
  assert.match(productionWorkspace, /id="record-production-heading"[\s\S]*Record production/);
  assert.match(productionWorkspace, /Raw brick quantity for/);
  assert.match(productionWorkspace, /TableHeaderCell numeric>Raw quantity/);
  assert.doesNotMatch(`${productionWorkspace}\n${productionReader}`, /brickType|brick_type|brick type totals|from\("brick_types"\)/i);
});

test("Sales keeps the canonical Brick Type catalogue and immutable Challan particulars snapshot", () => {
  assert.match(salesMigration, /brick_type_id uuid not null/);
  assert.match(salesMigration, /brick_particulars_snapshot text not null/);
  assert.match(salesMigration, /references public\.brick_types\(id, factory_id\) on delete restrict/);
  assert.match(office, /<SalesOfficeSection[\s\S]*brickTypes=\{brickTypes\}/);
});
