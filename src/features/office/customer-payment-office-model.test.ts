import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChallanHeader, CustomerOutstandingChallan, CustomerPayment } from "@/features/sales/types";
import {
  applyPaymentLocks,
  buildCustomerPaymentInput,
  emptyCustomerPaymentForm,
  getCustomerPaymentFormStatus,
  setPaymentAmount,
  togglePaymentAllocation,
  fillOutstandingAllocation,
} from "./customer-payment-office-model.ts";

const candidates: CustomerOutstandingChallan[] = [{
  challanId: "challan-1",
  challanNumber: 41,
  challanDate: "2026-08-25",
  challanStatus: "active",
  saleTotal: 10_000,
  totalPaid: 2_000,
  outstandingAmount: 8_000,
  paymentState: "partially_paid",
  isLocked: true,
}, {
  challanId: "challan-2",
  challanNumber: 42,
  challanDate: "2026-08-26",
  challanStatus: "active",
  saleTotal: 5_000,
  totalPaid: 0,
  outstandingAmount: 5_000,
  paymentState: "unpaid",
  isLocked: false,
}];

test("payment amount never auto-allocates to the oldest Challan", () => {
  const empty = emptyCustomerPaymentForm("2026-08-27");
  const changed = setPaymentAmount(empty, "8000");
  assert.deepEqual(changed.allocations, {});
  assert.equal(getCustomerPaymentFormStatus(changed, candidates).canSubmit, false);
});

test("explicit one or multiple Challan allocations must exactly equal payment", () => {
  let form = { ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "10000"), paymentMode: "cash" };
  form = fillOutstandingAllocation(form, candidates[0]!);
  assert.equal(getCustomerPaymentFormStatus(form, candidates).remainingAmount, 2_000);
  assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, false);

  form = togglePaymentAllocation(form, "challan-2", true);
  form = { ...form, allocations: { ...form.allocations, "challan-2": "2000" } };
  const status = getCustomerPaymentFormStatus(form, candidates);
  assert.deepEqual(status, {
    paymentAmount: 10_000,
    allocatedAmount: 10_000,
    remainingAmount: 0,
    canSubmit: true,
    error: "",
  });
  assert.deepEqual(buildCustomerPaymentInput("factory-a", "customer-a", form, candidates)?.allocations, [
    { challanId: "challan-1", amount: 8_000 },
    { challanId: "challan-2", amount: 2_000 },
  ]);
});

test("one Challan accepts either a partial payment or its full outstanding amount", () => {
  for (const amount of ["3000", "8000"]) {
    const form = {
      ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), amount),
      paymentMode: "upi",
      allocations: { "challan-1": amount },
    };
    assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, true);
  }
});

test("zero, negative, invalid, and over-outstanding allocations cannot submit", () => {
  for (const amount of ["0", "-1", "8000.001", "8000.01"]) {
    const form = {
      ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), amount === "8000.01" ? "8000.01" : "8000"),
      paymentMode: "cash",
      allocations: { "challan-1": amount },
    };
    assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, false);
  }
});

test("new customer payments require a supported persisted payment mode", () => {
  const base = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    allocations: { "challan-1": "3000" },
  };
  assert.equal(getCustomerPaymentFormStatus(base, candidates).canSubmit, false);
  const withMode = { ...base, paymentMode: "bank_transfer" };
  assert.equal(getCustomerPaymentFormStatus(withMode, candidates).canSubmit, true);
  assert.equal(
    buildCustomerPaymentInput("factory-a", "customer-a", withMode, candidates)?.paymentMode,
    "bank_transfer",
  );
});

test("successful payment locks only affected Challans and preserves unrelated object state", () => {
  const headers = [
    { id: "challan-1", isLocked: false },
    { id: "challan-2", isLocked: false },
  ] as ChallanHeader[];
  const payment = {
    allocations: [{ challanId: "challan-1" }],
  } as CustomerPayment;
  const next = applyPaymentLocks(headers, payment);
  assert.equal(next[0]?.isLocked, true);
  assert.strictEqual(next[1], headers[1]);
});
