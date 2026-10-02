import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("../office/components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("../office/office-navigation.ts", import.meta.url),
  "utf8",
);
const model = readFileSync(new URL("../office/expense-office-model.ts", import.meta.url), "utf8");

const archive = component.slice(
  component.indexOf('costsOutgoingsArea === "costs" && showCostsArchive'),
  component.indexOf('costsOutgoingsArea === "costs" && selectedRecord'),
);

test("All Costs is a nested hash-addressable Costs view", () => {
  assert.match(navigation, /OFFICE_COSTS_ARCHIVE_HASH = "#all-costs"/);
  assert.match(navigation, /value === "all-costs"\) return "costs"/);
  assert.match(component, /window\.location\.hash === getOfficeCostsArchiveHash\(\)/);
  assert.match(component, /window\.location\.hash = getOfficeCostsArchiveHash\(\)/);
  assert.match(component, /onClick=\{closeCostsArchive\}>← Back to Costs/);
  assert.match(component, /window\.location\.hash = getOfficeCostsOutgoingsHash\("costs"\)/);
  assert.match(component, /costsOutgoingsArea === "costs" && showCostsArchive && <div/);
});

test("archive reuses one full Cost query plus model-owned filtering and totals", () => {
  assert.equal((component.match(/listExpenseRecords\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archiveRecords = filterExpenseArchiveRecords\(records/);
  assert.match(component, /const archiveSummary = summarizeExpenseRecords\(archiveRecords\)/);
  assert.match(model, /record\.counterpartyNameSnapshot[\s\S]*record\.description[\s\S]*record\.note/);
  assert.match(model, /record\.businessDate >= filters\.fromDate/);
  assert.match(model, /record\.businessDate <= filters\.toDate/);
  assert.match(model, /record\.status === "void"/);
  assert.match(model, /record\.paymentState === filters\.state/);
});

test("archive provides supported filters, summary, and genuine Cost columns", () => {
  for (const label of ["Search Costs", "Type", "Counterparty / Payee", "State"]) {
    assert.match(archive, new RegExp(`label="${label.replace("/", "\\/")}"`));
  }
  assert.match(archive, /label=\{ATLAS_UI_STRINGS\.fields\.fromDate\}/);
  assert.match(archive, /label=\{ATLAS_UI_STRINGS\.fields\.toDate\}/);
  for (const total of ["Total Purchases", "Total Expenses", "Paid"]) {
    assert.match(archive, new RegExp(`label="${total}"`));
  }
  assert.match(archive, /label=\{ATLAS_UI_STRINGS\.payment\.outstanding\}/);
  for (const column of [
    "Type", "Supplier / Counterparty", "Description", "Paid", "Note / Reference", "Action",
  ]) assert.match(archive, new RegExp(`<TableHeaderCell(?: numeric)?>${column}</TableHeaderCell>`));
  assert.match(archive, /<TableHeaderCell>\{ATLAS_UI_STRINGS\.fields\.date\}<\/TableHeaderCell>/);
  assert.match(archive, /<TableHeaderCell numeric>\{ATLAS_UI_STRINGS\.fields\.amount\}<\/TableHeaderCell>/);
  assert.match(archive, /<TableHeaderCell numeric>\{ATLAS_UI_STRINGS\.payment\.due\}<\/TableHeaderCell>/);
  assert.match(archive, /<TableHeaderCell>\{ATLAS_UI_STRINGS\.fields\.status\}<\/TableHeaderCell>/);
  assert.doesNotMatch(archive, /Cost ID|approval|ledger|sync state|audit metadata|\bERP\b/i);
});

test("archive table is bounded, wide, sticky, and has no numbered pagination", () => {
  assert.match(archive, /<TableContainer bounded aria-label="All Costs table">/);
  assert.match(archive, /<Table wide>/);
  assert.match(archive, /<TableHeader sticky>/);
  assert.match(archive, /archiveRecords\.map/);
  assert.match(archive, /ATLAS_UI_STRINGS\.actions\.open\} →/);
  assert.doesNotMatch(archive, /pagination|pageNumber|pageSize|Next page|Previous page/i);
});

test("Open reuses existing detail, correction, void, and Record Payment authority", () => {
  assert.match(archive, /setSelectedRecordId\(record\.id\); setConfirmingVoidId\(""\)/);
  assert.match(component, /costsOutgoingsArea === "costs" && selectedRecord/);
  assert.match(component, /getExpenseRecordEligibility\(selectedRecord\)/);
  assert.match(component, /onEdit=\{\(\) => openEditRecord\(selectedRecord\)\}/);
  assert.match(component, /onConfirmVoid=\{\(\) => void confirmVoid\(selectedRecord\)\}/);
  assert.match(component, /selectCostsOutgoingsArea\("outgoing-payments"\)/);
  assert.match(component, /if \(showCostsArchive\) closeCostsArchive\(\)/);
});

test("All Costs uses Atlas primitives and token classes", () => {
  for (const primitive of [
    "Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill",
    "Table", "TableBody", "TableCaption", "TableCell", "TableContainer", "TableHeader",
    "TableHeaderCell", "TableRow",
  ]) assert.match(archive, new RegExp(`<${primitive}`));
  assert.doesNotMatch(archive, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(archive, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});

test("All Costs stays separate from the Outgoing Payments archive", () => {
  assert.match(component, /showCostsArchive/);
  assert.match(component, /showPaymentsArchive/);
  assert.match(component, /getOfficeCostsArchiveHash\(\)/);
  assert.match(component, /getOfficeOutgoingPaymentsArchiveHash\(\)/);
});
