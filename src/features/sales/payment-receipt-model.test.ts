import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { CustomerPayment } from "@/features/sales/types";
import { buildPrintablePaymentReceipt } from "./payment-receipt-model.ts";

const screenSource = readFileSync(new URL("./components/payment-receipt-screen.tsx", import.meta.url), "utf8");
const documentSource = screenSource.slice(screenSource.indexOf("export function PaymentReceiptDocument"));
const routeSource = readFileSync(new URL("../../app/office/payments/[paymentId]/page.tsx", import.meta.url), "utf8");
const officeSource = readFileSync(new URL("../office/components/customer-payments-section.tsx", import.meta.url), "utf8");

const payment: CustomerPayment = {
  id: "internal-payment-id",
  factoryId: "internal-factory-id",
  customerId: "internal-customer-id",
  customerNameSnapshot: "Customer A at payment",
  customerAddressSnapshot: "Customer address at payment",
  customerMobileSnapshot: "9000000001",
  companyNameSnapshot: "Company A at payment",
  companyBusinessDescriptionSnapshot: "Brick works at payment",
  companyAddressSnapshot: "Factory address at payment",
  companyMobileSnapshot: "9000000002",
  paymentDate: "2026-08-27",
  amount: 8_000,
  paymentMode: "upi",
  note: "Bank transfer",
  createdAt: "2026-08-27T10:00:00Z",
  allocations: [{
    id: "internal-allocation-1", factoryId: "internal-factory-id", paymentId: "internal-payment-id",
    challanId: "internal-challan-1", challanNumber: 41, allocatedAmount: 5_000, createdAt: "2026-08-27T10:00:00Z",
  }, {
    id: "internal-allocation-2", factoryId: "internal-factory-id", paymentId: "internal-payment-id",
    challanId: "internal-challan-2", challanNumber: 42, allocatedAmount: 3_000, createdAt: "2026-08-27T10:00:00Z",
  }],
};

test("receipt uses payment-time company and customer snapshots", () => {
  const receipt = buildPrintablePaymentReceipt(payment);
  assert.equal(receipt.company.name, "Company A at payment");
  assert.equal(receipt.customer.name, "Customer A at payment");
  assert.equal(receipt.company.address, "Factory address at payment");
  assert.equal(receipt.customer.address, "Customer address at payment");
  assert.equal(receipt.paymentMode, "upi");
});

test("one multi-allocation payment produces one receipt containing every Challan", () => {
  const receipt = buildPrintablePaymentReceipt(payment);
  assert.equal(receipt.amount, 8_000);
  assert.deepEqual(receipt.allocations, [
    { challanNumber: 41, amount: 5_000 },
    { challanNumber: 42, amount: 3_000 },
  ]);
  assert.match(documentSource, /receipt\.allocations\.map/);
});

test("customer-facing receipt excludes internal IDs, locks, and accounting internals", () => {
  const serialized = JSON.stringify(buildPrintablePaymentReceipt(payment));
  assert.doesNotMatch(serialized, /internal-|isLocked|accounting|factoryId|customerId|paymentId/i);
  assert.doesNotMatch(documentSource, /paymentId|factoryId|customerId|isLocked|accounting|database/i);
});

test("authenticated receipt route supports browser print and Save as PDF", () => {
  assert.match(routeSource, /<AuthGuard>/);
  assert.match(officeSource, /\/office\/payments\/\$\{payment\.id\}/);
  assert.match(screenSource, /window\.print\(\)/);
  assert.match(screenSource, /Download PDF/);
  assert.match(screenSource, /Save as PDF/);
  assert.match(documentSource, /Customer&amp;apos;s Signature|Customer&apos;s Signature/);
  assert.match(documentSource, /Manager&amp;apos;s Signature|Manager&apos;s Signature/);
});
