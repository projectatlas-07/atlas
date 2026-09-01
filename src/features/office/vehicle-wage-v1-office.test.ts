import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("./components/vehicle-wage-accounts-section.tsx", import.meta.url),
  "utf8",
);
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

test("Vehicle Wages remains one focused account beside Vehicle management", () => {
  assert.match(salesOffice, /<VehicleManagementSection[\s\S]*<VehicleWageAccountsSection/);
  assert.match(component, /Vehicle Wages/);
  assert.match(component, /Delivery Labour Wage accounts/);
  assert.match(component, /Vehicle accounts/);
  assert.match(component, /Trip Labour Wage/);
  assert.match(component, /Open Challan/);
});

test("date-range UI is inclusive and supports day, week, month, and arbitrary custom ranges", () => {
  for (const label of ["Today", "Yesterday", "This week", "This month", "Custom range"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /From date/);
  assert.match(component, /To date/);
  assert.match(component, /inclusive/);
  assert.match(component, /range\?\.fromDate, range\?\.toDate/);
});

test("archived and Tracking-OFF Vehicles remain visible as current context only", () => {
  assert.match(component, /account\.isActive \? "Active" : "Archived"/);
  assert.match(component, /Tracking \{account\.deliveryWageTrackingEnabled \? "ON" : "OFF"\} now/);
  assert.doesNotMatch(component, /filter\([^)]*isActive|filter\([^)]*deliveryWageTrackingEnabled/);
});

test("V1 trip earnings remain Challan-derived after V2 adds a separate payment boundary", () => {
  assert.doesNotMatch(component, /\bWithdraw\b|Add Wage|Manual Wage|Adjustment|Edit Payment|Delete Payment/);
  assert.match(service, /\.from\("challans"\)/);
  assert.doesNotMatch(service, /vehicle_wage_earnings|challan_total|customer_payment_allocations/);
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
