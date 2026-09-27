import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/add-soil-trolley-worker-drawer.tsx", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("./components/soil-office-section.tsx", import.meta.url),
  "utf8",
);

test("Add Soil worker uses the focused Production-style V2 drawer", () => {
  assert.match(overview, /\+ Add worker/);
  assert.match(overview, /<AddSoilTrolleyWorkerDrawer/);
  assert.doesNotMatch(overview, /id="add-soil-worker-heading"|onSubmit=\{submitWorker\}/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /Workforce directory/);
  assert.match(drawer, /Add Soil \/ Trolley worker/);
  assert.match(drawer, /border-t border-atlas-border bg-atlas-background-muted/);
});

test("drawer contains only the three supported Soil creation fields", () => {
  for (const field of ["Worker name", "Initial ₹ / trolley", "Effective from"]) {
    assert.match(drawer, new RegExp(field));
  }
  assert.match(drawer, /inputMode="decimal"/);
  assert.match(drawer, /type="date"/);
  assert.match(drawer, /getLocalDate/);
  assert.doesNotMatch(drawer, /Origin|brick|crew|group|payment|status|worker id|notes?/i);
});

test("validation is compact, field-aware, and duplicate-safe", () => {
  assert.match(drawer, /if \(isSubmitting\) return/);
  assert.match(drawer, /name\.trim\(\)\.replace\(\/\\s\+\/g, " "\)/);
  assert.match(drawer, /Worker name is required/);
  assert.match(drawer, /Number\.isFinite\(numericRate\)/);
  assert.match(drawer, /Initial trolley rate must be greater than zero/);
  assert.match(drawer, /Effective-from date is required/);
  assert.match(drawer, /aria-invalid=/);
  assert.match(drawer, /<Feedback role="alert" tone="danger">/);
});

test("creation remains one atomic worker plus initial-rate operation", () => {
  assert.match(drawer, /await onCreate\(\{/);
  assert.match(drawer, /worker and initial trolley rate are created together/);
  assert.match(overview, /buildSoilWorkerCreateInput\(\{/);
  assert.match(overview, /await createSoilWorker\(creationInput\)/);
  assert.match(overview, /setQueryData<SoilWorker\[]>/);
  assert.match(overview, /invalidateQueries\(\{ queryKey: workersKey\(factoryId\) \}\)/);
  assert.match(overview, /setIsAddWorkerOpen\(false\)/);
  assert.match(overview, /setManagementWorkerId\(worker\.id\)/);
  assert.doesNotMatch(drawer, /createSoilWorker|\.from\(|\.rpc\(/);
});

test("drawer preserves Production focus behaviour and Atlas V2 presentation", () => {
  assert.match(drawer, /nameInputRef\.current\?\.focus\(\)/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /isSubmittingRef/);
  assert.match(drawer, /ATLAS_UI_STRINGS\.actions\.cancel/);
  for (const primitive of ["Button", "Feedback", "FormField", "Input"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /<(?:input)\b/);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
