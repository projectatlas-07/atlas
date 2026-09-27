import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/soil-trolley-account-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/soil-office-section.tsx", import.meta.url),
  "utf8",
);
const queryKeys = readFileSync(
  new URL("./soil-office-query-keys.ts", import.meta.url),
  "utf8",
);

test("Soil Account & payment opens as a responsive right-side drawer", () => {
  assert.match(officeSection, /<SoilTrolleyAccountDrawer/);
  assert.match(officeSection, /const \[accountWorkerId, setAccountWorkerId\]/);
  assert.match(officeSection, /onClick=\{\(\) => openAccount\(worker\.id\)\}/);
  assert.match(officeSection, /onClick=\{\(\) => toggleManagement\(worker\.id\)\}/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("drawer uses only existing authoritative Soil reads and payment service", () => {
  for (const authority of [
    "resolveSoilWorkerTrolleyRate",
    "getSoilFinancialSummary",
    "listSoilEarnings",
    "listSoilPayments",
    "listSoilFinancialAdjustments",
    "createSoilPayment",
  ]) assert.match(drawer, new RegExp(`${authority}\\(`));
  assert.match(drawer, /summary\.availableBalance/);
  assert.match(drawer, /buildSoilPaymentInput\(\{/);
  assert.match(drawer, /mergeSoilPaymentSummary/);
  assert.match(drawer, /insertSoilPaymentNewestFirst/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(|createSoilFinancialAdjustment/);
});

test("period earnings and trolleys retain immutable Soil snapshot semantics", () => {
  for (const label of ["This week", "Last week", "This month", "Custom dates"]) {
    assert.match(drawer, new RegExp(label));
  }
  assert.match(drawer, /resolveWageEarningsDateRange/);
  assert.match(drawer, /sumSoilPeriodEarned\(earningsQuery\.data/);
  assert.match(drawer, /sumSoilPeriodTrolleys\(earningsQuery\.data/);
  assert.match(drawer, /immutable BASE\/CORRECTION snapshots/);
  assert.match(drawer, /Period filters do not change it/);
});

test("payment prevents duplicate activation and refreshes shared overview caches", () => {
  assert.match(drawer, /if \(isPaying\) return/);
  assert.match(drawer, /loading=\{isPaying\}/);
  assert.match(drawer, /inputMode="decimal"/);
  assert.match(drawer, /Payment exceeds this worker's available balance/);
  assert.match(drawer, /soilFinancialSummaryQueryKey\(factoryId, worker\.id\)/);
  assert.match(drawer, /soilPaymentsQueryKey\(factoryId, worker\.id\)/);
  assert.match(queryKeys, /office-soil-financial-summary/);
  assert.match(queryKeys, /office-soil-payments/);
});

test("drawer preserves payment, earning, correction, and adjustment visibility", () => {
  assert.match(drawer, /Recent payments/);
  assert.match(drawer, /Work &amp; earnings history · selected period/);
  assert.match(drawer, /buildSoilEarningHistoryItem/);
  assert.match(drawer, /Office adjustment history/);
  assert.match(drawer, /adjustment\.reason/);
  assert.match(drawer, /Office additions/);
  assert.match(drawer, /Office deductions/);
});

test("drawer follows Production V2 presentation without Production-only semantics", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill", "TableContainer"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.match(drawer, /Available to pay/);
  assert.match(drawer, /Earnings view/);
  assert.match(drawer, /Payment details/);
  assert.doesNotMatch(drawer, /settlement cutoff|settled earned|live earned|brick|crew|origin|rate per 1,000|payment method|remarks|notes/i);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
