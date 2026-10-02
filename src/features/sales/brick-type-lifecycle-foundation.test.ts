import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261002000070_create_brick_type_lifecycle_foundation.sql", import.meta.url),
  "utf8",
);

test("adds the final monotonic Brick Type lifecycle without Production coupling", () => {
  assert.match(migration, /add column ever_used boolean not null default false/);
  assert.match(migration, /challan_items_mark_brick_type_used[\s\S]*after insert on public\.challan_items/);
  assert.match(migration, /old\.ever_used and not new\.ever_used[\s\S]*P3403/);
  assert.doesNotMatch(migration, /production_entries|production labourer|assigned_brick_type/i);
});

test("keeps mutations authoritative and permanent deletion guarded", () => {
  assert.match(migration, /create or replace function public\.create_brick_type/);
  assert.match(migration, /create or replace function public\.rename_brick_type/);
  assert.match(migration, /create or replace function public\.set_brick_type_active/);
  assert.match(migration, /create or replace function public\.delete_unused_brick_type/);
  assert.match(migration, /target_brick_type\.ever_used[\s\S]*P3401/);
  assert.match(migration, /from public\.challan_items[\s\S]*P3402/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke insert, update, delete on public\.brick_types from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.delete_unused_brick_type\(uuid, uuid\)[\s\S]*to authenticated/);
});

test("contains no environment-wide destructive reset", () => {
  assert.doesNotMatch(migration, /delete from public\.(challans|challan_items|customer_payments|customer_payment_allocations)/i);
  assert.doesNotMatch(migration, /truncate/i);
});
