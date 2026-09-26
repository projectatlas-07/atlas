import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260915000048_simplify_production_labourer_rates.sql", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../office/components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const managementDrawer = readFileSync(
  new URL("../office/components/production-worker-management-drawer.tsx", import.meta.url),
  "utf8",
);
const bulkRateSetting = readFileSync(
  new URL("../office/components/production-bulk-rate-setting.tsx", import.meta.url),
  "utf8",
);
const rangeService = readFileSync(
  new URL("./services/production-range-summary-service.ts", import.meta.url),
  "utf8",
);
const activeWorkflow = dashboard.slice(
  dashboard.indexOf("function LabourerManagement"),
  dashboard.indexOf("function LabourerProductionRateOverrideControls"),
);
const resolver = migration.slice(
  migration.indexOf("create or replace function public.resolve_production_wage_rate"),
  migration.indexOf("revoke all on function public.set_production_labourer_rates"),
);

test("reuses direct effective-dated Production rate history without another rate table", () => {
  assert.match(migration, /insert into public\.production_wage_rates/);
  assert.doesNotMatch(migration, /create table[\s\S]*production.*rate/i);
  assert.match(migration, /set_production_labourer_rates\(\s*p_factory_id uuid,\s*p_labourer_ids uuid\[\]/);
  assert.match(migration, /effective_to = p_effective_from - 1/);
  assert.match(migration, /next_rate\.effective_from - 1/);
  assert.match(migration, /A Production rate already starts.*P2408/s);
});

test("new resolution is direct-only and missing rate fails explicitly", () => {
  assert.match(resolver, /labourer_id = p_labourer_id/);
  assert.match(resolver, /production_crew_id is null/);
  assert.match(resolver, /Rate not set.*P2402/s);
  assert.doesNotMatch(resolver, /production_crew_assignments|crew_default/);
  assert.match(rangeService, /Rate not set for this labourer/);
  assert.doesNotMatch(rangeService, /production_crew_assignments|getCurrentProductionCrewAssignment|getCurrentCrewProductionWageRate/);
});

test("origin is optional selection metadata and never rate math", () => {
  assert.match(migration, /production_origin_label text/);
  assert.match(migration, /never affects rate resolution, eligibility, or accounting/);
  assert.match(bulkRateSetting, /Filter by Origin/);
  assert.match(managementDrawer, /setProductionLabourerOrigin/);
  assert.match(managementDrawer, /For identification and filtering only\. It never changes wage calculations\./);
  assert.doesNotMatch(resolver, /production_origin_label/);
  assert.doesNotMatch(rangeService, /origin/);
});

test("individual drawer and V2 bulk tools share the direct-rate mutation", () => {
  assert.equal((activeWorkflow.match(/<ProductionBulkRateSetting/g) ?? []).length, 1);
  assert.equal((bulkRateSetting.match(/setProductionLabourerRates\(/g) ?? []).length, 1);
  assert.equal((managementDrawer.match(/setProductionLabourerRates\(/g) ?? []).length, 1);
  for (const label of ["All matching workers", "Selected workers", "Effective from", "Backdated change"]) assert.ok(bulkRateSetting.includes(label));
  for (const label of ["Effective from", "Direct rate history"]) assert.ok(managementDrawer.includes(label));
  assert.doesNotMatch(bulkRateSetting, /crew|default rate|brick.?type/i);
  assert.doesNotMatch(managementDrawer, /crew|default rate/i);
});

test("migration preserves locked accounting, withdrawals, and Chamber Transport boundaries", () => {
  for (const table of ["weekly_earnings", "production_weekly_earning_details", "withdrawals", "transport_crews", "transport_workers", "transport_daily_entries"]) {
    const mutation = new RegExp(`(?:alter|drop|truncate|delete\\s+from|update|insert\\s+into)\\s+(?:table\\s+)?public\\.${table}\\b`, "i");
    assert.doesNotMatch(migration, mutation);
  }
  assert.doesNotMatch(migration, /create or replace function public\.calculate_production_wages/);
  assert.doesNotMatch(dashboard, /Calculate Wages/);
  assert.match(dashboard, /TransportOfficeSection/);
});
