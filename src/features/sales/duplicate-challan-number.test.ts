import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getEligibleVehicleWageTrips } from "./vehicle-wage-model.ts";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260913000037_allow_duplicate_challan_numbers.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_duplicate_challan_numbers.sql", import.meta.url),
  "utf8",
);
const challanService = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const paymentService = readFileSync(
  new URL("./services/customer-payment-service.ts", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const customerPayments = readFileSync(
  new URL("../office/components/customer-payments-section.tsx", import.meta.url),
  "utf8",
);
const register = readFileSync(
  new URL("../office/components/sales-register-section.tsx", import.meta.url),
  "utf8",
);
const printScreen = readFileSync(
  new URL("./components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);
const cashBookMigration = readFileSync(
  new URL("../../../supabase/migrations/20260901000033_create_vehicle_wage_payment_reversals.sql", import.meta.url),
  "utf8",
);

test("forward migration removes only visible-number uniqueness and preserves UUID identity", () => {
  assert.match(migration, /drop constraint challans_factory_number_key/);
  assert.match(migration, /Duplicates are allowed; the Challan UUID is the only record identity/);
  assert.doesNotMatch(migration, /drop constraint challans_pkey|alter column id|drop column|update public\.challans/i);
});

test("record-specific application paths use internal Challan IDs", () => {
  assert.match(challanService, /\.eq\("id", challanId\)/);
  assert.match(challanService, /p_challan_id: input\.challanId/);
  assert.match(challanService, /p_challan_id: challanId/);
  assert.match(office, /openChallan\(challan\.id\)/);
  assert.match(office, /\/office\/challans\/\$\{challan\.id\}/);
  assert.match(printScreen, /getChallan\(factory\.factoryId, challanId\)/);
  assert.doesNotMatch(challanService, /\.eq\("challan_number"/);
});

test("duplicate-sensitive financial paths key and join by IDs", () => {
  assert.match(paymentService, /seenChallanIds/);
  assert.match(paymentService, /\.in\("id", challanIds\)/);
  assert.match(paymentService, /allocatedByChallanId/);
  assert.match(register, /key=\{entry\.challanId\}/);
  assert.match(register, /\/office\/challans\/\$\{entry\.challanId\}/);
  assert.match(cashBookMigration, /challans\.id = allocations\.challan_id/);
  assert.doesNotMatch(cashBookMigration, /challans\.challan_number = allocations/);
});

test("duplicate visible numbers remain separate Vehicle Delivery Wage sources", () => {
  const trips = getEligibleVehicleWageTrips([
    {
      challanId: "duplicate-a",
      challanNumber: "11",
      challanDate: "2026-09-12",
      vehicleId: "vehicle-a",
      vehicleNumberSnapshot: "WB58A1234",
      deliveryWageApplicableSnapshot: true,
      tripLabourWage: 100,
      status: "active",
    },
    {
      challanId: "duplicate-b",
      challanNumber: "11",
      challanDate: "2026-09-13",
      vehicleId: "vehicle-a",
      vehicleNumberSnapshot: "WB58A1234",
      deliveryWageApplicableSnapshot: true,
      tripLabourWage: 200,
      status: "active",
    },
  ]);
  assert.deepEqual(trips.map((trip) => trip.challanId), ["duplicate-b", "duplicate-a"]);
  assert.equal(trips.reduce((total, trip) => total + trip.tripLabourWage, 0), 300);
});

test("lists, payment references, and search results expose compact disambiguating context", () => {
  assert.match(office, /visibleChallans\.map/);
  assert.match(office, /challan\.customerNameSnapshot/);
  assert.match(office, /formatChallanDate\(challan\.challanDate\)/);
  assert.match(office, /challan\.vehicleNumberSnapshot/);
  assert.match(customerPayments, /allocation\.challanDate/);
  assert.match(register, /entry\.challanDate/);
  assert.match(register, /entry\.customerNameSnapshot/);
});

test("rollback-safe verifier covers identity, edit, view, payment, void, register, cash, wage, and isolation", () => {
  for (const phrase of [
    "same-factory duplicate visible numbers create separate internal Challan IDs",
    "editing targets one duplicate-number Challan by internal ID",
    "view and print source rows resolve independently by internal ID",
    "payment and outstanding remain independent by Challan ID",
    "voiding targets only one duplicate-number Challan ID",
    "Sales Register source retains both duplicate-number transactions",
    "Cash Book remains linked to the correct payment transaction",
    "both duplicate-number Challans contribute independently to Vehicle Delivery Wage",
    "factories independently reuse visible numbers without cross-factory leakage",
    "UUID primary key and all unrelated Challan constraints remain authoritative",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});
