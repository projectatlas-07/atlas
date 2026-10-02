import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-fuel-office-section.tsx",
  import.meta.url,
), "utf8");
const drawer = readFileSync(new URL(
  "../office/components/vehicle-fuel-payment-detail-drawer.tsx",
  import.meta.url,
), "utf8");
const navigation = readFileSync(new URL(
  "../office/office-navigation.ts",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("./vehicle-fuel-model.ts", import.meta.url), "utf8");

test("All Pump Payments is a nested hash-addressable Pump Payments view", () => {
  assert.match(navigation, /OFFICE_PUMP_PAYMENTS_ARCHIVE_HASH = "#all-pump-payments"/);
  assert.match(navigation, /value === "all-pump-payments"\) return "pump-payments"/);
  assert.match(component, /window\.location\.hash === getOfficePumpPaymentsArchiveHash\(\)/);
  assert.match(component, /onClick=\{openPaymentArchive\}>View all payments →/);
  assert.match(component, /← Back to Pump Payments/);
  assert.match(component, /window\.location\.hash = getOfficeFuelBookHash\("pump-payments"\)/);
  assert.match(component, /activeArea === "pump-payments" && showPaymentArchive && <>/);
});

test("archive reuses one grouped payment query and model-owned filtering", () => {
  assert.equal((component.match(/listVehicleFuelBatchPayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archivePayments = filterVehicleFuelBatchPayments\(/);
  assert.match(model, /paymentMode: VehicleFuelBatchPayment\["paymentMode"\] \| ""/);
  assert.match(model, /payment\.pumpName[\s\S]*payment\.note[\s\S]*payment\.allocations\.map/);
  assert.match(model, /payment\.vehicleIds\.includes\(vehicleId\)/);
  for (const label of ["Search payments", "Fuel Pump", "Vehicle"]) {
    assert.match(component, new RegExp(`label="${label}"`));
  }
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.fromDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.toDate/);
  assert.match(component, /label=\{ATLAS_UI_STRINGS\.payment\.mode\}/);
});

test("archive exposes only genuine grouped Pump Payment columns in a bounded table", () => {
  for (const column of ["Fuel Pump", "Fuel Entries", "Action"]) {
    assert.match(component, new RegExp(`<TableHeaderCell(?: numeric)?>${column}</TableHeaderCell>`));
  }
  for (const shared of ["payment.date", "fields.amount", "payment.mode", "fields.note"]) {
    assert.match(component, new RegExp(`ATLAS_UI_STRINGS\\.${shared.replace(".", "\\.")}`));
  }
  assert.match(component, /<TableContainer bounded aria-label="All Pump Payments table">/);
  assert.match(component, /<Table wide>/);
  assert.match(component, /<TableHeader sticky>/);
  assert.match(component, /Open payment →/);
  assert.doesNotMatch(component, /Pump Payment ID|sync status|audit metadata|pagination|pageNumber/i);
});

test("payment drawer is accessible, read-only, and renders exact persisted allocations", () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /payment\.allocations\.map/);
  for (const field of [
    "pumpName", "paymentDate", "amount", "paymentMode", "note", "fuelDate", "fuelTime",
    "vehicleNumberSnapshot", "fuelType", "litres", "allocatedAmount",
  ]) assert.match(drawer, new RegExp(`\\.${field}`));
  assert.doesNotMatch(drawer, /settlement from|settlement to|fromDate|toDate/i);
  assert.doesNotMatch(drawer, /(?:edit|delete|void|reverse|save)Payment|type="submit"/i);
});

test("drawer reconciliation uses persisted allocations and can open existing Fuel Entry detail", () => {
  assert.match(drawer, /getVehicleFuelPaymentAllocationReconciliation\(payment\)/);
  assert.match(model, /payment\.allocations\.reduce/);
  assert.doesNotMatch(drawer, /outstandingAmount|totalPaid|listVehicleFuelRecords|\.from\(|\.rpc\(/);
  assert.match(drawer, /onOpenFuelEntry\(allocation\.fuelRecordId\)/);
  assert.match(drawer, /canOpenFuelEntry\(allocation\.fuelRecordId\)/);
  assert.match(component, /return records\.some\(\(record\) => record\.id === fuelRecordId\)/);
  assert.match(component, /setSelectedId\(fuelRecordId\)/);
  assert.match(component, /window\.location\.hash = getOfficeFuelBookHash\("fuel-entries"\)/);
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
