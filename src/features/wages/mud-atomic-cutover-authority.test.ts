import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260916000059_add_atomic_mud_settlement_cutover.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_mud_atomic_cutover.sql", import.meta.url),
  "utf8",
);

test("cutover uses one transaction and the shared factory Mud settlement lock", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*'mud_factory_settlement'/);
  assert.match(migration, /create_mud_legacy_opening\([\s\S]*transition_mud_accounting_mode\(p_factory_id, 'SETTLEMENT'\)/);
  assert.match(migration, /commit;\s*$/);
  assert.equal((migration.match(/\bcommit;/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /dblink|postgres_fdw|autonomous/i);
});

test("all cutover eligibility checks happen before the opening is created", () => {
  const openingCall = migration.indexOf("from public.create_mud_legacy_opening(");
  assert.ok(openingCall > migration.indexOf("certification.certification_status <> 'READY'"));
  assert.ok(openingCall > migration.indexOf("calculate_mud_cutover_readiness("));
  assert.ok(openingCall > migration.indexOf("extract(isodow from p_proposed_legacy_cutoff) <> 7"));
});

test("direct SHADOW to SETTLEMENT requires the atomic authority opening", () => {
  const authorityMessage = /Mud SETTLEMENT mode must be entered through the atomic cutover authority\./g;
  assert.equal([...migration.matchAll(authorityMessage)].length, 2);
  assert.match(migration, /revoke all on function public\.create_mud_legacy_opening\(uuid, date\)[\s\S]*service_role/);
  assert.match(migration, /using errcode = 'P3201'/);
});

test("cutover returns the immutable opening, Sunday-Monday boundary, actor and audit metadata", () => {
  assert.match(migration, /legacy_opening_settlement_id uuid/);
  assert.match(migration, /final_legacy_week_start date/);
  assert.match(migration, /legacy_cutoff date/);
  assert.match(migration, /settlement_start_date date/);
  assert.match(migration, /transition_audit_id uuid/);
  assert.match(migration, /actor uuid/);
  assert.match(migration, /cutover_at timestamptz/);
});

test("Phase 5A does not redefine legacy withdrawals or settlement protection", () => {
  assert.doesNotMatch(migration, /create or replace function public\.create_labour_group_withdrawal/i);
  assert.doesNotMatch(migration, /create trigger .*production/i);
  assert.doesNotMatch(migration, /create trigger .*mud_group_(terms|rates)/i);
});

test("rollback verifier covers the happy path and every required adversarial fixture", () => {
  for (const fixture of ["happy", "rate_change", "group_stop", "multi_member", "invalid_next_day"]) {
    assert.match(verifier, new RegExp(`'${fixture}'`));
  }
  assert.match(verifier, /direct SHADOW to SETTLEMENT cannot bypass atomic cutover/);
  assert.match(verifier, /mid-week Saturday cutoff is rejected before opening/);
  assert.match(verifier, /post-cutoff legacy withdrawal rejects cutover/);
  assert.match(verifier, /unreconciled legacy balance rejects cutover/);
  assert.match(verifier, /duplicate cutover is rejected/);
  assert.match(verifier, /legacy 700 != daily 780 = hand calculation/);
  assert.match(verifier, /outer rollback restored every baseline count/);
});
