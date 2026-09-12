import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260910000034_allow_exact_challan_brick_amount.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_exact_brick_amount.sql", import.meta.url),
  "utf8",
);
const office = readFileSync(new URL("../office/components/sales-office-section.tsx", import.meta.url), "utf8");
const model = readFileSync(new URL("../office/sales-office-model.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");
const register = readFileSync(new URL("./services/sales-register-service.ts", import.meta.url), "utf8");
const payments = readFileSync(new URL("./services/customer-payment-service.ts", import.meta.url), "utf8");

test("database stores one exact Amount authority and derives its display Rate", () => {
  assert.match(migration, /alter column line_amount drop expression/);
  assert.match(migration, /alter column rate_per_1000_bricks type numeric\(19, 9\)/);
  assert.match(migration, /add column pricing_mode text not null default 'RATE'/);
  assert.match(migration, /pricing_mode in \('RATE', 'AMOUNT'\)/);
  assert.match(migration, /item_rate := round\(\(item_amount \* 1000\) \/ item_quantity_numeric, 9\)/);
  assert.match(migration, /item_amount := round\(\(item_quantity_numeric \* item_rate\) \/ 1000, 2\)/);
  assert.match(migration, /must supply exactly one pricing input: Rate or Amount/);
});

test("last edited Rate or Amount becomes the only submitted authority", () => {
  assert.match(office, /updateLine\(line\.key, "ratePer1000Bricks"/);
  assert.match(office, /updateLine\(line\.key, "lineAmount"/);
  assert.match(office, /last one you edit controls the row/);
  assert.match(model, /field === "ratePer1000Bricks"[\s\S]*"RATE"/);
  assert.match(model, /field === "lineAmount"[\s\S]*"AMOUNT"/);
  assert.match(service, /pricing_mode: "AMOUNT",[\s\S]*amount: normalizeMoneyDecimal/);
  assert.match(service, /pricing_mode: "RATE",[\s\S]*rate: item\.ratePer1000Bricks/);
});

test("all downstream consumers keep reading the single persisted amount and total", () => {
  assert.match(service, /lineAmount: Number\(row\.line_amount\)/);
  assert.match(printModel, /amount: item\.lineAmount/);
  assert.match(printModel, /total: challan\.challanTotal/);
  assert.match(register, /moneyToPaise\(item\.line_amount\)/);
  assert.match(register, /moneyToPaise\(row\.challan_total\)/);
  assert.match(payments, /saleTotal: Number\(state\.sale_total\)/);
  assert.match(payments, /outstandingAmount: Number\(state\.outstanding_amount\)/);
});

test("rollback verifier covers exact, mixed, invalid, aggregate, and locked paths", () => {
  for (const phrase of [
    "12,347 bricks at exact Amount ₹80,000",
    "existing Rate workflow",
    "mixed Rate/Amount rows",
    "item cannot supply both Rate and Amount",
    "item cannot omit both Rate and Amount",
    "customer aggregate",
    "payment-locked lifecycle",
    "RLS",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});

test("migration stays inside brick pricing and preserves existing lifecycle architecture", () => {
  assert.doesNotMatch(migration, /create table|drop table|drop column|alter table public\.challans/);
  assert.doesNotMatch(migration, /create policy|drop policy|customer_payments|vehicles/);
  assert.match(migration, /create or replace function public\.insert_challan_items/);
  assert.doesNotMatch(migration, /create or replace function public\.(create_challan|update_challan|calculate_challan_total)/);
});
