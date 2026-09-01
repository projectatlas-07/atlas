import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260825000018_create_soil_worker_lifecycle.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_soil_supply_t7.sql", import.meta.url),
  "utf8",
);

test("T7 uses the existing Soil worker lifecycle field and three guarded RPCs", () => {
  assert.doesNotMatch(migration, /alter table public\.soil_workers\s+add column/i);
  assert.match(migration, /create or replace function public\.archive_soil_worker/);
  assert.match(migration, /create or replace function public\.restore_soil_worker/);
  assert.match(migration, /create or replace function public\.delete_unused_soil_worker/);
  assert.equal((migration.match(/security definer/gi) ?? []).length, 3);
  assert.equal((migration.match(/set search_path = pg_catalog, public/gi) ?? []).length, 4);
});

test("T7 database eligibility prevents archived daily inserts and corrections", () => {
  assert.match(migration, /before insert or update on public\.soil_daily_trolley_entries/);
  assert.match(migration, /if not worker_is_active then/);
  assert.match(migration, /Archived Soil workers cannot receive trolley entries/);
  assert.match(migration, /soil_lifecycle:/);
});

test("T7 delete checks every meaningful history source before setup-rate cleanup", () => {
  const guard = migration.indexOf("if exists (\n    select 1\n    from public.soil_daily_trolley_entries");
  const rateDelete = migration.indexOf("delete from public.soil_worker_trolley_rates");
  const workerDelete = migration.indexOf("delete from public.soil_workers");
  assert.ok(guard > 0 && guard < rateDelete && rateDelete < workerDelete);
  for (const table of [
    "soil_daily_trolley_entries",
    "soil_earnings",
    "soil_payments",
    "soil_financial_adjustments",
  ]) assert.match(migration.slice(guard, rateDelete), new RegExp(`public\\.${table}`));
  assert.match(migration, /cannot be deleted\. Archive the worker instead/);
});

test("T7 serializes lifecycle changes with rate, finance, and daily writes", () => {
  assert.match(migration, /soil_worker_trolley_rate/);
  assert.match(migration, /soil_financial:/);
  assert.match(migration, /soil_lifecycle:/);
  assert.match(migration, /for update/);
});

test("T7 exposes lifecycle only to authenticated callers and keeps direct writes closed", () => {
  for (const fn of [
    "archive_soil_worker",
    "restore_soil_worker",
    "delete_unused_soil_worker",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
  }
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.soil_workers/i);
});

test("T7 verifier covers lifecycle preservation, delete guards, isolation, and legacy scope", () => {
  for (const phrase of [
    "archive preserves historical rows and financial summary",
    "archived worker is excluded from active population",
    "archived worker cannot receive trolley entries",
    "restore preserves history and enables future work",
    "unused worker and setup rates are deleted",
    "daily history blocks permanent deletion",
    "earnings history blocks permanent deletion",
    "payment history blocks permanent deletion",
    "adjustment history blocks permanent deletion",
    "cross-factory archive fails",
    "authenticated direct lifecycle update fails",
    "anonymous archive RPC fails",
    "T1 through T6 and unrelated Atlas modules remain present",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});
