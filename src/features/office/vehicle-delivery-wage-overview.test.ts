import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const overview = readFileSync(
  new URL("./components/vehicle-delivery-wage-overview.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../sales/services/vehicle-wage-service.ts", import.meta.url),
  "utf8",
);
const salesOffice = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);

test("Vehicle wage overview exposes only the supported period controls and columns", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom", "All Time"]) {
    assert.match(overview, new RegExp(label));
  }
  for (const heading of ["Vehicle", "Trips", "Earned", "Available", "Last paid", "Action"]) {
    assert.match(overview, new RegExp(`TableHeaderCell[^>]*>${heading}`));
  }
  assert.doesNotMatch(overview, /₹x\/trip|Change Rate|Paid\/Unpaid|driver wage/i);
});

test("period earnings and lifetime balances keep separate authoritative query keys", () => {
  assert.match(overview, /listVehicleWageTrips\(factoryId, range!\)/);
  assert.match(overview, /listAllVehicleWageTrips\(factoryId\)/);
  assert.match(overview, /vehicleWageAccountQueryKey\(factoryId, account\.vehicleId\)/);
  assert.match(overview, /Available remains the current lifetime balance/);
  assert.doesNotMatch(overview, /vehicleWageAccountQueryKey\([^\n]*range|vehicleWageAccountQueryKey\([^\n]*preset/);
  assert.match(service, /get_vehicle_wage_account_summary/);
});

test("trip expansion is single-row, capped at seven, and reconciles from the account trips", () => {
  assert.match(overview, /setExpandedVehicleId\(\(current\) => current === vehicleId \? "" : vehicleId\)/);
  assert.match(overview, /account\.trips\.slice\(0, 7\)/);
  assert.match(overview, /Show remaining \$\{formatIndianNumber\(remainingCount\)\} trips/);
  assert.match(overview, /formatIndianNumber\(account\.qualifyingTripCount\)[\s\S]*formatIndianCurrency\(account\.earnedAmount\)/);
  assert.match(overview, /Trip wages are recorded on individual Challans and summed into period earnings/);
});

test("trip evidence links to the saved Challan and uses historical customer and destination snapshots", () => {
  assert.match(overview, /customerNameSnapshot/);
  assert.match(overview, /destinationSnapshot/);
  assert.match(overview, /href=\{`\/office\/challans\/\$\{trip\.challanId\}`\}/);
  assert.match(overview, /formatChallanLabel\(trip\.challanNumber\)/);
});

test("overview uses V2 primitives with separate desktop and mobile presentations", () => {
  for (const primitive of ["Button", "EmptyState", "Feedback", "Input", "Select", "StatusPill", "TableContainer"]) {
    assert.match(overview, new RegExp(`<${primitive}\\b`));
  }
  assert.match(overview, /hidden md:block/);
  assert.match(overview, /md:hidden/);
  assert.doesNotMatch(overview, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});

test("Account keeps the focused drawer while rare actions update in place", () => {
  assert.match(overview, /<VehicleWageAccountDrawer[\s\S]*vehicle=\{accountVehicle\}/);
  assert.doesNotMatch(overview, /VehicleWageAccountsSection|detailOnly/);
  assert.match(overview, /Account &amp; payment/);
  assert.match(overview, /<VehicleRareActions/);
  assert.match(overview, /onVehicleSaved\(saved\)/);
  assert.match(salesOffice, /onVehicleSaved=\{cacheSavedVehicle\}/);
  assert.doesNotMatch(overview + salesOffice, /onManageVehicles|>Manage<|setActiveArea\("settings"\)/);
});
