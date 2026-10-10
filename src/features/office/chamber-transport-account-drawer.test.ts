import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";

const drawer = readFileSync(
  new URL("./components/chamber-transport-account-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/transport-office-section.tsx", import.meta.url),
  "utf8",
);

test("Account & payment opens as a responsive right-side drawer over the overview", () => {
  assert.match(officeSection, /<ChamberTransportWorkforceOverview/);
  assert.match(officeSection, /<ChamberTransportAccountDrawer/);
  assert.doesNotMatch(officeSection, /function TransportWorkerFinances/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("current cumulative account remains independent from selected-period earnings", () => {
  assert.match(drawer, /balanceQueryKey\(factoryId, worker\.id, localToday\)/);
  assert.match(drawer, /periodEarningsQueryKey\([\s\S]*earningsRange\?\.fromDate[\s\S]*earningsRange\?\.toDate/);
  assert.match(drawer, /ATLAS_UI_STRINGS\.transportCredit\.balanceHelp/);
  assert.match(ATLAS_UI_STRINGS.transportCredit.balanceHelp, /Period filters do not change it/);
  assert.match(drawer, /ATLAS_UI_STRINGS\.transportCredit\.total/);
  assert.match(drawer, /Total withdrawn/);
  assert.match(drawer, /sumTransportPeriodEarned\(periodDetails\)/);
});

test("arbitrary period history uses immutable multi-group worker-share snapshots", () => {
  for (const label of ["This week", "Last week", "This month", "Custom"]) {
    assert.match(drawer, new RegExp(label));
  }
  assert.match(drawer, /listTransportWorkerEarningDetails\(/);
  assert.match(drawer, /buildTransportWeeklyDetailDisplay\(detail\)/);
  assert.match(drawer, /immutable saved worker-share snapshots only/);
  assert.match(drawer, /periodGroups\.join\(" · "\)/);
  assert.match(drawer, /Saved rate/);
  assert.match(drawer, /Group pool/);
});

test("payments retain the authoritative withdrawal RPC and dated overdraw protection", () => {
  assert.match(drawer, /buildTransportWithdrawalInput\(\{/);
  assert.match(drawer, /createTransportWorkerWithdrawal\(input\)/);
  assert.match(drawer, /getTransportWorkerAvailableBalance\(\{/);
  assert.match(drawer, /asOfDate: paymentDate/);
  assert.match(drawer, /transportWorkerFinanceErrorMessage/);
  assert.match(drawer, /if \(isPaying\) return/);
  assert.match(drawer, /loading=\{isPaying\}/);
  assert.match(drawer, /inputMode="decimal"/);
  assert.match(drawer, /listTransportWorkerWithdrawals\(/);
});

test("reference hierarchy uses only V2 primitives and approved Atlas tokens", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill", "TableContainer"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.match(drawer, /Available to pay/);
  assert.match(drawer, /Earnings view/);
  assert.match(drawer, /Record payment/);
  assert.match(drawer, /Recent payments/);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});

test("drawer does not invent Chamber financial or worker semantics", () => {
  assert.doesNotMatch(drawer, /work_direction|direction|individual worker rate|Paid \/ Unpaid|settlement status|payment method|payment notes|worker id/i);
  assert.doesNotMatch(drawer, /insert\(|update\(|delete\(|\.from\(|\.rpc\(/);
});
