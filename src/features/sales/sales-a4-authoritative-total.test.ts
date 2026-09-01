import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260831000029_make_challan_total_authoritative.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_a4.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const paymentService = readFileSync(
  new URL("./services/customer-payment-service.ts", import.meta.url),
  "utf8",
);
const registerService = readFileSync(
  new URL("./services/sales-register-service.ts", import.meta.url),
  "utf8",
);
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");
const domainTypes = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const generatedTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");

test("A4 installs one persisted-row combined-total authority", () => {
  assert.match(migration, /Atlas Sales correction A4/);
  const calculator = migration.slice(
    migration.indexOf("create or replace function public.calculate_challan_total"),
    migration.indexOf("create or replace function public.refresh_challan_total"),
  );
  assert.match(calculator, /sum\(items\.line_amount\)[\s\S]*from public\.challan_items/);
  assert.match(calculator, /sum\(lines\.amount\)[\s\S]*from public\.challan_flexible_lines/);
  assert.match(calculator, /lines\.line_type = 'EXTRA_CHARGE'/);
  assert.match(calculator, /lines\.line_category = 'OTHER_REVENUE'/);
  assert.doesNotMatch(calculator, /NOTE[\s\S]*\+|sum[\s\S]*NOTE/);

  const refresh = migration.slice(
    migration.indexOf("create or replace function public.refresh_challan_total"),
    migration.indexOf("create or replace function public.recalculate_challan_total"),
  );
  assert.match(refresh, /public\.calculate_challan_total/);
  assert.match(refresh, /atlas\.internal_challan_total_write/);
  assert.match(refresh, /update public\.challans[\s\S]*challan_total = calculated_total/);
  assert.doesNotMatch(refresh, /sum\(/);
});

test("brick and flexible mutations share the same factory-scoped refresh path", () => {
  const adapter = migration.slice(
    migration.indexOf("create or replace function public.recalculate_challan_total()"),
    migration.indexOf("create trigger challan_flexible_lines_recalculate_total"),
  );
  assert.match(adapter, /tg_op = 'DELETE'/);
  assert.match(adapter, /old\.challan_id[\s\S]*new\.challan_id/);
  assert.match(adapter, /old\.factory_id[\s\S]*new\.factory_id/);
  assert.match(adapter, /public\.refresh_challan_total/);
  assert.match(migration, /create trigger challan_flexible_lines_recalculate_total[\s\S]*after insert or update or delete on public\.challan_flexible_lines[\s\S]*public\.recalculate_challan_total/);
  assert.match(migration, /Keep the existing trigger entry point[\s\S]*proven brick-line trigger/);
});

test("historical reconciliation changes only safe unallocated rows and aborts on protected mismatches", () => {
  assert.match(migration, /lock table public\.challans,[\s\S]*public\.customer_payment_allocations[\s\S]*exclusive mode/);
  assert.match(migration, /protected historical Challan totals/);
  assert.match(migration, /challans\.is_locked[\s\S]*challans\.status <> 'active'[\s\S]*customer_payment_allocations/);
  assert.match(migration, /errcode = 'P3013'/);
  assert.match(migration, /challans\.status = 'active'[\s\S]*not challans\.is_locked[\s\S]*not exists \([\s\S]*customer_payment_allocations/);
  assert.match(migration, /perform public\.refresh_challan_total/);
  assert.match(migration, /Brick-only and NOTE-only history is deliberately untouched/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
});

test("A4 leaves P3011 as the only final-content guard and retires runtime P3012 handling", () => {
  const guard = migration.slice(
    migration.indexOf("create or replace function public.assert_challan_final_content"),
    migration.indexOf("create or replace function public.guard_challan_header_update"),
  );
  assert.match(guard, /from public\.challan_items/);
  assert.match(guard, /from public\.challan_flexible_lines/);
  assert.match(guard, /not has_brick_items and not has_flexible_lines[\s\S]*P3011/);
  assert.doesNotMatch(guard, /P3012|has_extra_charge/);
  assert.doesNotMatch(service, /P3012|financial manual-only|requires at least one brick line/);
  assert.match(service, /P3011[\s\S]*brick, NOTE, or EXTRA_CHARGE line/);
  assert.match(domainTypes, /May be empty when final content contains at least one NOTE or EXTRA_CHARGE line/);
});

test("A4 keeps database truth behind private fixed-search-path functions", () => {
  for (const signature of [
    /revoke all on function public\.calculate_challan_total\(uuid, uuid\)/,
    /revoke all on function public\.refresh_challan_total\(uuid, uuid\)/,
    /revoke all on function public\.recalculate_challan_total\(\)/,
    /revoke all on function public\.assert_challan_final_content\(uuid, uuid\)/,
  ]) assert.match(migration, signature);
  assert.match(migration, /calculate_challan_total[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(migration, /refresh_challan_total[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(migration, /Challan totals can only be derived from persisted Challan lines/);
  const mutationService = service.slice(
    service.indexOf("export async function createChallan"),
    service.indexOf("export async function voidChallan"),
  );
  assert.doesNotMatch(mutationService, /p_challan_total|p_total|p_line_amount/);
  assert.match(generatedTypes, /challan_total: number/);
  assert.doesNotMatch(generatedTypes, /other_total|manual_total/);
});

test("existing financial consumers continue reading the saved combined total", () => {
  assert.match(service, /challanTotal: Number\(row\.challan_total\)/);
  assert.match(paymentService, /saleTotal: Number\(state\.sale_total\)/);
  assert.match(paymentService, /outstandingAmount: Number\(state\.outstanding_amount\)/);
  assert.match(paymentService, /challan_total/);
  assert.match(registerService, /totalRevenuePaise = moneyToPaise\(row\.challan_total\)/);
  assert.match(registerService, /totalRevenue: totalRevenuePaise \/ 100/);
  assert.match(registerService, /challan_flexible_lines/);
  assert.match(printModel, /total: challan\.challanTotal/);
  for (const source of [paymentService, printModel]) {
    assert.doesNotMatch(source, /challan_flexible_lines/);
  }
});

test("the rollback-only A4 verifier covers totals, updates, payments, history, and isolation", () => {
  for (const phrase of [
    "brick-only ₹100,000",
    "bricks ₹100,000 plus EXTRA_CHARGE ₹2,000",
    "NOTE contributes zero",
    "EXTRA_CHARGE-only ₹5,000",
    "NOTE plus EXTRA_CHARGE manual-only",
    "NOTE-only Challan remains valid",
    "completely empty Challan remains rejected",
    "quantity times rate EXTRA_CHARGE contributes exactly once",
    "multiple EXTRA_CHARGE rows sum exactly once",
    "changing an EXTRA_CHARGE recalculates",
    "removing an EXTRA_CHARGE recalculates",
    "omitted flexible lines preserve",
    "explicit empty flexible array removes",
    "final empty update rolls back",
    "₹60,000 payment leaves ₹42,000 outstanding",
    "manual ₹5,000 sale accepts ₹2,000 payment",
    "full payment produces zero outstanding",
    "overpayment beyond the combined total remains rejected",
    "payment-locked Challan cannot change",
    "Factory A cannot influence Factory B totals",
    "A1 company snapshots remain immutable",
    "A2 amount validation remains intact",
    "existing brick-only historical total remains unchanged",
    "protected pre-A4 mismatches abort migration",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});

test("A4 stays scoped while Correction D prints its authoritative total and saved lines", () => {
  assert.doesNotMatch(migration, /OTHER_GOODS|vehicle wage|delivery wage|brick revenue split|other revenue split/i);
  assert.doesNotMatch(migration, /alter table public\.challans[\s\S]*add column/i);
  assert.doesNotMatch(migration, /create table|drop table|drop column/i);
  assert.match(printModel, /lines: \[\.\.\.brickLines, \.\.\.flexibleLines\]/);
  assert.match(printModel, /total: challan\.challanTotal/);
});
