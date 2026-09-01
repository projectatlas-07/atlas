import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260831000028_enforce_challan_document_content.sql", import.meta.url),
  "utf8",
);
const previousMigration = readFileSync(
  new URL("../../../supabase/migrations/20260831000027_create_challan_flexible_line_foundation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_a3.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");

test("A3 is a forward-only RPC correction and leaves the verified A2 migration untouched", () => {
  assert.match(migration, /Atlas Sales correction A3/);
  assert.match(previousMigration, /Atlas Sales correction A2/);
  assert.doesNotMatch(migration, /alter table|create table|drop table|drop column/i);
  assert.doesNotMatch(migration, /OTHER_GOODS|vehicle master|delivery wage/i);
});

test("brick insertion now accepts an empty array but keeps every A2 brick-row validation", () => {
  const inserter = migration.slice(
    migration.indexOf("create or replace function public.insert_challan_items"),
    migration.indexOf("create or replace function public.assert_challan_final_content"),
  );
  assert.match(inserter, /jsonb_typeof\(p_items\) <> 'array'/);
  assert.match(inserter, /jsonb_array_length\(p_items\) > 100/);
  assert.doesNotMatch(inserter, /jsonb_array_length\(p_items\) = 0/);
  for (const rule of [
    /only brick_type_id, quantity, and rate/,
    /positive whole number/,
    /at most two decimal places/,
    /Brick type does not belong to this factory/,
  ]) assert.match(inserter, rule);
});

test("the historical A3 guard documents its empty and pre-A4 errors", () => {
  const guard = migration.slice(
    migration.indexOf("create or replace function public.assert_challan_final_content"),
    migration.indexOf("create or replace function public.create_challan_with_final_content"),
  );
  assert.match(guard, /from public\.challan_items/);
  assert.match(guard, /from public\.challan_flexible_lines/);
  assert.match(guard, /line_type = 'EXTRA_CHARGE'/);
  assert.match(guard, /not has_brick_items and not has_flexible_lines[\s\S]*P3011/);
  assert.match(guard, /TEMPORARY A3 GUARD/);
  assert.match(guard, /not has_brick_items and has_extra_charge[\s\S]*P3012/);
  assert.match(service, /error\.code === "P3011"/);
  assert.doesNotMatch(service, /error\.code === "P3012"/);
});

test("create validates combined content and preserves A1 snapshots plus transactional numbering", () => {
  const creator = migration.slice(
    migration.indexOf("create or replace function public.create_challan_with_final_content"),
    migration.indexOf("create or replace function public.update_challan_with_final_content"),
  );
  assert.match(creator, /jsonb_array_length\(p_items\) = 0[\s\S]*jsonb_array_length\(p_flexible_lines\) = 0[\s\S]*P3011/);
  assert.match(creator, /company_village_snapshot[\s\S]*factory_profile\.village/);
  assert.match(creator, /on conflict \(factory_id\) do update/);
  assert.match(creator, /insert_challan_items[\s\S]*replace_challan_flexible_lines[\s\S]*assert_challan_final_content/);
});

test("update performs replacement semantics first and validates the final persisted document", () => {
  const updater = migration.slice(
    migration.indexOf("create or replace function public.update_challan_with_final_content"),
    migration.indexOf("create or replace function public.create_challan("),
  );
  assert.match(updater, /for update/);
  assert.match(updater, /existing_challan\.is_locked[\s\S]*P3005/);
  assert.match(updater, /existing_challan\.status <> 'active'[\s\S]*P3006/);
  assert.match(updater, /delete from public\.challan_items[\s\S]*insert_challan_items/);
  assert.match(updater, /if p_replace_flexible_lines then[\s\S]*replace_challan_flexible_lines/);
  assert.match(updater, /replace_challan_flexible_lines[\s\S]*assert_challan_final_content/);
  assert.match(migration, /p_flexible_lines is not null\s*\n\s*\);/);
});

test("old and combined RPC signatures remain controlled while private helpers stay private", () => {
  for (const signature of [
    /create_challan\(uuid, date, uuid, text, numeric, jsonb\)/i,
    /create_challan\(\s*uuid, date, uuid, text, numeric, jsonb, jsonb/i,
    /update_challan\(\s*uuid, uuid, date, uuid, text, numeric, jsonb\s*\)/i,
    /update_challan\(\s*uuid, uuid, date, uuid, text, numeric, jsonb, jsonb/i,
  ]) assert.match(migration, signature);
  assert.match(migration, /revoke all on function public\.assert_challan_final_content/);
  assert.match(migration, /revoke all on function public\.create_challan_with_final_content/);
  assert.match(migration, /revoke all on function public\.update_challan_with_final_content/);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/i);
});

test("A3 does not begin A4 or A5 while Correction D supports its manual documents", () => {
  assert.doesNotMatch(migration, /update public\.challans[\s\S]*challan_total\s*=/i);
  assert.doesNotMatch(migration, /execute function public\.recalculate_challan_total/i);
  assert.match(printModel, /challan\.flexibleLines/);
  assert.match(migration, /temporarily rejects every no-brick document[\s\S]*until A4/i);
});

test("focused SQL verifier covers every A3 validity transition and existing safety boundary", () => {
  for (const phrase of [
    "brick-only Challan still creates",
    "brick plus NOTE creates",
    "brick plus EXTRA_CHARGE creates",
    "meaningful NOTE-only Challan creates",
    "completely empty Challan is rejected",
    "EXTRA_CHARGE-only Challan is temporarily rejected until A4",
    "NOTE plus EXTRA_CHARGE without bricks is temporarily rejected until A4",
    "allows brick plus NOTE to become NOTE-only",
    "brick-only cannot transition to empty",
    "omitted flexible lines cannot leave an EXTRA_CHARGE-only final state",
    "NOTE-only Challan cannot remove its final NOTE",
    "explicit empty flexible array clears lines only when final brick content remains valid",
    "payment-locked Challans remain immutable",
    "existing void rules",
    "failed A3 creates consumed or changed permanent numbering",
    "immutable A1 company snapshots",
    "A2 NOTE financial rules remain intact",
    "payments, outstanding, and Sales Register source values remain brick-only",
    "existing legacy Challans retain historical snapshots",
    "cross-factory RLS",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});
