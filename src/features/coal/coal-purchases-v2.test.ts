import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const searchChoice = readFileSync(new URL(
  "../office/components/search-choice.tsx",
  import.meta.url,
), "utf8");

test("Coal Purchases makes the existing purchase form the primary experience", () => {
  assert.match(component, /activeArea === "coal-purchases" && !showPurchaseArchive && <>/);
  assert.match(component, /id="new-coal-purchase-heading"/);
  assert.match(component, /<form onSubmit=\{savePurchase\}>/);
  assert.doesNotMatch(component, /showForm|setShowForm/);
  for (const field of [
    "Seller", "Business date", "Coal", "Source", "Coal Challan No. (optional)",
    "Vehicle Number", "Quantity", "Rate", "Coal Amount", "Separate Delivery Charge",
    "Paid now (blank or 0 = unpaid)", "Payment mode", "Final Total",
  ]) assert.match(component, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Coal math, freight, save, correction, and paid-now remain model and service owned", () => {
  assert.match(component, /setForm\(updateCoalMeasurement\(form, field, event\.target\.value\)\)/);
  assert.match(component, /const finalTotal = getCoalFinalTotal\(form\)/);
  assert.match(component, /buildCreateCoalPurchaseInput\(factoryId, form\)/);
  assert.match(component, /buildUpdateCoalPurchaseInput\(factoryId, editingId, form\)/);
  assert.match(component, /createCoalPurchase\(input\)/);
  assert.match(component, /updateCoalPurchase\(input\)/);
  assert.match(component, /voidCoalPurchase\(factoryId, selected\.id\)/);
  assert.match(component, /hasSeparateFreight: event\.target\.checked, separateFreightAmount: ""/);
  assert.match(component, /initialPaidAmount: event\.target\.value/);
  assert.match(component, /\["office-cash-book-day", factoryId\]/);
});

test("Coal inline add controls share one mutually-exclusive toggle state", () => {
  assert.match(component, /const \[inlineEditor, setInlineEditor\] = useState<CoalInlineEditor \| null>\(null\)/);
  assert.match(component, /const opening = inlineEditor !== editor/);
  assert.match(component, /setInlineEditor\(opening \? editor : null\)/);
  assert.match(component, /onClick=\{\(\) => toggleInlineEditor\("seller"\)\}>Add Seller/);
  assert.match(component, /onClick=\{\(\) => toggleInlineEditor\("coal_name"\)\}>Add Coal/);
  assert.match(component, /onClick=\{\(\) => toggleInlineEditor\("source_location"\)\}>Add Source/);
  assert.match(component, /inlineEditor === "seller" && <fieldset/);
  assert.match(component, /const referenceKind = inlineEditor === "coal_name" \|\| inlineEditor === "source_location"/);
  assert.doesNotMatch(component, /showSellerDraft|setShowSellerDraft|setReferenceKind/);
});

test("Coal inline editor save and cancel preserve existing selection and refresh behaviour", () => {
  assert.match(component, /createOrAssignSupplierRole\(/);
  assert.match(component, /createCoalReferenceValue\(factoryId, referenceKind, referenceDraft\)/);
  assert.match(component, /setForm\(\(current\) => \(\{ \.\.\.current, sellerId: saved\.id \}\)\)/);
  assert.match(component, /\[referenceKind === "coal_name" \? "coalNameReferenceId" : "sourceReferenceId"\]: saved\.id/);
  assert.match(component, /setInlineEditor\(\(current\) => current === "seller" \? null : current\)/);
  assert.match(component, /setInlineEditor\(\(current\) => current === referenceKind \? null : current\)/);
  assert.match(component, /variant="ghost" onClick=\{\(\) => setInlineEditor\(null\)\}/);
  assert.match(component, /invalidateQueries\(\{ queryKey: suppliersKey\(factoryId\) \}\)/);
  assert.match(component, /invalidateQueries\(\{ queryKey: referencesKey\(factoryId\) \}\)/);
  assert.doesNotMatch(component, /toggleInlineEditor\([\s\S]{0,120}setForm/);
});

test("recent purchases are secondary, bounded, scrollable, and reuse purchase detail", () => {
  assert.match(component, /const recentPurchases = purchases\.slice\(0, 6\)/);
  assert.match(component, /Recent Coal Purchases/);
  assert.match(component, /className="flex h-96 flex-col"/);
  assert.match(component, /className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(component, /onClick=\{\(\) => openPurchaseDetail\(purchase\.id\)\}/);
  assert.match(component, /selected && !editingId && <CoalPurchaseDetail/);
  assert.match(component, /onClick=\{openPurchaseArchive\}>View all purchases →/);
  assert.match(component, /View all purchases →/);
});

test("Coal Purchases uses Atlas V2 primitives and stacks before the desktop breakpoint", () => {
  assert.match(component, /<Card as="section" aria-label="Coal Purchase work area">/);
  assert.match(component, /<Input/);
  assert.match(component, /<Select/);
  assert.match(component, /<Checkbox/);
  assert.match(component, /<Feedback/);
  assert.match(component, /grid items-start gap-atlas-4 lg:grid-cols-3/);
  assert.match(component, /lg:col-span-2/);
  assert.equal((component.match(/<SearchChoice v2/g) ?? []).length, 4);
  assert.match(searchChoice, /v2\s+\? <Input role="combobox"/);
  assert.match(searchChoice, /: <input role="combobox"[\s\S]*className=\{inputClass\}/);
});

test("Seller Payments keeps its authoritative workflow separate from Coal Purchases", () => {
  assert.match(component, /activeArea === "seller-payments" && !showPaymentArchive && <>/);
  assert.match(component, /buildCoalSelectivePaymentInput\(factoryId, paymentForm, purchases\)/);
  assert.match(component, /createCoalSelectivePayment\(input\)/);
  assert.match(component, /Recent Seller Payments/);
  assert.match(component, /payment\.allocations\.map/);
});
