import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../../supabase/migrations/20260827000023_create_cash_book_foundation.sql", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../../../supabase/verify_sales_s6a.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("./services/cash-book-service.ts", import.meta.url), "utf8");
const paymentService = readFileSync(new URL("../sales/services/customer-payment-service.ts", import.meta.url), "utf8");
const concurrencyVerifier = readFileSync(new URL("../../../scripts/verify-sales-s5a-concurrency.mjs", import.meta.url), "utf8");

test("S6A stays bounded to Cash Book foundation without building S6B or later accounting", () => {
  assert.match(migration, /create table public\.cash_book_initializations/);
  assert.match(migration, /create table public\.cash_book_manual_entries/);
  assert.doesNotMatch(migration, /general_ledger|chart_of_accounts|expense|purchase|vehicle_wage/i);
  assert.doesNotMatch(service, /general_ledger|chart_of_accounts|record_vehicle_wage_payment|vehicle_wage_payments/i);
  assert.doesNotMatch(service, /react|component|screen|jsx/i);
});

test("payment modes are constrained and historical S5 rows remain explicitly unspecified", () => {
  for (const mode of ["cash", "upi", "bank_transfer", "cheque", "other", "unspecified"]) {
    assert.match(migration, new RegExp(`'${mode}'`));
  }
  assert.match(migration, /add column payment_mode text not null default 'unspecified'/);
  assert.match(migration, /normalized_payment_mode not in \('cash', 'upi', 'bank_transfer', 'cheque', 'other'\)/);
  assert.match(paymentService, /p_payment_mode: input\.paymentMode/);
  assert.match(concurrencyVerifier, /p_payment_mode: "cash"/);
});

test("payment RPC keeps deterministic S5 locking and overpayment recheck", () => {
  const paymentFunction = migration.slice(
    migration.indexOf("create function public.create_customer_payment"),
    migration.indexOf("create table public.cash_book_initializations"),
  );
  assert.match(paymentFunction, /order by target\.id[\s\S]*for update/);
  assert.match(paymentFunction, /existing_paid[\s\S]*target_challan\.challan_total/);
  assert.match(paymentFunction, /set is_locked = true/);
  assert.match(paymentFunction, /insert into public\.customer_payments\([\s\S]*payment_mode/);
});

test("customer payments feed one Cash Book movement from the payment header, not allocations", () => {
  const sourceFunction = migration.slice(
    migration.indexOf("create or replace function public.get_cash_book_source_movements"),
    migration.indexOf("create or replace function public.get_cash_book_day_summary"),
  );
  assert.match(sourceFunction, /from public\.customer_payments as payments/);
  assert.match(sourceFunction, /'customer_payment'::text/);
  assert.match(sourceFunction, /payments\.id/);
  assert.match(sourceFunction, /payments\.amount/);
  assert.doesNotMatch(sourceFunction, /allocations\.allocated_amount/);
});

test("manual entries are positive idempotent events with void-only correction", () => {
  assert.match(migration, /amount > 0/);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /request ID was already used for different data/);
  assert.match(migration, /old\.status <> 'active'[\s\S]*new\.status <> 'void'/);
  assert.match(migration, /Manual Cash Book entries cannot be deleted/);
  assert.doesNotMatch(migration, /function public\.(update|delete)_cash_book_manual_entry/);
});

test("opening and closing are derived and carry forward active source movements", () => {
  assert.match(migration, /initialization\.opening_balance \+ totals\.prior_net/);
  assert.match(migration, /totals\.day_in - totals\.day_out/);
  assert.match(migration, /where source_status = 'active'/);
  assert.doesNotMatch(migration, /daily_closing_balance|daily_opening_balance/);
  assert.match(verifier, /no-transaction next day opens and closes at 70,000/);
});

test("Cash Book writes are RPC-only and reads remain factory-authorized", () => {
  assert.doesNotMatch(service, /\.from\(|\.insert\(|\.update\(|\.delete\(/);
  for (const rpc of [
    "initialize_cash_book",
    "create_cash_book_manual_entry",
    "void_cash_book_manual_entry",
    "get_cash_book_day_summary",
    "list_cash_book_day_entries",
  ]) assert.match(service, new RegExp(`supabase\\.rpc\\("${rpc}"`));
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /security definer/g);
  assert.match(migration, /set search_path = pg_catalog, public/g);
  assert.match(verifier, /Factory A user cannot read Factory B summary/);
});
