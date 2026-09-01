import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCreateChallanInput,
  calculateChallanTotalPreview,
  challanFormFromSaved,
  getChallanFormError,
  getSavedChallanVehicleDetails,
  selectVehicleForChallan,
  type ChallanFormState,
} from "../office/sales-office-model.ts";
import type { Challan, Vehicle } from "./types.ts";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260901000030_create_vehicle_challan_snapshot_foundation.sql", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const challanService = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const vehicleService = readFileSync(new URL("./services/vehicle-service.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");

const offVehicle: Vehicle = {
  id: "vehicle-off",
  factoryId: "factory-a",
  vehicleNumber: "WB12OFF1",
  normalizedVehicleNumber: "WB12OFF1",
  deliveryWageTrackingEnabled: false,
  isActive: true,
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};
const onVehicle: Vehicle = {
  ...offVehicle,
  id: "vehicle-on",
  vehicleNumber: "WB12ON1",
  normalizedVehicleNumber: "WB12ON1",
  deliveryWageTrackingEnabled: true,
};

const baseForm: ChallanFormState = {
  challanDate: "2026-09-01",
  customerId: "customer-a",
  vehicleId: "",
  selectedVehicleIsActive: true,
  vehicleDeliveryWageTrackingEnabled: false,
  tripLabourWage: "",
  lines: [{ key: "brick", brickTypeId: "brick-a", quantity: "1000", ratePer1000Bricks: "100000" }],
  flexibleLines: [{
    key: "charge",
    lineType: "EXTRA_CHARGE",
    particulars: "Loading",
    chargeMode: "DIRECT_AMOUNT",
    amount: "2000",
    quantity: "",
    rate: "",
  }],
};

test("C2 form supports no Vehicle and clears stale wage when switching ON to OFF or blank", () => {
  assert.deepEqual(buildCreateChallanInput("factory-a", baseForm), {
    factoryId: "factory-a",
    challanDate: "2026-09-01",
    customerId: "customer-a",
    vehicleId: null,
    tripLabourWage: null,
    items: [{ brickTypeId: "brick-a", quantity: 1000, ratePer1000Bricks: 100000 }],
    flexibleLines: [{
      lineType: "EXTRA_CHARGE",
      orderIndex: 0,
      particulars: "Loading",
      amount: 2000,
    }],
  });

  const selectedOn = selectVehicleForChallan(baseForm, [onVehicle, offVehicle], onVehicle.id);
  assert.equal(getChallanFormError(selectedOn), "Enter a positive Trip Labour Wage for this Vehicle.");
  const withWage = { ...selectedOn, tripLabourWage: "750" };
  assert.equal(getChallanFormError(withWage), null);
  assert.equal(buildCreateChallanInput("factory-a", withWage)?.tripLabourWage, 750);

  const selectedOff = selectVehicleForChallan(withWage, [onVehicle, offVehicle], offVehicle.id);
  assert.equal(selectedOff.tripLabourWage, "");
  assert.equal(buildCreateChallanInput("factory-a", selectedOff)?.tripLabourWage, null);
  const noVehicle = selectVehicleForChallan(withWage, [onVehicle, offVehicle], "");
  assert.equal(noVehicle.tripLabourWage, "");
  assert.equal(noVehicle.vehicleId, "");
});

test("Trip Labour Wage remains completely outside customer total preview", () => {
  const withWage = {
    ...selectVehicleForChallan(baseForm, [onVehicle], onVehicle.id),
    tripLabourWage: "750",
  };
  assert.equal(calculateChallanTotalPreview(withWage.lines, withWage.flexibleLines), 102000);
  assert.equal(buildCreateChallanInput("factory-a", withWage)?.tripLabourWage, 750);
});

test("editing uses current live Vehicle configuration while saved detail remains historical", () => {
  const saved = {
    id: "challan-a",
    factoryId: "factory-a",
    challanNumber: 1,
    challanDate: "2026-09-01",
    customerId: "customer-a",
    customerNameSnapshot: "Customer A",
    customerAddressSnapshot: "Address",
    customerMobileSnapshot: "9000000000",
    companyNameSnapshot: "Atlas",
    companyBusinessDescriptionSnapshot: "Bricks",
    companyAddressSnapshot: "Factory",
    companyMobileSnapshot: "9111111111",
    companyVillageSnapshot: "Village",
    companyPostOfficeSnapshot: "Post",
    companyPoliceStationSnapshot: "Police",
    companyDistrictSnapshot: "District",
    companyStateSnapshot: "State",
    vehicleId: onVehicle.id,
    vehicleNumberSnapshot: onVehicle.normalizedVehicleNumber,
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 750,
    vehicleNumber: onVehicle.normalizedVehicleNumber,
    tractorLabourRateSnapshot: 750,
    challanTotal: 102000,
    status: "active",
    isLocked: false,
    voidedAt: null,
    createdAt: "2026-09-01T09:00:00Z",
    updatedAt: "2026-09-01T09:00:00Z",
    items: [],
    flexibleLines: [],
  } satisfies Challan;
  const liveNowOff = { ...onVehicle, deliveryWageTrackingEnabled: false };
  const editForm = challanFormFromSaved(saved, [liveNowOff]);
  assert.equal(editForm.vehicleDeliveryWageTrackingEnabled, false);
  assert.equal(editForm.tripLabourWage, "");
  assert.deepEqual(getSavedChallanVehicleDetails(saved), {
    vehicleNumber: "WB12ON1",
    tripLabourWage: 750,
  });
  assert.doesNotMatch(office, /Internal tractor labour rate/i);
});

test("migration makes normalized identity, tenant FK, snapshots, and strict wage invariant authoritative", () => {
  assert.match(migration, /unique \(factory_id, normalized_vehicle_number\)/);
  assert.match(migration, /foreign key \(vehicle_id, factory_id\)[\s\S]*references public\.vehicles\(id, factory_id\)/);
  assert.match(migration, /delivery_wage_applicable_snapshot = true[\s\S]*trip_labour_wage > 0/);
  assert.match(migration, /delivery_wage_applicable_snapshot = false[\s\S]*trip_labour_wage is null/);
  assert.match(migration, /from public\.vehicles[\s\S]*for share/);
  assert.match(migration, /if not vehicle_row\.is_active/);
  assert.match(migration, /insert into public\.challans\([\s\S]*vehicle_id, vehicle_number_snapshot,[\s\S]*delivery_wage_applicable_snapshot, trip_labour_wage/);
  assert.match(migration, /revoke all on function public\.create_challan\([\s\S]*uuid, date, uuid, text, numeric, jsonb/);
  assert.doesNotMatch(migration, /create or replace function public\.calculate_challan_total/);
});

test("runtime has one master-based write path and Correction D prints the saved snapshot", () => {
  assert.match(challanService, /p_vehicle_id: input\.vehicleId/);
  assert.match(challanService, /p_trip_labour_wage: input\.tripLabourWage/);
  assert.doesNotMatch(challanService, /p_vehicle_number: validated|p_tractor_labour_rate/);
  assert.match(vehicleService, /find_or_create_vehicle/);
  assert.match(office, /Search Vehicles/);
  assert.match(office, /Add Vehicle without leaving this Challan/);
  assert.match(office, /Trip Labour Wage/);
  assert.match(office, /does not affect the customer Challan total/);
  assert.match(office, /Archived Vehicles/);
  assert.match(printModel, /challan\.vehicleNumberSnapshot/);
  assert.doesNotMatch(printModel, /tripLabourWage|deliveryWageApplicableSnapshot/);
});
