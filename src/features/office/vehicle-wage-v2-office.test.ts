import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260901000031_create_vehicle_wage_payment_foundation.sql", import.meta.url),
  "utf8",
);
const component = readFileSync(
  new URL("./components/vehicle-wage-accounts-section.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../sales/services/vehicle-wage-service.ts", import.meta.url),
  "utf8",
);
const challanService = readFileSync(
  new URL("../sales/services/challan-service.ts", import.meta.url),
  "utf8",
);
const officeModel = readFileSync(
  new URL("./sales-office-model.ts", import.meta.url),
  "utf8",
);
const cashBookMigration = readFileSync(
  new URL("../../../supabase/migrations/20260828000024_create_expense_purchase_foundation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_vehicle_wage_v2.sql", import.meta.url),
  "utf8",
);
const concurrencyVerifier = readFileSync(
  new URL("../../../scripts/verify-vehicle-wage-v2-concurrency.mjs", import.meta.url),
  "utf8",
);

test("00031 adds one immutable factory-safe payment ledger without earnings or balance storage", () => {
  assert.match(migration, /create table public\.vehicle_wage_payments/);
  assert.match(migration, /foreign key \(vehicle_id, factory_id\)[\s\S]*references public\.vehicles\(id, factory_id\) on delete restrict/);
  assert.match(migration, /before update or delete on public\.vehicle_wage_payments/);
  assert.match(migration, /revoke all on public\.vehicle_wage_payments from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.vehicle_wage_payments to authenticated/);
  assert.doesNotMatch(migration, /vehicle_wage_earnings|current_balance|add column (?:total_earned|total_paid)/);
});

test("lifetime authority aggregates eligible Challans and payments separately", () => {
  const authority = migration.slice(
    migration.indexOf("create or replace function public.get_vehicle_wage_account_totals"),
    migration.indexOf("create or replace function public.get_vehicle_wage_account_summary"),
  );
  assert.match(authority, /challans\.status = 'active'/);
  assert.match(authority, /challans\.delivery_wage_applicable_snapshot = true/);
  assert.match(authority, /sum\(challans\.trip_labour_wage\)/);
  assert.match(authority, /sum\(payments\.amount\)/);
  assert.doesNotMatch(authority, /\bjoin\b/i);
  assert.match(authority, /total_earned - totals\.total_paid/);
});

test("payments and Challan exposure changes share deterministic account locking", () => {
  const payment = migration.slice(
    migration.indexOf("create or replace function public.record_vehicle_wage_payment"),
    migration.indexOf("create or replace function public.guard_challan_vehicle_wage_balance"),
  );
  const guard = migration.slice(
    migration.indexOf("create or replace function public.guard_challan_vehicle_wage_balance"),
    migration.indexOf("revoke all on function public.prevent_vehicle_wage_payment_mutation"),
  );
  for (const definition of [payment, guard]) {
    assert.match(definition, /pg_advisory_xact_lock/);
    assert.match(definition, /vehicle_wage_account:/);
  }
  assert.match(guard, /array_agg\(vehicle_id order by vehicle_id\)/);
  assert.match(guard, /old\.status = 'active'/);
  assert.match(guard, /new\.status = 'active'/);
  assert.match(guard, /current_account\.total_paid > projected_earned/);
  assert.match(migration, /before update on public\.challans/);
});

test("RPC-only writes enforce factory access, exact money, available balance, and audit identity", () => {
  assert.match(migration, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(migration, /Vehicle does not belong to this factory.*P3102/);
  assert.match(migration, /p_amount > current_account\.available_balance/);
  assert.match(migration, /Payment exceeds available Vehicle wage balance[\s\S]*P3110/);
  assert.match(migration, /normalized_note, auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.record_vehicle_wage_payment/);
  assert.doesNotMatch(migration, /grant insert|for insert/);
});

test("UI separates range reporting from lifetime solvency and refreshes after payment", () => {
  for (const label of [
    "Earned in selected range", "Lifetime Earned", "Lifetime Paid",
    "Lifetime Available", "Record Payment", "Payment History", "Trip History",
  ]) assert.match(component, new RegExp(label));
  assert.match(component, /lifetimeQuery\.data\.availableBalance <= 0/);
  assert.match(component, /setQueryData<VehicleWageLifetimeAccount>/);
  assert.match(component, /setQueryData<VehicleWagePayment\[\]>/);
  assert.match(component, /Archived[\s\S]*Tracking[\s\S]*Settlement remains available/);
  assert.doesNotMatch(component, /Edit Payment|Delete Payment|Adjustment|Add Wage/);
});

test("service uses the account RPC, controlled payment RPC, and RLS history read", () => {
  assert.match(service, /\.rpc\("get_vehicle_wage_account_summary"/);
  assert.match(service, /\.rpc\("record_vehicle_wage_payment"/);
  assert.match(service, /\.from\("vehicle_wage_payments"\)/);
  assert.match(service, /Payment exceeds available Vehicle wage balance/);
  assert.match(service, /changed while you were saving/);
  assert.match(challanService, /P3111[\s\S]*overpay the Vehicle wage account/);
  assert.match(officeModel, /P3111[\s\S]*overpay the Vehicle wage account/);
});

test("V2 does not modify customer or Cash Book financial sources", () => {
  assert.doesNotMatch(migration, /customer_payments|customer_payment_allocations|challan_total|cash_book/);
  assert.match(cashBookMigration, /expense_payments/);
  assert.doesNotMatch(cashBookMigration, /vehicle_wage_payments/);
});

test("rollback verifier and live concurrency runner cover the V2 integrity matrix", () => {
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
  for (const scenario of [
    "overpayment", "zero payment", "negative payment", "Factory A cannot",
    "archived", "Tracking-OFF", "void-before-payment", "payment-before-void",
    "downward wage edit", "Vehicle removal", "Vehicle move", "solvent Vehicle move",
    "immutable trigger",
  ]) assert.match(verifier, new RegExp(scenario, "i"));
  assert.match(concurrencyVerifier, /Promise\.all/);
  assert.match(concurrencyVerifier, /Exactly one competing ₹700 payment must succeed/);
  assert.match(concurrencyVerifier, /Exactly one payment\/void race participant must succeed/);
  assert.match(concurrencyVerifier, /total_paid\) <= Number\(mutationRaceAccount\.total_earned/);
});

test("V2.1 verifier distinguishes exact solvency from a genuinely insolvent reduction", () => {
  assert.match(verifier, /1250 - 500 \+ 250 = 1000/);
  assert.match(verifier, /exact-solvency downward edit did not produce 1000 \/ 1000 \/ 0/);
  assert.match(verifier, /1000 - 250 \+ 200 = 950/);
  assert.match(verifier, /downward wage edit cannot make the source Vehicle overpaid[\s\S]*edit_wage_challan\(%L::uuid,%L::uuid,200\)/);
  assert.match(verifier, /solvent downward edit did not produce 1250 \/ 500 \/ 750/);
});
