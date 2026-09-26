import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/add-production-labourer-drawer.tsx", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const creation = office.slice(
  office.indexOf("async function createProductionLabourer"),
  office.indexOf('if (factoryAccessStatus === "loading")'),
);
const overview = office.slice(
  office.indexOf("function LabourerManagement"),
  office.indexOf("function LabourerProductionRateOverrideControls"),
);

test("Add labourer uses the established focused V2 drawer interaction", () => {
  assert.match(overview, /\+ Add labourer/);
  assert.match(overview, /<AddProductionLabourerDrawer/);
  assert.doesNotMatch(office, /function AddLabourerForm/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /Workforce directory/);
  assert.match(drawer, /Add labourer/);
});

test("creation keeps only authoritative worker identity fields", () => {
  assert.match(drawer, /Labourer name/);
  assert.match(drawer, /Origin \(optional\)/);
  assert.match(drawer, /Used only for identification and filtering\. It does not affect wages\./);
  assert.match(creation, /from\("labourers"\)\.insert\(\{/);
  assert.match(creation, /factory_id: factoryId/);
  assert.match(creation, /name,/);
  assert.match(creation, /production_origin_label: originLabel/);
  assert.match(creation, /is_active: true/);
  assert.doesNotMatch(`${drawer}\n${creation}`, /brick.?type|assigned brick|change brick/i);
  assert.doesNotMatch(`${drawer}\n${creation}`, /crew assignment|crew rate|default crew|worker id|enrollment|category|notes?/i);
});

test("name and origin are normalized with truthful validation", () => {
  assert.match(drawer, /const normalizedName = name\.trim\(\)/);
  assert.match(drawer, /if \(!normalizedName\)/);
  assert.match(drawer, /Labourer name is required\./);
  assert.match(drawer, /const normalizedOrigin = origin\.trim\(\) \|\| null/);
  assert.match(drawer, /maxLength=\{100\}/);
  assert.match(drawer, /aria-invalid=/);
  assert.match(drawer, /<Feedback role="alert" tone="danger">/);
});

test("duplicate submit is blocked and successful creation refreshes the authoritative list", () => {
  assert.match(drawer, /if \(isSubmitting\) return/);
  assert.match(drawer, /setIsSubmitting\(true\)/);
  assert.match(drawer, /await onCreate\(\{/);
  assert.match(drawer, /setName\(""\)/);
  assert.match(drawer, /setOrigin\(""\)/);
  assert.match(drawer, /setSuccessMessage\("Labourer added\."\)/);
  assert.match(creation, /await loadLabourers\(\)/);
  assert.doesNotMatch(creation, /setLabourers\(\(current\).*\.\.\./s);
});

test("initial rate stays in its existing separate effective-dated workflow", () => {
  assert.doesNotMatch(drawer, /setProductionLabourerRates|Effective from|Initial wage rate|inputMode="decimal"/);
  assert.match(drawer, /first direct rate later from Manage/);
  assert.doesNotMatch(creation, /setProductionLabourerRates|production_wage_rates|rate_per_1000_bricks/);
});

test("drawer is keyboard accessible and uses only V2 presentation contracts", () => {
  assert.match(drawer, /nameInputRef\.current\?\.focus\(\)/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /ATLAS_UI_STRINGS\.actions\.cancel/);
  for (const primitive of ["Button", "Feedback", "FormField", "Input"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
