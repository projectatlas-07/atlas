import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const overview = readFileSync(
  new URL("./components/chamber-transport-workforce-overview.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/transport-office-section.tsx", import.meta.url),
  "utf8",
);
const overviewModel = readFileSync(
  new URL("./chamber-transport-overview-model.ts", import.meta.url),
  "utf8",
);

test("Chamber overview uses authoritative existing reads only", () => {
  for (const service of [
    "listTransportGroupAssignments",
    "listTransportRangeEarningDetails",
    "getTransportWorkerAvailableBalance",
    "listLatestTransportWorkerWithdrawalsForFactory",
  ]) {
    assert.match(overview, new RegExp(service));
  }
  assert.match(overviewModel, /workerDailyShareSnapshot/);
  assert.match(overview, /withdrawalDate/);
  assert.doesNotMatch(overview, /supabase|\.from\(|\.rpc\(/);
  assert.doesNotMatch(overview, /work_direction|direction|individual.*rate|paid status|unpaid|pay all/i);
});

test("overview supports the complete shared inclusive earnings range pattern", () => {
  for (const label of ["This week", "Last week", "This month", "Custom"]) {
    assert.match(overview, new RegExp(label));
  }
  assert.match(overview, /resolveWageEarningsDateRange/);
  assert.match(overview, /formatDateOnly\(earningsRange\.fromDate\)/);
  assert.match(overview, /formatDateOnly\(earningsRange\.toDate\)/);
  assert.match(overview, /inclusive\. Earnings use locked worker-share snapshots only/);
});

test("multi-group membership, real Last paid, and authoritative balances remain distinct", () => {
  assert.match(overview, /memberships\.get\(worker\.id\)/);
  assert.match(overview, /workerMemberships\.map/);
  assert.match(overview, /formatTransportWorkerLastPaid/);
  assert.match(overview, /query\.data\.availableBalance/);
  assert.match(overview, /Group pools are paya × effective group rate/);
});

test("reference hierarchy is token-based with separate desktop and mobile presentations", () => {
  for (const primitive of ["Button", "EmptyState", "Feedback", "FormField", "Input", "StatusPill", "TableContainer"]) {
    assert.match(overview, new RegExp(`<${primitive}\\b`));
  }
  assert.match(overview, /hidden md:block/);
  assert.match(overview, /md:hidden/);
  assert.match(overview, /Search Chamber Transport workers/);
  assert.match(overview, /Search worker or Transport Group/);
  assert.doesNotMatch(overview, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});

test("setup and account actions open focused V2 drawers over the same overview", () => {
  assert.match(officeSection, /activeView === "setup"/);
  assert.match(officeSection, /<ChamberTransportManagementDrawer/);
  assert.match(officeSection, /activeView === "account"/);
  assert.match(officeSection, /<ChamberTransportAccountDrawer/);
  assert.match(officeSection, /worker=\{accountWorker\}/);
  assert.doesNotMatch(officeSection, /activeView !== "account"/);
});
