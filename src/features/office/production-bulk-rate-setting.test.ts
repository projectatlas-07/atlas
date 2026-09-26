import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const bulk = readFileSync(
  new URL("./components/production-bulk-rate-setting.tsx", import.meta.url),
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

test("legacy disclosure is replaced by an explicit focused rate-setting mode", () => {
  assert.match(overview, /Set rates/);
  assert.match(overview, /<ProductionBulkRateSetting/);
  assert.match(overview, /isBulkRateOpen \? \(/);
  assert.doesNotMatch(overview, /Bulk Production rate tools|ProductionLabourerRateControls/);
  assert.match(bulk, /Set Production rates/);
  assert.match(bulk, /Direct effective-dated rates/);
});

test("all and selected modes target only active workers matching Origin", () => {
  assert.match(bulk, /type TargetMode = "all" \| "selected"/);
  assert.match(bulk, /labourers\.filter\(\(labourer\) => labourer\.isActive\)/);
  assert.match(bulk, /originFilter === "all"/);
  assert.match(bulk, /originFilter === "none"/);
  assert.match(bulk, /labourer\.originLabel === originFilter/);
  assert.match(bulk, /targetMode === "all"[\s\S]*visibleLabourers\.map/);
  assert.match(bulk, /selectedLabourerIds\.has\(labourer\.id\)/);
  assert.match(bulk, /All matching workers/);
  assert.match(bulk, /Selected workers/);
  assert.match(bulk, /Select all \{formatIndianNumber\(visibleLabourers\.length\)\} matching/);
  assert.match(bulk, /Clear selection/);
});

test("the authoritative direct effective-dated mutation is reused exactly once", () => {
  assert.equal((bulk.match(/setProductionLabourerRates\(\{/g) ?? []).length, 1);
  assert.match(bulk, /factoryId,/);
  assert.match(bulk, /labourerIds: targetLabourerIds/);
  assert.match(bulk, /ratePer1000Bricks: numericRate/);
  assert.match(bulk, /effectiveFrom,/);
  assert.match(bulk, /if \(isSubmitting\) return/);
  assert.doesNotMatch(bulk, /\.from\(|\.insert\(|\.update\(|\.rpc\(/);
});

test("rate, date, target summary, and backdated warning remain truthful", () => {
  assert.match(bulk, /inputMode="decimal"/);
  assert.match(bulk, /type="date"/);
  assert.match(bulk, /Rate per 1,000 bricks must be greater than zero/);
  assert.match(bulk, /Effective-from date is required/);
  assert.match(bulk, /Choose at least one active labourer/);
  assert.match(bulk, /Apply to \{formatIndianNumber\(targetCount\)\}/);
  assert.match(bulk, /formatIndianCurrency\(numericRate\)/);
  assert.match(bulk, /formatDateOnly\(effectiveFrom\)/);
  assert.match(bulk, /effectiveFrom < today/);
  assert.match(bulk, /Backdated change: live historical range earnings from this date may change/);
});

test("success clears transient input and refreshes authoritative rate queries", () => {
  assert.match(bulk, /setRate\(""\)/);
  assert.match(bulk, /setSelectedLabourerIds\(new Set\(\)\)/);
  assert.match(bulk, /Rate saved for/);
  assert.match(bulk, /invalidateQueries\(\{ queryKey: \["office-production-wage-rates", factoryId\] \}\)/);
  assert.doesNotMatch(bulk, /setLabourers|setProductionWageRates/);
});

test("Stitch selection treatment uses V2 primitives without importing its business fiction", () => {
  for (const primitive of ["Button", "Card", "Checkbox", "EmptyState", "Feedback", "FormField", "Input", "Select", "TableContainer"]) {
    assert.match(bulk, new RegExp(`<${primitive}\\b`));
  }
  assert.match(bulk, /hidden md:block/);
  assert.match(bulk, /md:hidden/);
  assert.doesNotMatch(bulk, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
  assert.doesNotMatch(bulk, /brick.?type|crew|default rate|rate category|reason|note/i);
});
