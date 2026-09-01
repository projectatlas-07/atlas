import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260901000032_integrate_vehicle_wage_payments_with_cash_book.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_vehicle_wage_cash_book_v3.sql", import.meta.url),
  "utf8",
);
const cashBookService = readFileSync(new URL("./services/cash-book-service.ts", import.meta.url), "utf8");
const cashBookTypes = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const cashBookUi = readFileSync(
  new URL("../office/components/cash-book-office-section.tsx", import.meta.url),
  "utf8",
);
const vehicleWageUi = readFileSync(
  new URL("../office/components/vehicle-wage-accounts-section.tsx", import.meta.url),
  "utf8",
);
const paymentMigration = readFileSync(
  new URL("../../../supabase/migrations/20260901000031_create_vehicle_wage_payment_foundation.sql", import.meta.url),
  "utf8",
);

function cashBookSourceFunction(): string {
  return migration.slice(
    migration.indexOf("create or replace function public.get_cash_book_source_movements"),
    migration.indexOf("revoke all on function public.get_cash_book_source_movements"),
  );
}

test("00032 is a forward-only derived Cash Book integration with no copied ledger", () => {
  assert.match(migration, /^begin;$/m);
  assert.match(migration, /^commit;$/m);
  assert.match(migration, /create or replace function public\.get_cash_book_source_movements/);
  assert.match(migration, /create index vehicle_wage_payments_factory_cash_book_idx/);
  assert.doesNotMatch(migration, /create table|alter table|insert into|update public|delete from|trigger/i);
  assert.doesNotMatch(migration, /record_vehicle_wage_payment|get_vehicle_wage_account_totals|challan_total/);
});

test("one immutable Vehicle payment header projects one normalized Money Out source row", () => {
  const source = cashBookSourceFunction();
  const vehicleBranch = source.slice(source.lastIndexOf("union all"));
  assert.match(source, /'vehicle_wage_payment'::text, payments\.id, payments\.payment_date, 'out'::text/);
  assert.match(source, /payments\.amount, 'unspecified'::text, vehicles\.vehicle_number/);
  assert.match(source, /'Vehicle Wage Payment'::text/);
  assert.match(source, /from public\.vehicle_wage_payments as payments/);
  assert.match(source, /vehicles\.id = payments\.vehicle_id[\s\S]*vehicles\.factory_id = payments\.factory_id/);
  assert.doesNotMatch(vehicleBranch, /is_active|delivery_wage_tracking_enabled|sum\(|group by|distinct/i);
});

test("the replacement preserves every established Cash Book source and private function contract", () => {
  const source = cashBookSourceFunction();
  for (const marker of [
    "'customer_payment'::text",
    "'manual_cash_entry'::text",
    "'expense_payment'::text",
    "'vehicle_wage_payment'::text",
  ]) assert.equal(source.split(marker).length - 1, 1, `${marker} must have one source branch`);
  assert.match(migration, /language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(migration, /revoke all on function public\.get_cash_book_source_movements\(uuid\)[\s\S]*from public, anon, authenticated/);
});

test("Cash Book runtime and UI render Vehicle wage payments without a second entry workflow", () => {
  assert.match(cashBookTypes, /"vehicle_wage_payment"/);
  assert.match(cashBookService, /"vehicle_wage_payment"/);
  assert.match(cashBookUi, /entry\.sourceType === "vehicle_wage_payment"/);
  assert.match(cashBookUi, /Vehicle Wage Payment/);
  assert.match(cashBookUi, /Vehicle wage payments appear automatically/);
  assert.doesNotMatch(cashBookUi, /recordVehicleWagePayment|vehicle_wage_payments/);
  assert.match(vehicleWageUi, /\["office-cash-book-day", factoryId\]/);
  assert.doesNotMatch(vehicleWageUi, /createCashBookManualEntry|cash_book_manual_entries/);
});

test("V3 leaves V2 payment authority and concurrency protection in 00031", () => {
  const vehicleBranch = cashBookSourceFunction().slice(
    cashBookSourceFunction().lastIndexOf("union all"),
  );
  assert.match(paymentMigration, /pg_advisory_xact_lock/);
  assert.match(paymentMigration, /p_amount > current_account\.available_balance/);
  assert.match(paymentMigration, /before update or delete on public\.vehicle_wage_payments/);
  assert.doesNotMatch(migration, /pg_advisory_xact_lock|available_balance/);
  assert.doesNotMatch(vehicleBranch, /customer_payment|expense_payment|cash_book_manual_entries/);
});

test("rollback verifier covers exact totals, dates, lifecycle stability, failures, isolation, and regressions", () => {
  assert.match(verifier, /^begin;$/m);
  assert.match(verifier, /^rollback;$/m);
  for (const scenario of [
    "₹1,200 Vehicle wage payment produces one exact Money Out row and total",
    "two Vehicle payments remain two rows on their authoritative payment dates",
    "over-limit payment creates no Cash Book outflow",
    "archive and Tracking OFF do not change historical Cash Book payments",
    "Vehicle account and customer financial totals remain authoritative",
    "absolutely factory-isolated",
    "customer, manual, and supplier/expense Cash Book flows still work",
  ]) assert.match(verifier, new RegExp(scenario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});
