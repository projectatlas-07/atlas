import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260901000033_create_vehicle_wage_payment_reversals.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_vehicle_wage_v4.sql", import.meta.url),
  "utf8",
);
const concurrencyVerifier = readFileSync(
  new URL("../../../scripts/verify-vehicle-wage-v4-concurrency.mjs", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/vehicle-wage-service.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("./vehicle-wage-model.ts", import.meta.url), "utf8");
const vehicleUi = readFileSync(
  new URL("../office/components/vehicle-wage-accounts-section.tsx", import.meta.url),
  "utf8",
);
const cashBookUi = readFileSync(
  new URL("../office/components/cash-book-office-section.tsx", import.meta.url),
  "utf8",
);

function functionBody(name: string, next: string): string {
  return migration.slice(migration.indexOf(name), migration.indexOf(next));
}

test("00033 adds one immutable full-reversal ledger without editing payments or storing adjustment amounts", () => {
  const table = migration.slice(
    migration.indexOf("create table public.vehicle_wage_payment_reversals"),
    migration.indexOf("create index vehicle_wage_payment_reversals_factory_history_idx"),
  );
  assert.match(table, /payment_id uuid not null unique/);
  assert.match(table, /foreign key \(payment_id, factory_id\)[\s\S]*vehicle_wage_payments\(id, factory_id\) on delete restrict/);
  assert.match(table, /reversal_date date not null/);
  assert.match(table, /reason text not null/);
  assert.match(table, /created_at timestamptz not null default now\(\)/);
  assert.match(table, /created_by uuid not null/);
  assert.doesNotMatch(table, /\bamount\b|partial/);
  assert.match(migration, /before update or delete on public\.vehicle_wage_payment_reversals/);
  assert.doesNotMatch(migration, /update public\.vehicle_wage_payments|delete from public\.vehicle_wage_payments/);
});

test("effective Paid has one authority that excludes a linked reversed payment", () => {
  const totals = functionBody(
    "create or replace function public.get_vehicle_wage_account_totals",
    "create or replace function public.reverse_vehicle_wage_payment",
  );
  assert.match(totals, /sum\(payments\.amount\)/);
  assert.match(totals, /not exists[\s\S]*vehicle_wage_payment_reversals/);
  assert.match(totals, /totals\.total_earned - totals\.total_paid/);
  assert.doesNotMatch(totals, /sum\(reversals\.|reversal_amount|stored_balance/i);
  for (const consumer of [
    "record_vehicle_wage_payment",
    "guard_challan_vehicle_wage_balance",
  ]) assert.match(migration + readFileSync(
    new URL("../../../supabase/migrations/20260901000031_create_vehicle_wage_payment_foundation.sql", import.meta.url),
    "utf8",
  ), new RegExp(`${consumer}[\\s\\S]*get_vehicle_wage_account_totals`));
});

test("reversal RPC validates, serializes, prevents duplicates, and returns server totals", () => {
  const rpc = functionBody(
    "create or replace function public.reverse_vehicle_wage_payment",
    "create or replace function public.get_cash_book_source_movements",
  );
  assert.match(rpc, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(rpc, /p_reversal_date < target_payment\.payment_date/);
  assert.match(rpc, /normalized_reason/);
  assert.match(rpc, /vehicle_wage_account:/);
  assert.match(rpc, /pg_advisory_xact_lock/);
  assert.match(rpc, /already been reversed[\s\S]*P3121/);
  assert.match(rpc, /insert into public\.vehicle_wage_payment_reversals/);
  assert.match(rpc, /get_vehicle_wage_account_totals/);
  assert.match(migration, /grant execute on function public\.reverse_vehicle_wage_payment[\s\S]*to authenticated/);
});

test("Cash Book remains append-only with original Money Out plus one equal reversal Money In", () => {
  const cash = functionBody(
    "create or replace function public.get_cash_book_source_movements",
    "revoke all on function public.prevent_vehicle_wage_payment_reversal_mutation",
  );
  assert.match(cash, /'vehicle_wage_payment'::text, payments\.id, payments\.payment_date, 'out'::text/);
  assert.match(cash, /'vehicle_wage_payment_reversal'::text, reversals\.id[\s\S]*reversals\.reversal_date, 'in'::text/);
  assert.match(cash, /payments\.amount[\s\S]*'Vehicle Wage Payment Reversal'::text/);
  assert.match(cash, /reversals\.payment_id[\s\S]*payments\.factory_id = reversals\.factory_id/);
  assert.doesNotMatch(cash.slice(cash.lastIndexOf("union all")), /is_active|delivery_wage_tracking_enabled|sum\(|group by/i);
});

test("service and minimal UI expose immutable reversal status and authoritative totals", () => {
  assert.match(model, /buildVehicleWagePaymentReversalInput/);
  assert.match(model, /applyVehicleWagePaymentReversal/);
  assert.match(service, /\.rpc\("reverse_vehicle_wage_payment"/);
  assert.match(service, /\.from\("vehicle_wage_payment_reversals"\)/);
  assert.match(service, /already been reversed/);
  assert.match(vehicleUi, /Reverse Payment/);
  assert.match(vehicleUi, /Confirm Reversal/);
  assert.match(vehicleUi, /Reversed on/);
  assert.match(vehicleUi, /payment\.reversal/);
  assert.match(vehicleUi, /setQueryData<VehicleWageLifetimeAccount>/);
  assert.match(vehicleUi, /applyVehicleWagePaymentReversal/);
  assert.match(vehicleUi, /\["office-cash-book-day", factoryId\]/);
  assert.doesNotMatch(vehicleUi, /Edit Payment|Delete Payment|partial reversal|manual adjustment/i);
  assert.match(cashBookUi, /Vehicle Wage Payment Reversal/);
});

test("rollback and live verifiers cover lifecycle, Cash Book, solvency, isolation, and races", () => {
  assert.match(verifier, /^begin;$/m);
  assert.match(verifier, /^rollback;$/m);
  for (const scenario of [
    "₹1,200 full reversal restores Paid 0 / Available 2,000",
    "original Money Out and adds one equal dated reversal Money In",
    "second reversal attempt fails",
    "archived and Tracking-OFF Vehicles can reverse",
    "Challan solvency guard uses effective Paid",
    "customer financial totals",
    "Trip Labour Wage",
    "factory-isolated",
    "independently immutable",
  ]) assert.match(verifier, new RegExp(scenario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(concurrencyVerifier, /Promise\.all/g);
  assert.match(concurrencyVerifier, /concurrent reversal\/payment serialized/);
  assert.match(concurrencyVerifier, /Exactly one competing reversal must succeed/);
  assert.match(concurrencyVerifier, /total_paid\) <= Number\(accountAfterRace\.total_earned/);
});
