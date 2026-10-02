import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("../office/components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);
const drawer = readFileSync(
  new URL("../office/components/expense-payment-detail-drawer.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("../office/office-navigation.ts", import.meta.url),
  "utf8",
);
const model = readFileSync(new URL("../office/expense-office-model.ts", import.meta.url), "utf8");

const archive = component.slice(
  component.indexOf('costsOutgoingsArea === "outgoing-payments" && showPaymentsArchive'),
  component.indexOf("</section>", component.indexOf('costsOutgoingsArea === "outgoing-payments" && showPaymentsArchive')),
);

test("All Outgoing Payments is a nested hash-addressable Outgoing Payments view", () => {
  assert.match(navigation, /OFFICE_OUTGOING_PAYMENTS_ARCHIVE_HASH = "#all-outgoing-payments"/);
  assert.match(navigation, /value === "all-outgoing-payments"\) return "outgoing-payments"/);
  assert.match(component, /window\.location\.hash === getOfficeOutgoingPaymentsArchiveHash\(\)/);
  assert.match(component, /window\.location\.hash = getOfficeOutgoingPaymentsArchiveHash\(\)/);
  assert.match(component, /onClick=\{closePaymentsArchive\}>← Back to Outgoing Payments/);
  assert.match(component, /window\.location\.hash = getOfficeCostsOutgoingsHash\("outgoing-payments"\)/);
  assert.match(component, /costsOutgoingsArea === "outgoing-payments" && showPaymentsArchive && <div/);
});

test("archive reuses one full payment query plus model-owned saved-history filtering", () => {
  assert.equal((component.match(/listExpensePayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const paymentArchivePayments = filterExpensePayments\(payments/);
  assert.match(model, /payment\.note[\s\S]*payment\.allocations\.flatMap/);
  assert.match(model, /allocation\.counterpartyNameSnapshot/);
  assert.match(model, /allocation\.description/);
  assert.match(model, /payment\.paymentDate >= filters\.fromDate/);
  assert.match(model, /payment\.paymentDate <= filters\.toDate/);
  assert.match(model, /allocation\.expenseKind === filters\.kind/);
  assert.match(model, /payment\.paymentMode === filters\.paymentMode/);
});

test("archive provides supported filters and genuine Outgoing Payment columns", () => {
  for (const label of ["Search payments", "Allocation type"]) {
    assert.match(archive, new RegExp(`label="${label}"`));
  }
  assert.match(archive, /label=\{ATLAS_UI_STRINGS\.fields\.fromDate\}/);
  assert.match(archive, /label=\{ATLAS_UI_STRINGS\.fields\.toDate\}/);
  assert.match(archive, /label=\{ATLAS_UI_STRINGS\.payment\.mode\}/);
  for (const column of ["Payment Date", "Note / Reference", "Allocated Costs", "Action"]) {
    assert.match(archive, new RegExp(`<TableHeaderCell(?: numeric)?>${column}</TableHeaderCell>`));
  }
  assert.match(archive, /<TableHeaderCell numeric>\{ATLAS_UI_STRINGS\.fields\.amount\}<\/TableHeaderCell>/);
  assert.match(archive, /<TableHeaderCell>\{ATLAS_UI_STRINGS\.payment\.mode\}<\/TableHeaderCell>/);
  assert.doesNotMatch(archive, /Payment ID|approval|ledger|sync state|audit metadata|\bERP\b|status/i);
});

test("archive table is bounded, wide, sticky, and has no numbered pagination", () => {
  assert.match(archive, /<TableContainer bounded aria-label="All Outgoing Payments table">/);
  assert.match(archive, /<Table wide>/);
  assert.match(archive, /<TableHeader sticky>/);
  assert.match(archive, /paymentArchivePayments\.map/);
  assert.match(archive, /Open payment →/);
  assert.doesNotMatch(archive, /pagination|pageNumber|pageSize|Next page|Previous page/i);
});

test("payment drawer is accessible, read-only, and displays exact saved allocation identity", () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /payment\.allocations\.map/);
  for (const field of [
    "paymentDate", "amount", "paymentMode", "note", "expenseKind",
    "counterpartyNameSnapshot", "description", "allocatedAmount",
  ]) assert.match(drawer, new RegExp(`\\.${field}`));
  assert.match(drawer, /getCostBusinessDate\(allocation\.expenseRecordId\)/);
  assert.doesNotMatch(drawer, /outstandingAmount|totalPaid|current Due/i);
  assert.doesNotMatch(drawer, /(?:edit|delete|void|reverse|save)Payment|type="submit"/i);
});

test("drawer reconciliation uses persisted allocation values and can open existing Cost detail", () => {
  assert.match(drawer, /getExpensePaymentAllocationReconciliation\(payment\)/);
  assert.match(model, /payment\.allocations\.reduce/);
  assert.match(model, /allocation\.allocatedAmount/);
  assert.match(drawer, /onOpenCost\(allocation\.expenseRecordId\)/);
  assert.match(component, /records\.some\(\(record\) => record\.id === expenseRecordId\)/);
  assert.match(component, /setSelectedRecordId\(expenseRecordId\)/);
  assert.match(component, /window\.location\.hash = getOfficeCostsOutgoingsHash\("costs"\)/);
  assert.match(component, /costsOutgoingsArea === "costs" && selectedRecord/);
});

test("archive and drawer use Atlas V2 tokens and primitives", () => {
  for (const primitive of ["Button", "Card", "Feedback"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  for (const primitive of [
    "Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select",
    "Table", "TableBody", "TableCaption", "TableCell", "TableContainer", "TableHeader",
    "TableHeaderCell", "TableRow",
  ]) assert.match(archive, new RegExp(`<${primitive}`));
  for (const source of [archive, drawer]) {
    assert.doesNotMatch(source, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
    assert.doesNotMatch(source, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  }
});
