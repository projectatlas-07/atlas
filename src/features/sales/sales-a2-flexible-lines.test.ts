import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260831000027_create_challan_flexible_line_foundation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_a2.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const domainTypes = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const supabaseTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");

test("A2 adds a relational, factory-scoped flexible-line table with only the requested fields", () => {
  for (const pattern of [
    /create table public\.challan_flexible_lines/i,
    /id uuid primary key default gen_random_uuid\(\)/i,
    /factory_id uuid not null references public\.factories/i,
    /challan_id uuid not null/i,
    /line_type text not null/i,
    /line_category text not null/i,
    /order_index integer not null/i,
    /particulars text not null/i,
    /quantity numeric\(18, 3\)/i,
    /rate numeric\(18, 2\)/i,
    /amount numeric\(18, 2\) not null/i,
    /foreign key \(challan_id, factory_id\)[\s\S]*references public\.challans\(id, factory_id\)/i,
    /unique \(challan_id, order_index\)/i,
  ]) assert.match(migration, pattern);

  assert.doesNotMatch(migration, /alter table public\.challan_items/i);
  assert.doesNotMatch(migration, /alter table public\.challans[\s\S]*add column/i);
});

test("A2 supports exactly NOTE and EXTRA_CHARGE with database-derived categories", () => {
  const typeConstraint = migration.slice(
    migration.indexOf("constraint challan_flexible_lines_type_check"),
    migration.indexOf("constraint challan_flexible_lines_category_check"),
  );
  assert.match(typeConstraint, /line_type in \('NOTE', 'EXTRA_CHARGE'\)/);
  assert.doesNotMatch(typeConstraint, /OTHER_GOODS/);

  assert.match(migration, /line_category in \('OTHER_REVENUE', 'NON_FINANCIAL'\)/);
  assert.match(domainTypes, /"BRICK_REVENUE"[\s\S]*"OTHER_REVENUE"[\s\S]*"NON_FINANCIAL"/);
  assert.match(service, /lineCategory: "BRICK_REVENUE"/);
  assert.doesNotMatch(domainTypes, /OTHER_GOODS/);
});

test("NOTE and EXTRA_CHARGE financial semantics are enforced by constraints and the private writer", () => {
  for (const pattern of [
    /line_type = 'NOTE'[\s\S]*line_category = 'NON_FINANCIAL'[\s\S]*quantity is null[\s\S]*rate is null[\s\S]*amount = 0/i,
    /line_type = 'EXTRA_CHARGE'[\s\S]*line_category = 'OTHER_REVENUE'[\s\S]*amount > 0/i,
    /amount = round\(quantity \* rate, 2\)/i,
    /NOTE can contain only line_type, order_index, and particulars; its amount is always zero/i,
    /quantity and rate must be supplied together/i,
    /amount must equal quantity multiplied by rate/i,
    /order_index must be a non-negative whole number/i,
  ]) assert.match(migration, pattern);
});

test("A2 preserves old RPC signatures and adds controlled atomic overloads", () => {
  for (const signature of [
    /create_challan\(uuid, date, uuid, text, numeric, jsonb, jsonb\)/i,
    /update_challan\(uuid, uuid, date, uuid, text, numeric, jsonb, jsonb\)/i,
  ]) {
    assert.match(migration, signature);
  }
  assert.match(migration, /from public\.create_challan\([\s\S]*p_items[\s\S]*\);/i);
  assert.match(migration, /from public\.update_challan\([\s\S]*p_items[\s\S]*\);/i);
  assert.match(migration, /if p_flexible_lines is not null then/i);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on function public\.replace_challan_flexible_lines/i);
  assert.match(migration, /grant execute on function public\.create_challan[\s\S]*to authenticated/i);
});

test("A2 leaves authoritative totals untouched while Correction D consumes its saved lines", () => {
  assert.doesNotMatch(migration, /update public\.challans[\s\S]*challan_total\s*=/i);
  assert.doesNotMatch(migration, /execute function public\.recalculate_challan_total/i);
  assert.match(printModel, /challan\.flexibleLines/);
  assert.match(migration, /Excluded from challan_total until A4/i);
});

test("service and generated types expose validated, ordered flexible lines without UI work", () => {
  for (const token of [
    "ChallanFlexibleLineInput",
    "ChallanNoteLine",
    "ChallanExtraChargeLine",
    "flexibleLines",
    "p_flexible_lines",
    "challan_flexible_lines",
    "order_index",
  ]) assert.match(service + domainTypes + supabaseTypes, new RegExp(token));

  assert.match(service, /\.order\("order_index", \{ ascending: true \}\)/);
  assert.match(service, /p_flexible_lines: validated\.flexibleLines \?\? \[\]/);
  assert.match(service, /p_flexible_lines: validated\.flexibleLines \?\? null/);
  assert.match(service, /must equal quantity multiplied by rate/);
});

test("focused SQL verifier covers A2 behavior, isolation, compatibility, and milestone boundaries", () => {
  for (const phrase of [
    "NOTE cannot contain a financial amount",
    "NOTE requires meaningful particulars",
    "contradictory quantity rate and amount are rejected",
    "incomplete quantity and rate combinations are rejected",
    "negative order_index is rejected",
    "duplicate order_index within one Challan is rejected",
    "before payment lock flexible lines can be edited and removed by atomic collection replacement",
    "factory_id cannot disagree with the parent Challan",
    "existing create_challan flows without flexible lines still work",
    "existing update_challan flows without flexible lines preserve",
    "immutable through normal edit flows after payment lock",
    "payment, outstanding, and Sales Register source values remain brick-only",
    "numbering, void, and immutable A1 company snapshot behavior remains unchanged",
    "A3/A4/A5 remain unimplemented",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});
