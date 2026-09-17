import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260915000052_create_mud_multi_group_configuration_foundation.sql", import.meta.url),
  "utf8",
);
const currentMudAccounting = readFileSync(
  new URL("../../../supabase/migrations/20260810000005_remove_is_placeholder.sql", import.meta.url),
  "utf8",
);
const productionCutover = readFileSync(
  new URL("../../../supabase/migrations/20260915000049_create_production_settlement_foundation.sql", import.meta.url),
  "utf8",
);

test("adds dormant effective-dated group terms and group rates with same-group overlap protection", () => {
  assert.match(migration, /create table public\.mud_group_terms/);
  assert.match(migration, /member_count integer not null/);
  assert.match(migration, /constraint mud_group_terms_member_count_check check \(member_count > 0\)/);
  assert.match(migration, /constraint mud_group_terms_no_overlap[\s\S]*factory_id with =[\s\S]*labour_group_id with =[\s\S]*daterange\(effective_from, effective_to, '\[\]'\) with &&/);
  assert.match(migration, /create table public\.mud_group_rates/);
  assert.match(migration, /constraint mud_group_rates_no_overlap[\s\S]*labour_group_id with =/);
  assert.match(migration, /rate_per_1000_bricks > 0/);
});

test("backfill is deliberately limited to the current active group and preserves legacy Mud rates", () => {
  assert.match(migration, /insert into public\.mud_group_terms[\s\S]*where groups\.is_active/);
  assert.match(migration, /coalesce\(min\(rates\.effective_from\), \(now\(\) at time zone 'Asia\/Kolkata'\)::date\)/);
  assert.match(migration, /insert into public\.mud_group_rates[\s\S]*where rates\.applies_to = 'mud_supply'/);
  assert.doesNotMatch(migration, /delete from public\.wage_rates|update public\.wage_rates|drop table public\.wage_rates/);
});

test("daily authority uses whole-brick largest remainder and stable UUID tie-breaking", () => {
  assert.match(migration, /create or replace function public\.get_mud_group_daily_allocation/);
  assert.match(migration, /floor\([\s\S]*eligible_quantity::numeric \* active\.member_count::numeric/);
  assert.match(migration, /mod\([\s\S]*eligible_quantity::numeric \* active\.member_count::numeric/);
  assert.match(migration, /order by weighted\.allocation_remainder desc, weighted\.labour_group_id asc/);
  assert.match(migration, /eligible_quantity - ranked\.base_total/);
  assert.match(migration, /final_allocation::numeric \* allocated\.rate_per_1000_bricks \/ 1000/);
});

test("foundation fails closed for missing or ambiguous configuration and remains read-only to clients", () => {
  for (const message of [
    "No active Mud group coverage",
    "Mud member-count coverage is missing",
    "Mud rate not set",
    "Overlapping Mud group terms",
    "Overlapping Mud group rates",
  ]) assert.ok(migration.includes(message), `${message} remains explicit`);
  assert.match(migration, /revoke all on public\.mud_group_terms, public\.mud_group_rates from anon, authenticated/);
  assert.match(migration, /grant select on public\.mud_group_terms, public\.mud_group_rates to authenticated/);
});

test("existing one-group Mud accounting and unrelated wage systems stay active", () => {
  assert.match(currentMudAccounting, /create or replace function public\.calculate_mud_supply_wages/);
  assert.doesNotMatch(migration, /drop index labour_groups_one_active_per_factory_idx/);
  assert.doesNotMatch(migration, /create or replace function public\.calculate_mud_supply_wages/);
  assert.doesNotMatch(migration, /weekly_earnings|withdrawals|production_earning_settlements|transport_weekly_earnings/);
  assert.match(productionCutover, /create or replace function public\.get_production_labourer_account/);
});
