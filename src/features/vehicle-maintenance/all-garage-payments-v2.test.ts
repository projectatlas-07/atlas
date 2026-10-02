import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");
const drawer = readFileSync(new URL(
  "../office/components/vehicle-maintenance-payment-detail-drawer.tsx",
  import.meta.url,
), "utf8");
const navigation = readFileSync(new URL(
  "../office/office-navigation.ts",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL(
  "./vehicle-maintenance-model.ts",
  import.meta.url,
), "utf8");

test("All Garage Payments is a nested hash-addressable Garage Payments view", () => {
  assert.match(navigation, /OFFICE_GARAGE_PAYMENTS_ARCHIVE_HASH = "#all-garage-payments"/);
  assert.match(navigation, /value === "all-garage-payments"\) return "garage-payments"/);
  assert.match(component, /window\.location\.hash === getOfficeGaragePaymentsArchiveHash\(\)/);
  assert.match(component, /onClick=\{openPaymentArchive\}>View all payments →/);
  assert.match(component, /← Back to Garage Payments/);
  assert.match(component, /window\.location\.hash = getOfficeVehicleMaintenanceHash\("garage-payments"\)/);
  assert.match(component, /activeArea === "garage-payments" && showPaymentArchive && <>/);
});

test("archive reuses one grouped payment query and model-owned filtering", () => {
  assert.equal((component.match(/listVehicleMaintenanceBatchPayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archivePayments = filterVehicleMaintenanceBatchPayments\(/);
  assert.match(model, /paymentMode: VehicleMaintenanceBatchPayment\["paymentMode"\] \| ""/);
  assert.match(model, /payment\.garageNameSnapshot[\s\S]*payment\.note[\s\S]*payment\.allocations\.flatMap/);
  assert.match(model, /payment\.vehicleIds\.includes\(vehicleId\)/);
  for (const label of ["Search payments", "Garage", "Vehicle"]) {
    assert.match(component, new RegExp(`label="${label}"`));
  }
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.fromDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.toDate/);
  assert.match(component, /label=\{ATLAS_UI_STRINGS\.payment\.mode\}/);
});

test("archive exposes only genuine grouped Garage Payment columns in a bounded table", () => {
  for (const column of ["Garage", "Maintenance jobs", "Action"]) {
    assert.match(component, new RegExp(`<TableHeaderCell(?: numeric)?>${column}</TableHeaderCell>`));
  }
  for (const shared of ["payment.date", "fields.amount", "payment.mode", "fields.note"]) {
    assert.match(component, new RegExp(`ATLAS_UI_STRINGS\\.${shared.replace(".", "\\.")}`));
  }
  assert.match(component, /<TableContainer bounded aria-label="All Garage Payments table">/);
  assert.match(component, /<Table wide>/);
  assert.match(component, /<TableHeader sticky>/);
  assert.match(component, /Open payment →/);
  assert.doesNotMatch(component, /Garage Payment ID|sync status|audit metadata|pagination|pageNumber/i);
});

test("payment drawer is accessible, read-only, and renders exact saved allocations", () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /payment\.allocations\.map/);
  for (const field of [
    "garageNameSnapshot", "paymentDate", "amount", "paymentMode", "note",
    "maintenanceDate", "vehicleNumberSnapshot", "workDescription", "allocatedAmount",
  ]) assert.match(drawer, new RegExp(`\\.${field}`));
  assert.doesNotMatch(drawer, /settlement from|settlement to|fromDate|toDate/i);
  assert.doesNotMatch(drawer, /(?:edit|delete|void|reverse|save)Payment|type="submit"/i);
});

test("drawer reconciliation uses persisted allocations and can open existing Maintenance detail", () => {
  assert.match(drawer, /getVehicleMaintenancePaymentAllocationReconciliation\(payment\)/);
  assert.match(model, /payment\.allocations\.reduce/);
  assert.doesNotMatch(drawer, /outstandingAmount|totalPaid|listVehicleMaintenanceRecords|\.from\(|\.rpc\(/);
  assert.match(drawer, /onOpenMaintenance\(allocation\.maintenanceId\)/);
  assert.match(drawer, /canOpenMaintenance\(allocation\.maintenanceId\)/);
  assert.match(component, /return records\.some\(\(record\) => record\.id === maintenanceId\)/);
  assert.match(component, /setSelectedId\(maintenanceId\)/);
  assert.match(component, /window\.location\.hash = getOfficeVehicleMaintenanceHash\("maintenance"\)/);
});

test("drawer and archive use Atlas V2 tokens and primitives", () => {
  for (const primitive of ["Button", "Card", "Feedback"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  for (const primitive of [
    "Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select",
    "Table", "TableBody", "TableCaption", "TableCell", "TableContainer", "TableHeader",
    "TableHeaderCell", "TableRow",
  ]) assert.match(component, new RegExp(`<${primitive}`));
  for (const source of [component, drawer]) {
    assert.doesNotMatch(source, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
    assert.doesNotMatch(source, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  }
});
