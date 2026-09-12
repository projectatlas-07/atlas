import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("./components/transport-office-section.tsx", import.meta.url),
  "utf8",
);
const readService = readFileSync(
  new URL("../transport/services/transport-weekly-earning-read-service.ts", import.meta.url),
  "utf8",
);
const sharedRange = readFileSync(
  new URL("../wages/wage-earnings-date-range.ts", import.meta.url),
  "utf8",
);

test("Chamber worker finances default fresh mounts to the shared This Week range", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(sharedRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(component, /useState<WageEarningsDatePreset>\(\s*DEFAULT_WAGE_EARNINGS_DATE_PRESET/);
  assert.match(component, /resolveWageEarningsDateRange/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);
});

test("selected-period query uses inclusive work dates and saved worker shares", () => {
  const periodRead = readService.slice(
    readService.indexOf("export async function listTransportWorkerEarningDetails"),
  );
  assert.match(periodRead, /\.eq\("factory_id", factoryId\)/);
  assert.match(periodRead, /\.eq\("transport_worker_id", transportWorkerId\)/);
  assert.match(periodRead, /\.gte\("work_date", range\.fromDate\)/);
  assert.match(periodRead, /\.lte\("work_date", range\.toDate\)/);
  assert.match(periodRead, /worker_daily_share_snapshot/);
  assert.doesNotMatch(periodRead, /\.gte\("created_at"|\.lte\("created_at"/);
});

test("period UI is separate from cumulative account and all-time withdrawals", () => {
  for (const label of [
    "Earnings period",
    "Period Earned",
    "Cumulative account",
    "Total Earned",
    "Paid / Withdrawn",
    "Available Balance",
    "Work and earnings — selected period",
    "Withdrawal History",
  ]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /sumTransportPeriodEarned\(periodEarningsQuery\.data/);
  assert.match(component, /transportWorkerPeriodEarningsQueryKey\([\s\S]*earningsRange\?\.fromDate[\s\S]*earningsRange\?\.toDate/);
  assert.match(component, /transportWorkerBalanceQueryKey\([\s\S]*form\.withdrawalDate/);
  assert.match(component, /transportWorkerWithdrawalsQueryKey\(factoryId, form\.selectedWorkerId\)/);
  assert.doesNotMatch(component, /transportWorkerWithdrawalsQueryKey\([^\n]*earningsRange/);
});

test("archived workers remain selectable and weekly settlement stays independent", () => {
  assert.match(component, /worker\.isActive \? "" : " \(Inactive\)"/);
  assert.match(component, /<TransportWeeklyEarningsManagement factoryId=\{factoryId\} \/>/);
  assert.match(component, /calculateTransportWeeklyWages/);
  assert.doesNotMatch(readService, /update\(|insert\(|delete\(/);
});
