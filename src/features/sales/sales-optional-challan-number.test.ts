import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260911000035_make_challan_number_optional_manual_text.sql", import.meta.url),
  "utf8",
);
const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const challanService = readFileSync(
  new URL("./services/challan-service.ts", import.meta.url),
  "utf8",
);
const paymentService = readFileSync(
  new URL("./services/customer-payment-service.ts", import.meta.url),
  "utf8",
);
const registerService = readFileSync(
  new URL("./services/sales-register-service.ts", import.meta.url),
  "utf8",
);
const wageService = readFileSync(
  new URL("./services/vehicle-wage-service.ts", import.meta.url),
  "utf8",
);

test("forward migration converts public Challan No. to nullable text without replacing UUID identity", () => {
  assert.match(migration, /alter column challan_number drop not null/);
  assert.match(migration, /alter column challan_number type text using challan_number::text/);
  assert.match(migration, /returns public\.challans/);
  assert.doesNotMatch(migration, /alter column id|drop constraint challans_pkey/i);
});

test("automatic public numbering is retired and blank remains genuine NULL", () => {
  assert.match(migration, /drop table public\.challan_number_counters/);
  assert.doesNotMatch(migration.slice(migration.indexOf("create function public.create_challan_with_vehicle_snapshot")), /allocated_number|last_challan_number|nextval|sequence/);
  assert.match(migration, /nullif\(btrim\(coalesce\(p_challan_number, ''\)\), ''\)/);
});

test("existing factory-scoped uniqueness stays in force and multiple NULL values remain legal", () => {
  assert.match(migration, /comment on constraint challans_factory_number_key/);
  assert.doesNotMatch(migration, /drop constraint challans_factory_number_key/);
  assert.match(migration, /challan_number is null\s+or/);
});

test("manual references are trimmed only at the edge and accept alphanumeric punctuation", () => {
  assert.match(migration, /challan_number = btrim\(challan_number\)/);
  assert.match(migration, /char_length\(challan_number\) <= 100/);
  assert.doesNotMatch(migration, /upper\(.*challan_number|regexp_replace\(.*challan_number/);
});

test("create and edit RPCs receive the optional reference while locked and void rules remain", () => {
  assert.match(challanService, /p_challan_number: validated\.challanNumber/);
  assert.match(migration, /set challan_number = normalized_challan_number/);
  assert.match(migration, /if existing_challan\.is_locked then/);
  assert.match(migration, /if existing_challan\.status <> 'active' then/);
  assert.match(migration, /atlas\.internal_challan_number_write/);
});

test("Office exposes one low-friction optional field and never suggests a generated value", () => {
  assert.match(office, /label="Challan No\. \(optional\)"/);
  assert.match(office, /value=\{form\.challanNumber\}/);
  assert.doesNotMatch(office, /automatic suggestion|prefix configuration|numbering settings/i);
});

test("history, payments, Sales Register, and Vehicle wage reads do not sort or identify by optional number", () => {
  for (const source of [challanService, paymentService, registerService, wageService]) {
    assert.doesNotMatch(source, /order\("challan_number"/);
    assert.doesNotMatch(source, /Number\(row\.challan_number\)/);
  }
  assert.match(paymentService, /challanId: row\.challan_id/);
  assert.match(registerService, /challanId: row\.id/);
  assert.match(wageService, /challanId: row\.id/);
});

test("the new path still delegates exact Amount, snapshots, totals, and final-content rules", () => {
  assert.match(migration, /resolve_challan_vehicle_snapshot/);
  assert.match(migration, /insert_challan_items/);
  assert.match(migration, /replace_challan_flexible_lines/);
  assert.match(migration, /assert_challan_final_content/);
  assert.doesNotMatch(migration, /create or replace function public\.insert_challan_items/);
});
