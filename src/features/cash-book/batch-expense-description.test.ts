import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000047_compact_batch_expense_cash_book_descriptions.sql",
  import.meta.url,
), "utf8");
const fuelComponent = readFileSync(new URL(
  "../office/components/vehicle-fuel-office-section.tsx",
  import.meta.url,
), "utf8");
const coalComponent = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const maintenanceComponent = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");

test("Fuel batches use one bounded Cash Book description instead of allocation concatenation", () => {
  assert.match(migration, /when bool_and\(fuel\.id is not null\) and count\(\*\) > 1/);
  assert.match(migration, /'Fuel payment · ' \|\| count\(\*\)::text \|\| ' refuels'/);
});

test("Coal and Maintenance compact descriptions remain intact", () => {
  assert.match(migration, /'Coal seller settlement · ' \|\| count\(\*\)::text \|\| ' purchases'/);
  assert.match(migration, /' · Maintenance payment · '/);
});

test("single and generic expense descriptions retain the existing specific fallback", () => {
  assert.match(migration, /else 'Payment for ' \|\| string_agg\(records\.description/);
  assert.match(migration, /and count\(\*\) > 1[\s\S]*else 'Payment for '/);
});

test("operational histories retain full allocation detail", () => {
  assert.match(fuelComponent, /payment\.allocations\.map/);
  assert.match(coalComponent, /payment\.allocations\.map/);
  assert.match(maintenanceComponent, /payment\.allocations\.map/);
});

test("description migration does not alter payment amounts, allocations, or settlement RPCs", () => {
  assert.doesNotMatch(migration, /insert into public\.expense_payments|update public\.expense_records/);
  assert.doesNotMatch(migration, /create or replace function public\.create_(?:vehicle|coal|expense)/);
});
