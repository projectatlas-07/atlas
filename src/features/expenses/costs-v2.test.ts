import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("../office/components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);

const newCostForm = component.slice(
  component.indexOf("function ExpenseRecordEditor"),
  component.indexOf("function ExpensePaymentEditor"),
);
const recentCosts = component.slice(
  component.indexOf("function RecentCosts"),
  component.indexOf("function ExpenseRecordDetail"),
);
const saveRecord = component.slice(
  component.indexOf("async function saveRecord"),
  component.indexOf("function openSupplierCreate"),
);

test("Costs makes one always-visible New Cost form the primary workflow", () => {
  assert.match(component, /costsOutgoingsArea === "costs" && !showCostsArchive && <div className="max-w-6xl">/);
  assert.match(component, /<ExpenseRecordEditor[\s\S]*<RecentCosts/);
  assert.match(newCostForm, /"New Cost"/);
  assert.doesNotMatch(component, />Record Purchase<|>Record Expense</);
  assert.doesNotMatch(component, /showRecordForm|setShowRecordForm/);
});

test("Type is first and switching it preserves the existing controlled form", () => {
  const typePosition = newCostForm.indexOf('label="Type"');
  const datePosition = newCostForm.indexOf('label="Business date"');
  const supplierPosition = newCostForm.indexOf('label="Supplier (optional)"');
  assert.ok(typePosition >= 0 && typePosition < datePosition && datePosition < supplierPosition);
  assert.match(newCostForm, /setForm\(\{ \.\.\.form, kind: event\.target\.value as ExpenseRecordKind \}\)/);
  assert.match(newCostForm, /<option value="purchase">Purchase<\/option>/);
  assert.match(newCostForm, /<option value="expense">Expense<\/option>/);
  assert.match(newCostForm, /`Save \$\{expenseKindLabel\(form\.kind\)\}`/);
});

test("New Cost contains only authoritative Purchase and Expense fields", () => {
  for (const label of [
    "Business date",
    "Supplier (optional)",
    "Counterparty / Payee",
    "Particulars / description",
    "Cost amount",
    "Reference / note (optional)",
  ]) {
    assert.ok(newCostForm.includes(label));
  }
  assert.doesNotMatch(newCostForm, /Paid now|payment mode|\bERP\b|sync status|audit metadata|worker ID/i);
});

test("saving a Cost reuses the source service and never creates a payment or Cash Book movement", () => {
  assert.match(saveRecord, /buildExpenseRecordInput\(factoryId, recordForm\)/);
  assert.match(saveRecord, /await createExpenseRecord\(input\)/);
  assert.match(saveRecord, /await updateExpenseRecord\(/);
  assert.match(saveRecord, /no Cash Book payment was created/);
  assert.doesNotMatch(saveRecord, /createExpensePayment|office-cash-book-day|setShowPaymentForm/);
  assert.match(newCostForm, /Payment is recorded separately in Outgoing Payments/);
});

test("Recent Costs is bounded, internally scrollable, and opens the archive", () => {
  assert.match(component, /const recentRecords = records\.slice\(0, 10\)/);
  assert.match(recentCosts, /flex h-96 flex-col/);
  assert.match(recentCosts, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(recentCosts, /expenseKindLabel\(record\.kind\)/);
  assert.match(recentCosts, /record\.counterpartyNameSnapshot/);
  assert.match(recentCosts, /formatSalesMoney\(record\.totalAmount\)/);
  assert.match(recentCosts, /formatSalesMoney\(record\.outstandingAmount\)/);
  assert.match(recentCosts, /onClick=\{\(\) => onOpen\(record\.id\)\}/);
  assert.match(recentCosts, /onClick=\{onViewAll\}>View all costs →/);
});

test("the redesigned Costs surface uses Atlas primitives and tokens", () => {
  for (const primitive of ["<Card", "<FormField", "<Input", "<Select", "<Button", "<Feedback", "<StatusPill"]) {
    assert.match(`${newCostForm}${recentCosts}`, new RegExp(primitive.replace("<", "\\<")));
  }
  assert.doesNotMatch(`${newCostForm}${recentCosts}`, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(`${newCostForm}${recentCosts}`, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});

test("detail correction, void, and Record Payment handoff remain wired", () => {
  assert.match(component, /onEdit=\{\(\) => openEditRecord\(selectedRecord\)\}/);
  assert.match(component, /onConfirmVoid=\{\(\) => void confirmVoid\(selectedRecord\)\}/);
  assert.match(component, /setPaymentError\(""\);[\s\S]*selectCostsOutgoingsArea\("outgoing-payments"\)/);
});
