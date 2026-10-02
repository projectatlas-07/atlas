import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("../office/components/expenses-office-section.tsx", import.meta.url),
  "utf8",
);

const paymentEditor = component.slice(
  component.indexOf("function ExpensePaymentEditor"),
  component.indexOf("function RecentCosts"),
);
const recentPayments = component.slice(
  component.indexOf("function RecentOutgoingPayments"),
  component.indexOf("function PaymentMetric"),
);
const savePayment = component.slice(
  component.indexOf("async function savePayment"),
  component.indexOf("function selectCostsOutgoingsArea"),
);

test("Outgoing Payments makes one payment form always visible", () => {
  assert.match(component, /costsOutgoingsArea === "outgoing-payments" && !showPaymentsArchive && <div className="max-w-6xl">/);
  assert.match(component, /<ExpensePaymentEditor[\s\S]*<RecentOutgoingPayments/);
  assert.doesNotMatch(component, /showPaymentForm|setShowPaymentForm/);
  assert.match(paymentEditor, /Payment Details/);
  assert.match(paymentEditor, /Outstanding Costs/);
});

test("payment details expose only the authoritative payment fields", () => {
  for (const label of [
    "Payment date",
    "Payment amount",
    "Payment mode",
    "Reference / note (optional)",
  ]) {
    assert.ok(paymentEditor.includes(label));
  }
  assert.match(paymentEditor, /NEW_CUSTOMER_PAYMENT_MODES\.map/);
  assert.doesNotMatch(paymentEditor, /ledger|\bERP\b|sync status|audit metadata/i);
});

test("eligible costs and allocations remain explicit and authoritative", () => {
  assert.match(component, /const candidates = getExpensePaymentCandidates\(records\)/);
  assert.match(paymentEditor, /Nothing is selected automatically/);
  assert.match(paymentEditor, /toggleExpensePaymentAllocation\(current, record, event\.target\.checked\)/);
  assert.match(paymentEditor, /isInteractiveExpensePaymentRowTarget\(event\.target\)/);
  assert.match(paymentEditor, /!Object\.prototype\.hasOwnProperty\.call\(current\.allocations, record\.id\)/);
  assert.match(paymentEditor, /cursor-pointer/);
  assert.match(paymentEditor, /form\.allocations\[record\.id\]/);
  assert.match(paymentEditor, /setExpensePaymentAllocation\(current, record\.id, event\.target\.value\)/);
  assert.match(paymentEditor, /"a, button, input, select, textarea, label, summary/);
  assert.match(paymentEditor, /record\.totalAmount/);
  assert.match(paymentEditor, /record\.outstandingAmount/);
  assert.match(paymentEditor, /record\.counterpartyNameSnapshot/);
  assert.match(paymentEditor, /record\.description/);
  assert.doesNotMatch(paymentEditor, /Use outstanding|fillExpenseOutstandingAllocation/);
});

test("reconciliation and submission reuse the existing model and controlled service", () => {
  assert.match(component, /getExpensePaymentFormStatus\(paymentForm, candidates\)/);
  assert.match(paymentEditor, /<PaymentMetric label="Payment" value=\{status\.paymentAmount\}/);
  assert.match(paymentEditor, /<PaymentMetric label="Allocated" value=\{status\.allocatedAmount\}/);
  assert.match(paymentEditor, /<PaymentMetric label="Remaining" value=\{status\.remainingAmount\}/);
  assert.match(paymentEditor, /disabled=\{!status\.canSubmit\}/);
  assert.match(paymentEditor, />Save Payment<\/Button>/);
  assert.match(paymentEditor, /aria-label="Payment reconciliation"/);
  assert.match(paymentEditor, /sticky bottom-atlas-0/);
  assert.match(paymentEditor, /max-h-96[^\"]*overflow-y-auto/);
  assert.equal((paymentEditor.match(/>Save Payment<\/Button>/g) ?? []).length, 1);
  assert.match(savePayment, /buildExpensePaymentInput\(factoryId, paymentForm, candidates\)/);
  assert.match(savePayment, /await createExpensePayment\(input\)/);
  assert.match(savePayment, /\["office-cash-book-day", factoryId\]/);
});

test("Cost detail handoff switches to the shared form without implicit selection", () => {
  const handoff = component.slice(
    component.indexOf("onRecordPayment={() =>"),
    component.indexOf("onClose={() =>", component.indexOf("onRecordPayment={() =>")),
  );
  assert.match(handoff, /selectCostsOutgoingsArea\("outgoing-payments"\)/);
  assert.doesNotMatch(handoff, /toggleExpensePaymentAllocation|setExpensePaymentAllocation|setPaymentForm/);
});

test("Recent Outgoing Payments is bounded, scrollable, and opens the archive", () => {
  assert.match(component, /const recentPayments = payments\.slice\(0, 10\)/);
  assert.match(recentPayments, /flex h-96 flex-col/);
  assert.match(recentPayments, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(recentPayments, /payment\.allocations\.slice\(0, 2\)\.map/);
  assert.match(recentPayments, /payment\.paymentDate/);
  assert.match(recentPayments, /payment\.paymentMode/);
  assert.match(recentPayments, /payment\.amount/);
  assert.match(recentPayments, /allocation\.counterpartyNameSnapshot/);
  assert.match(recentPayments, /onClick=\{onViewAll\}>View all payments →/);
  assert.match(component, /onViewAll=\{openPaymentsArchive\}/);
});

test("the redesigned payment surface uses Atlas primitives and tokens", () => {
  for (const primitive of ["<Card", "<FormField", "<Input", "<Select", "<Checkbox", "<Button", "<Feedback"]) {
    assert.match(`${paymentEditor}${recentPayments}`, new RegExp(primitive.replace("<", "\\<")));
  }
  assert.doesNotMatch(`${paymentEditor}${recentPayments}`, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(`${paymentEditor}${recentPayments}`, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
});
