import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-fuel-office-section.tsx",
  import.meta.url,
), "utf8");
const navigation = readFileSync(new URL(
  "../office/office-navigation.ts",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("./vehicle-fuel-model.ts", import.meta.url), "utf8");

test("All Fuel Entries is a nested hash-addressable Fuel Entries view", () => {
  assert.match(navigation, /OFFICE_FUEL_ENTRIES_ARCHIVE_HASH = "#all-fuel-entries"/);
  assert.match(navigation, /value === "all-fuel-entries"\) return "fuel-entries"/);
  assert.match(component, /window\.location\.hash === getOfficeFuelEntriesArchiveHash\(\)/);
  assert.match(component, /window\.location\.hash = getOfficeFuelEntriesArchiveHash\(\)/);
  assert.match(component, /onClick=\{closeFuelEntriesArchive\}>← Back to Fuel Entries/);
  assert.match(component, /window\.location\.hash = getOfficeFuelBookHash\("fuel-entries"\)/);
  assert.match(component, /activeArea === "fuel-entries" && showFuelEntriesArchive && <>/);
});

test("archive reuses full Fuel history, model filters, and derived summary", () => {
  assert.equal((component.match(/listVehicleFuelRecords\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archiveRecords = filterVehicleFuelRecords\(/);
  assert.match(component, /const archiveSummary = summarizeVehicleFuel\(archiveRecords\)/);
  assert.match(model, /record\.vehicleNumberSnapshot/);
  assert.match(model, /record\.pumpNameSnapshot/);
  assert.match(model, /matchesVehicleFuelState\(record, state\)/);
});

test("archive provides genuine filters, summaries, and business columns", () => {
  for (const label of [
    "Search Fuel Entries", "Vehicle", "Fuel Pump", "Fuel Type", "All States",
    "Total Fuel", "Total Amount", "Paid",
  ]) assert.match(component, new RegExp(label));
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.fromDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.toDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.outstanding/);
  for (const field of [
    "fuelDate", "fuelTime", "vehicleNumberSnapshot", "pumpNameSnapshot", "fuelType",
    "litres", "ratePerLitre", "fuelAmount", "totalPaid", "outstandingAmount",
  ]) assert.match(component, new RegExp(`record\\.${field}`));
  assert.doesNotMatch(component, /odometer|mileage|driver|telemetry|sync state|audit state/i);
});

test("archive table is bounded, wide, sticky, and has no pagination", () => {
  assert.match(component, /<TableContainer bounded aria-label="All Fuel Entries table">/);
  assert.match(component, /<Table wide>/);
  assert.match(component, /<TableHeader sticky>/);
  assert.match(component, /archiveRecords\.map/);
  assert.match(component, /ATLAS_UI_STRINGS\.actions\.open\} →/);
  assert.doesNotMatch(component, /pagination|pageNumber|pageSize|Next page|Previous page/i);
});

test("Open reuses existing detail and correction, void, and lock authority", () => {
  assert.match(component, /setSelectedId\(record\.id\); setConfirmingVoid\(false\)/);
  assert.match(component, /activeArea === "fuel-entries" && selected/);
  assert.match(component, /canChangeVehicleFuel\(selected\)/);
  assert.match(component, /voidVehicleFuel\(factoryId, selected\.id\)/);
  assert.match(component, /if \(showFuelEntriesArchive\) closeFuelEntriesArchive\(\)/);
});

test("All Fuel Entries uses Atlas V2 primitives and token classes", () => {
  for (const primitive of [
    "Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "Select",
    "Table", "TableBody", "TableCaption", "TableCell", "TableContainer", "TableHeader",
    "TableHeaderCell", "TableRow",
  ]) assert.match(component, new RegExp(`<${primitive}`));
  assert.doesNotMatch(component, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(component, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});
