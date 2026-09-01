import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const migrationDirectory = new URL("../../../supabase/migrations/", import.meta.url);
const soilMigrations = readdirSync(migrationDirectory)
  .filter((name) => /^2026082500001[3-9]_.*\.sql$/.test(name))
  .sort();
const concurrencyMigration = readFileSync(
  new URL("../../../supabase/migrations/20260825000019_harden_soil_financial_concurrency.sql", import.meta.url),
  "utf8",
);
const finalVerifier = readFileSync(
  new URL("../../../supabase/verify_soil_supply_final.sql", import.meta.url),
  "utf8",
);
const dailyModel = readFileSync(new URL("./soil-daily-entry-model.ts", import.meta.url), "utf8");
const dailyScreen = readFileSync(
  new URL("./components/soil-daily-entry-screen.tsx", import.meta.url),
  "utf8",
);
const managerScreen = readFileSync(
  new URL("../manager/components/manager-entry-screen.tsx", import.meta.url),
  "utf8",
);
const officeScreen = readFileSync(
  new URL("../office/components/soil-office-section.tsx", import.meta.url),
  "utf8",
);
const supabaseTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");

test("Soil migrations form one forward-only 00013 through 00019 chain", () => {
  assert.deepEqual(soilMigrations.map((name) => name.slice(0, 14)), [
    "20260825000013",
    "20260825000014",
    "20260825000015",
    "20260825000016",
    "20260825000017",
    "20260825000018",
    "20260825000019",
  ]);
});

test("T8 financial hardening shares the authoritative lock and rejects negative projected balance", () => {
  assert.match(concurrencyMigration, /soil_financial:/);
  assert.match(concurrencyMigration, /get_soil_financial_summary/);
  assert.match(concurrencyMigration, /projected_available_balance < 0/);
  assert.match(concurrencyMigration, /using errcode = 'P2A05'/);
  assert.match(concurrencyMigration, /before insert or update on public\.soil_daily_trolley_entries/);
  assert.doesNotMatch(concurrencyMigration, /alter table.*add column/is);
});

test("archived historical rows remain visible but cannot leak into an active save batch", () => {
  assert.match(dailyModel, /if \(!row\.soilWorkerIsActive\) return \[\]/);
  assert.match(dailyScreen, /row\.soilWorkerIsActive && row\.quantityInput\.trim\(\)/);
  assert.match(dailyScreen, /disabled=\{isSaving \|\| !row\.soilWorkerIsActive\}/);
  assert.match(dailyScreen, /Archived · read-only/);
});

test("site stays quantity-only while Office remains the financial and lifecycle surface", () => {
  assert.match(managerScreen, /workflow === "soil".*<SoilDailyEntryScreen/s);
  assert.match(dailyScreen, /Trolley Quantity|trolley quantity/i);
  assert.doesNotMatch(dailyScreen, /createSoilPayment|financial adjustment|Available Balance|Total Paid/i);
  for (const phrase of [
    "Record payment",
    "Record adjustment",
    "Total Earned",
    "Available Balance",
    "Archived Soil workers",
    "archiveSoilWorker",
    "restoreSoilWorker",
    "deleteUnusedSoilWorker",
  ]) assert.match(officeScreen, new RegExp(phrase));
});

test("generated Supabase types cover the final Soil RPC boundary", () => {
  for (const rpc of [
    "create_soil_worker_with_initial_trolley_rate",
    "create_soil_worker_trolley_rate",
    "resolve_soil_worker_trolley_rate",
    "save_soil_daily_trolley_entries",
    "get_soil_total_earned",
    "get_soil_financial_summary",
    "create_soil_payment",
    "create_soil_financial_adjustment",
    "archive_soil_worker",
    "restore_soil_worker",
    "delete_unused_soil_worker",
  ]) assert.match(supabaseTypes, new RegExp(`${rpc}:`));
});

test("final verifier covers the integrated release contract", () => {
  for (const phrase of [
    "worker creation and atomic initial rates",
    "future rate change preserves historical rate resolution",
    "multi-worker quantities use stored applicable rate/base snapshots",
    "trolley correction creates an immutable signed event",
    "payment, addition, deduction, and authoritative available balance",
    "overpayment is rejected",
    "over-deduction is rejected",
    "downward earning correction cannot overdraw financial balance",
    "archive hides new work while preserving all history and totals",
    "restore enables future trolley work without inventing a rate",
    "unused deletion is clean and historical deletion is guarded",
    "RLS, RPC validation, and composite references isolate factories",
    "earnings, payments, and adjustments are independently immutable",
    "required RLS, policies, privileges, indexes, constraints, triggers, and RPCs exist",
    "Production, Mud, Chamber Transport, and Staff remain intact",
  ]) assert.match(finalVerifier, new RegExp(phrase, "i"));
  assert.match(finalVerifier, /^begin;/m);
  assert.match(finalVerifier, /^rollback;/m);
});
