import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase1 = readFileSync(new URL("../../../supabase/migrations/20260915000052_create_mud_multi_group_configuration_foundation.sql", import.meta.url), "utf8");
const phase2 = readFileSync(new URL("../../../supabase/migrations/20260916000053_activate_mud_multi_group_configuration.sql", import.meta.url), "utf8");
const currentMud = readFileSync(new URL("../../../supabase/migrations/20260810000005_remove_is_placeholder.sql", import.meta.url), "utf8");
const dailyAuthority = phase1.slice(phase1.indexOf("create or replace function public.get_mud_group_daily_allocation"), phase1.indexOf("revoke all on function public.get_mud_group_daily_allocation"));
const configurationRead = phase2.slice(phase2.indexOf("create or replace function public.get_mud_group_configuration"), phase2.indexOf("create or replace function public.create_mud_group"));
const rangeAuthority = phase2.slice(phase2.indexOf("create or replace function public.get_mud_group_range_allocation"), phase2.indexOf("revoke all on function public.transition_mud_accounting_mode"));

test("new-engine allocation and reads have zero labour_groups.is_active dependency", () => {
  assert.doesNotMatch(dailyAuthority, /(?:labour_groups|groups)\.is_active/);
  assert.match(dailyAuthority, /from public\.mud_group_terms/);
  assert.doesNotMatch(configurationRead, /(?:labour_groups|groups)\.is_active/);
  assert.match(rangeAuthority, /public\.get_mud_group_daily_allocation/);
  assert.doesNotMatch(rangeAuthority, /labour_groups|(?:labour_groups|groups)\.is_active/);
});

test("every factory starts LEGACY_WEEKLY with only forward audited transitions", () => {
  assert.match(phase2, /create type public\.mud_accounting_mode as enum[\s\S]*'LEGACY_WEEKLY'[\s\S]*'SHADOW'[\s\S]*'SETTLEMENT'/);
  assert.match(phase2, /insert into public\.mud_accounting_states[\s\S]*select factories\.id, 'LEGACY_WEEKLY'/);
  assert.match(phase2, /old_mode = 'LEGACY_WEEKLY' and new_mode = 'SHADOW'/);
  assert.match(phase2, /old_mode = 'SHADOW' and new_mode = 'SETTLEMENT'/);
  assert.match(phase2, /actor uuid not null/);
  assert.doesNotMatch(phase2, /SETTLEMENT' and new_mode =|new_mode = 'LEGACY_WEEKLY'/);
});

test("controlled configuration API owns all term and rate mutations", () => {
  for (const rpc of ["create_mud_group", "set_mud_group_member_count", "set_mud_group_rate", "stop_mud_group_earning", "restart_mud_group_earning"]) {
    assert.match(phase2, new RegExp(`create or replace function public\\.${rpc}`));
    assert.match(phase2, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.match(phase2, /p_stop_date - 1/);
  assert.match(phase2, /current_term\.effective_to/);
  assert.match(phase2, /case when next_found then next_rate\.effective_from - 1 else null end/);
});

test("Phase 2 does not redefine or mutate legacy financial accounting", () => {
  assert.match(currentMud, /create or replace function public\.calculate_mud_supply_wages/);
  assert.doesNotMatch(phase2, /create or replace function public\.(calculate_mud_supply_wages|create_labour_group_withdrawal|get_labour_group_available_balance|get_production_labourer_account|calculate_transport_weekly_wages)/);
  assert.doesNotMatch(phase2, /insert into public\.(weekly_earnings|withdrawals|production_earning_settlements|transport_weekly_earnings)/);
  assert.doesNotMatch(phase2, /drop index labour_groups_one_active_per_factory_idx/);
});
