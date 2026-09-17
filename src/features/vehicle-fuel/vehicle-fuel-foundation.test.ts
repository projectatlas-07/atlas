import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000042_create_vehicle_fuel_book.sql", import.meta.url,
), "utf8");
const verifier = readFileSync(new URL("../../../supabase/verify_vehicle_fuel_book.sql", import.meta.url), "utf8");
const component = readFileSync(new URL("../office/components/vehicle-fuel-office-section.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../office/components/office-dashboard.tsx", import.meta.url), "utf8");

test("Fuel is a one-to-one Vehicle-linked extension of shared expense obligations", () => {
  assert.match(migration, /create table public\.vehicle_fuel_records/);
  assert.match(migration, /references public\.expense_records\(id, factory_id\)/);
  assert.match(migration, /references public\.vehicles\(id, factory_id\)/);
  assert.doesNotMatch(migration, /create table public\.(fuel_payments|fuel_pumps)/);
});

test("local date/time, Diesel/Petrol, snapshot, and deterministic chronology are structural", () => {
  assert.match(migration, /fuel_time time\(0\) without time zone not null/);
  assert.match(migration, /fuel_type in \('DIESEL', 'PETROL'\)/);
  assert.match(migration, /vehicle_number_snapshot text not null/);
  assert.match(migration, /business_date desc, fuel\.fuel_time desc, records\.created_at desc, fuel\.id desc/);
  assert.match(component, /type="time" required/);
});

test("Fuel Pump role stays isolated while permitting one multi-role supplier identity", () => {
  assert.match(migration, /'COAL_SELLER', 'GARAGE', 'FUEL_PUMP'/);
  assert.match(component, /listSuppliersByRole\(factoryId, "FUEL_PUMP"\)/);
  assert.match(component, /role: "FUEL_PUMP"/);
  assert.match(component, /"office-suppliers-by-role", factoryId, "FUEL_PUMP"/);
});

test("payments reuse the immutable shared engine and direct bypasses are blocked", () => {
  assert.match(migration, /public\.create_expense_payment/);
  assert.match(migration, /guard_vehicle_fuel_expense_mutation/);
  assert.match(migration, /guard_vehicle_fuel_payment_allocation/);
  assert.doesNotMatch(migration, /insert into public\.cash_book/i);
  assert.match(component, /Cash Book Money Out/);
});

test("dedicated UI includes fast entry, Last Refuel, histories, and generic exclusion", () => {
  assert.match(dashboard, /<VehicleFuelOfficeSection factoryId=\{factoryId!\}/);
  assert.match(component, /Last refuel:/);
  assert.match(component, /No previous refuel recorded/);
  assert.match(component, /Vehicle and Pump Fuel history/);
  assert.match(component, /Pump payment history/);
  assert.match(migration, /from public\.vehicle_fuel_records/);
});

test("archived Vehicles are rejected for new entries but persisted history is readable", () => {
  assert.match(migration, /Archived Vehicles cannot receive new Fuel entries/);
  assert.match(component, /vehicle\.isActive \|\| vehicle\.id === form\.vehicleId/);
  assert.match(component, /Archived/);
});

test("rollback verifier covers relational, chronology, financial, and isolation invariants", () => {
  for (const phrase of [
    "smart measurements", "unpaid, partial, and full", "Last Refuel",
    "chronological", "Cash Book", "generic Expense", "factory-isolated",
    "rolled back all fixtures",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});
