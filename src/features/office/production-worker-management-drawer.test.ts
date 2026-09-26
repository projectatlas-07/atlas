import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/production-worker-management-drawer.tsx", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const overview = office.slice(
  office.indexOf("function LabourerManagement"),
  office.indexOf("function LabourerProductionRateOverrideControls"),
);
const workerMutations = office.slice(
  office.indexOf("async function toggleLabourer"),
  office.indexOf("if (factoryAccessStatus"),
);

test("Manage opens a focused right-side drawer instead of legacy inline management", () => {
  assert.match(overview, /<ProductionWorkerManagementDrawer/);
  assert.doesNotMatch(overview, /Close management|Edit Name|Hide Origin|Hide Rate/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, />Done</);
});

test("drawer exposes only authoritative worker identity and lifecycle controls", () => {
  assert.match(drawer, /worker\.name/);
  assert.match(drawer, /worker\.originLabel/);
  assert.match(drawer, /PRODUCTION_LABOURER_LIFECYCLE_STATUS/);
  assert.match(drawer, /onSaveName\(worker, normalizedName\)/);
  assert.match(drawer, /setProductionLabourerOrigin\(/);
  assert.match(drawer, /onToggleLifecycle\(worker\)/);
  assert.match(drawer, /Existing work, earnings and account history remain unchanged/);
  assert.doesNotMatch(drawer, /Brick Type|assigned Brick|Change Brick/i);
  assert.doesNotMatch(drawer, /crew|enrolled|#WRK|reason\s*\/\s*note|worker category/i);
});

test("name and lifecycle mutations retain their existing factory-scoped writes", () => {
  assert.match(workerMutations, /update\(\{ is_active: !labourer\.isActive \}\)/);
  assert.match(workerMutations, /update\(\{ name \}\)/);
  assert.ok((workerMutations.match(/\.eq\("id", labourer\.id\)/g) ?? []).length >= 2);
  assert.ok((workerMutations.match(/\.eq\("factory_id", factoryId\)/g) ?? []).length >= 2);
  assert.doesNotMatch(workerMutations, /delete\(/);
});

test("individual rate workflow reuses direct effective-dated rate authority", () => {
  assert.match(drawer, /getCurrentLabourerProductionWageRate\(/);
  assert.match(drawer, /setProductionLabourerRates\(\{/);
  assert.match(drawer, /labourerIds: \[worker\.id\]/);
  assert.match(drawer, /effectiveFrom/);
  assert.match(drawer, /queryKey: \["office-production-wage-rates", factoryId\]/);
  assert.match(drawer, /Direct rate history/);
  assert.match(drawer, /WAGE_RATE_HISTORY_STATUS/);
  assert.match(drawer, /formatDateOnly\(historyRate\.effectiveFrom\)/);
  assert.doesNotMatch(drawer, /createProductionCrew|assignLabourerToProductionCrew|default rate/i);
});

test("drawer preserves duplicate-action protection and V2 presentation contracts", () => {
  assert.match(drawer, /if \(isSavingOrigin\) return/);
  assert.match(drawer, /if \(isSavingRate\) return/);
  assert.match(drawer, /if \(workerUpdating\) return/);
  assert.match(drawer, /inputMode="decimal"/);
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "StatusPill"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});

test("account, Add Labourer, management, and bulk rates remain separate workflows", () => {
  assert.match(overview, /<ProductionWorkerAccountDrawer/);
  assert.match(overview, /<AddProductionLabourerDrawer/);
  assert.doesNotMatch(office, /function AddLabourerForm/);
  assert.match(overview, /<ProductionBulkRateSetting/);
  assert.doesNotMatch(overview, /ProductionLabourerRateControls/);
});
