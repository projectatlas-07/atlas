import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../../supabase/migrations/20260827000022_snapshot_customer_payment_receipts.sql", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../../../supabase/verify_sales_s5b.sql", import.meta.url), "utf8");
const office = readFileSync(new URL("../office/components/customer-payments-section.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("../office/components/sales-office-section.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("./services/customer-payment-service.ts", import.meta.url), "utf8");
const registerService = readFileSync(new URL("./services/sales-register-service.ts", import.meta.url), "utf8");

test("S5B stays bounded to Office payment workflow, history, receipt, and payment display", () => {
  assert.doesNotMatch(migration + office, /cash_book|general_ledger|chart_of_accounts|expense|purchase|vehicle_wage/i);
  assert.doesNotMatch(migration, /receipt_number|payment_number|sequence/i);
  assert.match(parent, /<CustomerPaymentsSection/);
});

test("Office payment save uses only verified S5A services and explicitly selected allocations", () => {
  assert.match(office, /createCustomerPayment\(input\)/);
  assert.match(service, /supabase\.rpc\("create_customer_payment"/);
  assert.doesNotMatch(office, /oldest|auto.?allocate/i);
  assert.match(office, /Nothing is selected automatically/);
  assert.match(office, /status\.canSubmit/);
  assert.match(office, /if \(isSaving\) return/);
  assert.doesNotMatch(office, /\.from\(|\.insert\(|\.update\(|\.delete\(/);
});

test("successful save refreshes summary, candidates, history, register, and affected locks", () => {
  for (const key of [
    "office-customer-payment-summary",
    "office-customer-payment-candidates",
    "office-customer-payment-history",
    "office-sales-register",
  ]) assert.match(office + parent, new RegExp(key));
  assert.match(parent, /applyPaymentLocks/);
  assert.match(parent, /allocation\.challanId/);
});

test("history is one immutable payment card with nested allocations and one receipt link", () => {
  assert.match(office, /history\.map\(\(payment\)/);
  assert.match(office, /payment\.allocations\.map/);
  assert.match(office, /\/office\/payments\/\$\{payment\.id\}/);
  assert.doesNotMatch(office, /Edit payment|Delete payment|Reverse payment/i);
});

test("register derives active payment state without changing the stored sale value", () => {
  assert.match(registerService, /getChallanPaymentState/);
  assert.match(registerService, /totalRevenuePaise = moneyToPaise\(row\.challan_total\)/);
  assert.match(registerService, /totalRevenue: totalRevenuePaise \/ 100/);
  assert.match(registerService, /paidAmount: payment\.totalPaid/);
  assert.match(registerService, /outstandingAmount: payment\.outstandingAmount/);
});

test("forward migration snapshots receipt profiles atomically and runtime verifier proves A survives B", () => {
  assert.match(migration, /before insert on public\.customer_payments/);
  assert.match(migration, /new\.customer_name_snapshot := customer_profile\.name/);
  assert.match(migration, /new\.company_name_snapshot := factory_profile\.name/);
  assert.match(verifier, /S5B Customer A/);
  assert.match(verifier, /S5B Customer B/);
  assert.match(verifier, /receipt source remains profile A after both profiles change to B/);
});
