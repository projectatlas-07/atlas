import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");

test("Maintenance makes the authoritative form the always-visible primary experience", () => {
  assert.match(component, /activeArea === "maintenance" && !showMaintenanceArchive && <>/);
  assert.match(component, /id="new-vehicle-maintenance-heading"/);
  assert.match(component, /<form onSubmit=\{saveRecord\}>/);
  assert.doesNotMatch(component, /showForm|setShowForm/);
  for (const field of [
    "Vehicle", "Business date", "Garage / mechanic", "Work / repair",
    "Maintenance amount", "Paid now (blank or 0 = unpaid)",
    "Amount due",
  ]) assert.match(component, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.mode/);
});

test("amount, paid-now, due, save, correction, and void remain model and service owned", () => {
  assert.match(component, /const initialDue = Math\.max\(0, \(Number\(form\.totalAmount\) \|\| 0\) - \(Number\(form\.initialPaidAmount\) \|\| 0\)\)/);
  assert.match(component, /buildCreateVehicleMaintenanceInput\(factoryId, form\)/);
  assert.match(component, /buildUpdateVehicleMaintenanceInput\(factoryId, editingId, form\)/);
  assert.match(component, /createVehicleMaintenance\(input\)/);
  assert.match(component, /updateVehicleMaintenance\(input\)/);
  assert.match(component, /voidVehicleMaintenance\(factoryId, selected\.id\)/);
  assert.match(component, /canChangeVehicleMaintenance\(selected\)/);
  assert.match(component, /\["office-cash-book-day", factoryId\]/);
});

test("Recent Maintenance is bounded, scrollable, authoritative, and reuses detail selection", () => {
  assert.match(component, /const recentRecords = records\.slice\(0, 8\)/);
  assert.match(component, /className="flex h-96 flex-col"/);
  assert.match(component, /className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(component, /setSelectedId\(record\.id\); setConfirmingVoid\(false\)/);
  assert.match(component, /onClick=\{openMaintenanceArchive\}>View all maintenance →<\/Button>/);
  assert.match(component, /<MaintenanceStatus record=\{record\}/);
});

test("Maintenance follows the V2 two-column hierarchy and shared presentation contracts", () => {
  assert.match(component, /grid items-start gap-atlas-4 lg:grid-cols-3/);
  assert.match(component, /lg:col-span-2/);
  assert.match(component, /<Card as="section" aria-labelledby="new-vehicle-maintenance-heading">/);
  assert.match(component, /<SearchChoice v2 label="Vehicle"/);
  assert.match(component, /<SearchChoice v2 label="Garage \/ mechanic"/);
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill", "Textarea"]) {
    assert.match(component, new RegExp(`<${primitive}`));
  }
  assert.match(component, /VEHICLE_MAINTENANCE_PAYMENT_STATUS/);
  assert.doesNotMatch(component, /odometer|technician|parts inventory|service category|job id/i);
});

test("Garage Payments remains on its existing shared service boundary", () => {
  assert.match(component, /activeArea === "garage-payments" && !showPaymentArchive && <>/);
  assert.match(component, /buildVehicleMaintenanceBatchPaymentInput\(factoryId, paymentForm, records\)/);
  assert.match(component, /createVehicleMaintenanceBatchPayment\(input\)/);
  assert.match(component, /Garage payment saved and allocated oldest-first with one Cash Book Money Out/);
  assert.match(component, /Recent Garage Payments/);
});
