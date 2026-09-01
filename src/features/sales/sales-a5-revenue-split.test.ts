import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const service = readFileSync(
  new URL("./services/sales-register-service.ts", import.meta.url),
  "utf8",
);
const model = readFileSync(new URL("./sales-register-model.ts", import.meta.url), "utf8");
const registerUi = readFileSync(
  new URL("../office/components/sales-register-section.tsx", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_a5.sql", import.meta.url),
  "utf8",
);
const a4Migration = readFileSync(
  new URL("../../../supabase/migrations/20260831000029_make_challan_total_authoritative.sql", import.meta.url),
  "utf8",
);
const generatedTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");

test("A5 derives category values from persisted authoritative rows in one register query", () => {
  assert.match(service, /challan_items \([\s\S]*line_amount/);
  assert.match(service, /challan_flexible_lines \([\s\S]*line_type[\s\S]*line_category[\s\S]*amount/);
  assert.match(service, /brickRevenuePaise[\s\S]*item\.line_amount/);
  assert.match(service, /line\.line_type === "EXTRA_CHARGE"/);
  assert.match(service, /line\.line_category === "OTHER_REVENUE"/);
  assert.doesNotMatch(service, /particulars.*loading|loading.*particulars/i);
});

test("Sales Register types use explicit unambiguous revenue names", () => {
  for (const source of [service, model]) {
    assert.match(source, /brickRevenue/);
    assert.match(source, /otherRevenue/);
    assert.match(source, /totalRevenue/);
  }
  assert.doesNotMatch(model, /challanTotal|totalSalesAmount/);
  assert.match(generatedTypes, /challan_total: number/);
  assert.doesNotMatch(generatedTypes, /brick_revenue|other_revenue/);
});

test("saved challan_total remains Total Revenue and every row must reconcile", () => {
  assert.match(service, /totalRevenuePaise = moneyToPaise\(row\.challan_total\)/);
  assert.match(service, /brickRevenuePaise \+ otherRevenuePaise !== totalRevenuePaise/);
  assert.match(service, /SalesRegisterReconciliationError/);
  assert.match(service, /SALES_REVENUE_MISMATCH/);
  assert.match(a4Migration, /calculate_challan_total[\s\S]*sum\(items\.line_amount\)[\s\S]*sum\(lines\.amount\)/);
  assert.doesNotMatch(service, /insert\(|update\(|delete\(/);
});

test("range summaries exclude voids and sum each revenue category independently", () => {
  const summarizer = model.slice(model.indexOf("export function summarizeSalesRegister"));
  assert.match(summarizer, /if \(entry\.status === "void"\)[\s\S]*continue/);
  assert.match(summarizer, /brickRevenuePaise \+= Math\.round\(entry\.brickRevenue \* 100\)/);
  assert.match(summarizer, /otherRevenuePaise \+= Math\.round\(entry\.otherRevenue \* 100\)/);
  assert.match(summarizer, /totalRevenuePaise \+= Math\.round\(entry\.totalRevenue \* 100\)/);
  assert.doesNotMatch(summarizer, /paidAmount|outstandingAmount/);
});

test("the existing Sales Register exposes exactly the requested summary split without a redesign", () => {
  assert.match(registerUi, /label="Brick Revenue"[\s\S]*summary\.brickRevenue/);
  assert.match(registerUi, /label="Other Revenue"[\s\S]*summary\.otherRevenue/);
  assert.match(registerUi, /label="Total Revenue"[\s\S]*summary\.totalRevenue/);
  assert.match(registerUi, /formatSalesMoney\(entry\.totalRevenue\)/);
  assert.match(registerUi, /No brick revenue/);
  assert.doesNotMatch(registerUi, /chart|profit|cost per brick|Add additional line/i);
});

test("A5 needs no schema migration or generated API change", () => {
  assert.match(verifier, /A5 adds no persistent database object/);
  assert.match(verifier, /temporary, security-invoker read/);
  assert.doesNotMatch(verifier, /create table public|alter table public|create view public|create function public/);
  assert.doesNotMatch(service, /supabase\.rpc\(["'](?:list|get)_sales_register/);
});

test("the rollback-only verifier covers category truth, history, payments, and isolation", () => {
  for (const phrase of [
    "brick-only Challan reports Brick Revenue ₹100,000",
    "mixed Challan reports Brick Revenue ₹100,000, Other Revenue ₹2,000, Total Revenue ₹102,000",
    "NOTE never contributes to Other Revenue",
    "EXTRA_CHARGE never increases Brick Revenue",
    "date-range totals are Brick Revenue ₹150,000, Other Revenue ₹2,000, Total Revenue ₹152,000",
    "EXTRA_CHARGE-only manual Challan reports zero Brick Revenue",
    "NOTE-only Challan reports zero for all three revenue values",
    "multiple EXTRA_CHARGE rows sum correctly",
    "persisted quantity times rate amount",
    "A2 flexible-line semantics remain intact",
    "A3 empty-document validity remains intact",
    "voided Challans remain visible but are excluded",
    "A1 company snapshots remain intact",
    "historical brick-only Challan keeps its previous Sales Register value",
    "partial payment and outstanding do not change revenue classification",
    "full payment and zero outstanding do not change revenue classification",
    "cross-factory Sales Register reporting is prevented",
    "A4 authoritative totals remain intact",
    "unrelated Atlas modules remain intact",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});

test("A5 does not begin C1, print-line work, vehicles, or cost accounting", () => {
  for (const source of [service, model, registerUi, verifier]) {
    assert.doesNotMatch(source, /OTHER_GOODS|vehicle wage|delivery wage|profitability|cost accounting/i);
  }
});
