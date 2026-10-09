import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildChallanReceivedPayment,
  emptyChallanReceivedPaymentForm,
  getChallanReceivedPaymentError,
} from "../office/sales-office-model.ts";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260919000063_create_challan_with_received_payment.sql",
    import.meta.url,
  ),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_paid_now.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const supabaseTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");

test("Pay Later is the default and creates no received-payment payload", () => {
  const form = emptyChallanReceivedPaymentForm("2026-09-19");
  assert.deepEqual(form, {
    choice: "pay_later",
    paymentDate: "2026-09-19",
    amount: "",
    paymentMode: "",
  });
  assert.equal(getChallanReceivedPaymentError(form, 96_000), null);
  assert.equal(buildChallanReceivedPayment(form, 96_000), null);
});

test("Received Now accepts full and partial receipts but rejects zero and overpayment", () => {
  const base = {
    choice: "received_now" as const,
    paymentDate: "2026-09-19",
    paymentMode: "upi",
  };
  assert.deepEqual(buildChallanReceivedPayment({ ...base, amount: "96000" }, 96_000), {
    paymentDate: "2026-09-19",
    amount: 96_000,
    paymentMode: "upi",
  });
  assert.deepEqual(buildChallanReceivedPayment({ ...base, amount: "50000" }, 96_000), {
    paymentDate: "2026-09-19",
    amount: 50_000,
    paymentMode: "upi",
  });
  assert.equal(
    getChallanReceivedPaymentError({ ...base, amount: "0" }, 96_000),
    "Enter a positive amount received.",
  );
  assert.equal(
    getChallanReceivedPaymentError({ ...base, amount: "96000.01" }, 96_000),
    "Amount received cannot exceed the Challan total.",
  );
  assert.equal(
    getChallanReceivedPaymentError({ ...base, amount: "50000", paymentMode: "" }, 96_000),
    "Choose a payment mode.",
  );
});

test("the atomic RPC composes the existing Challan and customer-payment authorities", () => {
  assert.match(migration, /function public\.create_challan_with_received_payment/);
  assert.match(migration, /from public\.create_challan\(/);
  assert.match(migration, /perform public\.create_customer_payment\(/);
  assert.match(migration, /jsonb_build_object\([\s\S]*'challan_id'[\s\S]*'amount'/);
  assert.doesNotMatch(migration, /insert into public\.(challans|customer_payments|customer_payment_allocations)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test("the client uses one RPC for Received Now and preserves the old Pay Later path", () => {
  assert.match(service, /supabase\.rpc\("create_challan_with_received_payment"/);
  assert.match(service, /p_payment_date: input\.receivedPayment\.paymentDate/);
  assert.match(service, /p_payment_amount: input\.receivedPayment\.amount/);
  assert.match(service, /p_payment_mode: input\.receivedPayment\.paymentMode/);
  assert.match(office, /Received now/);
  assert.match(office, /Pay later/);
  assert.match(office, /await submitChallanCreation\(\s*creationLatch\.current/);
  assert.match(office, /\(\) => receivedPayment\s*\? createChallanWithReceivedPayment\(\{ \.\.\.input, receivedPayment \}\)\s*: createChallan\(input\)/);
  assert.match(supabaseTypes, /create_challan_with_received_payment:/);
});

test("database regression verifier covers ledger visibility, rollback, isolation, and snapshots", () => {
  for (const evidence of [
    "Pay Later creates no customer payment",
    "full Received Now leaves zero outstanding",
    "partial Received Now leaves the correct remainder",
    "overpayment rolls back Challan and payment together",
    "same payment appears in payment history, dues, and Cash Book",
    "Factory A user cannot create a paid Challan in Factory B",
    "Vehicle and trip wage snapshots survive Paid Now unchanged",
  ]) assert.match(verifier, new RegExp(evidence));
});
