import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260916000060_activate_mud_settlement_withdrawals.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_mud_settlement_withdrawals.sql", import.meta.url),
  "utf8",
);
const weeklyRepair = readFileSync(
  new URL("../../../supabase/migrations/20260916000061_repair_mud_weekly_settlement_guard.sql", import.meta.url),
  "utf8",
);

test("settlement withdrawal is factory-locked, mode-gated, and client-idempotent", () => {
  assert.match(migration, /create or replace function public\.create_mud_settlement_withdrawal/);
  assert.match(migration, /p_withdrawal_id uuid/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*'mud_factory_settlement'/);
  assert.match(migration, /current_mode is distinct from 'SETTLEMENT'/);
  assert.match(migration, /was_replayed := true/);
  assert.match(migration, /Client withdrawal identity was already used for different/);
});

test("withdrawal creates its linked checkpoint before validating settled-only funds", () => {
  const runtime = migration.slice(
    migration.indexOf("create or replace function public.create_mud_settlement_withdrawal"),
    migration.indexOf("create or replace function public.create_labour_group_withdrawal"),
  );
  assert.match(runtime, /insert into public\.withdrawals/);
  assert.match(runtime, /create_mud_factory_settlement/);
  assert.match(runtime, /calculate_mud_group_settlement_account\([\s\S]*false/);
  assert.match(runtime, /available_balance < 0/);
  assert.ok(runtime.indexOf("insert into public.withdrawals") < runtime.indexOf("create_mud_factory_settlement"));
  assert.ok(runtime.indexOf("create_mud_factory_settlement") < runtime.indexOf("available_balance < 0"));
});

test("one account authority supports safe settled validation and displayed live balance", () => {
  assert.match(migration, /p_include_live_earnings boolean/);
  assert.match(migration, /resolved_settled_earned \+ resolved_live_earned/);
  assert.match(migration, /available_balance := total_earned - resolved_total_withdrawn/);
  assert.match(migration, /p_include_live_earnings then/);
  assert.match(migration, /accounting_mode = 'SETTLEMENT'/);
});

test("legacy Mud posting paths reject only SETTLEMENT mode", () => {
  assert.equal((migration.match(/Mud accounting is now continuous settlement accounting\./g) ?? []).length, 2);
  assert.match(migration, /create or replace function public\.create_labour_group_withdrawal/);
  assert.match(migration, /create or replace function public\.calculate_mud_supply_wages/);
  assert.match(migration, /if current_mode = 'SETTLEMENT'/);
  assert.doesNotMatch(migration, /create trigger .*production|create trigger .*mud_group_(terms|rates)/i);
  assert.doesNotMatch(weeklyRepair, /is_placeholder/);
  assert.match(weeklyRepair, /on conflict \(factory_id, week_start\)/);
  assert.match(weeklyRepair, /hashtext\('calculate_mud_supply_wages:' \|\| p_week_start::text\)/);
  assert.match(weeklyRepair, /Mud accounting is now continuous settlement accounting\./);
});

test("rollback verifier covers partial, same-cutoff, advancing, isolation, and failure cases", () => {
  for (const phrase of [
    "remaining protected balance is 6000",
    "same-cutoff checkpoint has zero daily snapshots",
    "later cutoff snapshots only newly uncovered dates",
    "Group A cannot consume Group B",
    "missing rate rollback",
    "missing term rollback",
    "duplicate retry is idempotent",
    "legacy paths still work in SHADOW",
    "real Test Atlas factory remains unchanged",
  ]) assert.match(verifier, new RegExp(phrase));
});
