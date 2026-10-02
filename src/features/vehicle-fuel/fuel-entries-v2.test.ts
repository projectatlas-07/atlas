import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-fuel-office-section.tsx",
  import.meta.url,
), "utf8");

test("Fuel Entries makes the authoritative form the always-visible primary experience", () => {
  assert.match(component, /activeArea === "fuel-entries" && !showFuelEntriesArchive && <>/);
  assert.match(component, /id="new-fuel-entry-heading"/);
  assert.match(component, /<form onSubmit=\{saveRecord\}>/);
  assert.doesNotMatch(component, /showForm|setShowForm/);
  for (const field of [
    "Vehicle", "Fuel Pump", "Business date", "Time", "Fuel Type", "Litres",
    "Rate / Litre", "Amount", "Paid now (blank or 0 = unpaid)", "Amount due",
  ]) assert.match(component, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.mode/);
});

test("smart measurement, paid-now, save, correction, and void stay model and service owned", () => {
  assert.match(component, /setForm\(\(current\) => updateFuelMeasurement\(current, field, value\)\)/);
  assert.match(component, /const initialDue = Math\.max\(0, \(Number\(form\.fuelAmount\) \|\| 0\) - \(Number\(form\.initialPaidAmount\) \|\| 0\)\)/);
  assert.match(component, /buildCreateVehicleFuelInput\(factoryId, form\)/);
  assert.match(component, /buildUpdateVehicleFuelInput\(factoryId, editingId, form\)/);
  assert.match(component, /createVehicleFuel\(input\)/);
  assert.match(component, /updateVehicleFuel\(input\)/);
  assert.match(component, /voidVehicleFuel\(factoryId, selected\.id\)/);
  assert.match(component, /canChangeVehicleFuel\(selected\)/);
  assert.match(component, /Number\(form\.initialPaidAmount\) > 0/);
  assert.match(component, /\["office-cash-book-day", factoryId\]/);
});

test("previous-refuel context and the financial lock remain visible and authoritative", () => {
  assert.match(component, /getPreviousVehicleRefuel\(factoryId, form\.vehicleId, form\.fuelDate, form\.fuelTime, editingId \|\| null\)/);
  assert.match(component, /enabled: activeArea === "fuel-entries" && Boolean\(form\.vehicleId && form\.fuelDate && form\.fuelTime\)/);
  assert.match(component, /Last refuel:/);
  assert.match(component, /relativeRefuelAge\(previousQuery\.data\.fuelDate\)/);
  assert.match(component, /Payment history locks this Fuel entry from correction or voiding/);
  assert.match(component, /disabled=\{!canChangeVehicleFuel\(selected\)\}/);
});

test("Recent Fuel Entries is bounded, scrollable, and reuses existing detail selection", () => {
  assert.match(component, /const recentRecords = records\.slice\(0, 8\)/);
  assert.match(component, /id="recent-fuel-entries-heading"/);
  assert.match(component, /className="flex h-96 flex-col"/);
  assert.match(component, /className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(component, /setSelectedId\(record\.id\); setConfirmingVoid\(false\)/);
  assert.match(component, /<FuelEntryStatus record=\{record\}/);
  assert.match(component, /<Button type="button" variant="ghost" onClick=\{openFuelEntriesArchive\}>View all fuel entries →<\/Button>/);
});

test("Fuel Entries follows the V2 responsive hierarchy and shared presentation contracts", () => {
  assert.match(component, /grid items-start gap-atlas-4 lg:grid-cols-3/);
  assert.match(component, /lg:col-span-2/);
  assert.match(component, /<Card as="section" aria-labelledby="new-fuel-entry-heading">/);
  assert.match(component, /<SearchChoice v2 label="Vehicle"/);
  assert.match(component, /<SearchChoice v2 label="Fuel Pump"/);
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill"]) {
    assert.match(component, new RegExp(`<${primitive}`));
  }
  assert.match(component, /VEHICLE_FUEL_PAYMENT_STATUS/);
  assert.doesNotMatch(component, /odometer|driver|mileage|trip id|tank capacity|receipt upload/i);
});

test("Pump Payments remains on its existing service and visibility boundary", () => {
  assert.match(component, /activeArea === "pump-payments" && !showPaymentArchive && <div/);
  assert.match(component, /buildVehicleFuelBatchPaymentInput\(factoryId, paymentForm, records\)/);
  assert.match(component, /createVehicleFuelBatchPayment\(input\)/);
  assert.match(component, /Batch Pump payment saved and allocated oldest-first with one Cash Book Money Out/);
  assert.match(component, /Recent Pump Payments/);
  assert.match(component, /payment\.allocations\.map/);
});
