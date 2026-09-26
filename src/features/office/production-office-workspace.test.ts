import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/production-office-workspace.tsx", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);

test("Production has one local navigation with the three approved operational areas", () => {
  assert.match(workspace, /type ProductionWorkspaceArea = "brick" \| "chamber" \| "soil"/);
  for (const label of ["Brick Production", "Chamber Transport", "Soil / Trolley"]) {
    assert.equal((workspace.match(new RegExp(`label: "${label.replace("/", "\\/")}"`, "g")) ?? []).length, 1, label);
  }
  assert.match(workspace, /useState<ProductionWorkspaceArea>\("brick"\)/);
  assert.match(workspace, /aria-label="Production workflows"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /variant=\{activeArea === area\.id \? "primary" : "secondary"\}/);
});

test("each sub-area separates its existing recording workflow from date-scoped history", () => {
  for (const href of ["/#brick-production", "/#chamber-transport", "/#soil"]) {
    assert.match(workspace, new RegExp(`recordingHref="${href.replace("/", "\\/")}"`));
  }
  for (const label of [
    "Record Brick Production",
    "Record Chamber Transport",
    "Record Soil / Trolley",
    "Daily history / totals",
    "Operational history / totals",
    "Operational history",
  ]) {
    assert.match(workspace, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(workspace, /<Input type="date"/);
  assert.match(workspace, /Saved operations for the selected business date/);
});

test("operational histories reuse existing read services and preserve module ownership", () => {
  assert.match(workspace, /getTodaysProduction\(factoryId, brickDate\)/);
  assert.match(workspace, /listTransportDailyOperations\(\{ factoryId, workDate: chamberDate \}\)/);
  assert.match(workspace, /listSoilDailyTrolleyEntries\(\{ factoryId, workDate: soilDate \}\)/);
  assert.match(workspace, /Transport Groups recorded/);
  assert.doesNotMatch(workspace, /workDirection|Direction/);
  assert.match(workspace, /Daily raw brick quantities saved against Production labourers/);
  assert.doesNotMatch(workspace, /brickType|brick_type|Brick type totals|>Brick type</i);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|create|saveSoilDaily|saveTransportDaily|save_production_entry/i);
  assert.doesNotMatch(workspace, /ratePerTrolleySnapshot|baseAmountSnapshot|totalEarned|totalPaid|availableBalance|withdrawal|wage/i);
  assert.doesNotMatch(office, /listTransportDailyOperations|listSoilDailyTrolleyEntries/);
  assert.equal((office.match(/getTodaysProduction/g) ?? []).length, 2, "Workforce reuses the existing daily Production reader once");
});

test("all three histories have truthful loading, error, retry, and empty states", () => {
  for (const loadingLabel of [
    "Loading Brick Production history...",
    "Loading Chamber Transport history...",
    "Loading Soil / Trolley history...",
  ]) {
    assert.match(workspace, new RegExp(loadingLabel.replace("/", "\\/")));
  }
  for (const emptyLabel of [
    "No Brick Production recorded",
    "No Chamber Transport recorded",
    "No Soil / Trolley work recorded",
  ]) {
    assert.match(workspace, new RegExp(emptyLabel.replace("/", "\\/")));
  }
  assert.match(workspace, /Operational history is unavailable right now/);
  assert.match(workspace, /ATLAS_UI_STRINGS\.actions\.retry/);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /aria-busy="true"/);
});

test("workspace uses V2 primitives, central formatting, and responsive touch targets", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "TableContainer"]) {
    assert.match(workspace, new RegExp(`<${primitive}\\b`));
  }
  assert.match(workspace, /formatDateOnly/);
  assert.match(workspace, /formatIndianNumber/);
  assert.match(workspace, /min-h-atlas-12/);
  assert.match(workspace, /sm:grid-cols-3/);
  assert.match(workspace, /sm:flex-row/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});

test("Office mounts the local workspace once and keeps Workforce module instances separate", () => {
  assert.equal((office.match(/<ProductionOfficeWorkspace\b/g) ?? []).length, 1);
  assert.match(office, /id="production"[\s\S]*hidden=\{activeArea !== "production"\}[\s\S]*<ProductionOfficeWorkspace/);
  assert.match(office, /id="workforce"[\s\S]*<WorkforceOfficeWorkspace[\s\S]*<MudGroupManagement[\s\S]*<TransportOfficeSection[\s\S]*<SoilOfficeSection/);
  assert.doesNotMatch(workspace, /MudGroupManagement|SoilOfficeSection|TransportOfficeSection|LabourerManagement/);
});
