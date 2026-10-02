import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000039_create_vehicle_maintenance_module.sql",
  import.meta.url,
), "utf8");
const verifier = readFileSync(new URL(
  "../../../supabase/verify_vehicle_maintenance_module.sql",
  import.meta.url,
), "utf8");
const paymentListRepair = readFileSync(new URL(
  "../../../supabase/migrations/20260914000040_fix_vehicle_maintenance_payment_list_ambiguity.sql",
  import.meta.url,
), "utf8");
const component = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");
const dashboard = readFileSync(new URL(
  "../office/components/office-dashboard.tsx",
  import.meta.url,
), "utf8");
const searchChoice = readFileSync(new URL(
  "../office/components/search-choice.tsx",
  import.meta.url,
), "utf8");

test("Maintenance is a one-to-one structured extension of shared expense obligations", () => {
  assert.match(migration, /references public\.expense_records\(id, factory_id\)/);
  assert.match(migration, /references public\.vehicles\(id, factory_id\)/);
  assert.match(migration, /from public\.suppliers/);
  assert.doesNotMatch(migration, /create table public\.(maintenance_payments|garages)/);
});

test("initial and later payments reuse immutable expense payments and Cash Book", () => {
  assert.match(migration, /public\.create_expense_payment/);
  assert.match(migration, /expense_payment_allocations/);
  assert.match(migration, /create_vehicle_maintenance_payment/);
  assert.doesNotMatch(migration, /insert into public\.cash_book|create table public\.maintenance_cash/i);
  assert.match(component, /Cash Book Money Out/);
});

test("Vehicle identity and readable historical snapshots are both stored", () => {
  assert.match(migration, /vehicle_id uuid not null/);
  assert.match(migration, /vehicle_number_snapshot text not null/);
  assert.match(migration, /Archived Vehicles cannot receive new Maintenance/);
  assert.match(component, /vehicle\.isActive \|\| vehicle\.id === form\.vehicleId/);
  assert.match(component, /Archived/);
});

test("financial lifecycle blocks generic mutation and generic payment bypass", () => {
  assert.match(migration, /guard_vehicle_maintenance_expense_mutation/);
  assert.match(migration, /guard_vehicle_maintenance_payment_allocation/);
  assert.match(migration, /target_record\.status <> 'active' or target_record\.is_locked/);
  assert.match(component, /Payment history locks this Maintenance job/);
});

test("dedicated UI has searchable Vehicle and Garage selection plus histories", () => {
  assert.match(dashboard, /<VehicleMaintenanceOfficeSection factoryId=\{factoryId!\}/);
  assert.match(searchChoice, /role="combobox"/);
  assert.match(component, /Add Garage/);
  assert.match(component, /Recent Maintenance/);
  assert.match(component, /Recent Garage Payments/);
});

test("generic Expenses excludes Maintenance while preserving the Coal exclusion", () => {
  assert.match(migration, /from public\.coal_purchases/);
  assert.match(migration, /from public\.vehicle_maintenance_records/);
  assert.match(migration, /Lists generic Expense\/Purchase records only/);
});

test("rollback verifier covers required relational and financial invariants", () => {
  for (const phrase of [
    "factory-isolated", "initial payment", "later payment", "overpayment",
    "archived Vehicle", "generic Expense", "rolled back all fixtures",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});

test("payment history ownership checks avoid RETURNS TABLE column ambiguity", () => {
  assert.match(paymentListRepair, /requested_vehicle\.factory_id = p_factory_id/);
  assert.match(paymentListRepair, /requested_garage\.factory_id = p_factory_id/);
  assert.match(paymentListRepair, /authorized_user\.factory_id = p_factory_id/);
});
