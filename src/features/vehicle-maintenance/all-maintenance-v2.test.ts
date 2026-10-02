import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
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

test("All Maintenance is a nested hash-addressable Maintenance view", () => {
  assert.match(navigation, /OFFICE_VEHICLE_MAINTENANCE_ARCHIVE_HASH = "#all-maintenance"/);
  assert.match(navigation, /value === "all-maintenance"\) return "maintenance"/);
  assert.match(component, /window\.location\.hash === getOfficeVehicleMaintenanceArchiveHash\(\)/);
  assert.match(component, /window\.location\.hash = getOfficeVehicleMaintenanceArchiveHash\(\)/);
  assert.match(component, /onClick=\{closeMaintenanceArchive\}>← Back to Maintenance/);
  assert.match(component, /window\.location\.hash = getOfficeVehicleMaintenanceHash\("maintenance"\)/);
  assert.match(component, /activeArea === "maintenance" && showMaintenanceArchive && <>/);
});

test("archive reuses full Maintenance history, model filters, and derived summary", () => {
  assert.equal((component.match(/listVehicleMaintenanceRecords\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archiveRecords = filterVehicleMaintenanceRecords\(/);
  assert.match(component, /const archiveSummary = summarizeVehicleMaintenance\(archiveRecords\)/);
  assert.match(model, /record\.vehicleNumberSnapshot/);
  assert.match(model, /record\.garageNameSnapshot/);
  assert.match(model, /record\.workDescription/);
  assert.match(model, /matchesVehicleMaintenanceState\(record, state\)/);
});

test("archive provides genuine filters, summaries, and business columns", () => {
  for (const label of [
    "Search Maintenance", "Vehicle", "Garage", "All States",
    "Work billed", "Paid", "Active jobs",
  ]) assert.match(component, new RegExp(label));
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.fromDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.toDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.outstanding/);
  for (const field of [
    "maintenanceDate", "vehicleNumberSnapshot", "garageNameSnapshot",
    "workDescription", "totalAmount", "totalPaid", "outstandingAmount",
  ]) assert.match(component, new RegExp(`record\\.${field}`));
  assert.doesNotMatch(component, /odometer|technician|parts metadata|job id|service category/i);
});

test("archive table is bounded, wide, sticky, and has no pagination", () => {
  assert.match(component, /<TableContainer bounded aria-label="All Maintenance table">/);
  assert.match(component, /<Table wide>/);
  assert.match(component, /<TableHeader sticky>/);
  assert.match(component, /archiveRecords\.map/);
  assert.match(component, /ATLAS_UI_STRINGS\.actions\.open\} →/);
  assert.doesNotMatch(component, /pagination|pageNumber|pageSize|Next page|Previous page/i);
});

test("Open reuses existing detail and keeps correction, void, and Pay Garage authority", () => {
  assert.match(component, /setSelectedId\(record\.id\); setConfirmingVoid\(false\)/);
  assert.match(component, /activeArea === "maintenance" && selected/);
  assert.match(component, /canChangeVehicleMaintenance\(selected\)/);
  assert.match(component, /voidVehicleMaintenance\(factoryId, selected\.id\)/);
  assert.match(component, /garageId: selected\.garageId, fromDate: selected\.maintenanceDate, toDate: selected\.maintenanceDate/);
  assert.match(component, /if \(showMaintenanceArchive\) closeMaintenanceArchive\(\)/);
});

test("All Maintenance uses Atlas V2 primitives and token classes", () => {
  for (const primitive of [
    "Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select",
    "Table", "TableBody", "TableCaption", "TableCell", "TableContainer", "TableHeader",
    "TableHeaderCell", "TableRow",
  ]) assert.match(component, new RegExp(`<${primitive}`));
  assert.doesNotMatch(component, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(component, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});
