import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260916000054_create_dormant_mud_settlement_foundation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_mud_multi_group_settlement_foundation.sql", import.meta.url),
  "utf8",
);

test("Mud settlements use one factory cutoff and immutable daily/group snapshots", () => {
  assert.match(migration, /create table public\.mud_factory_settlements/);
  assert.match(migration, /previous_cutoff date/);
  assert.match(migration, /settled_through date not null/);
  assert.match(migration, /create table public\.mud_factory_settlement_days/);
  assert.match(migration, /eligible_factory_production bigint not null/);
  assert.match(migration, /total_active_mud_members bigint not null/);
  assert.match(migration, /create table public\.mud_group_settlement_days/);
  assert.match(migration, /mud_group_term_id uuid not null/);
  assert.match(migration, /mud_group_rate_id uuid not null/);
  assert.match(migration, /unique \(factory_id, work_date\)/);
  assert.equal((migration.match(/execute function public\.reject_mud_settlement_mutation/g) ?? []).length, 4);
});

test("checkpoint builder delegates every date to the Phase 1 allocation authority", () => {
  const builder = migration.slice(
    migration.indexOf("create or replace function public.create_mud_factory_settlement"),
    migration.indexOf("create or replace function public.create_mud_legacy_opening"),
  );
  assert.match(builder, /public\.get_mud_group_daily_allocation/);
  assert.match(builder, /day_allocated_production <> day_eligible_production/);
  assert.match(builder, /p_settled_through = resolved_previous_cutoff[\s\S]*daily_snapshots := 0/);
  assert.match(builder, /p_settled_through < resolved_previous_cutoff/);
  assert.match(builder, /triggering_labour_group_id/);
  assert.match(builder, /triggering_withdrawal_id/);
  assert.doesNotMatch(builder, /labour_groups\.is_active|wage_rates/);
});

test("Legacy Opening and dormant account prevent weekly/live double counting", () => {
  assert.match(migration, /create table public\.mud_group_legacy_openings/);
  assert.match(migration, /sum\(weekly\.amount\)/);
  assert.match(migration, /live_start := resolved_cutoff \+ 1/);
  assert.match(migration, /resolved_settled_earned \+ resolved_live_earned/);
  assert.match(migration, /available_balance := total_earned - resolved_total_withdrawn/);
  assert.match(verifier, /live settlement dates do not start strictly after Legacy Opening cutoff/);
});

test("Phase 3 is financially dormant and leaves every existing authority untouched", () => {
  assert.doesNotMatch(migration, /create or replace function public\.(calculate_mud_supply_wages|create_labour_group_withdrawal|get_production_labourer_account|calculate_transport_weekly_wages)/);
  assert.doesNotMatch(migration, /update public\.mud_accounting_states|insert into public\.mud_accounting_mode_transitions/);
  assert.doesNotMatch(migration, /insert into public\.(weekly_earnings|withdrawals)/);
  assert.match(migration, /grant execute on function public\.create_mud_factory_settlement[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.create_mud_factory_settlement[\s\S]*from public, anon, authenticated/);
  assert.match(verifier, /atlas_mud_phase3\.baseline_state_hash/);
  assert.match(verifier, /atlas_mud_phase3\.baseline_transition_count/);
  assert.match(verifier, /where factory_id in \(factory_a_id, factory_b_id\)/);
  assert.match(verifier, /pre-existing SHADOW history and unrelated accounting are unchanged/);
});
