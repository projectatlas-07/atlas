import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000043_create_vehicle_fuel_batch_settlement.sql",
  import.meta.url,
), "utf8");
const unboundedMigration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000044_remove_vehicle_fuel_batch_allocation_cap.sql",
  import.meta.url,
), "utf8");
const compactDescriptionMigration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000047_compact_batch_expense_cash_book_descriptions.sql",
  import.meta.url,
), "utf8");
const verifier = readFileSync(new URL(
  "../../../supabase/verify_vehicle_fuel_batch_settlement.sql",
  import.meta.url,
), "utf8");
const component = readFileSync(new URL(
  "../office/components/vehicle-fuel-office-section.tsx",
  import.meta.url,
), "utf8");

test("batch settlement delegates one multi-allocation payment to the shared authority", () => {
  assert.match(migration, /create_vehicle_fuel_batch_payment/);
  assert.match(migration, /public\.create_expense_payment/);
  assert.match(migration, /allocations jsonb/);
  assert.doesNotMatch(migration, /create table|insert into public\.cash_book/i);
});

test("eligible Fuel is Pump/date/status scoped and allocated oldest date/time first", () => {
  assert.match(migration, /records\.supplier_id = p_pump_id/);
  assert.match(migration, /records\.business_date between p_from_date and p_to_date/);
  assert.match(migration, /records\.status = 'active'/);
  assert.match(migration, /having records\.total_amount - coalesce\(sum\(allocations\.allocated_amount\), 0\) > 0/);
  assert.match(migration, /order by records\.business_date, fuel\.fuel_time, records\.created_at, records\.id/);
});

test("batch locks obligations by stable UUID before recomputing authoritative outstanding", () => {
  assert.match(migration, /order by records\.id\s+for update of records/);
  assert.match(migration, /p_amount > period_outstanding/);
  assert.match(migration, /using errcode = 'P4510'/);
});

test("authoritative Fuel batches are not limited by the shared public 100-allocation guard", () => {
  assert.match(unboundedMigration, /current_setting\('atlas\.internal_vehicle_fuel_write', true\) is distinct from 'on'/);
  assert.match(unboundedMigration, /create or replace function public\.create_vehicle_fuel_batch_payment/);
  assert.doesNotMatch(unboundedMigration, /more than 100 Fuel entries/);
  assert.match(verifier, /101 allocations/);
});

test("Pump payment history groups allocation rows into one immutable payment row", () => {
  assert.match(migration, /list_vehicle_fuel_batch_payments/);
  assert.match(migration, /count\(allocations\.id\)/);
  assert.match(migration, /group by payments\.id/);
  assert.match(component, /Each payment appears once/);
  assert.match(compactDescriptionMigration, /jsonb_agg\(jsonb_build_object/);
  assert.match(component, /payment\.allocations\.map/);
});

test("UI replaces individual dropdown payment with Pump/range Period Outstanding", () => {
  assert.match(component, /Settle Pump Dues/);
  assert.match(component, /Period Outstanding/);
  assert.match(component, /Save Batch Payment/);
  assert.doesNotMatch(component, /Outstanding Fuel entry/);
});

test("rollback verifier covers deterministic allocations, one Cash Book row, isolation, and atomic failure", () => {
  for (const phrase of [
    "oldest-first", "same-date time ordering", "partial final allocation",
    "exactly one Cash Book Money Out", "another Pump", "outside range",
    "factory-isolated", "atomic", "rolled back all fixtures",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});
