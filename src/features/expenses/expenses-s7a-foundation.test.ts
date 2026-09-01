import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260828000024_create_expense_purchase_foundation.sql", import.meta.url),
  "utf8",
);
const ambiguityRepair = readFileSync(
  new URL("../../../supabase/migrations/20260828000025_fix_expense_record_list_factory_id.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_expenses_s7a.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/expense-service.ts", import.meta.url), "utf8");
const concurrencyVerifier = readFileSync(
  new URL("../../../scripts/verify-expenses-s7a-concurrency.mjs", import.meta.url),
  "utf8",
);
const cashBookTypes = readFileSync(new URL("../cash-book/types.ts", import.meta.url), "utf8");

test("S7A stays bounded to database and service foundations without S7B or accounting", () => {
  assert.match(migration, /create table public\.suppliers/);
  assert.match(migration, /create table public\.expense_records/);
  assert.doesNotMatch(migration + service, /general_ledger|chart_of_accounts|profit_and_loss|vehicle_wage/i);
  assert.doesNotMatch(service, /react|component|screen|jsx/i);
});

test("purchase and expense are positive cost events separate from actual outgoing payments", () => {
  const expenseRecordTable = migration.slice(
    migration.indexOf("create table public.expense_records"),
    migration.indexOf("create table public.expense_payments"),
  );
  assert.match(migration, /kind in \('purchase', 'expense'\)/);
  assert.match(migration, /total_amount > 0/);
  assert.match(migration, /create table public\.expense_payments/);
  assert.match(migration, /create table public\.expense_payment_allocations/);
  assert.doesNotMatch(expenseRecordTable, /payment_mode/);
});

test("supplier identity is factory-scoped and snapshotted onto each source", () => {
  assert.match(migration, /expense_records_supplier_factory_fkey/);
  assert.match(migration, /counterparty_name_snapshot/);
  assert.match(migration, /snapshot_name, snapshot_address, snapshot_mobile/);
  assert.match(verifier, /supplier edit rewrote historical purchase snapshot/);
});

test("source lifecycle allows correction before payment and locks after first allocation", () => {
  assert.match(migration, /create or replace function public\.update_expense_record/);
  assert.match(migration, /target_record\.is_locked or exists/);
  assert.match(migration, /create or replace function public\.void_expense_record/);
  assert.match(migration, /set is_locked = true/);
  assert.match(migration, /Expense\/Purchase records cannot be deleted/);
});

test("atomic outgoing payment uses explicit equal allocations and deterministic locks", () => {
  const paymentFunction = migration.slice(
    migration.indexOf("create or replace function public.create_expense_payment"),
    migration.indexOf("create or replace function public.list_expense_records"),
  );
  assert.match(paymentFunction, /allocation_total <> p_amount/);
  assert.match(paymentFunction, /same Expense\/Purchase cannot appear twice/);
  assert.match(paymentFunction, /order by target\.id[\s\S]*for update/);
  assert.match(paymentFunction, /existing_paid[\s\S]*outstanding amount/);
  assert.match(paymentFunction, /insert into public\.expense_payments[\s\S]*insert into public\.expense_payment_allocations/);
});

test("outstanding and supplier totals are derived rather than stored", () => {
  assert.match(migration, /records\.total_amount - coalesce\(paid\.total_paid, 0\)/);
  assert.match(migration, /'partially_paid'/);
  assert.doesNotMatch(migration.slice(
    migration.indexOf("create table public.expense_records"),
    migration.indexOf("create table public.expense_payments"),
  ), /outstanding_amount|total_paid/);
});

test("one outgoing payment header feeds exactly one Cash Book Money Out movement", () => {
  const cashFunction = migration.slice(
    migration.indexOf("create or replace function public.get_cash_book_source_movements"),
    migration.indexOf("revoke all on function public.reject_supplier_delete"),
  );
  assert.match(cashFunction, /'expense_payment'::text/);
  assert.match(cashFunction, /payments\.id, payments\.payment_date, 'out'::text/);
  assert.match(cashFunction, /from public\.expense_payments as payments/);
  assert.doesNotMatch(cashFunction, /allocations\.allocated_amount/);
  assert.match(cashBookTypes, /"expense_payment"/);
  assert.match(verifier, /multi-source payment duplicated Cash Book Money Out/);
});

test("financial tables are factory-readable but controlled-write only", () => {
  for (const table of ["suppliers", "expense_records", "expense_payments", "expense_payment_allocations"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table}`));
  }
  assert.doesNotMatch(service, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(migration, /security definer/g);
  assert.match(migration, /set search_path = pg_catalog, public/g);
});

test("verifiers cover rollback, lifecycle, Cash Book, isolation, and real concurrency", () => {
  for (const phrase of [
    "payment/allocation mismatch rolls back",
    "one invalid allocation rolls back entire payment",
    "paid purchase cannot be updated",
    "void source cannot receive payment",
    "factory-isolated",
  ]) assert.match(verifier, new RegExp(phrase));
  assert.match(concurrencyVerifier, /Promise\.all/);
  assert.match(concurrencyVerifier, /Exactly one competing ₹8,000 expense payment must succeed/);
  assert.match(concurrencyVerifier, /outstanding_amount.*2000/s);
});

test("forward repair qualifies list RPC columns and verifier executes both list paths", () => {
  assert.match(ambiguityRepair, /create or replace function public\.list_expense_records/);
  assert.match(ambiguityRepair, /requested_supplier\.factory_id = p_factory_id/);
  assert.match(ambiguityRepair, /authorized_user\.factory_id = p_factory_id/);
  assert.doesNotMatch(
    ambiguityRepair,
    /from public\.suppliers\s+where[\s\S]{0,120}\bfactory_id = p_factory_id/,
  );
  assert.match(verifier, /list_expense_records\(factory_a_id, null\)/);
  assert.match(verifier, /list_expense_records\(factory_a_id, supplier\.id\)/);
});
