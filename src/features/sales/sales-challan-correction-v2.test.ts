import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const editor = office.match(
  /function ChallanEditor\([\s\S]*?\n}\n\nfunction VehicleCombobox/,
)?.[0] ?? "";

test("correction mode uses the shared V2 presentation contracts", () => {
  assert.match(editor, /Challan correction/);
  assert.match(editor, /<StatusPill label=\{challanStatus\.label\}/);
  assert.match(editor, /<ChallanField label="Customer" v2>/);
  assert.match(editor, /<VehicleCombobox\s+v2\s/);
  assert.match(editor, /<BrickTypeCombobox\s+v2\s/);
  assert.match(editor, /<Feedback role="alert" tone="danger">\{error\}<\/Feedback>/);
  assert.doesNotMatch(editor, /v2=\{!challan\}/);
});

test("saved snapshots are visibly separate from correction inputs", () => {
  assert.match(editor, /challan-correction-snapshots-heading/);
  assert.match(editor, /Saved snapshot context/);
  assert.match(editor, /challan\.customerNameSnapshot/);
  assert.match(editor, /challan\.vehicleNumberSnapshot/);
  assert.match(editor, /challan\.companyNameSnapshot/);
  assert.match(editor, /challan\.companyGstinSnapshot/);
  assert.match(editor, /company snapshot remains unchanged/);
  assert.match(editor, /Corrected total preview · derived/);
});

test("locked and void Challans cannot render an editable correction form", () => {
  assert.match(editor, /const correctionEligibility = challan \? getChallanEligibility\(challan\) : null/);
  assert.match(editor, /if \(challan && correctionEligibility && !correctionEligibility\.canEdit\)/);
  assert.match(editor, /financially locked because a payment has been allocated/);
  assert.match(editor, /Void Challans are retained as immutable history/);
  assert.match(editor, /tone=\{correctionEligibility\.reason === "void" \? "danger" : "warning"\}/);
});

test("correction keeps existing authority, payload, and Direct Amount contracts", () => {
  assert.match(editor, /challanFormFromSaved\(challan, vehicles\)/);
  assert.match(editor, /buildUpdateChallanInput\(factoryId, challan\.id, form\)/);
  assert.match(editor, /saved = await updateChallan\(input\)/);
  assert.match(editor, /line\.pricingMode === "AMOUNT" \? line\.lineAmount/);
  assert.match(editor, /label=\{challan \? "Amount · entered" : "Amount"\}/);
  assert.match(editor, /type="text" inputMode="decimal" value=\{line\.amount\}/);
  assert.doesNotMatch(editor, /type=\{challan \? "number" : "text"\}/);
  assert.match(editor, /Brick rows plus extra charges\. Notes add ₹0/);
});

test("create and correction share one sticky authoritative total and save footer", () => {
  assert.equal((editor.match(/sticky bottom-atlas-0 z-20/g) ?? []).length, 1);
  assert.match(
    editor,
    /className="sticky bottom-atlas-0 z-20 flex flex-col gap-atlas-4 border-t border-atlas-border-strong bg-atlas-background py-atlas-4 sm:flex-row sm:items-end sm:justify-between"/,
  );
  assert.match(editor, /const totalPreview = calculateChallanTotalPreview\(form\.lines, form\.flexibleLines\)/);
  assert.match(editor, /formatIndianCurrency\(totalPreview\)/);
  assert.equal((editor.match(/Corrected total preview · derived/g) ?? []).length, 1);
  assert.equal((editor.match(/Save corrections/g) ?? []).length, 1);
  assert.match(
    editor,
    /type="submit"[\s\S]*loading=\{isSaving\}[\s\S]*disabled=\{isSaving \|\| \(form\.lines\.length > 0/,
  );
  assert.doesNotMatch(
    editor,
    /className=\{challan \? "flex flex-col gap-atlas-4 border-t border-atlas-border-strong pt-atlas-5/,
  );
});

test("correction preserves its existing native focus and Enter behavior", () => {
  assert.match(editor, /if \(challan \|\| event\.key !== "Enter"/);
  assert.match(editor, /if \(challan\) return;[\s\S]*focusAfterVehicle/);
  assert.match(editor, /onSelectionComplete=\{\(\) => \{ if \(!challan\) focusSoon/);
  assert.match(editor, /if \(!challan && event\.key === "Enter"/);
  assert.doesNotMatch(editor, /tabIndex=/);
});

test("correction remains presentation-only and responsive", () => {
  assert.match(editor, /sm:grid-cols-3/);
  assert.match(editor, /md:grid-cols-5/);
  assert.match(editor, /sm:flex-row/);
  assert.match(editor, /min-h-atlas-12/);
  assert.doesNotMatch(editor, /(?:insert|delete)\(|\.from\(|\.rpc\(/);
});
