import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260830000026_add_structured_challan_company_profile.sql", import.meta.url),
  "utf8",
);
const originalSalesMigration = readFileSync(
  new URL("../../../supabase/migrations/20260826000020_create_sales_challan_foundation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_a1.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");
const supabaseTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");

const createFunction = migration.slice(
  migration.indexOf("create or replace function public.create_challan"),
);
const updateFunction = originalSalesMigration.slice(
  originalSalesMigration.indexOf("create or replace function public.update_challan"),
  originalSalesMigration.indexOf("create or replace function public.void_challan"),
);

test("A1 is a forward-only additive schema change with explicit structured columns", () => {
  for (const column of ["village", "post_office", "police_station", "district", "state"]) {
    assert.match(migration, new RegExp(`add column ${column} text not null default ''`));
    assert.match(migration, new RegExp(`add column company_${column}_snapshot text`));
  }
  assert.doesNotMatch(migration, /drop column|alter column address|update public\.challans[\s\S]*company_village_snapshot/i);
  assert.match(migration, /Legacy generic printable address retained/);
});

test("profile writes stay factory-authorized and preserve the legacy generic address", () => {
  const profileFunction = migration.slice(
    migration.indexOf("create or replace function public.update_factory_printable_profile"),
    migration.indexOf("revoke all on function public.update_factory_printable_profile"),
  );
  assert.match(profileFunction, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(profileFunction, /factory_users\.factory_id = p_factory_id/);
  assert.match(profileFunction, /village = normalized_village/);
  assert.doesNotMatch(profileFunction, /address =/);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/);
});

test("new Challans snapshot authoritative structured profile values while edits preserve them", () => {
  for (const field of [
    "company_village_snapshot",
    "company_post_office_snapshot",
    "company_police_station_snapshot",
    "company_district_snapshot",
    "company_state_snapshot",
  ]) assert.match(createFunction, new RegExp(field));
  assert.match(createFunction, /from public\.factories[\s\S]*for share/);
  assert.doesNotMatch(createFunction, /p_company_.*snapshot/);
  assert.doesNotMatch(updateFunction, /company_(village|post_office|police_station|district|state)_snapshot\s*=/);
  assert.match(migration, /company_village_snapshot is distinct from old\.company_village_snapshot/);
});

test("legacy print fallback uses only the saved legacy snapshot, never today's factory", () => {
  assert.match(printModel, /addressKind: "legacy"/);
  assert.match(printModel, /address: challan\.companyAddressSnapshot/);
  assert.match(printModel, /addressKind: "structured"/);
  assert.doesNotMatch(printModel, /factories|FactoryPrintableProfile|getFactory/);
  assert.match(migration, /company_village_snapshot is null[\s\S]*company_state_snapshot is null/);
});

test("generated types and the service include every structured profile and snapshot field", () => {
  for (const token of [
    "village",
    "post_office",
    "police_station",
    "district",
    "state",
    "company_village_snapshot",
    "company_post_office_snapshot",
    "company_police_station_snapshot",
    "company_district_snapshot",
    "company_state_snapshot",
  ]) {
    assert.match(service + supabaseTypes, new RegExp(token));
  }
  assert.match(supabaseTypes, /p_village: string/);
  assert.match(service, /p_village: requireText\(village, "village"\)/);
});

test("focused SQL verification covers history, isolation, lifecycle, lock, and numbering", () => {
  for (const phrase of [
    "factory saves all structured company fields",
    "profile RLS and controlled write authorization isolate tenants",
    "new Challan snapshots the current structured company profile",
    "do not replace the original company snapshot",
    "legacy Challan stays readable",
    "without current-profile backfill",
    "payment lock rules remain unchanged",
    "create, edit, void, and per-factory sequential numbering remain intact",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});
