import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const office = readFileSync(new URL("./components/office-dashboard.tsx", import.meta.url), "utf8");
const sales = readFileSync(new URL("./components/sales-office-section.tsx", import.meta.url), "utf8");
const expenses = readFileSync(new URL("./components/expenses-office-section.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/office/page.tsx", import.meta.url), "utf8");
const dashboardArea = office.slice(
  office.indexOf('<section id="dashboard"'),
  office.indexOf('<section id="production"'),
);
const salesArea = sales.slice(
  sales.indexOf('<section id="sales"'),
  sales.indexOf('<section aria-label="Vehicle Delivery Wages"'),
);
const purchasesArea = expenses.slice(
  expenses.indexOf('<section aria-labelledby="expenses-office-heading"'),
  expenses.indexOf('<SupplierManagementSection'),
);

test("Office mounts Dashboard once as the default shell area", () => {
  assert.match(office, /useState<OfficeAreaId>\("dashboard"\)/);
  assert.match(office, /<OfficeShell activeArea=\{activeArea\} onAreaChange=\{setActiveArea\}>/);
  assert.match(dashboardArea, /id="office-dashboard-feature"/);
  assert.match(dashboardArea, /<DashboardFeature factoryId=\{factoryId!\} \/>/);
  assert.equal((office.match(/<DashboardFeature\b/g) ?? []).length, 1);
});

test("Dashboard receives only the existing authenticated Office factory identity", () => {
  assert.match(office, /const \[factoryId, setFactoryId\] = useState<string \| null>\(null\)/);
  assert.match(office, /const result = await resolveAuthenticatedFactoryId\(\)/);
  assert.match(office, /setFactoryId\(result\.factoryId\)/);
  assert.equal((office.match(/await resolveAuthenticatedFactoryId\(/g) ?? []).length, 1);
  assert.doesNotMatch(office, /factory_users|dashboardFactory|setDashboardFactory/);
  assert.equal(office.match(/<DashboardFeature\b([^>]+)\/>/)?.[1].trim(), "factoryId={factoryId!}");
});

test("Dashboard and shell stay behind existing authentication and factory-access guards", () => {
  assert.match(page, /<AuthGuard><OfficeDashboard \/><\/AuthGuard>/);
  for (const status of ["loading", "denied", "failed"]) {
    const guard = office.indexOf(`if (factoryAccessStatus === "${status}")`);
    assert.ok(guard > -1 && guard < office.indexOf("<OfficeShell"));
    assert.match(office.slice(guard, office.indexOf("\n  }", guard)), /return <main/);
  }
});

test("existing Office capabilities remain single mounted instances grouped by area", () => {
  const expectedOnce = [
    "DashboardFeature",
    "ProductionOfficeWorkspace",
    "WorkforceOfficeWorkspace",
    "SalesOfficeSection",
    "CoalPurchaseOfficeSection",
    "VehicleMaintenanceOfficeSection",
    "VehicleFuelOfficeSection",
    "ExpensesOfficeSection",
    "CashBookOfficeSection",
    "AddBrickTypeForm",
    "BrickTypeManagement",
    "LabourerManagement",
    "MudGroupManagement",
    "SoilOfficeSection",
    "StaffOfficeSection",
    "TransportOfficeSection",
  ];

  for (const component of expectedOnce) {
    assert.equal((office.match(new RegExp(`<${component}\\b`, "g")) ?? []).length, 1, `${component} remains mounted once`);
  }

  for (const area of ["dashboard", "production", "workforce", "purchases-expenses", "cash-book", "reports"]) {
    assert.match(office, new RegExp(`<section id="${area}"[\\s\\S]*?hidden=\\{activeArea !== "${area}"\\}`));
  }
  assert.match(sales, /<section id="sales"[\s\S]*?hidden=\{activeArea !== "sales"\}/);
  assert.match(sales, /<section id="settings"[\s\S]*?hidden=\{activeArea !== "settings"\}/);
  assert.match(expenses, /hidden=\{activeArea !== "purchases-expenses"\}/);
  assert.match(expenses, /hidden=\{activeArea !== "settings"\}/);
});

test("Office groups operational work, workforce accounts, and master data without duplicate owners", () => {
  assert.match(office, /id="production"[\s\S]*<ProductionOfficeWorkspace factoryId=\{factoryId!\} \/>/);
  assert.match(office, /id="workforce"[\s\S]*WorkforceOfficeWorkspace[\s\S]*LabourerManagement[\s\S]*MudGroupManagement[\s\S]*TransportOfficeSection[\s\S]*SoilOfficeSection[\s\S]*StaffOfficeSection/);
  assert.equal((office.match(/<AddProductionLabourerDrawer\b/g) ?? []).length, 1);
  assert.match(sales, /hidden=\{!showVehicleWages\}[\s\S]*VehicleDeliveryWageOverview/);
  assert.match(sales, /id="settings"[\s\S]*FactoryProfileEditor[\s\S]*VehicleManagementSection/);
  assert.match(expenses, /<SupplierManagementSection[\s\S]*hidden=\{activeArea !== "settings"\}/);
  assert.doesNotMatch(salesArea, /VehicleManagementSection|VehicleWageAccountsSection/);
  assert.doesNotMatch(purchasesArea, /SupplierManagementSection|onOpenSupplierCreate|onOpenSupplierEdit/);
  assert.equal((office.match(/<SalesOfficeSection\b/g) ?? []).length, 1);
  assert.equal((office.match(/<ExpensesOfficeSection\b/g) ?? []).length, 1);
});

test("Office preserves hash deep links and browser back navigation without a second router", () => {
  assert.match(office, /const hash = window\.location\.hash;[\s\S]*resolveOfficeAreaFromHash\(hash\)/);
  assert.match(office, /window\.addEventListener\("hashchange", syncAreaFromHash\)/);
  assert.match(office, /window\.removeEventListener\("hashchange", syncAreaFromHash\)/);
  assert.doesNotMatch(office, /router\.push\([^)]*#|useSearchParams|URLSearchParams/);
});

test("Dashboard New Challan deep link reuses the existing Sales instance and opens create mode", () => {
  assert.match(office, /setSalesNavigationTarget\(hash === "#new-challan" \? "new-challan" : null\)/);
  assert.match(office, /navigationTarget=\{salesNavigationTarget\}/);
  assert.match(sales, /activeArea !== "sales" \|\| navigationTarget !== "new-challan"/);
  assert.match(sales, /setMode\("create"\)/);
  assert.match(sales, /setSelectedChallanId\(""\)/);
  assert.equal((office.match(/<SalesOfficeSection\b/g) ?? []).length, 1);
});

test("Office knows only DashboardFeature and adds no Dashboard data logic", () => {
  const dashboardImports = [...office.matchAll(/import .* from "(@\/features\/dashboard\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(dashboardImports, ["@/features/dashboard/components/dashboard-feature"]);
  assert.doesNotMatch(office, /\bDashboardContainer\b|\bDashboardView\b|\bDashboardDateControls\b|getDashboardSnapshot|dashboardSnapshotQueryOptions|getTodayDashboardRange|DashboardDateMode|DashboardDateRange/);
  assert.doesNotMatch(dashboardArea, /supabase|\/services\/|compensation|useQuery|fetch\(|dateFrom|dateTo|onChange|isLoading|error/);
  assert.doesNotMatch(page, /dashboard-feature|DashboardContainer|getDashboardSnapshot/);
});
