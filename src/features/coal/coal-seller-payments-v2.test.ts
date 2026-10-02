import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("./coal-purchase-model.ts", import.meta.url), "utf8");

test("Seller Payments is an always-visible primary workflow with authoritative seller totals", () => {
  assert.match(component, /activeArea === "seller-payments" && !showPaymentArchive && <>/);
  assert.doesNotMatch(component, /\[showPayment, setShowPayment\]/);
  assert.match(component, /<form onSubmit=\{savePayment\}/);
  assert.match(component, /const sellerSummary = summarizeCoalPurchases/);
  assert.match(component, /label="Purchased" value=\{sellerSummary\.totalPurchased\}/);
  assert.match(component, /label="Paid" value=\{sellerSummary\.totalPaid\}/);
  assert.match(component, /label="Outstanding" value=\{sellerSummary\.totalOutstanding\}/);
});

test("payment amount and allocation reconciliation stay in the Coal model", () => {
  assert.match(model, /paymentAmount: number/);
  assert.match(model, /allocatedAmount: number/);
  assert.match(model, /remainingAmount: number/);
  assert.match(model, /const remainingPaise = safePaymentPaise - selectedPaise/);
  assert.match(model, /Allocate the full payment amount before saving/);
  assert.match(model, /Allocated amount cannot exceed the payment amount/);
  assert.match(model, /amount: formatCoalAllocationTotal\(allocations\)/);
  assert.match(component, /setCoalSettlementPaymentAmount\(current, event\.target\.value\)/);
  assert.match(component, /setCoalSettlementAllocation\(current, purchase\.id, event\.target\.value\)/);
  assert.match(component, /label="Payment" value=\{paymentStatus\.paymentAmount\}/);
  assert.match(component, /label="Allocated" value=\{paymentStatus\.allocatedAmount\}/);
  assert.match(component, /label="Remaining" value=\{paymentStatus\.remainingAmount\}/);
});

test("outstanding purchase selection stays explicit while selection fills and reconciles its allocation", () => {
  assert.match(component, /getEligibleCoalSettlementPurchases/);
  assert.match(component, /Nothing is selected automatically/);
  assert.match(component, /<Checkbox[\s\S]*toggleCoalSettlementPurchase\(current, purchase, event\.target\.checked\)/);
  assert.match(component, /label="Allocation amount"/);
  assert.doesNotMatch(component, /Use outstanding/);
  assert.match(component, /disabled=\{!paymentStatus\.canSubmit\}/);
  assert.match(component, /buildCoalSelectivePaymentInput\(factoryId, paymentForm, purchases\)/);
  assert.match(component, /createCoalSelectivePayment\(input\)/);
});

test("purchase detail Pay Seller keeps its explicit prefill", () => {
  assert.match(component, /next\.sellerId = purchase\.sellerId/);
  assert.match(component, /next\.fromDate = purchase\.purchaseDate/);
  assert.match(component, /next\.toDate = purchase\.purchaseDate/);
  assert.match(component, /next\.amount = String\(purchase\.outstandingAmount\)/);
  assert.match(component, /next\.allocations\[purchase\.id\] = String\(purchase\.outstandingAmount\)/);
  assert.match(component, /selectCoalArea\("seller-payments"\)/);
});

test("recent Seller Payments are bounded, scrollable, seller-aware, and expandable", () => {
  assert.match(component, /const recentSellerPayments = payments[\s\S]*\.slice\(0, 6\)/);
  assert.match(component, /Recent Seller Payments/);
  assert.match(component, /className="flex h-96 flex-col"/);
  assert.match(component, /className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(component, /setSelectedPaymentId/);
  assert.match(component, /payment\.allocations\.map/);
  assert.match(component, /onClick=\{openPaymentArchive\}>View all payments →/);
});

test("Seller Payments uses the V2 primitives and stacks before desktop", () => {
  assert.match(component, /grid items-start gap-atlas-4 lg:grid-cols-3/);
  assert.match(component, /space-y-atlas-4 lg:col-span-2/);
  assert.match(component, /<SearchChoice v2 label="Coal Seller"/);
  assert.match(component, /<Card as="section" aria-labelledby="seller-summary-heading">/);
  assert.match(component, /<Input/);
  assert.match(component, /<Select/);
  assert.match(component, /<Checkbox/);
  assert.match(component, /<Feedback/);
});
