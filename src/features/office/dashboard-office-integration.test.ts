import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const office = readFileSync(new URL("./components/office-dashboard.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/office/page.tsx", import.meta.url), "utf8");
const dashboardSection = office.match(/<section id="office-dashboard-feature"[\s\S]*?<\/section>/)?.[0] ?? "";

test("Office exposes a Dashboard jump link targeting the mounted feature section", () => {
  assert.match(office, /<a href="#office-dashboard-feature"[^>]*>Dashboard<\/a>/);
  assert.match(dashboardSection, /aria-label="Dashboard"/);
  assert.match(dashboardSection, /<DashboardFeature factoryId=\{factoryId!\} \/>/);
  assert.equal((office.match(/<DashboardFeature\b/g) ?? []).length, 1);
});

test("Dashboard receives only the existing authenticated Office factory identity", () => {
  assert.match(office, /const \[factoryId, setFactoryId\] = useState<string \| null>\(null\)/);
  assert.match(office, /const result = await resolveAuthenticatedFactoryId\(\)/);
  assert.match(office, /setFactoryId\(result.factoryId\)/);
  assert.equal((office.match(/await resolveAuthenticatedFactoryId\(/g) ?? []).length, 1);
  assert.doesNotMatch(office, /factory_users|dashboardFactory|setDashboardFactory/);
  assert.equal(office.match(/<DashboardFeature\b([^>]+)\/>/)?.[1].trim(), "factoryId={factoryId!}");
});

test("Dashboard stays behind existing authentication and factory-access guards", () => {
  assert.match(page, /<AuthGuard><OfficeDashboard \/><\/AuthGuard>/);
  for (const status of ["loading", "denied", "failed"]) {
    const guard = office.indexOf(`if (factoryAccessStatus === "${status}")`);
    assert.ok(guard > -1 && guard < office.indexOf("<DashboardFeature"));
    assert.match(office.slice(guard, office.indexOf("\n  }", guard)), /return <main/);
  }
});

test("Production remains the landing content and all existing sections retain their order", () => {
  assert.match(office, /<h1[^>]*>Production<\/h1>/);
  const sections = [
    '<SummaryCard label="Total Production"',
    '<section aria-labelledby="todays-production-heading"',
    "<TransportDailyOperationsSection",
    "<SalesOfficeSection",
    "<ExpensesOfficeSection",
    "<CashBookOfficeSection",
    "<WageRatesSection",
    "<CalculateWagesSection",
    "<AddBrickTypeForm",
    "<BrickTypeManagement",
    "<ProductionCrewManagement",
    "<AddLabourerForm",
    "<LabourerManagement",
    "<LabourGroupManagement",
    "<SoilOfficeSection",
    "<StaffOfficeSection",
    "<TransportOfficeSection",
    "<DashboardFeature",
  ];
  let previousIndex = -1;
  for (const section of sections) {
    const index = office.indexOf(section);
    assert.ok(index > previousIndex, `${section} remains available in its original order`);
    previousIndex = index;
  }
});

test("Office knows only DashboardFeature and adds no Dashboard loading, date, or source logic", () => {
  const dashboardImports = [...office.matchAll(/import .* from "(@\/features\/dashboard\/[^\"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(dashboardImports, ["@/features/dashboard/components/dashboard-feature"]);
  assert.doesNotMatch(office, /\bDashboardContainer\b|\bDashboardView\b|\bDashboardDateControls\b|getDashboardSnapshot|dashboardSnapshotQueryOptions|getTodayDashboardRange|DashboardDateMode|DashboardDateRange/);
  assert.doesNotMatch(dashboardSection, /supabase|\/services\/|compensation|useQuery|fetch\(|dateFrom|dateTo|onChange|isLoading|error/);
  assert.doesNotMatch(page, /dashboard-feature|DashboardContainer|getDashboardSnapshot/);
});
