import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/fuel-book-office-workspace.tsx", import.meta.url),
  "utf8",
);
const fuelBook = readFileSync(
  new URL("./components/vehicle-fuel-office-section.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./office-navigation.ts", import.meta.url),
  "utf8",
);

test("Fuel Book exposes exactly its two approved operational areas", () => {
  assert.match(workspace, /OFFICE_FUEL_BOOK_AREAS\.map/);
  assert.match(navigation, /id: "fuel-entries", label: "Fuel Entries"/);
  assert.match(navigation, /id: "pump-payments", label: "Pump Payments"/);
  assert.match(workspace, /aria-label="Fuel Book areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
});

test("Fuel Entries is the default and only the selected inner workflow is visible", () => {
  assert.match(fuelBook, /useState<OfficeFuelBookAreaId>\("fuel-entries"\)/);
  assert.match(fuelBook, /activeArea === "fuel-entries" && !showFuelEntriesArchive && <>/);
  assert.match(fuelBook, /id="new-fuel-entry-heading"/);
  assert.match(fuelBook, /id="recent-fuel-entries-heading"/);
  assert.match(fuelBook, /activeArea === "fuel-entries" && selected/);
  assert.match(fuelBook, /activeArea === "pump-payments" && !showPaymentArchive && <div/);
  assert.match(fuelBook, /id="pump-summary-heading"/);
  assert.match(fuelBook, /id="recent-pump-payments-heading"/);
});

test("refresh and browser history reuse the Office hash router", () => {
  assert.match(fuelBook, /resolveOfficeFuelBookAreaFromHash\(window\.location\.hash\)/);
  assert.match(fuelBook, /window\.addEventListener\("hashchange", syncFuelBookAreaFromHash\)/);
  assert.match(fuelBook, /window\.removeEventListener\("hashchange", syncFuelBookAreaFromHash\)/);
  assert.match(fuelBook, /window\.location\.hash = getOfficeFuelBookHash\(area\)/);
  assert.match(fuelBook, /<FuelBookOfficeWorkspace activeArea=\{activeArea\} onAreaChange=\{selectFuelBookArea\}>/);
});

test("existing Fuel and Pump Payment state stays in one authoritative component", () => {
  assert.equal((fuelBook.match(/useQueryClient\(\)/g) ?? []).length, 1);
  assert.equal((fuelBook.match(/listVehicleFuelRecords\(factoryId\)/g) ?? []).length, 1);
  assert.equal((fuelBook.match(/listVehicleFuelBatchPayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(fuelBook, /buildCreateVehicleFuelInput/);
  assert.match(fuelBook, /buildVehicleFuelBatchPaymentInput/);
  assert.match(fuelBook, /createVehicleFuelBatchPayment/);
  assert.match(fuelBook, /\["office-cash-book-day", factoryId\]/);
});

test("contextual navigation is compact, token-based, and horizontally scrollable", () => {
  assert.match(workspace, /<Button/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /flex min-w-max gap-atlas-2/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|allocation|Cash Book/i);
});
