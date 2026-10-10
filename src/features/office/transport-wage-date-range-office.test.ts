import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";

const component = readFileSync(
  new URL("./components/transport-office-section.tsx", import.meta.url),
  "utf8",
);
const accountDrawer = readFileSync(
  new URL("./components/chamber-transport-account-drawer.tsx", import.meta.url),
  "utf8",
);
const managementDrawer = readFileSync(
  new URL("./components/chamber-transport-management-drawer.tsx", import.meta.url),
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
const financeModel = readFileSync(
  new URL("./transport-worker-finances-model.ts", import.meta.url),
  "utf8",
);

test("Chamber worker finances default fresh mounts to the shared This week range", () => {
  for (const label of ["This week", "Last week", "This month", "Custom"]) {
    assert.match(accountDrawer, new RegExp(label));
  }
  assert.match(sharedRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(accountDrawer, /useState<WageEarningsDatePreset>\(\s*DEFAULT_WAGE_EARNINGS_DATE_PRESET/);
  assert.match(accountDrawer, /resolveWageEarningsDateRange/);
  assert.doesNotMatch(accountDrawer, /localStorage|sessionStorage/);
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
    "Earnings view",
    "ATLAS_UI_STRINGS.transportCredit.total",
    "Total withdrawn",
    "Available to pay",
    "Locked contribution details",
    "Recent payments",
  ]) {
    assert.match(accountDrawer, new RegExp(label));
  }
  assert.equal(ATLAS_UI_STRINGS.transportCredit.total, "Total earnings including credits");
  assert.match(accountDrawer, /sumTransportPeriodEarned\(periodDetails\)/);
  assert.match(accountDrawer, /periodEarningsQueryKey\([\s\S]*earningsRange\?\.fromDate[\s\S]*earningsRange\?\.toDate/);
  assert.match(accountDrawer, /balanceQueryKey\(factoryId, worker\.id, localToday\)/);
  assert.match(accountDrawer, /withdrawalsQueryKey\(factoryId, worker\.id\)/);
  assert.doesNotMatch(accountDrawer, /withdrawalsQueryKey\([^\n]*earningsRange/);
});

test("archived workers remain selectable and weekly settlement stays independent", () => {
  assert.match(financeModel, /worker\.isActive \? "" : " \(Inactive\)"/);
  assert.match(accountDrawer, /TRANSPORT_WORKER_LIFECYCLE_STATUS/);
  assert.match(accountDrawer, /worker\.isActive/);
  assert.match(component, /worker=\{accountWorker\}/);
  assert.match(component, /<ChamberTransportManagementDrawer/);
  assert.match(managementDrawer, /<TransportWeeklyLockingSection factoryId=\{factoryId\} \/>/);
  assert.match(managementDrawer, /calculateTransportWeeklyWages/);
  assert.doesNotMatch(readService, /update\(|insert\(|delete\(/);
});
