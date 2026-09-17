import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260916000062_protect_mud_settlement_inputs.sql", import.meta.url),
  "utf8",
);
const ui = readFileSync(
  new URL("../office/components/mud-group-management.tsx", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_mud_settlement_withdrawals.sql", import.meta.url),
  "utf8",
);

test("Production keeps its labourer guard and gains the shared Mud cutoff guard", () => {
  const authority = migration.slice(
    migration.indexOf("create or replace function public.assert_production_date_is_unsettled"),
    migration.indexOf("create or replace function public.protect_mud_group_term_settled_date"),
  );
  assert.match(authority, /'mud_factory_settlement'/);
  assert.match(authority, /accounting_mode/);
  assert.match(authority, /p_production_date <= latest_cutoff/);
  assert.match(authority, /'production_account:' \|\| p_labourer_id/);
  assert.match(authority, /production_earning_settlements/);
  assert.match(authority, /Production through % is settled and cannot be changed/);
});

test("term and rate triggers preserve settled history but allow clipped future splits", () => {
  assert.match(migration, /mud_group_terms_protect_settled_date/);
  assert.match(migration, /Mud group configuration through % is settled and cannot be changed/);
  assert.match(migration, /new\.member_count <> old\.member_count/);
  assert.match(migration, /mud_group_rates_protect_settled_date/);
  assert.match(migration, /Mud rate through % is settled and cannot be changed/);
  assert.match(migration, /new\.rate_per_1000_bricks <> old\.rate_per_1000_bricks/);
  assert.equal((migration.match(/'mud_factory_settlement'/g) ?? []).length, 3);
  assert.equal((migration.match(/least\(coalesce\(new\.effective_to/g) ?? []).length, 2);
});

test("SETTLEMENT UI routes to continuous accounts and hides legacy controls by mode", () => {
  assert.match(ui, /mode === "SETTLEMENT" && <SettlementMudAccounting/);
  assert.match(ui, /mode === "LEGACY_WEEKLY" \|\| mode === "SHADOW"/);
  assert.match(ui, /getMudSettlementAccount/);
  assert.match(ui, /createMudSettlementWithdrawal/);
  for (const label of ["Settled Earned", "Live Earned after cutoff", "Withdrawn", "Available Balance", "Settle Production through"]) {
    assert.match(ui, new RegExp(label));
  }
  assert.match(ui, /default settlement cutoff is the day before the withdrawal date/i);
  assert.match(ui, /all Mud groups move to the same cutoff/i);
});

test("rollback verifier covers protected and future mutations plus factory isolation", () => {
  for (const phrase of [
    "settled Production insert, update, and delete are blocked",
    "post-cutoff Production insert, update, and delete succeed",
    "settled Mud group term changes are blocked",
    "post-cutoff Mud group changes succeed",
    "settled Mud rates are blocked",
    "post-cutoff Mud rates succeed",
    "SHADOW fixture remains editable",
    "all protected writers share the Mud factory lock",
    "real Test Atlas factory remains SHADOW with zero settlement state",
    "outer rollback restored every baseline count",
  ]) assert.match(verifier, new RegExp(phrase));
});
