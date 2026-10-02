import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/purchases-expenses-office-workspace.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./office-navigation.ts", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const expenses = readFileSync(
  new URL("./components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);
const coalWorkspace = readFileSync(
  new URL("./components/coal-office-workspace.tsx", import.meta.url),
  "utf8",
);
const coal = readFileSync(
  new URL("./components/coal-purchase-office-section.tsx", import.meta.url),
  "utf8",
);
const maintenanceWorkspace = readFileSync(
  new URL("./components/vehicle-maintenance-office-workspace.tsx", import.meta.url),
  "utf8",
);
const maintenance = readFileSync(
  new URL("./components/vehicle-maintenance-office-section.tsx", import.meta.url),
  "utf8",
);
const fuelWorkspace = readFileSync(
  new URL("./components/fuel-book-office-workspace.tsx", import.meta.url),
  "utf8",
);
const fuel = readFileSync(
  new URL("./components/vehicle-fuel-office-section.tsx", import.meta.url),
  "utf8",
);
const costsWorkspace = readFileSync(
  new URL("./components/costs-outgoings-office-workspace.tsx", import.meta.url),
  "utf8",
);

test("Purchases and Expenses exposes exactly the four approved categories", () => {
  assert.match(workspace, /OFFICE_PURCHASES_EXPENSES_AREAS\.map/);
  for (const label of ["Coal", "Vehicle Maintenance", "Fuel Book", "Costs & Outgoings"]) {
    assert.match(navigation, new RegExp(label.replace("&", "\\&")));
  }
  assert.match(workspace, /aria-label="Purchases and Expenses areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
});

test("only the selected existing category UI is visible", () => {
  assert.equal((dashboard.match(/<CoalPurchaseOfficeSection\b/g) ?? []).length, 1);
  assert.equal((dashboard.match(/<VehicleMaintenanceOfficeSection\b/g) ?? []).length, 1);
  assert.equal((dashboard.match(/<VehicleFuelOfficeSection\b/g) ?? []).length, 1);
  assert.equal((dashboard.match(/<ExpensesOfficeSection\b/g) ?? []).length, 1);
  assert.match(dashboard, /hidden=\{purchasesExpensesArea !== "coal"\}[\s\S]*<CoalPurchaseOfficeSection/);
  assert.match(dashboard, /hidden=\{purchasesExpensesArea !== "vehicle-maintenance"\}[\s\S]*<VehicleMaintenanceOfficeSection/);
  assert.match(dashboard, /hidden=\{purchasesExpensesArea !== "fuel-book"\}[\s\S]*<VehicleFuelOfficeSection/);
  assert.match(dashboard, /showCostsOutgoings=\{purchasesExpensesArea === "costs-outgoings"\}/);
  assert.match(expenses, /hidden=\{activeArea !== "purchases-expenses" \|\| !showCostsOutgoings\}/);
});

test("category selection, refresh, and browser history share the Office hash router", () => {
  assert.match(dashboard, /useState<OfficePurchasesExpensesAreaId>\("coal"\)/);
  assert.match(dashboard, /resolveOfficePurchasesExpensesAreaFromHash\(hash\) \?\? "coal"/);
  assert.match(dashboard, /window\.location\.hash = getOfficePurchasesExpensesHash\(area\)/);
  assert.match(dashboard, /onAreaChange=\{selectPurchasesExpensesArea\}/);
  assert.match(dashboard, /window\.addEventListener\("hashchange", syncAreaFromHash\)/);
  assert.match(dashboard, /window\.removeEventListener\("hashchange", syncAreaFromHash\)/);
});

test("Coal contextual hashes stay inside the Coal category", () => {
  assert.match(navigation, /if \(resolveOfficeCoalAreaFromHash\(hash\)\) return "coal"/);
  assert.match(navigation, /if \(value === "coal" \|\| value === "all-coal-purchases"\) return "coal-purchases"/);
});

test("Fuel Book contextual hashes stay inside the Fuel Book category", () => {
  assert.match(navigation, /if \(resolveOfficeFuelBookAreaFromHash\(hash\)\) return "fuel-book"/);
  assert.match(navigation, /id: "fuel-entries", label: "Fuel Entries", hash: "fuel-book"/);
  assert.match(navigation, /id: "pump-payments", label: "Pump Payments", hash: "fuel-book-pump-payments"/);
});

test("Costs and Outgoings contextual hashes stay inside the Costs and Outgoings category", () => {
  assert.match(navigation, /if \(resolveOfficeCostsOutgoingsAreaFromHash\(hash\)\) return "costs-outgoings"/);
  assert.match(navigation, /id: "costs", label: "Costs", hash: "costs-outgoings"/);
  assert.match(navigation, /id: "outgoing-payments", label: "Outgoing Payments", hash: "costs-outgoings-payments"/);
});

test("workspace navigation is compact, token-based, and horizontally scrollable", () => {
  assert.match(workspace, /<Button/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /flex min-w-max gap-atlas-2/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|create|update|delete/i);
});

test("Purchases and Expenses removes only its redundant shell header and starts with category navigation", () => {
  assert.match(
    shell,
    /activeArea !== "sales" && activeArea !== "workforce" && activeArea !== "production" && activeArea !== "purchases-expenses" && activeArea !== "cash-book" && \(/,
  );
  assert.doesNotMatch(workspace, /Office workspace|Purchases & Expenses|<header/);
  assert.match(workspace, /<div className="space-y-atlas-3">\s*<nav aria-label="Purchases and Expenses areas"/);
});

test("all four category workspaces use the same tightened contextual spacing", () => {
  for (const contextualWorkspace of [coalWorkspace, maintenanceWorkspace, fuelWorkspace, costsWorkspace]) {
    assert.match(contextualWorkspace, /<div className="space-y-atlas-3">\s*<nav/);
  }
  assert.doesNotMatch(coal, /aria-label="Coal workspace" className="mt-atlas-6"/);
  assert.doesNotMatch(maintenance, /aria-labelledby="vehicle-maintenance-heading" className="mt-atlas-6"/);
  assert.doesNotMatch(fuel, /aria-labelledby="vehicle-fuel-heading" className="mt-atlas-6"/);
  assert.match(expenses, /<div className="mt-atlas-3" hidden=\{activeArea !== "purchases-expenses" \|\| !showCostsOutgoings\}>/);
});

test("Milestone 8A leaves every existing category component and service boundary intact", () => {
  assert.doesNotMatch(workspace, /CoalPurchaseOfficeSection|VehicleMaintenanceOfficeSection|VehicleFuelOfficeSection|ExpensesOfficeSection/);
  assert.doesNotMatch(workspace, /payment|allocation|Cash Book|archive|drawer/i);
  assert.match(expenses, /<SupplierManagementSection[\s\S]*hidden=\{activeArea !== "settings"\}/);
});
