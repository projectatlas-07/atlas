import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const drawer = readFileSync(new URL(
  "../office/components/coal-seller-payment-detail-drawer.tsx",
  import.meta.url,
), "utf8");
const navigation = readFileSync(new URL(
  "../office/office-navigation.ts",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("./coal-purchase-model.ts", import.meta.url), "utf8");

test("All Seller Payments is a nested hash-addressable Seller Payments view", () => {
  assert.match(navigation, /OFFICE_COAL_SELLER_PAYMENTS_ARCHIVE_HASH = "#all-seller-payments"/);
  assert.match(navigation, /value === "all-seller-payments"\) return "seller-payments"/);
  assert.match(component, /window\.location\.hash === getOfficeCoalSellerPaymentsArchiveHash\(\)/);
  assert.match(component, /onClick=\{openPaymentArchive\}>View all payments →/);
  assert.match(component, /← Back to Seller Payments/);
  assert.match(component, /window\.location\.hash = getOfficeCoalHash\("seller-payments"\)/);
});

test("archive reuses one grouped payment query and model-owned filtering", () => {
  assert.equal((component.match(/listCoalPayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archivePayments = filterCoalPayments\(/);
  assert.match(model, /paymentMode: CoalPayment\["paymentMode"\] \| ""/);
  assert.match(model, /payment\.sellerNameSnapshot[\s\S]*payment\.note[\s\S]*payment\.allocations\.flatMap/);
  for (const label of ["Search payments", "From", "To", "Seller"]) {
    assert.match(component, new RegExp(`label="${label}"`));
  }
  assert.match(component, /label=\{ATLAS_UI_STRINGS\.payment\.mode\}/);
});

test("archive exposes only genuine Seller Payment columns in a bounded table", () => {
  for (const column of ["Seller", "Allocated Purchases", "Action"]) {
    assert.match(component, new RegExp(`<TableHeaderCell(?: numeric)?>${column}</TableHeaderCell>`));
  }
  for (const shared of ["payment.date", "fields.amount", "payment.mode", "fields.note"]) {
    assert.match(component, new RegExp(`ATLAS_UI_STRINGS\\.${shared.replace(".", "\\.")}`));
  }
  assert.match(component, /<TableContainer bounded aria-label="All Seller Payments table">/);
  assert.match(component, /<TableHeader sticky>/);
  assert.match(component, /Open payment →/);
  assert.doesNotMatch(component, /Seller Payment ID|sync status|audit metadata/i);
});

test("payment drawer is accessible, read-only, and renders exact saved allocations", () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, /payment\.allocations\.map/);
  for (const field of [
    "sellerNameSnapshot", "paymentDate", "amount", "paymentMode", "note",
    "purchaseDate", "coalChallanNumber", "coalNameSnapshot",
    "sourceLocationSnapshot", "allocatedAmount",
  ]) assert.match(drawer, new RegExp(`\\.${field}`));
  assert.doesNotMatch(drawer, /(?:edit|delete|void|reverse|save)Payment|type="submit"/i);
});

test("drawer reconciliation uses persisted allocations and can open existing purchase detail", () => {
  assert.match(drawer, /getCoalPaymentAllocationReconciliation\(payment\)/);
  assert.match(model, /payment\.allocations\.reduce/);
  assert.doesNotMatch(drawer, /outstandingAmount|totalPaid|listCoalPurchases|\.from\(|\.rpc\(/);
  assert.match(drawer, /onOpenPurchase\(allocation\.purchaseId\)/);
  assert.match(drawer, /canOpenPurchase\(allocation\.purchaseId\)/);
  assert.match(component, /return purchases\.some\(\(purchase\) => purchase\.id === purchaseId\)/);
  assert.match(component, /setSelectedId\(purchaseId\)/);
  assert.match(component, /window\.location\.hash = getOfficeCoalHash\("coal-purchases"\)/);
});

test("drawer uses Atlas V2 tokens and primitives without a parallel visual system", () => {
  for (const primitive of ["Button", "Card", "Feedback"]) assert.match(drawer, new RegExp(`<${primitive}\\b`));
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
  assert.doesNotMatch(drawer, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});
