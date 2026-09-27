import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/vehicle-wage-account-drawer.tsx", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("./components/vehicle-delivery-wage-overview.tsx", import.meta.url),
  "utf8",
);

test("Vehicle Account and payment opens as one accessible responsive right drawer", () => {
  assert.match(overview, /<VehicleWageAccountDrawer[\s\S]*vehicle=\{accountVehicle\}/);
  assert.doesNotMatch(overview, /VehicleWageAccountsSection|detailOnly/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0[^"]*w-full[^"]*sm:max-w-lg/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});
test("drawer keeps lifetime balance separate from selected-period Challan earnings", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom", "All Time"]) {
    assert.match(drawer, new RegExp(label));
  }
  assert.match(drawer, /getVehicleWageLifetimeAccount\(factoryId, vehicle\.id\)/);
  assert.match(drawer, /vehicleWageAccountQueryKey\(factoryId, vehicle\.id\)/);
  assert.doesNotMatch(drawer, /vehicleWageAccountQueryKey\([^\n]*range|vehicleWageAccountQueryKey\([^\n]*preset/);
  assert.match(drawer, /listVehicleWageTrips\(factoryId, earningsRange!\)/);
  assert.match(drawer, /listAllVehicleWageTrips\(factoryId\)/);
  assert.match(drawer, /buildVehicleWageAccounts/);
  assert.match(drawer, /periodAccount\.qualifyingTripCount/);
  assert.match(drawer, /periodAccount\.earnedAmount/);
  assert.match(drawer, /Period filters do not change it/);
});

test("payment form uses existing authority, prevents obvious overpay, and offers Pay Full", () => {
  assert.match(drawer, /buildVehicleWagePaymentInput/);
  assert.match(drawer, /recordVehicleWagePayment\(paymentInput\)/);
  assert.match(drawer, /paymentInput\.amount > accountQuery\.data\.availableBalance/);
  assert.match(drawer, /Payment exceeds the authoritative available balance/);
  assert.match(drawer, /Pay Full \{formatIndianCurrency\(availableBalance\)\}/);
  assert.match(drawer, /Remaining after payment/);
  assert.match(drawer, /setQueryData<VehicleWageLifetimeAccount>/);
  assert.match(drawer, /insertVehicleWagePaymentNewestFirst/);
  assert.match(drawer, /form="vehicle-wage-payment-form"/);
});

test("payment history is a same-drawer drill-in and preserves immutable full reversals", () => {
  assert.match(drawer, /type DrawerView = "account" \| "history"/);
  assert.match(drawer, /View history/);
  assert.match(drawer, /setView\("history"\)/);
  assert.match(drawer, /Back to account/);
  assert.match(drawer, /buildVehicleWagePaymentReversalInput/);
  assert.match(drawer, /reverseVehicleWagePayment\(input\)/);
  assert.match(drawer, /applyVehicleWagePaymentReversal/);
  assert.match(drawer, /original stays in history/);
  assert.match(drawer, /Reversed on/);
  assert.doesNotMatch(drawer, /router|href=|window\.open/);
});

test("drawer omits unsupported rates, trip duplication, and mutable ledger actions", () => {
  assert.doesNotMatch(drawer, /Current rate|₹\s*\d+\s*\/\s*trip|Change Rate/i);
  assert.doesNotMatch(drawer, /Recent Trips|TripEvidence|formatChallanLabel|challanId/);
  assert.doesNotMatch(drawer, /Edit Payment|Delete Payment|partial reversal|manual adjustment/i);
  assert.doesNotMatch(drawer, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});
