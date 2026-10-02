import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/vehicle-maintenance-office-workspace.tsx", import.meta.url),
  "utf8",
);
const maintenance = readFileSync(
  new URL("./components/vehicle-maintenance-office-section.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./office-navigation.ts", import.meta.url),
  "utf8",
);

test("Vehicle Maintenance exposes exactly its two approved operational areas", () => {
  assert.match(workspace, /OFFICE_VEHICLE_MAINTENANCE_AREAS\.map/);
  assert.match(navigation, /id: "maintenance", label: "Maintenance"/);
  assert.match(navigation, /id: "garage-payments", label: "Garage Payments"/);
  assert.match(workspace, /aria-label="Vehicle Maintenance areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
});

test("Maintenance is the default and only the selected inner workflow is visible", () => {
  assert.match(maintenance, /useState<OfficeVehicleMaintenanceAreaId>\("maintenance"\)/);
  assert.match(maintenance, /activeArea === "maintenance" && !showMaintenanceArchive && <>/);
  assert.match(maintenance, /<form onSubmit=\{saveRecord\}>/);
  assert.match(maintenance, /Recent Maintenance/);
  assert.doesNotMatch(maintenance, /showForm|setShowForm/);
  assert.match(maintenance, /activeArea === "maintenance" && selected/);
  assert.match(maintenance, /activeArea === "garage-payments" && !showPaymentArchive && <>/);
  assert.match(maintenance, /id="garage-summary-heading"/);
  assert.match(maintenance, /Recent Garage Payments/);
});

test("Vehicle Maintenance refresh and browser history reuse the Office hash router", () => {
  assert.match(maintenance, /resolveOfficeVehicleMaintenanceAreaFromHash\(window\.location\.hash\)/);
  assert.match(maintenance, /window\.addEventListener\("hashchange", syncVehicleMaintenanceAreaFromHash\)/);
  assert.match(maintenance, /window\.removeEventListener\("hashchange", syncVehicleMaintenanceAreaFromHash\)/);
  assert.match(maintenance, /window\.location\.hash = getOfficeVehicleMaintenanceHash\(area\)/);
  assert.match(maintenance, /<VehicleMaintenanceOfficeWorkspace activeArea=\{activeArea\} onAreaChange=\{selectVehicleMaintenanceArea\}>/);
  assert.match(maintenance, /garageId: selected\.garageId, fromDate: selected\.maintenanceDate, toDate: selected\.maintenanceDate/);
  assert.match(maintenance, /selectVehicleMaintenanceArea\("garage-payments"\)/);
});

test("existing maintenance and garage payment state stays in one authoritative component", () => {
  assert.equal((maintenance.match(/useQueryClient\(\)/g) ?? []).length, 1);
  assert.equal((maintenance.match(/listVehicleMaintenanceRecords\(factoryId\)/g) ?? []).length, 1);
  assert.equal((maintenance.match(/listVehicleMaintenanceBatchPayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(maintenance, /buildCreateVehicleMaintenanceInput/);
  assert.match(maintenance, /buildVehicleMaintenanceBatchPaymentInput/);
  assert.match(maintenance, /createVehicleMaintenanceBatchPayment/);
  assert.match(maintenance, /\["office-cash-book-day", factoryId\]/);
});

test("contextual navigation is compact, token-based, and horizontally scrollable", () => {
  assert.match(workspace, /<Button/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /flex min-w-max gap-atlas-2/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|allocation|Cash Book/i);
});
