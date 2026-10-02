import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/workforce-office-workspace.tsx", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const sales = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);
const overview = office.slice(
  office.indexOf("function LabourerManagement"),
  office.indexOf("function LabourerProductionRateOverrideControls"),
);

test("Workforce exposes the six approved areas through one local navigation", () => {
  for (const [id, label] of [
    ["production-workers", "Production workers"],
    ["mud-supply", "Mud Supply"],
    ["chamber-transport", "Chamber Transport"],
    ["soil-workers", "Soil / Trolley workers"],
    ["staff", "Staff"],
    ["vehicle-delivery-wages", "Vehicle Delivery Wages"],
  ]) {
    assert.match(workspace, new RegExp(`id: "${id}", label: "${label.replace("/", "\\/")}"`));
  }
  assert.match(workspace, /aria-label="Workforce areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
  assert.match(office, /useState<WorkforceWorkspaceArea>\("production-workers"\)/);
});

test("Workforce removes repeated headings and begins with compact category navigation", () => {
  assert.doesNotMatch(workspace, /People, rates and accounts/i);
  assert.doesNotMatch(workspace, /Workforce workspace/);
  assert.doesNotMatch(workspace, /Manage workers, wage rates/);
  assert.doesNotMatch(workspace, /<header/);
  assert.match(workspace, /<div className="space-y-atlas-4">\s*<nav aria-label="Workforce areas"/);
  assert.match(shell, /activeArea !== "sales" && activeArea !== "workforce" && activeArea !== "production" && activeArea !== "purchases-expenses" && activeArea !== "cash-book" && \(/);
});

test("Production Workers starts with actions and filters instead of a repeated banner", () => {
  assert.doesNotMatch(overview, /Today ·/);
  assert.doesNotMatch(overview, /production-workers-heading/);
  assert.doesNotMatch(overview, /active ·[\s\S]*archived/);
  assert.doesNotMatch(overview, /Work and earnings shown here use today/);
  assert.match(overview, /<section aria-label="Production workers">\s*<div className="flex flex-col gap-atlas-2 lg:flex-row lg:items-end lg:justify-between">/);
  assert.match(overview, /Filter Production workers by lifecycle[\s\S]*Set rates[\s\S]*\+ Add labourer[\s\S]*Search Production workers/);
  assert.doesNotMatch(overview, /border-b border-atlas-border pb-atlas-4/);
});

test("Production Worker filters, actions, and search share one compact responsive toolbar", () => {
  assert.match(overview, /flex w-full flex-col gap-atlas-2 sm:flex-row sm:items-end lg:flex-1 lg:justify-end/);
  assert.match(overview, /Set rates[\s\S]*\+ Add labourer[\s\S]*<FormField label="Search Production workers">/);
  assert.match(overview, /className="w-full lg:max-w-sm"/);
  assert.match(overview, /mt-atlas-3 hidden md:block/);
  assert.match(overview, /mt-atlas-3 divide-y divide-atlas-border border-y border-atlas-border md:hidden/);
  assert.doesNotMatch(overview, /<div className="mt-atlas-4 space-y-atlas-3">/);
});

test("Production and Mud use focused V2 presentations while remaining modules stay single mounted", () => {
  assert.match(office, /hidden=\{workforceArea !== "production-workers"\}[\s\S]*<LabourerManagement/);
  assert.match(overview, /<AddProductionLabourerDrawer/);
  assert.doesNotMatch(office, /function AddLabourerForm/);
  assert.match(office, /hidden=\{workforceArea !== "mud-supply"\}><MudGroupManagement/);
  assert.match(office, /hidden=\{workforceArea !== "chamber-transport"\}><TransportOfficeSection/);
  assert.match(office, /hidden=\{workforceArea !== "soil-workers"\}><SoilOfficeSection/);
  assert.match(office, /hidden=\{workforceArea !== "staff"\}><StaffOfficeSection/);
  assert.match(office, /showVehicleWages=\{activeArea === "workforce" && workforceArea === "vehicle-delivery-wages"\}/);
  assert.match(sales, /hidden=\{!showVehicleWages\}[\s\S]*<VehicleDeliveryWageOverview/);

  for (const component of [
    "LabourerManagement",
    "MudGroupManagement",
    "TransportOfficeSection",
    "SoilOfficeSection",
    "StaffOfficeSection",
  ]) {
    assert.equal((office.match(new RegExp(`<${component}\\b`, "g")) ?? []).length, 1);
  }
});

test("Production worker overview reuses authoritative daily work, direct rates, and wage calculation", () => {
  assert.match(overview, /getTodaysProduction\(factoryId, asOfDate\)/);
  assert.match(overview, /getProductionWageRatesForFactory\(factoryId\)/);
  assert.match(overview, /getCurrentLabourerProductionWageRate/);
  assert.match(overview, /calculateProductionWage\(quantity, currentRate\.ratePer1000Bricks\)/);
  assert.match(overview, /PRODUCTION_LABOURER_LIFECYCLE_STATUS/);
  assert.match(overview, /getLatestLabourerWithdrawalsForFactory/);
  assert.match(overview, /formatProductionWorkerLastPaid/);
  assert.doesNotMatch(overview, /unpaid|pay all/i);
  assert.doesNotMatch(overview, /supabase|\.from\(|\.rpc\(/);
});

test("overview follows the corrected Stitch hierarchy without a global search or heavy header", () => {
  for (const heading of ["Worker", "Work done", "Rate", "Action"]) {
    assert.match(overview, new RegExp(`TableHeaderCell[^>]*>${heading}`));
  }
  assert.match(overview, /ATLAS_UI_STRINGS\.fields\.amount/);
  assert.match(overview, /TableHeaderCell>Last paid/);
  assert.match(overview, /label="Search Production workers"/);
  assert.match(overview, /placeholder="Search worker or origin"/);
  assert.doesNotMatch(overview, /brickType|brick type|Change Brick Type/i);
  assert.doesNotMatch(overview, /Search operators, units, logs|global search/i);
  assert.match(overview, /<TableHeader>/);
  assert.doesNotMatch(overview, /py-atlas-(?:6|8|10|12)[^\n]*TableHeader/);
});

test("overview uses V2 primitives, token styling, and separate mobile presentation", () => {
  for (const primitive of ["Button", "EmptyState", "Feedback", "FormField", "Input", "StatusPill", "TableContainer"]) {
    assert.match(overview, new RegExp(`<${primitive}\\b`));
  }
  assert.match(overview, /hidden md:block/);
  assert.match(overview, /md:hidden/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /<Button/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /ProductionOfficeWorkspace|ProductionWorkspaceArea/);
});
