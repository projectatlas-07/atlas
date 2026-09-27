import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/soil-trolley-management-drawer.tsx", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("./components/soil-office-section.tsx", import.meta.url),
  "utf8",
);

test("Soil management opens as the focused responsive V2 drawer", () => {
  assert.match(overview, /<SoilTrolleyManagementDrawer/);
  assert.doesNotMatch(overview, /function SoilWorkerDetail/);
  assert.match(drawer, /fixed inset-0 z-50/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /Worker management/);
  assert.match(drawer, /id="soil-trolley-management-title"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("management keeps only supported Soil responsibilities", () => {
  for (const responsibility of [
    "Current rate",
    "Revise trolley rate",
    "Trolley rate history",
    "Office adjustments",
    "Adjustment history",
    "Worker status",
    "Archive worker",
    "Restore worker",
    "Delete unused worker",
  ]) assert.match(drawer, new RegExp(responsibility));

  for (const service of [
    "resolveSoilWorkerTrolleyRate",
    "listSoilWorkerTrolleyRates",
    "createSoilWorkerTrolleyRate",
    "createSoilFinancialAdjustment",
    "listSoilFinancialAdjustments",
    "archiveSoilWorker",
    "restoreSoilWorker",
    "deleteUnusedSoilWorker",
  ]) assert.match(drawer, new RegExp(service));
});

test("rate, lifecycle, adjustment, and delete authority remain service-backed", () => {
  assert.match(drawer, /buildSoilRateChangeInput/);
  assert.match(drawer, /insertSoilRateNewestFirst/);
  assert.match(drawer, /invalidateQueries\(\{[\s\S]*soilRateHistoryQueryKey/);
  assert.match(drawer, /Past recorded work and earnings are unchanged/);
  assert.match(drawer, /buildSoilAdjustmentInput/);
  assert.match(drawer, /insertSoilAdjustmentNewestFirst/);
  assert.match(drawer, /soilFinancialSummaryQueryKey/);
  assert.match(drawer, /canOfferUnusedSoilWorkerDelete/);
  assert.match(drawer, /The database verifies this again before deleting/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(/);
  assert.doesNotMatch(drawer, /updateSoilWorkerTrolleyRate|deleteSoilWorkerTrolleyRate/);
});

test("account and payment content is not duplicated in management", () => {
  for (const accountOnlyContent of [
    "Account &amp; payment",
    "Available to pay",
    "Earnings view",
    "Payment details",
    "Recent payments",
    "Work &amp; earnings history",
    "Pay full balance",
  ]) assert.doesNotMatch(drawer, new RegExp(accountOnlyContent));
  assert.doesNotMatch(drawer, /createSoilPayment|buildSoilPaymentInput|listSoilEarnings/);
});

test("drawer uses Atlas primitives and tokens without Production-only semantics", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.match(drawer, /SOIL_WORKER_LIFECYCLE_STATUS/);
  assert.match(drawer, /WAGE_RATE_HISTORY_STATUS/);
  assert.doesNotMatch(drawer, /<(?:input|select)\b/);
  assert.doesNotMatch(drawer, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(drawer, /brick|crew|origin|per 1,000|settlement cutoff/i);
});
