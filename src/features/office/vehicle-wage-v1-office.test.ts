import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const overview = readFileSync(
  new URL("./components/vehicle-delivery-wage-overview.tsx", import.meta.url),
  "utf8",
);
const drawer = readFileSync(
  new URL("./components/vehicle-wage-account-drawer.tsx", import.meta.url),
  "utf8",
);
const component = `${overview}\n${drawer}`;
const salesOffice = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../sales/services/vehicle-wage-service.ts", import.meta.url),
  "utf8",
);
const c2Migration = readFileSync(
  new URL("../../../supabase/migrations/20260901000030_create_vehicle_challan_snapshot_foundation.sql", import.meta.url),
  "utf8",
);
const baseSalesMigration = readFileSync(
  new URL("../../../supabase/migrations/20260826000020_create_sales_challan_foundation.sql", import.meta.url),
  "utf8",
);
const printDocument = readFileSync(
  new URL("../sales/components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);
const sharedWageRange = readFileSync(
  new URL("../wages/wage-earnings-date-range.ts", import.meta.url),
  "utf8",
);

test("Vehicle Wages remains one focused account under Workforce while Vehicle management is in Settings", () => {
  assert.match(salesOffice, /hidden=\{!showVehicleWages\}[\s\S]*<VehicleDeliveryWageOverview/);
  assert.match(salesOffice, /id="settings"[\s\S]*<VehicleManagementSection/);
  assert.match(overview, /Vehicle Delivery Wages/);
  assert.match(drawer, /Vehicle wage account/);
  assert.match(overview, /Challan trip breakdown/);
  assert.match(overview, /formatChallanLabel\(trip\.challanNumber\)/);
  assert.doesNotMatch(drawer, /Recent Trips|Challan trip breakdown/);
});

test("earnings-period UI defaults fresh mounts to the shared This Week range", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom"]) {
    assert.match(component, new RegExp(label));
  }
  assert.doesNotMatch(component, /label: "Today"|label: "Yesterday"/);
  assert.match(sharedWageRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(overview, /useState<VehicleWageOverviewPreset>\("this_week"\)/);
  assert.match(drawer, /useState<VehicleWageDrawerPreset>\("this_week"\)/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);
  assert.match(component, /label="From"/);
  assert.match(component, /label="To"/);
  assert.match(component, /inclusive/);
  assert.match(overview, /range\?\.fromDate,[\s\S]*range\?\.toDate/);
  assert.match(drawer, /enabled: rangeIsValid/);
  assert.match(drawer, /Earnings view/);
  assert.match(drawer, /periodAccount\.earnedAmount/);
});

test("archived and Tracking-OFF Vehicles remain visible as current context only", () => {
  assert.match(overview, /!account\.isActive && <StatusPill label="Archived"/);
  assert.match(overview, /Wage \{enabled \? "ON" : "OFF"\}/);
  assert.doesNotMatch(component, /filter\([^)]*isActive|filter\([^)]*deliveryWageTrackingEnabled/);
  assert.match(overview, /listVehicleTrips\(factoryId\)/);
  assert.match(overview, /No Vehicles/);
});

test("V1 trip earnings remain Challan-derived after V2 adds a separate payment boundary", () => {
  assert.doesNotMatch(component, /\bWithdraw\b|Add Wage|Manual Wage|Adjustment|Edit Payment|Delete Payment/);
  assert.match(service, /\.from\("challans"\)/);
  assert.doesNotMatch(service, /vehicle_wage_earnings|challan_total|customer_payment_allocations/);
});

test("operational trip evidence stays in the overview and out of the account drawer", () => {
  assert.match(overview, /Challan trip breakdown/);
  assert.match(overview, /customerNameSnapshot/);
  assert.match(overview, /destinationSnapshot/);
  assert.match(overview, /trip\.challanNumber/);
  assert.doesNotMatch(component, /N\/A|UUID/);
  assert.match(overview, /queryKey: \["office-vehicle-trips", factoryId\]/);
  assert.doesNotMatch(drawer, /Recent Trips|TripEvidence|formatChallanLabel/);
});

test("range changes affect only period earnings, not cumulative accounts or payment history", () => {
  assert.match(drawer, /"drawer-trips"[\s\S]*rangePreset[\s\S]*earningsRange\?\.fromDate/);
  assert.match(drawer, /vehicleWageAccountQueryKey\(factoryId, vehicle\.id\)/);
  assert.match(drawer, /vehicleWagePaymentsQueryKey\(factoryId, vehicle\.id\)/);
  assert.doesNotMatch(drawer, /vehicleWageAccountQueryKey\([^\n]*range|vehicleWagePaymentsQueryKey\([^\n]*range/);
  for (const label of ["Earnings", "Available", "ATLAS_UI_STRINGS.payment.history"]) {
    assert.match(component, new RegExp(label));
  }
});

test("ordinary SELECT remains factory-scoped and protected by existing Challan RLS", () => {
  assert.match(service, /\.eq\("factory_id", factoryId\)/);
  assert.match(baseSalesMigration, /Authenticated users can read their factory Sales Challans/);
  assert.match(baseSalesMigration, /factory_users\.factory_id = challans\.factory_id/);
  assert.match(c2Migration, /challans_factory_vehicle_date_idx/);
  assert.match(c2Migration, /foreign key \(vehicle_id, factory_id\)/);
});

test("Challan mutations refresh derived exposure while payment-only changes do not redefine it", () => {
  assert.match(salesOffice, /cacheSavedChallan[\s\S]*office-vehicle-wages/);
  assert.doesNotMatch(service, /customer_payments|customer_payment_allocations|challan_total|challan_items|challan_flexible_lines/);
});

test("customer-facing Correction D remains unchanged and hides internal wage", () => {
  const document = printDocument.slice(printDocument.indexOf("export function RoadChallanDocument"));
  assert.doesNotMatch(document, /Trip Labour Wage|Delivery Wage Tracking|Vehicle Wages/);
  assert.match(document, /challan\.total/);
});
