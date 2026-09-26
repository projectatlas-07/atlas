import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260915000049_create_production_settlement_foundation.sql", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../office/components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const accountDrawer = readFileSync(
  new URL("../office/components/production-worker-account-drawer.tsx", import.meta.url),
  "utf8",
);
const balanceService = readFileSync(
  new URL("./services/labourer-available-balance-service.ts", import.meta.url),
  "utf8",
);
const withdrawalService = readFileSync(
  new URL("./services/labourer-withdrawal-create-service.ts", import.meta.url),
  "utf8",
);

const withdrawalFunction = migration.slice(
  migration.indexOf("create or replace function public.create_labourer_withdrawal(\n  p_factory_id uuid,\n  p_labourer_id uuid,\n  p_withdrawal_date date,\n  p_settlement_cutoff date"),
  migration.indexOf("-- Compatibility for old clients"),
);

test("adds compact immutable settlement headers and daily snapshots", () => {
  assert.match(migration, /create table public\.production_earning_settlements/);
  assert.match(migration, /previous_settled_through date/);
  assert.match(migration, /settled_through date not null/);
  assert.match(migration, /settlement_type in \('legacy_opening', 'withdrawal'\)/);
  assert.match(migration, /create table public\.production_earning_settlement_details/);
  for (const column of ["production_entry_id", "work_date", "quantity", "production_wage_rate_id", "rate_per_1000_bricks", "earned_amount"]) {
    assert.match(migration, new RegExp(`${column} `));
  }
  assert.equal((migration.match(/reject_production_settlement_mutation\(\)/g) ?? []).length >= 3, true);
  assert.match(migration, /before update or delete on public\.production_earning_settlements/);
  assert.match(migration, /before update or delete on public\.production_earning_settlement_details/);
  assert.match(migration, /enable row level security/);
});

test("creates one legacy opening without rewriting weekly financial history", () => {
  assert.match(migration, /max\(weekly\.week_start \+ 6\)/);
  assert.match(migration, /sum\(weekly\.quantity_used\)::bigint/);
  assert.match(migration, /sum\(weekly\.amount\)/);
  assert.match(migration, /'legacy_opening'/);
  for (const table of ["weekly_earnings", "production_weekly_earning_details", "withdrawals"]) {
    const destructiveMutation = new RegExp(`(?:alter|drop|truncate|delete\\s+from|update)\\s+(?:table\\s+)?public\\.${table}\\b`, "i");
    assert.doesNotMatch(migration, destructiveMutation);
  }
});

test("one database authority calculates settled plus post-cutoff live earnings minus withdrawals", () => {
  assert.match(migration, /calculate_production_labourer_account/);
  assert.match(migration, /sum\(settlements\.total_earned\)/);
  assert.match(migration, /entries\.production_date > resolved_cutoff/);
  assert.match(migration, /resolve_production_wage_rate/);
  assert.match(migration, /available_balance := total_earned - resolved_total_withdrawn/);
  assert.match(balanceService, /rpc\("get_production_labourer_account"/);
  assert.doesNotMatch(balanceService, /\.from\("weekly_earnings"\)|\.from\("withdrawals"\)/);
});

test("withdrawal serializes, snapshots the full cutoff period, validates balance, and commits atomically", () => {
  assert.match(withdrawalFunction, /pg_advisory_xact_lock/);
  assert.match(withdrawalFunction, /production_account:/);
  assert.match(withdrawalFunction, /p_settlement_cutoff < previous_cutoff/);
  assert.match(withdrawalFunction, /p_withdrawal_date < latest_withdrawal_date/);
  assert.match(withdrawalFunction, /entries\.production_date <= p_settlement_cutoff/g);
  assert.match(withdrawalFunction, /insert into public\.production_earning_settlements/);
  assert.match(withdrawalFunction, /insert into public\.production_earning_settlement_details/);
  assert.match(withdrawalFunction, /p_amount > balance_before_withdrawal/);
  assert.match(withdrawalFunction, /insert into public\.withdrawals/);
  assert.match(withdrawalFunction, /settlement_id := new_settlement_id/);
});

test("UI makes withdrawal date and settlement cutoff separate with a previous-day default", () => {
  assert.match(withdrawalService, /getDefaultSettlementCutoff/);
  assert.match(withdrawalService, /shiftLocalDate\(withdrawalDate, -1\)/);
  assert.match(withdrawalService, /p_settlement_cutoff: settlementCutoff/);
  assert.match(accountDrawer, /Settle Production through/);
  assert.match(accountDrawer, /min=\{latestSettlementCutoff \?\? undefined\}/);
  assert.match(accountDrawer, /max=\{withdrawalDate \|\| undefined\}/);
  assert.match(accountDrawer, /existing settlement authority and locks Production earnings through the selected cutoff/);
});

test("the completed Production cutover hides Calculate Wages while preserving every non-Production wage boundary", () => {
  assert.doesNotMatch(dashboard, /Calculate Wages/);
  assert.doesNotMatch(migration, /create or replace function public\.calculate_production_wages/);
  for (const boundary of ["mud_supply", "transport_", "soil_", "staff_"]) {
    const tableMutation = new RegExp(`(?:alter|drop|truncate|delete\\s+from|update|insert\\s+into)\\s+(?:table\\s+)?public\\.${boundary}`, "i");
    assert.doesNotMatch(migration, tableMutation);
  }
});
