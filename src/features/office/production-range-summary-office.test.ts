import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const bulkRateSetting = readFileSync(
  new URL("./components/production-bulk-rate-setting.tsx", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("./components/production-worker-account-drawer.tsx", import.meta.url),
  "utf8",
);
const rangeService = readFileSync(
  new URL("../wages/services/production-range-summary-service.ts", import.meta.url),
  "utf8",
);
const sharedRange = readFileSync(
  new URL("../wages/wage-earnings-date-range.ts", import.meta.url),
  "utf8",
);
test("Production range summary uses the shared fresh This Week date controls", () => {
  for (const label of ["This week", "Last week", "This month", "Custom dates"]) {
    assert.match(detail, new RegExp(label));
  }
  assert.match(sharedRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(detail, /useState<WageEarningsDatePreset>\(\s*DEFAULT_WAGE_EARNINGS_DATE_PRESET/);
  assert.match(detail, /resolveWageEarningsDateRange/);
  assert.doesNotMatch(detail, /localStorage|sessionStorage/);
});

test("Production read is factory, labourer, and inclusive work-date scoped", () => {
  assert.match(rangeService, /\.from\("production_entries"\)/);
  assert.match(rangeService, /\.eq\("factory_id", factoryId\)/);
  assert.match(rangeService, /\.eq\("labourer_id", labourerId\)/);
  assert.match(rangeService, /\.gte\("production_date", range\.fromDate\)/);
  assert.match(rangeService, /\.lte\("production_date", range\.toDate\)/);
  assert.doesNotMatch(rangeService, /created_at/);
});

test("range values are visibly separate from the cumulative financial account", () => {
  for (const label of [
    "Earnings view",
    "Earned in period",
    "Rate periods used",
    "Informational only",
    "Available to pay",
    "Settled earned",
    "Live earned",
    "Total paid",
    "Recent payments",
    "Locked earnings history",
  ]) {
    assert.ok(detail.includes(label), `Expected Production detail to include ${label}`);
  }
  assert.match(detail, /available balance remains the authoritative all-time account through today/);
});

test("range selection affects only its production query and never account or withdrawal queries", () => {
  assert.match(detail, /"labourer-production-range-summary"[\s\S]*productionRange\?\.fromDate[\s\S]*productionRange\?\.toDate/);
  assert.match(detail, /"labourer-available-balance", factoryId, worker\.id, asOfDate/);
  assert.match(detail, /"labourer-withdrawal-history", factoryId, worker\.id/);
  assert.doesNotMatch(detail, /"labourer-available-balance"[^\n]*productionRange/);
  assert.doesNotMatch(detail, /"labourer-withdrawal-history"[^\n]*productionRange/);
  assert.match(detail, /refetchInterval: 30_000/);
});

test("informational calculation is read-only and reuses historical selectors plus the Production formula", () => {
  assert.match(rangeService, /getCurrentLabourerProductionWageRate/);
  assert.doesNotMatch(rangeService, /getCurrentProductionCrewAssignment/);
  assert.doesNotMatch(rangeService, /getCurrentCrewProductionWageRate/);
  assert.match(rangeService, /ratePeriods/);
  assert.match(rangeService, /calculateProductionWage/);
  assert.doesNotMatch(rangeService, /weekly_earnings|production_weekly_earning_details/);
  assert.doesNotMatch(rangeService, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("active labourer workflow exposes direct rate selection and hides Production crew concepts", () => {
  const activeWorkflow = dashboard.slice(
    dashboard.indexOf("function LabourerManagement"),
    dashboard.indexOf("function LabourerProductionRateOverrideControls"),
  );
  assert.match(activeWorkflow, /<ProductionBulkRateSetting/);
  for (const label of ["Set Production rates", "All matching workers", "Selected workers", "Filter by Origin", "Effective from", "Backdated change"]) {
    assert.match(bulkRateSetting, new RegExp(label));
  }
  assert.doesNotMatch(bulkRateSetting, /crew|default rate|brick.?type/i);
  assert.match(bulkRateSetting, /setProductionLabourerRates/);
});
