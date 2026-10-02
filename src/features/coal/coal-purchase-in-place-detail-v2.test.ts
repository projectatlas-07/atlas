import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const coal = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const sales = readFileSync(new URL(
  "../office/components/sales-office-section.tsx",
  import.meta.url,
), "utf8");

test("Coal mirrors the Sales history-to-primary-detail transition", () => {
  assert.match(sales, /function openChallan\(challanId: string\)[\s\S]*setSelectedChallanId\(challanId\);[\s\S]*setMode\("detail"\)/);
  assert.match(sales, /onOpen=\{\(challanId\) => \{[\s\S]*openChallan\(challanId\);[\s\S]*setChallansView\("main"\)/);

  assert.match(coal, /function openPurchaseDetail\(purchaseId: string\)/);
  assert.match(coal, /setSelectedId\(purchaseId\);[\s\S]*setEditingId\(""\);[\s\S]*setShowPurchaseArchive\(false\)/);
  assert.match(coal, /window\.location\.hash = getOfficeCoalHash\("coal-purchases"\)/);
  assert.equal((coal.match(/onClick=\{\(\) => openPurchaseDetail\(purchase\.id\)\}/g) ?? []).length, 2);
});

test("selected purchase replaces the creation form inside one primary work area", () => {
  assert.match(coal, /<Card as="section" aria-label="Coal Purchase work area">/);
  assert.match(coal, /\{\(!selected \|\| editingId\) && <form onSubmit=\{savePurchase\}>/);
  assert.match(coal, /\{selected && !editingId && <CoalPurchaseDetail/);
  assert.match(coal, /<article aria-labelledby="saved-coal-purchase-heading"/);
  assert.doesNotMatch(coal, /activeArea === "coal-purchases" && selected && <section/);
  assert.doesNotMatch(coal, /rounded-xl border border-stone-300 bg-white p-5 shadow-sm/);
});

test("selected detail preserves genuine Coal data and authoritative actions", () => {
  for (const field of [
    "purchaseDate", "sellerNameSnapshot", "sellerAddressSnapshot", "sellerMobileSnapshot",
    "coalNameSnapshot", "sourceLocationSnapshot", "coalChallanNumber", "vehicleNumberSnapshot",
    "quantity", "rate", "coalAmount", "separateFreightAmount", "finalTotal", "totalPaid",
    "outstandingAmount",
  ]) assert.match(coal, new RegExp(`purchase\\.${field}`));

  assert.match(coal, /disabled=\{!canChangeCoalPurchase\(selected\)\} onClick=\{\(\) => openEdit\(selected\)\}>Correct/);
  assert.match(coal, /variant="danger" disabled=\{!canChangeCoalPurchase\(selected\)\} onClick=\{\(\) => setConfirmingVoid\(true\)\}>Void/);
  assert.match(coal, /disabled=\{selected\.status !== "active" \|\| selected\.outstandingAmount <= 0\} onClick=\{\(\) => openPayment\(selected\)\}>Pay Seller/);
  assert.match(coal, /await voidCoalPurchase\(factoryId, selected\.id\)/);
  assert.match(coal, /buildUpdateCoalPurchaseInput\(factoryId, editingId, form\)/);
});

test("New Coal Purchase returns from detail or correction to a clean creation form", () => {
  assert.match(coal, /function openCreate\(\)[\s\S]*setForm\(emptyCoalPurchaseForm\(localToday\)\);[\s\S]*setEditingId\(""\);[\s\S]*setSelectedId\(""\)/);
  assert.match(coal, /<Button type="button" onClick=\{openCreate\}>New Coal Purchase<\/Button>/);
  assert.doesNotMatch(coal, /Create Challan/);
});

test("in-place detail uses Atlas V2 primitives and tokens", () => {
  const detail = coal.slice(coal.indexOf("function CoalPurchaseDetail"));
  for (const primitive of ["Button", "Card", "Feedback"]) {
    assert.match(detail, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(detail, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
  assert.doesNotMatch(detail, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});
