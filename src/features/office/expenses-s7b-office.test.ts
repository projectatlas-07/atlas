import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("./components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260828000024_create_expense_purchase_foundation.sql", import.meta.url),
  "utf8",
);

test("S7B adds one coherent Expenses & Purchases Office workflow and stops before later accounting", () => {
  assert.match(dashboard, /<ExpensesOfficeSection[\s\S]*activeArea=\{activeArea\}[\s\S]*factoryId=\{factoryId!\}[\s\S]*showCostsOutgoings=/);
  assert.match(component, /New Cost/);
  assert.match(component, /<option value="purchase">Purchase<\/option>/);
  assert.match(component, /<option value="expense">Expense<\/option>/);
  assert.match(component, /Recent Costs/);
  assert.match(component, /Payment Details/);
  assert.match(component, /Recent Outgoing Payments/);
  assert.doesNotMatch(component, /general ledger|chart of accounts|balance sheet|stock valuation|vehicle delivery wage/i);
});

test("source and Settings supplier forms use only the completed controlled S7A services", () => {
  assert.match(component, /await createExpenseRecord\(input\)/);
  assert.match(component, /await updateExpenseRecord\(/);
  assert.match(component, /await voidExpenseRecord\(factoryId, record\.id\)/);
  assert.match(component, /await createSupplier\(input\)/);
  assert.match(component, /await updateSupplier\(/);
  assert.doesNotMatch(component, /supabase\.|\.insert\(|\.update\(|\.delete\(/);
  assert.match(component, /SupplierManagementSection/);
  assert.match(component, /hidden=\{activeArea !== "settings"\}/);
  assert.doesNotMatch(component.slice(component.indexOf("function ExpenseRecordEditor")), /Quick-create supplier/);
  assert.match(component, /Edit supplier/);
  assert.match(component, /Supplier \/ counterparty/);
});

test("recent costs preserves authoritative identity, amount, due, and payment state", () => {
  assert.match(component, /records\.slice\(0, 10\)/);
  assert.match(component, /counterpartyNameSnapshot/);
  assert.match(component, /record\.outstandingAmount/);
  assert.match(component, /EXPENSE_PAYMENT_STATUS/);
  assert.match(component, /EXPENSE_RECORD_STATUS/);
});

test("record detail preserves snapshots and exposes only backend-eligible correction and void", () => {
  assert.match(component, /saved historical identity/);
  assert.match(component, /counterpartyAddressSnapshot/);
  assert.match(component, /counterpartyMobileSnapshot/);
  assert.match(component, /eligibility\.canEdit/);
  assert.match(component, /eligibility\.canVoid/);
  assert.match(component, /Confirm void/);
  assert.match(component, /Financially locked/);
  assert.doesNotMatch(component, /Delete Expense|Delete Purchase|deleteExpense|deletePurchase/i);
});

test("payment UI is explicit, supports multiple sources, and has duplicate-submit protection", () => {
  assert.match(component, /Nothing is selected automatically/);
  assert.match(component, /toggleExpensePaymentAllocation/);
  assert.match(component, /setExpensePaymentAllocation/);
  assert.doesNotMatch(component, /Use outstanding/);
  assert.match(component, /Payment amount/);
  assert.match(component, /Allocated/);
  assert.match(component, /Remaining/);
  assert.match(component, /NEW_CUSTOMER_PAYMENT_MODES/);
  assert.match(component, /if \(isSavingPayment\) return/);
  assert.match(component, /await createExpensePayment\(input\)/);
});

test("successful payment refreshes source state, history, summary query, and Cash Book", () => {
  assert.match(component, /getExpenseRecordPaymentState/);
  assert.match(component, /applyExpensePaymentStates/);
  assert.match(component, /expenseRecordsKey\(factoryId\)/);
  assert.match(component, /expensePaymentsKey\(factoryId\)/);
  assert.match(component, /\["office-cash-book-day", factoryId\]/);
  assert.match(component, /Cash Book Money Out updates automatically/);
});

test("recent payment history renders persisted events with nested allocations and no mutation controls", () => {
  assert.match(component, /payments\.map\(\(payment\)/);
  assert.match(component, /payment\.allocations\.slice\(0, 2\)\.map/);
  assert.match(component, /payment\.allocations\.length/);
  assert.doesNotMatch(component, /Edit Payment|Delete Payment|voidExpensePayment/i);
});

test("Cash Book remains one Money Out row per payment header even for multi-allocation payments", () => {
  const cashSource = migration.slice(
    migration.indexOf("create or replace function public.get_cash_book_source_movements"),
    migration.indexOf("revoke all on function public.reject_supplier_delete"),
  );
  assert.match(cashSource, /'expense_payment'::text, payments\.id, payments\.payment_date, 'out'::text/);
  assert.match(cashSource, /from public\.expense_payments as payments/);
  assert.doesNotMatch(cashSource, /allocations\.allocated_amount/);
  assert.doesNotMatch(component, /createCashBookManualEntry|Manual Money Out/);
});
