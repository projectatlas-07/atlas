import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const overview = readFileSync(
  new URL("./components/vehicle-delivery-wage-overview.tsx", import.meta.url),
  "utf8",
);
const salesOffice = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const vehicleService = readFileSync(
  new URL("../sales/services/vehicle-service.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260901000030_create_vehicle_challan_snapshot_foundation.sql", import.meta.url),
  "utf8",
);

test("desktop and mobile rare actions share one portal expression but use distinct open keys", () => {
  assert.match(overview, /aria-label=\{`More actions for \$\{vehicle\.vehicleNumber\}`\}/);
  assert.match(overview, /aria-haspopup="menu"/);
  assert.match(overview, /role="menu"/);
  assert.match(overview, /role="menuitem"/);
  assert.match(overview, />⋯</);
  assert.match(overview, /Turn wage tracking \{vehicle\.deliveryWageTrackingEnabled \? "OFF" : "ON"\}/);
  assert.match(overview, /vehicle\.isActive \? "Archive vehicle" : "Restore vehicle"/);
  assert.equal((overview.match(/<VehicleRareActions/g) ?? []).length, 2);
  assert.equal((overview.match(/createPortal\(/g) ?? []).length, 1);
  assert.match(overview, /vehicleRareActionsMenuKey\("desktop", account\.vehicleId\)/);
  assert.match(overview, /vehicleRareActionsMenuKey\("mobile", account\.vehicleId\)/);
  assert.match(overview, /menuOpen=\{openMenuKey === menuKey\}/);
  assert.match(overview, /open=\{openMenuKey === menuKey\}/);
  assert.doesNotMatch(overview, />Manage<|onManageVehicles/);
});

test("the final archived row menu escapes TableContainer clipping", () => {
  assert.match(overview, /createPortal\(/);
  assert.match(overview, /document\.body/);
  assert.match(overview, /className="fixed z-50 w-56/);
  assert.match(overview, /window\.addEventListener\("scroll", positionMenu, true\)/);
  assert.match(overview, /vehicle\.isActive \? "archive" : "restore"/);
  assert.match(overview, /requestVehicleAction\(account\.vehicleId, action\)/);
  assert.match(overview, /vehicles\.find\(\(vehicle\) => vehicle\.id === pendingVehicleAction\?\.vehicleId\)/);
  assert.match(overview, /restoreVehicle\(factoryId, actionVehicle\.id\)/);
});

test("both menu actions close the portal and open the existing confirmation", () => {
  assert.match(overview, /function requestVehicleAction\(vehicleId: string, action: VehicleRareAction\) \{[\s\S]*setOpenMenuKey\(""\);[\s\S]*setPendingVehicleAction\(\{ vehicleId, action \}\)/);
  assert.match(overview, /onRequestAction\(vehicle\.deliveryWageTrackingEnabled \? "tracking_off" : "tracking_on"\)/);
  assert.match(overview, /onRequestAction\(vehicle\.isActive \? "archive" : "restore"\)/);
  assert.match(overview, /pendingVehicleAction && actionVehicle && \([\s\S]*<VehicleActionConfirmation/);
});

test("All, Active, and Archived filters feed the same desktop and mobile action rows", () => {
  assert.match(overview, /\["all", `All \$\{formatIndianNumber\(accounts\.length\)\}`\]/);
  assert.match(overview, /\["active", `Active \$\{formatIndianNumber\(activeCount\)\}`\]/);
  assert.match(overview, /\["archived", `Archived \$\{formatIndianNumber\(archivedCount\)\}`\]/);
  assert.equal((overview.match(/visibleAccounts\.map\(\(account\) =>/g) ?? []).length, 2);
  assert.equal((overview.match(/onRequestAction=\{\(action\) => requestVehicleAction\(account\.vehicleId, action\)\}/g) ?? []).length, 2);
});

test("all four confirmations use the required consequence copy and emphasis", () => {
  for (const text of [
    "Turn wage tracking OFF for",
    "Future trips will not earn delivery wages.",
    "Turn OFF",
    "Turn wage tracking ON for",
    "Future eligible trips can earn delivery wages.",
    "Turn ON",
    "It will be removed from active vehicle selection.",
    "It will return to active vehicle selection.",
  ]) assert.match(overview, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(overview, /action === "tracking_off" \|\| action === "archive"/);
  assert.match(overview, /variant=\{isDanger \? "danger" : "primary"\}/);
  assert.match(overview, /role="dialog"/);
  assert.match(overview, /aria-modal="true"/);
  assert.match(overview, /max-w-md/);
});

test("actions call only existing factory-scoped services and prevent duplicate submission", () => {
  assert.match(overview, /setVehicleDeliveryWageTracking\(\{[\s\S]*factoryId[\s\S]*vehicleId: actionVehicle\.id[\s\S]*enabled: false/);
  assert.match(overview, /enabled: true/);
  assert.match(overview, /archiveVehicle\(factoryId, actionVehicle\.id\)/);
  assert.match(overview, /restoreVehicle\(factoryId, actionVehicle\.id\)/);
  assert.match(overview, /vehicleActionSubmittingRef\.current/);
  assert.match(overview, /vehicleActionSubmittingRef\.current = true/);
  assert.match(overview, /loading=\{submitting\}/);
  assert.match(vehicleService, /\.rpc\("set_vehicle_delivery_wage_tracking"/);
  assert.match(vehicleService, /changeVehicleLifecycle\("archive_vehicle"/);
  assert.match(vehicleService, /changeVehicleLifecycle\("restore_vehicle"/);
  assert.doesNotMatch(overview, /supabase|\.from\(|\.rpc\(/);
});

test("saved Vehicle replaces the shared cache row without navigating to Settings", () => {
  assert.match(overview, /onVehicleSaved\(saved\)/);
  assert.match(salesOffice, /onVehicleSaved=\{cacheSavedVehicle\}/);
  assert.match(salesOffice, /setQueryData<Vehicle\[\]>\([\s\S]*vehiclesKey\(factoryId\)/);
  assert.match(salesOffice, /current\.filter\(\(item\) => item\.id !== vehicle\.id\)/);
  assert.doesNotMatch(overview + salesOffice + dashboard, /onManageVehicles/);
  assert.doesNotMatch(overview, /setActiveArea\("settings"\)|href=.*settings|router/);
});

test("database contracts preserve historical Challan snapshots and factory isolation", () => {
  assert.match(migration, /Changes live Delivery Wage Tracking for future saves without mutating historical Challans/);
  assert.match(migration, /Archives a Vehicle from future selection while preserving historical references/);
  assert.match(migration, /factory_users\.factory_id = p_factory_id/);
  assert.doesNotMatch(overview, /Change Rate|₹x\/trip|vehicle-level rate/i);
});
