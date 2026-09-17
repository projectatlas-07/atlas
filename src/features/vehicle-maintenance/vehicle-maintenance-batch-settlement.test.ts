import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000046_create_vehicle_maintenance_batch_settlement.sql",
  import.meta.url,
), "utf8");
const verifier = readFileSync(new URL(
  "../../../supabase/verify_vehicle_maintenance_batch_settlement.sql",
  import.meta.url,
), "utf8");
const component = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");

test("Garage batch settlement delegates one multi-allocation payment to shared authority", () => {
  assert.match(migration, /create_vehicle_maintenance_batch_payment/);
  assert.match(migration, /public\.create_expense_payment/);
  assert.match(migration, /allocations jsonb/);
  assert.doesNotMatch(migration, /create table|insert into public\.cash_book/i);
});

test("eligible Maintenance is factory, Garage, date, status, and due scoped", () => {
  assert.match(migration, /records\.factory_id = p_factory_id/);
  assert.match(migration, /records\.supplier_id = p_garage_id/);
  assert.match(migration, /records\.business_date between p_from_date and p_to_date/);
  assert.match(migration, /records\.status = 'active'/);
  assert.match(migration, /having records\.total_amount - coalesce\(sum\(existing\.allocated_amount\), 0\) > 0/);
  assert.match(migration, /role = 'GARAGE'/);
});

test("Garage batch locks deterministically, recomputes due, and allocates oldest-first", () => {
  assert.match(migration, /order by records\.id\s+for update of records/);
  assert.match(migration, /p_amount > period_outstanding/);
  assert.match(migration, /order by records\.business_date, records\.created_at, records\.id/);
  assert.match(migration, /using errcode = 'P4310'/);
});

test("trusted Maintenance batches may span more than 100 jobs", () => {
  assert.match(migration, /current_setting\('atlas\.internal_vehicle_maintenance_write', true\) is distinct from 'on'/);
  assert.match(verifier, /101 Maintenance jobs/);
});

test("Garage payment history groups one header and preserves allocation breakdown", () => {
  assert.match(migration, /list_vehicle_maintenance_batch_payments/);
  assert.match(migration, /jsonb_agg\(jsonb_build_object/);
  assert.match(migration, /group by payments\.id/);
  assert.match(component, /Each immutable payment appears once/);
  assert.match(component, /payment\.allocations\.map/);
});

test("UI replaces the individual-job dropdown with Garage/range Period Outstanding", () => {
  assert.match(component, /Settle Garage Dues/);
  assert.match(component, /Period Outstanding/);
  assert.match(component, /Save Garage Payment/);
  assert.doesNotMatch(component, /Outstanding Maintenance<select/);
});

test("Cash Book description is compact and Coal behavior remains intact", () => {
  assert.match(migration, /Maintenance payment · '/);
  assert.match(migration, /Coal seller settlement · '/);
  assert.match(component, /Garage settlement ·/);
});

test("rollback verifier covers allocation, atomicity, one Cash Book row, and isolation", () => {
  for (const phrase of [
    "oldest-first", "same-date stable ordering", "partial final allocation",
    "one Cash Book Money Out", "another Garage", "outside range",
    "factory-isolated", "atomic", "rolled back all fixtures",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});
