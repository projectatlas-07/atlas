import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/production-worker-account-drawer.tsx", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const overview = office.slice(
  office.indexOf("function LabourerManagement"),
  office.indexOf("function LabourerProductionRateOverrideControls"),
);

test("Production worker account opens as a focused right-side dialog over the list", () => {
  assert.match(overview, /<ProductionWorkerAccountDrawer/);
  assert.doesNotMatch(overview, /<LabourerEarningsHistory/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.doesNotMatch(drawer, /brickType|brick type/i);
});

test("drawer reuses the authoritative account, withdrawal, history, and rate services", () => {
  for (const authority of [
    "getLabourerAvailableBalance",
    "createLabourerWithdrawal",
    "getLabourerWithdrawalHistory",
    "getLabourerEarningsHistory",
    "getCurrentLabourerProductionWageRate",
    "calculateProductionRangeSummary",
  ]) {
    assert.match(drawer, new RegExp(`${authority}\\(`));
  }
  assert.match(drawer, /latestSettlementCutoff/);
  assert.match(drawer, /min=\{latestSettlementCutoff \?\? undefined\}/);
  assert.match(drawer, /max=\{withdrawalDate \|\| undefined\}/);
  assert.match(drawer, /Pay full balance/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(|Paid \/ Unpaid|payment method|remarks|note/i);
});

test("drawer uses V2 tokens and primitives without adding a font or display token", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill", "TableContainer"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.match(drawer, /text-atlas-3xl/);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});

test("payment form prevents duplicate activation and refreshes Last Paid after success", () => {
  assert.match(drawer, /if \(isSubmitting\) return/);
  assert.match(drawer, /loading=\{isSubmitting\}/);
  assert.match(drawer, /inputMode="decimal"/);
  assert.match(drawer, /amount: numericAmount/);
  assert.doesNotMatch(drawer, /numericAmount\s*!==\s*accountQuery\.data\?\.availableBalance/);
  assert.match(drawer, /queryKey: \["labourer-latest-withdrawals", factoryId\]/);
});
