import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/costs-outgoings-office-workspace.tsx", import.meta.url),
  "utf8",
);
const costsOutgoings = readFileSync(
  new URL("./components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./office-navigation.ts", import.meta.url),
  "utf8",
);

test("Costs and Outgoings exposes exactly its two approved operational areas", () => {
  assert.match(workspace, /OFFICE_COSTS_OUTGOINGS_AREAS\.map/);
  assert.match(navigation, /id: "costs", label: "Costs"/);
  assert.match(navigation, /id: "outgoing-payments", label: "Outgoing Payments"/);
  assert.match(workspace, /aria-label="Costs and Outgoings areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
});

test("Costs is the default and only the selected operational workflow is visible", () => {
  assert.match(costsOutgoings, /useState<OfficeCostsOutgoingsAreaId>\("costs"\)/);
  assert.match(costsOutgoings, /costsOutgoingsArea === "costs" && !showCostsArchive && <div/);
  assert.match(costsOutgoings, /<ExpenseRecordEditor/);
  assert.match(costsOutgoings, /<RecentCosts/);
  assert.match(costsOutgoings, /<ExpenseRecordDetail/);
  assert.match(costsOutgoings, /costsOutgoingsArea === "outgoing-payments" && !showPaymentsArchive && <div/);
  assert.match(costsOutgoings, /<ExpensePaymentEditor/);
  assert.match(costsOutgoings, /<RecentOutgoingPayments/);
});

test("refresh and browser history reuse the Office hash router", () => {
  assert.match(costsOutgoings, /resolveOfficeCostsOutgoingsAreaFromHash\(window\.location\.hash\)/);
  assert.match(costsOutgoings, /window\.addEventListener\("hashchange", syncCostsOutgoingsAreaFromHash\)/);
  assert.match(costsOutgoings, /window\.removeEventListener\("hashchange", syncCostsOutgoingsAreaFromHash\)/);
  assert.match(costsOutgoings, /window\.location\.hash = getOfficeCostsOutgoingsHash\(area\)/);
  assert.match(costsOutgoings, /<CostsOutgoingsOfficeWorkspace[\s\S]*activeArea=\{costsOutgoingsArea\}[\s\S]*onAreaChange=\{selectCostsOutgoingsArea\}/);
});

test("existing cost, outgoing payment, and supplier state stays in one authoritative component", () => {
  assert.equal((costsOutgoings.match(/useQueryClient\(\)/g) ?? []).length, 1);
  assert.equal((costsOutgoings.match(/listExpenseRecords\(factoryId\)/g) ?? []).length, 1);
  assert.equal((costsOutgoings.match(/listExpensePayments\(factoryId\)/g) ?? []).length, 1);
  assert.equal((costsOutgoings.match(/listSuppliers\(factoryId\)/g) ?? []).length, 1);
  assert.match(costsOutgoings, /buildExpenseRecordInput/);
  assert.match(costsOutgoings, /buildExpensePaymentInput/);
  assert.match(costsOutgoings, /createExpensePayment/);
  assert.match(costsOutgoings, /\["office-cash-book-day", factoryId\]/);
  assert.match(costsOutgoings, /<SupplierManagementSection[\s\S]*hidden=\{activeArea !== "settings"\}/);
});

test("record detail opens the authoritative payment workflow without losing the shared state owner", () => {
  assert.match(costsOutgoings, /onRecordPayment=\{\(\) => \{[\s\S]*setPaymentError\(""\);[\s\S]*selectCostsOutgoingsArea\("outgoing-payments"\)/);
  assert.doesNotMatch(costsOutgoings, /showPaymentForm|setShowPaymentForm/);
  assert.equal((costsOutgoings.match(/<ExpensePaymentEditor/g) ?? []).length, 1);
  assert.equal((costsOutgoings.match(/<RecentOutgoingPayments/g) ?? []).length, 1);
});

test("contextual navigation is compact, token-based, and horizontally scrollable", () => {
  assert.match(workspace, /<Button/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /flex min-w-max gap-atlas-2/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|allocation|Cash Book/i);
});
