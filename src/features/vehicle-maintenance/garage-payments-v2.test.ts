import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL(
  "./vehicle-maintenance-model.ts",
  import.meta.url,
), "utf8");
const service = readFileSync(new URL(
  "./services/vehicle-maintenance-service.ts",
  import.meta.url,
), "utf8");

test("Garage Payment is always visible and keeps the authoritative supported fields", () => {
  assert.match(component, /activeArea === "garage-payments" && !showPaymentArchive && <>/);
  for (const field of [
    "Garage",
    "Note / reference (optional)", "Settlement from", "Settlement to",
  ]) assert.match(component, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const field of ["date", "amount", "mode"]) {
    assert.match(component, new RegExp(`ATLAS_UI_STRINGS\\.payment\\.${field}`));
  }
  assert.match(component, /<Button type="submit"[\s\S]*>Save Garage Payment<\/Button>/);
});

test("Garage totals reuse the existing model summary instead of persisted UI totals", () => {
  assert.match(component, /summarizeVehicleMaintenance\(/);
  assert.match(component, /records\.filter\(\(record\) => record\.garageId === paymentForm\.garageId\)/);
  for (const label of ["Work billed", "Paid"]) {
    assert.match(component, new RegExp(`label="${label}"`));
  }
  assert.match(component, /label=\{ATLAS_UI_STRINGS\.payment\.outstanding\}/);
  assert.match(model, /export function summarizeVehicleMaintenance/);
});

test("settlement context mirrors oldest-first eligibility without fake allocation controls", () => {
  assert.match(component, /getVehicleMaintenancePeriodOutstanding/);
  assert.match(component, /periodOutstanding\.eligibleRecords\.map\(\(record, index\)/);
  assert.match(component, /same oldest-first order used by the backend/);
  assert.match(component, /backend rechecks eligibility and outstanding amounts before saving/);
  assert.doesNotMatch(component, /type="checkbox"|Use outstanding|allocatedAmount.*onChange/);
  assert.match(model, /\.sort\(compareMaintenanceOldestFirst\)/);
  assert.match(service, /create_vehicle_maintenance_batch_payment/);
});

test("Maintenance Pay Garage preserves Garage and single-job date context", () => {
  assert.match(component, /garageId: selected\.garageId, fromDate: selected\.maintenanceDate, toDate: selected\.maintenanceDate/);
  assert.match(component, /selectVehicleMaintenanceArea\("garage-payments"\)/);
});

test("Recent Garage Payments is bounded, scrollable, allocation-aware, and links to the archive", () => {
  assert.match(component, /const recentPayments = payments\.slice\(0, 8\)/);
  assert.match(component, /id="recent-garage-payments-heading"/);
  assert.match(component, /className="flex h-96 flex-col"/);
  assert.match(component, /className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(component, /payment\.allocations\.map/);
  assert.match(component, /<Button type="button" variant="ghost" onClick=\{openPaymentArchive\}>View all payments →<\/Button>/);
});

test("Garage Payments uses Atlas V2 primitives and token classes", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select"]) {
    assert.match(component, new RegExp(`<${primitive}`));
  }
  assert.doesNotMatch(component, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(component, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});
