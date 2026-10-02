import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const navigation = readFileSync(new URL(
  "../office/office-navigation.ts",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("./coal-purchase-model.ts", import.meta.url), "utf8");

test("All Coal Purchases is a nested hash-addressable Coal Purchases view", () => {
  assert.match(navigation, /OFFICE_COAL_PURCHASES_ARCHIVE_HASH = "#all-coal-purchases"/);
  assert.match(navigation, /value === "coal" \|\| value === "all-coal-purchases"/);
  assert.match(component, /window\.location\.hash === getOfficeCoalPurchasesArchiveHash\(\)/);
  assert.match(component, /onClick=\{openPurchaseArchive\}>View all purchases →/);
  assert.match(component, /← Back to Coal Purchases/);
  assert.match(component, /window\.location\.hash = getOfficeCoalHash\("coal-purchases"\)/);
});

test("archive reuses one loaded history and the authoritative model filters and totals", () => {
  assert.equal((component.match(/listCoalPurchases\(factoryId\)/g) ?? []).length, 1);
  assert.match(component, /const archivePurchases = filterCoalPurchases\(/);
  assert.match(component, /const archiveSummary = summarizeCoalPurchases\(archivePurchases\)/);
  assert.match(model, /purchase\.sellerNameSnapshot[\s\S]*purchase\.coalNameSnapshot[\s\S]*purchase\.sourceLocationSnapshot[\s\S]*purchase\.coalChallanNumber[\s\S]*purchase\.vehicleNumberSnapshot/);
  for (const label of ["Search purchases", "From", "To", "Seller", "Payment status"]) {
    assert.match(component, new RegExp(`label="${label}"`));
  }
});

test("archive exposes genuine Coal columns in a bounded wide table", () => {
  for (const column of [
    "Date", "Seller", "Coal", "Source", "Challan", "Vehicle", "Quantity",
    "Rate", "Coal Amount", "Freight", "Total", "Paid", "Status", "Action",
  ]) assert.match(component, new RegExp(`<TableHeaderCell(?: numeric)?>${column}</TableHeaderCell>`));
  assert.match(component, /<TableHeaderCell numeric>\{ATLAS_UI_STRINGS\.payment\.outstanding\}<\/TableHeaderCell>/);
  assert.match(component, /<TableContainer bounded aria-label="All Coal Purchases table">/);
  assert.match(component, /<Table wide>/);
  assert.match(component, /<TableHeader sticky>/);
  assert.doesNotMatch(component, /numbered pagination|Page \{.*\} of/i);
});

test("Open reuses existing detail, correction, void, and payment authority", () => {
  assert.match(component, /onClick=\{\(\) => openPurchaseDetail\(purchase\.id\)\}/);
  assert.match(component, /setShowPurchaseArchive\(false\)/);
  assert.match(component, /window\.location\.hash = getOfficeCoalHash\("coal-purchases"\)/);
  assert.match(component, /selected && !editingId && <CoalPurchaseDetail/);
  assert.match(component, /disabled=\{!canChangeCoalPurchase\(selected\)\}/);
  assert.match(component, /voidCoalPurchase\(factoryId, selected\.id\)/);
  assert.match(component, /onClick=\{\(\) => openPayment\(selected\)\}/);
  assert.match(component, /setSelectedId\(purchase\.id\);[\s\S]*setEditingId\(purchase\.id\);[\s\S]*closePurchaseArchive\(\)/);
});

test("All Seller Payments stays a separate archive route", () => {
  assert.match(navigation, /OFFICE_COAL_SELLER_PAYMENTS_ARCHIVE_HASH = "#all-seller-payments"/);
  assert.match(component, /onClick=\{openPaymentArchive\}>View all payments →/);
});
