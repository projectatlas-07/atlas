import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCreateChallanInput,
  filterActiveVehiclesForChallan,
  getChallanFormError,
  selectVehicleForChallan,
  type ChallanFormState,
} from "../office/sales-office-model.ts";
import type { Vehicle } from "./types.ts";

const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);

const wageOn: Vehicle = {
  id: "vehicle-on",
  factoryId: "factory-a",
  vehicleNumber: "WB57B1234",
  normalizedVehicleNumber: "WB57B1234",
  deliveryWageTrackingEnabled: true,
  isActive: true,
  createdAt: "2026-09-11T08:00:00Z",
  updatedAt: "2026-09-11T08:00:00Z",
};
const wageOff: Vehicle = {
  ...wageOn,
  id: "vehicle-off",
  vehicleNumber: "WB 12 AB 9876",
  normalizedVehicleNumber: "WB12AB9876",
  deliveryWageTrackingEnabled: false,
};
const archived: Vehicle = {
  ...wageOn,
  id: "vehicle-archived",
  vehicleNumber: "WB57ARCH1",
  normalizedVehicleNumber: "WB57ARCH1",
  isActive: false,
};
const vehicles = [wageOn, wageOff, archived];

const baseForm: ChallanFormState = {
  challanNumber: "A-39",
  challanDate: "2026-09-11",
  customerId: "customer-a",
  vehicleId: "",
  selectedVehicleIsActive: true,
  vehicleDeliveryWageTrackingEnabled: false,
  tripLabourWage: "",
  lines: [{
    key: "brick-a",
    brickTypeId: "brick-a",
    quantity: "12347",
    pricingMode: "AMOUNT",
    ratePer1000Bricks: "6479.306714182",
    lineAmount: "80000",
  }],
  flexibleLines: [],
};

test("empty and partial searches expose only active Vehicles", () => {
  assert.deepEqual(
    filterActiveVehiclesForChallan(vehicles, "").map((vehicle) => vehicle.id),
    [wageOn.id, wageOff.id],
  );
  assert.deepEqual(
    filterActiveVehiclesForChallan(vehicles, "WB57").map((vehicle) => vehicle.id),
    [wageOn.id],
  );
  assert.equal(filterActiveVehiclesForChallan(vehicles, "ARCH").length, 0);
});

test("search is case-insensitive and ignores normal spacing differences", () => {
  assert.deepEqual(
    filterActiveVehiclesForChallan(vehicles, "  wb 12 ab  ").map((vehicle) => vehicle.id),
    [wageOff.id],
  );
});

test("Vehicle ID is the only authoritative selection and can change or clear", () => {
  const selectedOn = selectVehicleForChallan(baseForm, vehicles, wageOn.id);
  assert.equal(selectedOn.vehicleId, wageOn.id);
  assert.equal(selectedOn.vehicleDeliveryWageTrackingEnabled, true);

  const selectedOff = selectVehicleForChallan(
    { ...selectedOn, tripLabourWage: "750" },
    vehicles,
    wageOff.id,
  );
  assert.equal(selectedOff.vehicleId, wageOff.id);
  assert.equal(selectedOff.vehicleDeliveryWageTrackingEnabled, false);
  assert.equal(selectedOff.tripLabourWage, "");

  const cleared = selectVehicleForChallan(selectedOff, vehicles, "");
  assert.equal(cleared.vehicleId, "");
  assert.equal(cleared.selectedVehicleIsActive, true);
  assert.equal(cleared.vehicleDeliveryWageTrackingEnabled, false);
});

test("Wage ON and OFF Vehicles remain selectable with existing Trip Labour Wage rules", () => {
  const selectedOn = selectVehicleForChallan(baseForm, vehicles, wageOn.id);
  assert.equal(getChallanFormError(selectedOn), "Enter a positive Trip Labour Wage for this Vehicle.");
  const withWage = { ...selectedOn, tripLabourWage: "750" };
  assert.equal(getChallanFormError(withWage), null);
  assert.equal(buildCreateChallanInput("factory-a", withWage)?.vehicleId, wageOn.id);
  assert.equal(buildCreateChallanInput("factory-a", withWage)?.tripLabourWage, 750);

  const selectedOff = selectVehicleForChallan(withWage, vehicles, wageOff.id);
  assert.equal(getChallanFormError(selectedOff), null);
  assert.equal(buildCreateChallanInput("factory-a", selectedOff)?.vehicleId, wageOff.id);
  assert.equal(buildCreateChallanInput("factory-a", selectedOff)?.tripLabourWage, null);
});

test("save payload keeps optional Challan number and exact Amount behavior unchanged", () => {
  const selected = selectVehicleForChallan(baseForm, vehicles, wageOff.id);
  const input = buildCreateChallanInput("factory-a", selected);
  assert.equal(input?.challanNumber, "A-39");
  assert.equal(input?.vehicleId, wageOff.id);
  assert.deepEqual(input?.items, [{
    brickTypeId: "brick-a",
    quantity: 12347,
    pricingMode: "AMOUNT",
    lineAmount: "80000.00",
  }]);
});

test("Challan UI has one searchable selector that displays the selected number", () => {
  const comboboxUsage = office.match(/<VehicleCombobox[\s\S]*?\/>/)?.[0];
  assert.ok(comboboxUsage);
  assert.match(office, /role="combobox"/);
  assert.match(office, /placeholder="Search or select vehicle\.\.\."/);
  assert.match(office, /value=\{isOpen \? searchText : selectedVehicle\?\.vehicleNumber \?\? ""\}/);
  assert.equal((office.match(/data-vehicle-combobox/g) ?? []).length, 1);
  assert.doesNotMatch(office, /label="Search Vehicles"|type="search"|vehicleSearch/);
  assert.doesNotMatch(comboboxUsage, /<select/);
});

test("combobox supports click, keyboard navigation, selection, Escape, and clear", () => {
  assert.match(office, /onFocus=\{openList\}/);
  assert.match(office, /event\.key === "ArrowDown"/);
  assert.match(office, /event\.key === "ArrowUp"/);
  assert.match(office, /event\.key === "Enter"/);
  assert.match(office, /event\.key === "Escape"/);
  assert.match(office, /if \(!isOpen\) openList\(\)/);
  assert.match(office, /onClick=\{\(\) => selectVehicle\(vehicle\.id\)\}/);
  assert.match(office, /aria-label="Clear Vehicle selection"/);
  assert.match(office, /onClick=\{\(\) => selectVehicle\(""\)\}/);
});

test("quick Add Vehicle still refreshes and selects the created active Vehicle", () => {
  assert.match(office, /const vehicle = await findOrCreateVehicle/);
  assert.match(office, /onVehicleSaved\(vehicle\)/);
  assert.match(office, /selectVehicleForChallan\(current, \[vehicle\], vehicle\.id\)/);
  assert.match(office, /Add Vehicle without leaving this Challan/);
});
