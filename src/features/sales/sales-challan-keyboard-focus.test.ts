import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);

const editor = office.match(/function ChallanEditor\([\s\S]*?\n}\n\nfunction VehicleCombobox/)?.[0] ?? "";
const vehicleCombobox = office.match(/function VehicleCombobox\([\s\S]*?\n}\n\nfunction BrickTypeCombobox/)?.[0] ?? "";
const brickTypeCombobox = office.match(/function BrickTypeCombobox\([\s\S]*?\n}\n\nfunction ChallanDetail/)?.[0] ?? "";
const rateField = editor.match(/<ChallanField[^>]*>[\s\S]*?data-challan-focus=\{`rate-\$\{index \+ 1\}`\}[\s\S]*?<\/ChallanField>/)?.[0] ?? "";
const amountField = editor.match(/<ChallanField[^>]*>[\s\S]*?data-challan-focus=\{`amount-\$\{index \+ 1\}`\}[\s\S]*?<\/ChallanField>/)?.[0] ?? "";

test("new Challan Enter path follows the intended operator sequence", () => {
  assert.match(editor, /data-challan-focus="customer"[\s\S]*focusSoon\(challanNumberInputRef\.current\)/);
  assert.match(editor, /data-challan-focus="number"[\s\S]*advanceNewChallanOnEnter\(event, \(\) => challanDateInputRef\.current\)/);
  assert.match(editor, /data-challan-focus="date"[\s\S]*advanceNewChallanOnEnter\(event, \(\) => vehicleInputRef\.current\)/);
  assert.match(editor, /focusName=\{`brick-type-\$\{index \+ 1}`\}[\s\S]*focusSoon\(quantityInputRefs\.current\.get\(line\.key\)/);
  assert.match(editor, /data-challan-focus=\{`quantity-\$\{index \+ 1}`\}[\s\S]*rateInputRefs\.current\.get\(line\.key\)/);
  assert.match(vehicleCombobox, /data-challan-focus="vehicle"/);
  assert.match(editor, /vehicle\?\.deliveryWageTrackingEnabled[\s\S]*tripLabourWageInputRef[\s\S]*focusFirstBrickLine\(\)/);
  assert.match(editor, /data-challan-focus="trip-labour-wage"[\s\S]*brickTypeInputRefs\.current\.get\(firstLine\.key\)/);
});

test("Pay Later and Received Now each finish at the explicit save action", () => {
  assert.match(editor, /data-challan-focus="pay-later"[\s\S]*focusSoon\(saveButtonRef\.current\)/);
  assert.match(editor, /data-challan-focus="received-now"[\s\S]*focusSoon\(\(\) => receivedAmountInputRef\.current\)/);
  assert.match(editor, /data-challan-focus="received-amount"[\s\S]*paymentDateInputRef\.current/);
  assert.match(editor, /data-challan-focus="payment-date"[\s\S]*paymentModeInputRef\.current/);
  assert.match(editor, /data-challan-focus="payment-mode"[\s\S]*focusSoon\(saveButtonRef\.current\)/);
  assert.match(editor, /data-challan-focus="save" type="submit"/);
});

test("Enter cannot implicitly submit early and dropdown Enter keeps selection authority", () => {
  assert.match(editor, /onKeyDown=\{preventImplicitCreateSubmit\}/);
  assert.match(editor, /if \(challan \|\| event\.key !== "Enter" \|\| event\.defaultPrevented/);
  assert.match(editor, /\["BUTTON", "SELECT", "TEXTAREA"\]\.includes\(target\.tagName\)/);
  assert.match(vehicleCombobox, /if \(event\.key === "Enter"\) \{\s*event\.preventDefault\(\)/);
  assert.match(vehicleCombobox, /if \(isOpen && highlightedVehicle\) \{\s*selectVehicle\(highlightedVehicle\.id\)/);
  assert.match(vehicleCombobox, /else if \(!isOpen \|\| !searchText\.trim\(\)\)/);
});

test("normal Tab order and multiple brick-row focus remain intact", () => {
  assert.doesNotMatch(editor, /tabIndex=/);
  assert.match(editor, /focusSoon\(\(\) => brickTypeInputRefs\.current\.get\(key\) \?\? null\)/);
  assert.match(editor, /const nextLine = form\.lines\[index \+ 1\];[\s\S]*brickTypeInputRefs\.current\.get\(nextLine\.key\)[\s\S]*payLaterInputRef\.current/);
  assert.doesNotMatch(editor.match(/function focusAfterBrickLine[\s\S]*?\n  }/)?.[0] ?? "", /vehicleInputRef/);
  assert.match(editor, /event\.nativeEvent\.isComposing/);
});

test("Rate Enter always focuses Amount before Amount advances the brick row", () => {
  assert.ok(rateField);
  assert.match(rateField, /advanceNewChallanOnEnter\(event, \(\) => amountInputRefs\.current\.get\(line\.key\) \?\? null\)/);
  assert.doesNotMatch(rateField, /focusAfterBrickLine/);
  assert.ok(amountField);
  assert.match(amountField, /focusAfterBrickLine\(index\)/);
});

test("Vehicle wage, no-wage, and optional skip paths all reach the first brick row", () => {
  assert.match(editor, /if \(tracksDeliveryWage \?\? vehicle\?\.deliveryWageTrackingEnabled\)[\s\S]*tripLabourWageInputRef\.current/);
  assert.match(editor, /focusAfterVehicle[\s\S]*focusFirstBrickLine\(\)/);
  assert.match(editor, /onAdvance=\{\(\) => focusAfterVehicle\(form\.vehicleId\)\}/);
  assert.match(editor, /data-challan-focus="trip-labour-wage"[\s\S]*brickTypeInputRefs\.current\.get\(firstLine\.key\)/);
});

test("Brick Type opens and navigates by keyboard, then selection focuses Quantity", () => {
  assert.ok(brickTypeCombobox);
  assert.match(brickTypeCombobox, /event\.key === "Enter"[\s\S]*if \(!isOpen\)[\s\S]*openList\(\)[\s\S]*selectBrickType\(highlightedBrickType\.id\)/);
  assert.match(brickTypeCombobox, /event\.key === "ArrowDown"/);
  assert.match(brickTypeCombobox, /event\.key === "ArrowUp"/);
  assert.match(brickTypeCombobox, /onClick=\{openList\}/);
  assert.match(brickTypeCombobox, /onClick=\{\(\) => selectBrickType\(brickType\.id\)\}/);
  assert.match(brickTypeCombobox, /onSelectionComplete\(\)/);
  assert.match(editor, /onSelectionComplete=\{\(\) => \{ if \(!challan\) focusSoon\(quantityInputRefs\.current\.get\(line\.key\) \?\? null\); }\}/);
});

test("new Challan presentation composes the V2 contracts without changing its model", () => {
  assert.match(office, /import \{ Button \} from "@\/components\/ui\/button"/);
  assert.match(office, /import \{ EmptyState, Feedback \} from "@\/components\/ui\/feedback"/);
  assert.match(office, /import \{ Input, Select \} from "@\/components\/ui\/form-controls"/);
  assert.match(office, /import \{ FormField \} from "@\/components\/ui\/form-field"/);
  assert.match(office, /return <FormField label=\{label\}>\{children\}<\/FormField>;/);
  assert.match(office, /formatIndianCurrency\(totalPreview\)/);
  assert.match(editor, /<VehicleCombobox\s+v2\s/);
  assert.match(editor, /<BrickTypeCombobox\s+v2\s/);
});

test("Save Challan remains the single guarded primary completion action", () => {
  assert.match(editor, /if \(isSaving\) return;/);
  assert.match(editor, /variant="primary"[\s\S]*data-challan-focus="save"[\s\S]*loading=\{isSaving\}/);
  assert.match(editor, />\{challan \? "Save corrections" : "Save Challan"\}<\/ChallanButton>/);
  assert.doesNotMatch(editor, /idempotency/i);
});
