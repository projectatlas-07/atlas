import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/production-office-workspace.tsx", import.meta.url),
  "utf8",
);
const dailyScreen = readFileSync(new URL("../transport/components/transport-daily-entry-screen.tsx", import.meta.url), "utf8");
const transportDrawer = readFileSync(new URL("./components/chamber-transport-management-drawer.tsx", import.meta.url), "utf8");
const office = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./office-navigation.ts", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);

test("Production has one local navigation with the three approved operational areas", () => {
  assert.match(navigation, /export type OfficeProductionAreaId/);
  for (const label of ["Brick Production", "Chamber Transport", "Soil / Trolley"]) {
    assert.equal((navigation.match(new RegExp(`label: "${label.replace("/", "\\/")}"`, "g")) ?? []).length, 1, label);
  }
  assert.match(workspace, /useState<OfficeProductionAreaId>\("brick"\)/);
  assert.match(workspace, /OFFICE_PRODUCTION_AREAS\.map/);
  assert.match(workspace, /aria-label="Production areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /variant=\{activeArea === area\.id \? "primary" : "ghost"\}/);
});

test("Production tabs follow canonical Office hashes and browser navigation", () => {
  assert.match(workspace, /resolveOfficeProductionAreaFromHash\(window\.location\.hash\)/);
  assert.match(workspace, /window\.addEventListener\("hashchange", syncProductionAreaFromHash\)/);
  assert.match(workspace, /window\.removeEventListener\("hashchange", syncProductionAreaFromHash\)/);
  assert.match(workspace, /window\.location\.hash = getOfficeProductionHash\(area\)/);
  assert.match(workspace, /onClick=\{\(\) => selectProductionArea\(area\.id\)\}/);
});

test("Production starts with compact navigation and keeps the work column left aligned", () => {
  assert.doesNotMatch(workspace, /Production workspace/);
  assert.doesNotMatch(workspace, /<header/);
  assert.match(workspace, /<div className="space-y-atlas-3">\s*<nav aria-label="Production areas"/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /flex min-w-max gap-atlas-2/);
  assert.match(workspace, /<div className="max-w-5xl">/);
});

test("Production removes redundant shell and tab headers while lifting every date control", () => {
  assert.match(shell, /activeArea !== "sales" && activeArea !== "workforce" && activeArea !== "production"/);
  for (const removedText of [
    "Daily factory operations",
    "Record daily raw brick quantities. Worker rates, earnings and payments remain in Workforce.",
    "Record daily Transport Group movement, present workers and paya quantity.",
    "Record daily trolley quantities. Worker rates, balances and payments remain in Workforce.",
  ]) {
    assert.doesNotMatch(workspace, new RegExp(removedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const area of ["Brick Production", "Chamber Transport", "Soil / Trolley"]) {
    assert.match(workspace, new RegExp(`aria-label="${area.replace("/", "\\/")}"[\\s\\S]*?className="max-w-3xl space-y-atlas-3"`));
  }
  assert.equal((workspace.match(/<div className="flex justify-end">/g) ?? []).length, 3);
  assert.equal((workspace.match(/<FormField label="Business date">/g) ?? []).length, 3);
  assert.doesNotMatch(workspace, /brick-production-heading|chamber-transport-heading|soil-trolley-heading/);
});

test("all three Production areas record inline without a separate workflow link", () => {
  assert.doesNotMatch(workspace, /recordingHref="\/#brick-production"/);
  assert.doesNotMatch(workspace, /recordingHref="\/#chamber-transport"/);
  assert.doesNotMatch(workspace, /recordingHref="\/#soil"/);
  assert.doesNotMatch(workspace, /function WorkspacePanel/);
});

test("Brick Production follows the focused V2 recording hierarchy", () => {
  for (const label of [
    "Brick Production",
    "Business date",
    "Record production",
    "Labourer name",
    "Raw quantity",
    "Save production entries",
    "Total Production",
    "Labourers Recorded",
    "Today’s saved entries",
  ]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /className="max-w-3xl space-y-atlas-3"/);
  assert.match(workspace, /Blank rows will be skipped/);
  assert.match(workspace, /inputMode="numeric"/);
  assert.match(workspace, /loading=\{isSaving\}/);
  assert.match(workspace, /isSavingRef\.current/);
});

test("Brick Production reuses the authoritative reader, model, schema, and save service", () => {
  assert.match(workspace, /getTodaysProduction\(factoryId, brickDate\)/);
  assert.match(workspace, /productionRecordSchema\.safeParse/);
  assert.match(workspace, /buildProductionSavePayload/);
  assert.match(workspace, /saveProductionEntryWithSessionRefresh/);
  assert.match(workspace, /if \(!dirtyLabourerIdsRef\.current\.has\(labourer\.id\)\) continue/);
  assert.match(workspace, /savedEntry: savedEntry \? \{ id: savedEntry\.id \} : undefined/);
  assert.match(workspace, /newEntryId: crypto\.randomUUID\(\)/);
  assert.doesNotMatch(workspace, /\.from\(|\.rpc\(|save_production_entry/);
});

test("Brick Production reflects factory and labourer settlement locks without hiding saved quantities", () => {
  assert.match(workspace, /getBrickProductionEditability/);
  assert.match(workspace, /editabilityQuery\.data\?\.isMudLocked/);
  assert.match(workspace, /Production through \{formatDateOnly\(editabilityQuery\.data\.mudSettlementCutoff\)\} has already been settled/);
  assert.match(workspace, /editability\?\.isLocked !== false/);
  assert.match(workspace, /Settled through \{formatDateOnly\(editability\.settledThrough\)\}/);
  assert.match(workspace, /value=\{quantities\[labourer\.id\] \?\? ""\}/);
  assert.match(workspace, /if \(editabilityQuery\.data\.labourers\[labourer\.id\]\?\.isLocked !== false\) continue/);
  assert.match(workspace, /allLabourersLocked \|\| editabilityQuery\.error/);
  assert.match(workspace, /Production for this business date is read-only/);
});

test("Chamber Transport follows the focused V2 recording hierarchy", () => {
  for (const label of [
    "Chamber Transport",
    "Business date",
    "Record transport",
    "Transport Group",
    "Present workers",
    "Paya / Chamber quantity",
    "Save transport entry",
    "Transport Groups Recorded",
    "Total Paya",
    "Workers Present",
    "Today’s saved entries",
    "Present count",
    "Saved workers",
  ]) {
    assert.match(workspace, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(workspace, /function ChamberTransportWorkspace[\s\S]*className="max-w-3xl space-y-atlas-3"/);
  assert.match(workspace, /inputMode="decimal"/);
  assert.match(workspace, /selectedWorkerIds\.size === members\.length/);
  assert.match(workspace, /saveInProgressRef\.current/);
});

test("Chamber Transport reuses authoritative group, attendance, paya, and save contracts", () => {
  for (const contract of [
    "loadActiveTransportGroups",
    "loadTransportDailyEntrySelection",
    "buildTransportDailyEntrySaveInput",
    "selectAllTransportWorkers",
    "toggleTransportWorkerSelection",
    "saveTransportDailyEntry",
    "listTransportDailyOperations",
  ]) {
    assert.match(workspace, new RegExp(contract));
  }
  assert.match(workspace, /transportGroupId: selectedGroupId/);
  assert.match(workspace, /selectedWorkerIds/);
  assert.match(workspace, /payaInput/);
  assert.match(workspace, /Promise\.all\(\[selectionQuery\.refetch\(\), query\.refetch\(\)\]\)/);
  assert.doesNotMatch(workspace, /ratePerPaya|dailyGroupPool|workerDailyShare|calculateTransportWeeklyWages/);
});

test("Transport rejection wiring preserves drafts and history without retrying writes (source assertions)", () => {
  const officeSave = workspace.slice(workspace.indexOf("async function saveTransport("), workspace.indexOf('aria-label="Chamber Transport"'));
  const separateSave = dailyScreen.slice(dailyScreen.indexOf("async function save():"), dailyScreen.indexOf('if (factoryAccess.status === "loading")', dailyScreen.indexOf("async function save():")));
  for (const handler of [officeSave, separateSave]) {
    assert.equal((handler.match(/await saveTransportDailyEntry\(input\)/g) ?? []).length, 1);
    assert.match(handler, /saveInProgressRef\.current/);
    const rejection = handler.slice(handler.indexOf("} catch (error)"), handler.indexOf("} finally"));
    assert.match(rejection, /transportDailyEntryErrorMessage\(error\)/);
    assert.doesNotMatch(rejection, /refetch|setPayaInput|setSelectedWorkerIds|saveTransportDailyEntry|status: "saved"|tone: "success"/);
  }
  const rateSave = transportDrawer.slice(transportDrawer.indexOf("async function saveRate("), transportDrawer.indexOf("async function toggleLifecycle()", transportDrawer.indexOf("async function saveRate(")));
  assert.equal((rateSave.match(/await createTransportGroupWageRate\(input\)/g) ?? []).length, 1);
  const rateRejection = rateSave.slice(rateSave.indexOf("} catch (caught)"), rateSave.indexOf("} finally"));
  assert.match(rateRejection, /transportRateOfficeErrorMessage\(caught/);
  assert.doesNotMatch(rateRejection, /setRateInput|setEffectiveFrom|setShowRateEditor|setSuccess|createTransportGroupWageRate/);
  assert.match(transportDrawer, /listTransportGroupWageRates\(/);
  assert.match(transportDrawer, /listTransportWeeklyEarnings\(/);
});

test("Soil Trolley follows the focused V2 recording hierarchy", () => {
  for (const label of [
    "Soil / Trolley",
    "Business date",
    "Record trolley entries",
    "Soil worker",
    "Trolley quantity",
    "Save trolley entries",
    "Workers Recorded",
    "Total Trolleys",
    "Today’s saved entries",
  ]) {
    assert.match(workspace, new RegExp(label.replace("/", "\\/"), "i"));
  }
  assert.match(workspace, /function SoilTrolleyWorkspace[\s\S]*className="max-w-3xl space-y-atlas-3"/);
  assert.match(workspace, /Blank rows will be skipped/);
  assert.match(workspace, /inputMode="decimal"/);
  assert.match(workspace, /step="0\.001"/);
  assert.match(workspace, /Archived · read-only/);
  assert.match(workspace, /saveInProgressRef\.current/);
});

test("Soil Trolley reuses the authoritative form model, reader, and save service", () => {
  for (const contract of [
    "listActiveSoilWorkers",
    "listSoilDailyTrolleyEntries",
    "prepareSoilDailyEntryForm",
    "updateSoilDailyEntryQuantity",
    "buildSoilDailyEntrySaveInput",
    "applySavedSoilDailyEntries",
    "saveSoilDailyTrolleyEntries",
    "soilDailyEntryErrorMessage",
  ]) {
    assert.match(workspace, new RegExp(contract));
  }
  assert.match(workspace, /await query\.refetch\(\)/);
  assert.doesNotMatch(workspace, /ratePerTrolley|baseAmount|soilEarning|availableBalance|soilPayment/i);
});

test("operational histories reuse existing read services and preserve module ownership", () => {
  assert.match(workspace, /getTodaysProduction\(factoryId, brickDate\)/);
  assert.match(workspace, /listTransportDailyOperations\(\{ factoryId, workDate: chamberDate \}\)/);
  assert.match(workspace, /listSoilDailyTrolleyEntries\(\{ factoryId, workDate: soilDate \}\)/);
  assert.match(workspace, /Transport Groups Recorded/);
  assert.doesNotMatch(workspace, /workDirection|Direction/);
  assert.doesNotMatch(workspace, /brickType|brick_type|Brick type totals|>Brick type</i);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|\bcreate\w*\(|save_production_entry/i);
  assert.doesNotMatch(workspace, /ratePerTrolleySnapshot|baseAmountSnapshot|totalEarned|totalPaid|availableBalance|withdrawal/i);
  assert.doesNotMatch(office, /listTransportDailyOperations|listSoilDailyTrolleyEntries/);
  assert.equal((office.match(/getTodaysProduction/g) ?? []).length, 2, "Workforce reuses the existing daily Production reader once");
});

test("all three histories have truthful loading, error, retry, and empty states", () => {
  for (const loadingLabel of [
    "Loading Brick Production entries...",
    "Loading Chamber Transport entries...",
    "Loading Soil / Trolley entries...",
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
  for (const primitive of ["Button", "Card", "Checkbox", "EmptyState", "Feedback", "FormField", "Input", "Select", "TableContainer"]) {
    assert.match(workspace, new RegExp(`<${primitive}\\b`));
  }
  assert.match(workspace, /formatDateOnly/);
  assert.match(workspace, /formatIndianNumber/);
  assert.match(workspace, /min-h-atlas-12/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /min-w-max/);
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
