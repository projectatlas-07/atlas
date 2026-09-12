import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
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
const detail = dashboard.slice(
  dashboard.indexOf("function LabourerEarningsHistory"),
  dashboard.indexOf("function LabourerWithdrawalForm"),
);

test("Production range summary uses the shared fresh This Week date controls", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom"]) {
    assert.match(dashboard, new RegExp(label));
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
    "Production range summary",
    "Earnings period",
    "Range Production",
    "Range Earned",
    "Informational only",
    "Available Balance",
    "Total earned",
    "Total withdrawn",
    "Withdrawal History",
    "Locked Earnings History",
  ]) {
    assert.match(detail, new RegExp(label));
  }
  assert.match(detail, /editable Production records and does not change locked weekly earnings or Available Balance/);
});

test("range selection affects only its production query and never account or withdrawal queries", () => {
  assert.match(detail, /"labourer-production-range-summary"[\s\S]*productionRange\?\.fromDate[\s\S]*productionRange\?\.toDate/);
  assert.match(detail, /"labourer-available-balance", factoryId, labourerId, asOfDate/);
  assert.match(detail, /"labourer-withdrawal-history", factoryId, labourerId/);
  assert.doesNotMatch(detail, /"labourer-available-balance"[^\n]*productionRange/);
  assert.doesNotMatch(detail, /"labourer-withdrawal-history"[^\n]*productionRange/);
  assert.match(detail, /refetchInterval: 30_000/);
});

test("informational calculation is read-only and reuses historical selectors plus the Production formula", () => {
  assert.match(rangeService, /getCurrentLabourerProductionWageRateOverride/);
  assert.match(rangeService, /getCurrentProductionCrewAssignment/);
  assert.match(rangeService, /getCurrentCrewProductionWageRate/);
  assert.match(rangeService, /calculateProductionWage/);
  assert.doesNotMatch(rangeService, /weekly_earnings|production_weekly_earning_details/);
  assert.doesNotMatch(rangeService, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
