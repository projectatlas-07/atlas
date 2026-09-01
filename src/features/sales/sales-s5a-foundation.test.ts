import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260827000021_create_customer_payment_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_s5a.sql", import.meta.url),
  "utf8",
);
const concurrencyVerifier = readFileSync(
  new URL("../../../scripts/verify-sales-s5a-concurrency.mjs", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("./services/customer-payment-service.ts", import.meta.url),
  "utf8",
);
const supabaseTypes = readFileSync(
  new URL("../../types/supabase.ts", import.meta.url),
  "utf8",
);

test("S5A stays bounded to customer payment storage, allocation, and read foundations", () => {
  assert.match(migration, /create table public\.customer_payments/);
  assert.match(migration, /create table public\.customer_payment_allocations/);
  assert.doesNotMatch(migration, /cash_book|general_ledger|chart_of_accounts|expense|purchase/i);
  assert.doesNotMatch(service, /react|component/i);
});

test("one immutable payment header owns explicit unique positive Challan allocations", () => {
  assert.match(migration, /customer_payment_allocations_payment_challan_key[\s\S]*unique \(payment_id, challan_id\)/);
  assert.match(migration, /allocated_amount > 0/);
  assert.match(migration, /foreign key \(payment_id, factory_id\)/);
  assert.match(migration, /foreign key \(challan_id, factory_id\)/);
  assert.match(migration, /customer_payments_prevent_update_delete/);
  assert.match(migration, /customer_payment_allocations_prevent_update_delete/);
  assert.doesNotMatch(migration, /function public\.(update|delete|edit|reverse)_customer_payment/);
});

test("atomic RPC validates equality and identity before insert, locks deterministically, and prevents overpayment", () => {
  const createFunction = migration.slice(
    migration.indexOf("create or replace function public.create_customer_payment"),
    migration.indexOf("create or replace function public.get_challan_payment_state"),
  );
  assert.match(createFunction, /allocation_total <> p_amount/);
  assert.match(createFunction, /target_challan\.customer_id <> p_customer_id/);
  assert.match(createFunction, /target_challan\.status <> 'active'/);
  assert.match(createFunction, /order by target\.id[\s\S]*for update/);
  assert.match(createFunction, /existing_paid[\s\S]*target_challan\.challan_total/);
  assert.match(createFunction, /insert into public\.customer_payments/);
  assert.match(createFunction, /insert into public\.customer_payment_allocations/);
  assert.match(createFunction, /set is_locked = true/);
  assert.doesNotMatch(createFunction, /oldest|challan_date/);
});

test("outstanding and payment state remain authoritative derived reads", () => {
  assert.match(migration, /function public\.get_challan_payment_state/);
  assert.match(migration, /sum\(allocations\.allocated_amount\)/);
  assert.match(migration, /when total_paid = 0 then 'unpaid'/);
  assert.match(migration, /when total_paid < sale_total then 'partially_paid'/);
  assert.match(migration, /function public\.get_customer_sales_summary/);
  assert.match(migration, /challans\.status = 'active'/);
  assert.match(migration, /total_outstanding := total_active_sales - total_payments_allocated/);
  assert.doesNotMatch(migration, /add column (outstanding|payment_state)/i);
});

test("payment tables expose factory-scoped reads but no direct authenticated mutation", () => {
  for (const table of ["customer_payments", "customer_payment_allocations"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant select on public\\.${table} to authenticated`));
  }
  assert.match(migration, /revoke all on public\.customer_payments from public, anon, authenticated/);
  assert.match(migration, /revoke all on public\.customer_payment_allocations from public, anon, authenticated/);
  for (const rpc of [
    "create_customer_payment",
    "get_challan_payment_state",
    "get_customer_sales_summary",
  ]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(supabaseTypes, new RegExp(`${rpc}:`));
  }
  assert.match(migration, /security definer/g);
  assert.match(migration, /set search_path = pg_catalog, public/g);
});

test("Sales service writes only through the controlled RPC and keeps source IDs for history", () => {
  assert.match(service, /supabase\.rpc\("create_customer_payment"/);
  assert.doesNotMatch(service, /from\("customer_payments"\)[\s\S]*\.(insert|update|delete)\(/);
  assert.match(service, /paymentId: row\.payment_id/);
  assert.match(service, /challanId: row\.challan_id/);
  assert.match(service, /getChallanPaymentState/);
  assert.match(service, /getCustomerSalesSummary/);
  assert.match(service, /listCustomerPayments/);
});

test("verifiers cover rollback, lifecycle, factory isolation, and genuine concurrent overpayment", () => {
  for (const phrase of [
    "single-Challan payment state",
    "fully paid Challan rejects another allocation",
    "explicit payment clears #2 only",
    "one valid and one invalid allocation rolls back atomically",
    "void Challan rejects allocation",
    "Factory B cannot read Factory A",
  ]) assert.match(verifier, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(concurrencyVerifier, /await Promise\.all\(\[/);
  assert.match(concurrencyVerifier, /Verifier Challan must start with ₹10,000 outstanding/);
  assert.match(concurrencyVerifier, /Unexpected concurrent create_customer_payment results/);
  assert.match(concurrencyVerifier, /result\.error\.code/);
  assert.match(concurrencyVerifier, /Exactly one competing ₹8,000 payment must succeed/);
  assert.match(concurrencyVerifier, /allocations\.reduce/);
  assert.match(concurrencyVerifier, /ATLAS_S5A_ALLOW_PERMANENT_TEST_ROWS/);
});
