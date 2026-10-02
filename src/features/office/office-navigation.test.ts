import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  getOfficeCoalHash,
  getOfficeCoalPurchasesArchiveHash,
  getOfficeCoalSellerPaymentsArchiveHash,
  getOfficeCostsArchiveHash,
  getOfficeCostsOutgoingsHash,
  getOfficeOutgoingPaymentsArchiveHash,
  getOfficeFuelEntriesArchiveHash,
  getOfficeFuelBookHash,
  getOfficePumpPaymentsArchiveHash,
  getOfficePurchasesExpensesHash,
  getOfficeProductionHash,
  getOfficeProductionHref,
  getOfficeGaragePaymentsArchiveHash,
  getOfficeVehicleMaintenanceHash,
  getOfficeVehicleMaintenanceArchiveHash,
  OFFICE_AREAS,
  OFFICE_COAL_AREAS,
  OFFICE_COSTS_ARCHIVE_HASH,
  OFFICE_OUTGOING_PAYMENTS_ARCHIVE_HASH,
  OFFICE_COSTS_OUTGOINGS_AREAS,
  OFFICE_FUEL_BOOK_AREAS,
  OFFICE_FUEL_ENTRIES_ARCHIVE_HASH,
  OFFICE_PUMP_PAYMENTS_ARCHIVE_HASH,
  OFFICE_PURCHASES_EXPENSES_AREAS,
  OFFICE_PRODUCTION_AREAS,
  OFFICE_GARAGE_PAYMENTS_ARCHIVE_HASH,
  OFFICE_VEHICLE_MAINTENANCE_AREAS,
  OFFICE_VEHICLE_MAINTENANCE_ARCHIVE_HASH,
  resolveOfficeAreaFromHash,
  resolveOfficeCoalAreaFromHash,
  resolveOfficeCostsOutgoingsAreaFromHash,
  resolveOfficeFuelBookAreaFromHash,
  resolveOfficePurchasesExpensesAreaFromHash,
  resolveOfficeProductionAreaFromHash,
  resolveOfficeVehicleMaintenanceAreaFromHash,
} from "./office-navigation.ts";

const shell = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);
const cashBook = readFileSync(
  new URL("./components/cash-book-office-section.tsx", import.meta.url),
  "utf8",
);
const coal = readFileSync(
  new URL("./components/coal-purchase-office-section.tsx", import.meta.url),
  "utf8",
);
const salesWorkspace = readFileSync(
  new URL("./components/sales-office-workspace.tsx", import.meta.url),
  "utf8",
);
const salesSection = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const workforceWorkspace = readFileSync(
  new URL("./components/workforce-office-workspace.tsx", import.meta.url),
  "utf8",
);

test("Office exposes exactly the eight approved top-level areas", () => {
  assert.deepEqual(OFFICE_AREAS, [
    { id: "dashboard", label: "Dashboard" },
    { id: "production", label: "Production" },
    { id: "workforce", label: "Workforce" },
    { id: "sales", label: "Sales" },
    { id: "purchases-expenses", label: "Purchases & Expenses" },
    { id: "cash-book", label: "Cash Book" },
    { id: "reports", label: "Reports" },
    { id: "settings", label: "Settings" },
  ]);

  for (const detailedModule of [
    "Soil Workers",
    "Chamber Transport",
    "Coal",
    "Fuel",
    "Maintenance",
    "Customer Dues",
    "Sales Register",
    "Vehicles",
    "Suppliers",
  ]) {
    assert.equal(OFFICE_AREAS.some((area) => area.label === detailedModule), false);
  }
});

test("Office area hashes are stable, safe, and retain the legacy Dashboard link", () => {
  for (const area of OFFICE_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.id}`), area.id);
  }
  assert.equal(resolveOfficeAreaFromHash("#office-dashboard-feature"), "dashboard");
  assert.equal(resolveOfficeAreaFromHash("#labour-wages"), "workforce");
  assert.equal(resolveOfficeAreaFromHash("#new-challan"), "sales");
  assert.equal(resolveOfficeAreaFromHash("#unknown"), "dashboard");
  assert.equal(resolveOfficeAreaFromHash(""), "dashboard");
});

test("Office resets only the document page scroll when the canonical view changes", () => {
  assert.match(shell, /const \[officeViewHash, setOfficeViewHash\] = useState\("#dashboard"\)/);
  assert.match(shell, /setOfficeViewHash\(window\.location\.hash \|\| "#dashboard"\)/);
  assert.match(shell, /window\.addEventListener\("hashchange", syncOfficeViewHash\)/);
  assert.match(shell, /window\.removeEventListener\("hashchange", syncOfficeViewHash\)/);
  assert.match(shell, /const resetOfficePageScroll = useCallback\(\(\) => \{[\s\S]*document\.scrollingElement[\s\S]*pageScroller\.scrollTop = 0;[\s\S]*\}, \[\]\)/);
  assert.match(shell, /useLayoutEffect\(\(\) => \{\s*resetOfficePageScroll\(\);\s*\}, \[activeArea, officeViewHash, resetOfficePageScroll\]\)/);
  assert.match(shell, /OfficePageScrollResetContext\.Provider value=\{resetOfficePageScroll\}/);
  assert.doesNotMatch(shell, /setTimeout|scrollIntoView/);
});

test("state-owned Sales and Workforce views use the same central page reset", () => {
  for (const workspace of [salesWorkspace, workforceWorkspace]) {
    assert.match(workspace, /useOfficePageScrollReset\(\)/);
    assert.match(workspace, /if \(area === activeArea\) return;/);
    assert.match(workspace, /onAreaChange\(area\);\s*resetOfficePageScroll\(\);/);
  }
  assert.match(salesSection, /showChallansView[\s\S]*resetOfficePageScroll\(\)/);
  assert.match(salesSection, /showCustomerPaymentsView[\s\S]*resetOfficePageScroll\(\)/);
  assert.match(salesSection, /openChallan\(challanId\);\s*setChallansView\("main"\);\s*resetOfficePageScroll\(\);/);
});

test("Office view reset leaves same-screen state and bounded history scrollers independent", () => {
  assert.equal((shell.match(/\.scrollTop = 0/g) ?? []).length, 1);
  assert.doesNotMatch(coal, /scrollTop|scrollTo\(|scrollIntoView/);
  assert.match(coal, /setPaymentDetailId/);
  assert.match(coal, /setInlineEditor/);
  assert.match(cashBook, /max-h-96 min-h-0 flex-1 overflow-y-auto/);
  assert.match(cashBook, /lg:min-h-0 lg:flex-1 lg:overflow-y-auto/);
  assert.doesNotMatch(cashBook, /scrollTop = 0|scrollTo\(|scrollIntoView/);
});

test("Production tab hashes use the existing Office hash router", () => {
  assert.deepEqual(OFFICE_PRODUCTION_AREAS, [
    { id: "brick", label: "Brick Production", hash: "brick-production" },
    { id: "chamber", label: "Chamber Transport", hash: "chamber-transport" },
    { id: "soil", label: "Soil / Trolley", hash: "soil" },
  ]);

  for (const area of OFFICE_PRODUCTION_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.hash}`), "production");
    assert.equal(resolveOfficeProductionAreaFromHash(`#${area.hash}`), area.id);
    assert.equal(getOfficeProductionHash(area.id), `#${area.hash}`);
    assert.equal(getOfficeProductionHref(area.id), `/office#${area.hash}`);
  }

  assert.equal(resolveOfficeProductionAreaFromHash("#production"), "brick");
  assert.equal(resolveOfficeProductionAreaFromHash("#transport"), "chamber");
  assert.equal(resolveOfficeProductionAreaFromHash("#sales"), null);
});

test("Purchases and Expenses category hashes use the existing Office hash router", () => {
  assert.deepEqual(OFFICE_PURCHASES_EXPENSES_AREAS, [
    { id: "coal", label: "Coal", hash: "coal" },
    { id: "vehicle-maintenance", label: "Vehicle Maintenance", hash: "vehicle-maintenance" },
    { id: "fuel-book", label: "Fuel Book", hash: "fuel-book" },
    { id: "costs-outgoings", label: "Costs & Outgoings", hash: "costs-outgoings" },
  ]);

  for (const area of OFFICE_PURCHASES_EXPENSES_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.hash}`), "purchases-expenses");
    assert.equal(resolveOfficePurchasesExpensesAreaFromHash(`#${area.hash}`), area.id);
    assert.equal(getOfficePurchasesExpensesHash(area.id), `#${area.hash}`);
  }

  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#purchases-expenses"), "coal");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#coal-purchases"), "coal");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#coal-seller-payments"), "coal");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-coal-purchases"), "coal");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-seller-payments"), "coal");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#production"), null);
});

test("Coal contextual hashes preserve the default and use the existing Office router", () => {
  assert.deepEqual(OFFICE_COAL_AREAS, [
    { id: "coal-purchases", label: "Coal Purchases", hash: "coal-purchases" },
    { id: "seller-payments", label: "Seller Payments", hash: "coal-seller-payments" },
  ]);

  for (const area of OFFICE_COAL_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.hash}`), "purchases-expenses");
    assert.equal(resolveOfficePurchasesExpensesAreaFromHash(`#${area.hash}`), "coal");
    assert.equal(resolveOfficeCoalAreaFromHash(`#${area.hash}`), area.id);
    assert.equal(getOfficeCoalHash(area.id), `#${area.hash}`);
  }

  assert.equal(resolveOfficeCoalAreaFromHash("#coal"), "coal-purchases");
  assert.equal(resolveOfficeCoalAreaFromHash("#all-coal-purchases"), "coal-purchases");
  assert.equal(getOfficeCoalPurchasesArchiveHash(), "#all-coal-purchases");
  assert.equal(resolveOfficeAreaFromHash("#all-coal-purchases"), "purchases-expenses");
  assert.equal(resolveOfficeCoalAreaFromHash("#all-seller-payments"), "seller-payments");
  assert.equal(getOfficeCoalSellerPaymentsArchiveHash(), "#all-seller-payments");
  assert.equal(resolveOfficeAreaFromHash("#all-seller-payments"), "purchases-expenses");
  assert.equal(resolveOfficeCoalAreaFromHash("#vehicle-maintenance"), null);
});

test("Vehicle Maintenance contextual hashes preserve the default and use the existing Office router", () => {
  assert.deepEqual(OFFICE_VEHICLE_MAINTENANCE_AREAS, [
    { id: "maintenance", label: "Maintenance", hash: "vehicle-maintenance" },
    { id: "garage-payments", label: "Garage Payments", hash: "vehicle-maintenance-garage-payments" },
  ]);

  for (const area of OFFICE_VEHICLE_MAINTENANCE_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.hash}`), "purchases-expenses");
    assert.equal(resolveOfficePurchasesExpensesAreaFromHash(`#${area.hash}`), "vehicle-maintenance");
    assert.equal(resolveOfficeVehicleMaintenanceAreaFromHash(`#${area.hash}`), area.id);
    assert.equal(getOfficeVehicleMaintenanceHash(area.id), `#${area.hash}`);
  }

  assert.equal(resolveOfficeVehicleMaintenanceAreaFromHash("#vehicle-maintenance"), "maintenance");
  assert.equal(OFFICE_VEHICLE_MAINTENANCE_ARCHIVE_HASH, "#all-maintenance");
  assert.equal(resolveOfficeVehicleMaintenanceAreaFromHash("#all-maintenance"), "maintenance");
  assert.equal(getOfficeVehicleMaintenanceArchiveHash(), "#all-maintenance");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-maintenance"), "vehicle-maintenance");
  assert.equal(resolveOfficeAreaFromHash("#all-maintenance"), "purchases-expenses");
  assert.equal(OFFICE_GARAGE_PAYMENTS_ARCHIVE_HASH, "#all-garage-payments");
  assert.equal(resolveOfficeVehicleMaintenanceAreaFromHash("#all-garage-payments"), "garage-payments");
  assert.equal(getOfficeGaragePaymentsArchiveHash(), "#all-garage-payments");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-garage-payments"), "vehicle-maintenance");
  assert.equal(resolveOfficeAreaFromHash("#all-garage-payments"), "purchases-expenses");
  assert.equal(resolveOfficeVehicleMaintenanceAreaFromHash("#coal"), null);
});

test("Fuel Book contextual hashes preserve the default and use the existing Office router", () => {
  assert.deepEqual(OFFICE_FUEL_BOOK_AREAS, [
    { id: "fuel-entries", label: "Fuel Entries", hash: "fuel-book" },
    { id: "pump-payments", label: "Pump Payments", hash: "fuel-book-pump-payments" },
  ]);

  for (const area of OFFICE_FUEL_BOOK_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.hash}`), "purchases-expenses");
    assert.equal(resolveOfficePurchasesExpensesAreaFromHash(`#${area.hash}`), "fuel-book");
    assert.equal(resolveOfficeFuelBookAreaFromHash(`#${area.hash}`), area.id);
    assert.equal(getOfficeFuelBookHash(area.id), `#${area.hash}`);
  }

  assert.equal(OFFICE_FUEL_ENTRIES_ARCHIVE_HASH, "#all-fuel-entries");
  assert.equal(resolveOfficeFuelBookAreaFromHash("#all-fuel-entries"), "fuel-entries");
  assert.equal(getOfficeFuelEntriesArchiveHash(), "#all-fuel-entries");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-fuel-entries"), "fuel-book");
  assert.equal(resolveOfficeAreaFromHash("#all-fuel-entries"), "purchases-expenses");
  assert.equal(OFFICE_PUMP_PAYMENTS_ARCHIVE_HASH, "#all-pump-payments");
  assert.equal(resolveOfficeFuelBookAreaFromHash("#all-pump-payments"), "pump-payments");
  assert.equal(getOfficePumpPaymentsArchiveHash(), "#all-pump-payments");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-pump-payments"), "fuel-book");
  assert.equal(resolveOfficeAreaFromHash("#all-pump-payments"), "purchases-expenses");

  assert.equal(resolveOfficeFuelBookAreaFromHash("#coal"), null);
});

test("Costs and Outgoings contextual hashes preserve the default and use the existing Office router", () => {
  assert.deepEqual(OFFICE_COSTS_OUTGOINGS_AREAS, [
    { id: "costs", label: "Costs", hash: "costs-outgoings" },
    { id: "outgoing-payments", label: "Outgoing Payments", hash: "costs-outgoings-payments" },
  ]);

  for (const area of OFFICE_COSTS_OUTGOINGS_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.hash}`), "purchases-expenses");
    assert.equal(resolveOfficePurchasesExpensesAreaFromHash(`#${area.hash}`), "costs-outgoings");
    assert.equal(resolveOfficeCostsOutgoingsAreaFromHash(`#${area.hash}`), area.id);
    assert.equal(getOfficeCostsOutgoingsHash(area.id), `#${area.hash}`);
  }

  assert.equal(resolveOfficeCostsOutgoingsAreaFromHash("#costs-outgoings"), "costs");
  assert.equal(OFFICE_COSTS_ARCHIVE_HASH, "#all-costs");
  assert.equal(resolveOfficeCostsOutgoingsAreaFromHash("#all-costs"), "costs");
  assert.equal(getOfficeCostsArchiveHash(), "#all-costs");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-costs"), "costs-outgoings");
  assert.equal(resolveOfficeAreaFromHash("#all-costs"), "purchases-expenses");
  assert.equal(OFFICE_OUTGOING_PAYMENTS_ARCHIVE_HASH, "#all-outgoing-payments");
  assert.equal(resolveOfficeCostsOutgoingsAreaFromHash("#all-outgoing-payments"), "outgoing-payments");
  assert.equal(getOfficeOutgoingPaymentsArchiveHash(), "#all-outgoing-payments");
  assert.equal(resolveOfficePurchasesExpensesAreaFromHash("#all-outgoing-payments"), "costs-outgoings");
  assert.equal(resolveOfficeAreaFromHash("#all-outgoing-payments"), "purchases-expenses");
  assert.equal(resolveOfficeCostsOutgoingsAreaFromHash("#coal"), null);
});

test("desktop and mobile shells share one navigation source", () => {
  assert.match(shell, /OFFICE_AREAS\.map/);
  assert.match(shell, /fixed inset-y-0 left-0 hidden w-64[\s\S]*lg:flex/);
  assert.match(shell, /sticky top-0[\s\S]*lg:hidden/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /aria-controls="office-mobile-navigation"/);
  assert.match(shell, /event\.key !== "Escape"/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(shell, /querySelectorAll<HTMLElement>/);
  assert.match(shell, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(shell, /min-h-atlas-12/);
});

test("new shell presentation uses V2 tokens and shared actions", () => {
  assert.match(shell, /<Button/);
  assert.match(shell, /<LogoutButton v2 \/>/);
  assert.doesNotMatch(shell, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(shell, /(?:insert|update|delete)\(|\.from\(|\.rpc\(/);
});
