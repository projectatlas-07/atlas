import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getSavedChallanFlexibleLineViews } from "../office/sales-office-model.ts";
import type { ChallanFlexibleLine } from "./types.ts";

const detail = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const editorModel = readFileSync(
  new URL("../office/sales-office-model.ts", import.meta.url),
  "utf8",
);
const register = readFileSync(new URL("./sales-register-model.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");
const printScreen = readFileSync(
  new URL("./components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);

const observedManualCase: ChallanFlexibleLine[] = [
  {
    id: "charge-a",
    factoryId: "factory-a",
    challanId: "challan-a",
    lineType: "EXTRA_CHARGE",
    lineCategory: "OTHER_REVENUE",
    orderIndex: 1,
    particulars: "Engine Oil",
    quantity: 2.5,
    rate: 400,
    amount: 1000,
    createdAt: "2026-08-31T10:00:00Z",
  },
  {
    id: "note-a",
    factoryId: "factory-a",
    challanId: "challan-a",
    lineType: "NOTE",
    lineCategory: "NON_FINANCIAL",
    orderIndex: 0,
    particulars: "Delivered in good condition",
    quantity: null,
    rate: null,
    amount: 0,
    createdAt: "2026-08-31T10:00:00Z",
  },
];

test("manual regression case maps persisted Note then quantity-rate Extra Charge in order", () => {
  assert.deepEqual(getSavedChallanFlexibleLineViews(observedManualCase), [
    {
      key: "note-a",
      kind: "note",
      typeLabel: "Note",
      particulars: "Delivered in good condition",
    },
    {
      key: "charge-a",
      kind: "extra_charge",
      typeLabel: "Extra Charge",
      particulars: "Engine Oil",
      quantity: 2.5,
      rate: 400,
      amount: 1000,
    },
  ]);
});

test("Note presentation cannot expose meaningless financial fields", () => {
  const [note] = getSavedChallanFlexibleLineViews([observedManualCase[1]!]);
  assert.equal(note?.kind, "note");
  assert.equal("quantity" in note!, false);
  assert.equal("rate" in note!, false);
  assert.equal("amount" in note!, false);

  const noteBranch = detail.slice(
    detail.indexOf('{line.kind === "note"'),
    detail.indexOf('{line.kind === "extra_charge"'),
  );
  assert.match(noteBranch, /line\.typeLabel/);
  assert.match(noteBranch, /line\.particulars/);
  assert.doesNotMatch(noteBranch, /line\.quantity|line\.rate|line\.amount|formatSalesMoney/);
});

test("direct and calculated Extra Charges retain authoritative persisted values", () => {
  const direct: ChallanFlexibleLine = {
    id: "charge-direct",
    factoryId: "factory-a",
    challanId: "challan-a",
    lineType: "EXTRA_CHARGE",
    lineCategory: "OTHER_REVENUE",
    orderIndex: 0,
    particulars: "Loading",
    quantity: null,
    rate: null,
    amount: 2000,
    createdAt: "2026-08-31T10:00:00Z",
  };
  const views = getSavedChallanFlexibleLineViews([direct, observedManualCase[0]!]);
  assert.deepEqual(views.map((line) => line.kind === "extra_charge"
    ? [line.particulars, line.quantity, line.rate, line.amount]
    : []), [
    ["Loading", null, null, 2000],
    ["Engine Oil", 2.5, 400, 1000],
  ]);
  assert.match(detail, /line\.quantity !== null && line\.rate !== null/);
  assert.match(detail, /formatSalesMoney\(line\.amount\)/);
});

test("multiple flexible rows preserve order_index instead of sorting by type or text", () => {
  const rows: ChallanFlexibleLine[] = [
    { ...observedManualCase[1]!, id: "note-z", orderIndex: 3, particulars: "Z note" },
    { ...observedManualCase[0]!, id: "charge-a", orderIndex: 2, particulars: "A charge" },
    { ...observedManualCase[1]!, id: "note-a", orderIndex: 1, particulars: "A note" },
    { ...observedManualCase[0]!, id: "charge-z", orderIndex: 0, particulars: "Z charge" },
  ];
  assert.deepEqual(
    getSavedChallanFlexibleLineViews(rows).map((line) => line.particulars),
    ["Z charge", "A note", "A charge", "Z note"],
  );
  assert.match(service, /\.order\("order_index", \{ ascending: true \}\)/);
});

test("brick-only, manual-only, and cleared saved views remain explicit", () => {
  assert.deepEqual(getSavedChallanFlexibleLineViews([]), []);
  assert.match(detail, /challan\.items\.length === 0[\s\S]*No brick lines/);
  assert.match(detail, /flexibleLines\.length === 0[\s\S]*No additional lines or notes/);
  assert.match(detail, /flexibleLines\.map/);
  assert.match(detail, /Authoritative Challan total[\s\S]*challan\.challanTotal/);
});

test("C1 editing, locks, voids, and A5 reporting remain unchanged", () => {
  assert.match(editorModel, /flexibleLines: \[\.\.\.challan\.flexibleLines\]/);
  assert.match(editorModel, /if \(challan\.isLocked\).*canEdit: false/);
  assert.match(detail, /challan\.status === "void"/);
  assert.match(register, /brickRevenue[\s\S]*otherRevenue[\s\S]*totalRevenue/);
  assert.doesNotMatch(detail, /insert\(|update\(|delete\(/);
});

test("Correction D reuses C1.1 saved lines without changing its Office behavior", () => {
  assert.match(printModel, /challan\.flexibleLines/);
  assert.match(printScreen, /line\.lineKind === "NOTE"/);
  assert.match(printScreen, /data-challan-line="extra-charge"|"extra-charge"/);
  for (const source of [detail, editorModel, service]) {
    assert.doesNotMatch(source, /OTHER_GOODS|driver master|fleet tracking|profitability/i);
  }
});
