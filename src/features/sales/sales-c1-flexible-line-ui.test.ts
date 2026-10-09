import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const editor = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const model = readFileSync(
  new URL("../office/sales-office-model.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const register = readFileSync(new URL("./sales-register-model.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");

test("C1 adds the two user-facing flexible-line choices inside the existing Challan editor", () => {
  assert.match(editor, /Additional lines \/ notes/);
  assert.match(editor, />Add note</);
  assert.match(editor, />Add extra charge</);
  assert.match(editor, /Particulars \/ note text/);
  assert.match(editor, /placeholder="Loading \/ unloading"/);
  assert.doesNotMatch(editor, />NOTE<|>EXTRA_CHARGE<|>NON_FINANCIAL<|>OTHER_REVENUE</);
});

test("Note rows expose particulars only while Extra Charge supports both authoritative input modes", () => {
  const noteUi = editor.slice(
    editor.indexOf('{line.lineType === "NOTE"'),
    editor.indexOf('{line.lineType === "EXTRA_CHARGE"'),
  );
  assert.match(noteUi, /Particulars \/ note text/);
  assert.doesNotMatch(noteUi, /type="number"|Amount|Quantity|Rate/);

  const chargeUi = editor.slice(
    editor.indexOf('{line.lineType === "EXTRA_CHARGE"'),
    editor.indexOf("</div>}\n              </div>;"),
  );
  assert.match(chargeUi, /Direct amount/);
  assert.match(chargeUi, /Quantity × rate/);
  assert.match(chargeUi, /Charge preview/);
  assert.match(model, /quantity: parsePositiveDecimal\(line\.quantity, 3\)/);
  assert.match(model, /rate: parseMoney\(line\.rate, false\)/);
});

test("Direct Amount remains text entry in both create and correction so scrolling cannot step it", () => {
  const directAmountUi = editor.match(
    /line\.chargeMode === "DIRECT_AMOUNT"[\s\S]*?<ChallanField[^>]*label=\{challan \? "Amount · entered" : "Amount"\}>([\s\S]*?)<\/ChallanField>/,
  )?.[1];

  assert.ok(directAmountUi, "Direct Amount control must exist.");
  assert.match(directAmountUi, /type="text"/);
  assert.match(directAmountUi, /inputMode="decimal"/);
  assert.doesNotMatch(directAmountUi, /type=\{challan \? "number"|type="number"|step="0\.01"/);
  assert.match(
    editor,
    /formatIndianCurrency\(amountPreview, \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\)/,
  );
});

test("C1 ordering and deletion semantics are explicit and deterministic", () => {
  assert.match(editor, /Move up/);
  assert.match(editor, /Move down/);
  assert.match(editor, /removeChallanFlexibleLine/);
  assert.match(model, /form\.flexibleLines\.map\(\(line, orderIndex\)/);
  assert.match(model, /flexibleLines,/);
  assert.match(service, /p_flexible_lines: validated\.flexibleLines \?\? null/);
});

test("manual-only documents and combined previews are enabled without weakening server authority", () => {
  assert.match(editor, /title="No brick items" description="Add a brick row, or use a note or extra charge for a manual Challan\."/);
  assert.match(model, /form\.lines\.length === 0 && form\.flexibleLines\.length === 0/);
  assert.match(model, /brickPaise \+ flexiblePaise/);
  assert.match(editor, /Notes add ₹0\. The database returns the authoritative saved total/);
  assert.match(editor, /onSaved!\(saved\)/);
  assert.match(editor, /Authoritative total: \$\{formatSalesMoney\(saved\.challanTotal\)\}/);
  assert.doesNotMatch(model, /challanTotal\s*:/);
});

test("controlled writes, payment locks, Sales Register, and Correction D print consumption remain intact", () => {
  assert.match(editor, /await submitChallanCreation\(\s*creationLatch\.current/);
  assert.match(editor, /: createChallan\(input\)/);
  assert.match(editor, /await updateChallan\(input\)/);
  assert.doesNotMatch(editor, /\.from\(["']challan_flexible_lines["']\)/);
  assert.match(model, /if \(challan\.isLocked\).*canEdit: false/);
  assert.match(service, /P3005[\s\S]*payment-locked/);
  assert.match(register, /brickRevenue[\s\S]*otherRevenue[\s\S]*totalRevenue/);
  assert.match(printModel, /challan\.flexibleLines/);
  assert.match(printModel, /lineKind: "NOTE"/);
  assert.match(printModel, /lineKind: "EXTRA_CHARGE"/);
});

test("C1 remains isolated from later goods, fleet, and profitability work", () => {
  for (const source of [editor, model, service]) {
    assert.doesNotMatch(source, /OTHER_GOODS|driver master|fleet tracking|profitability|cost accounting/i);
  }
});
