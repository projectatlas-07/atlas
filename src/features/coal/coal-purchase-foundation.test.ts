import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000038_create_coal_purchase_module.sql",
  import.meta.url,
), "utf8");
const component = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
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

test("Coal is structured but reuses supplier obligations and immutable expense payments", () => {
  assert.match(migration, /references public\.expense_records\(id, factory_id\)/);
  assert.match(migration, /from public\.suppliers/);
  assert.match(migration, /public\.create_expense_payment/);
  assert.match(migration, /expense_payment_allocations/);
  assert.doesNotMatch(migration, /create table public\.coal_(sellers|payments)/);
});

test("initial and later payments flow into existing Cash Book Money Out without copied ledger rows", () => {
  assert.match(migration, /Initial Coal Purchase payment/);
  assert.match(migration, /create or replace function public\.create_coal_payment/);
  assert.doesNotMatch(migration, /insert into public\.cash_book|create table public\.coal_cash/i);
  assert.match(component, /Cash Book Money Out updates automatically/);
});

test("Coal fields remain reportable, snapshotted, and factory-owned", () => {
  for (const field of [
    "coal_name_snapshot", "source_location_snapshot", "coal_challan_number",
    "vehicle_number_snapshot", "quantity", "rate", "coal_amount",
    "separate_freight_amount",
  ]) assert.match(migration, new RegExp(field));
  assert.match(migration, /factory_id uuid not null/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /factory_users\.user_id = auth\.uid\(\)/);
});

test("Coal Challan Number stays optional duplicate display data", () => {
  assert.match(migration, /coal_challan_number text/);
  const purchaseTable = migration.slice(
    migration.indexOf("create table public.coal_purchases"),
    migration.indexOf("create index coal_purchases_factory_history_idx"),
  );
  assert.doesNotMatch(purchaseTable, /unique\s*\([^)]*coal_challan_number/i);
  assert.doesNotMatch(migration, /create unique index[^;]*coal_challan_number/i);
  assert.match(component, /Coal Challan No\. \(optional\)/);
});

test("financial lifecycle blocks generic mutation and allows only unpaid correction or void", () => {
  assert.match(migration, /guard_coal_expense_record_mutation/);
  assert.match(migration, /guard_coal_payment_allocation/);
  assert.match(migration, /target_record\.status <> 'active' or target_record\.is_locked/);
  assert.match(migration, /public\.void_expense_record/);
  assert.match(component, /Payment history locks this purchase/);
});

test("dedicated manager UI includes searchable masters, smart entry, freight opt-in, and statements", () => {
  assert.match(dashboard, /<CoalPurchaseOfficeSection factoryId=\{factoryId!\}/);
  assert.match(searchChoice, /role="combobox"/);
  assert.match(component, /Enter any two values/);
  assert.match(component, /Add separate delivery charge/);
  assert.match(component, /Coal Purchase history and seller statement/);
  assert.match(component, /Seller Payment History/);
});

test("Coal history exposes the non-persisted Payment Status filter beside existing filters", () => {
  assert.match(component, /Payment Status/);
  assert.match(component, /<option value="all">All<\/option>/);
  assert.match(component, /<option value="unpaid">Unpaid<\/option>/);
  assert.match(component, /<option value="partial">Partial<\/option>/);
  assert.match(component, /<option value="paid">Paid<\/option>/);
  assert.match(component, /useState<CoalPaymentStatusFilter>\("all"\)/);
});

test("Coal history contains only detailed purchases and grouped seller payments", () => {
  assert.doesNotMatch(component, /Combined Coal Transactions/);
  assert.doesNotMatch(component, /buildCoalTransactions/);
  assert.match(component, /Detailed Purchase History/);
  assert.match(component, /Seller Payment History/);
  assert.match(component, /filterCoalPayments\(payments, fromDate, toDate, sellerFilter\)/);
  assert.match(component, /Payment Status does not/);
  assert.match(component, /payment\.allocations\.map/);
});

test("generic Expense\/Purchase editor excludes structured Coal records", () => {
  assert.match(migration, /and not exists \([\s\S]*from public\.coal_purchases/);
  assert.match(migration, /dedicated Coal records remain in their purpose-built module/);
});
