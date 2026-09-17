import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260915000050_protect_settled_production_cutover.sql", import.meta.url),
  "utf8",
);
const entryScreen = readFileSync(
  new URL("./components/production-entry-screen.tsx", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../office/components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const balanceService = readFileSync(
  new URL("../wages/services/labourer-available-balance-service.ts", import.meta.url),
  "utf8",
);
const dailyUniquenessMigration = readFileSync(
  new URL("../../../supabase/migrations/20260802000007_make_daily_production_unique_per_labourer.sql", import.meta.url),
  "utf8",
);

const saveFunction = migration.slice(
  migration.indexOf("create or replace function public.save_production_entry"),
  migration.indexOf("revoke insert, update, delete on public.production_entries"),
);
const rateFunction = migration.slice(
  migration.indexOf("create or replace function public.set_production_labourer_rates"),
  migration.indexOf("-- Keep the legacy signature"),
);
const legacyCalculator = migration.slice(
  migration.indexOf("create or replace function public.calculate_production_wages"),
  migration.indexOf("comment on function public.save_production_entry"),
);

test("Production entry UI uses one controlled RPC and no direct table mutation", () => {
  assert.match(entryScreen, /rpc\("save_production_entry"/);
  assert.match(entryScreen, /p_entry_id: payload\.savedEntryId \?\? payload\.newEntryId/);
  assert.doesNotMatch(entryScreen, /\.from\("production_entries"\)[\s\S]{0,100}\.(?:insert|update|delete)\(/);
  assert.match(migration, /revoke insert, update, delete on public\.production_entries from authenticated/);
});

test("save RPC preserves one daily row, retry identity, and brick snapshot semantics", () => {
  assert.match(dailyUniquenessMigration, /unique \(factory_id, labourer_id, production_date\)/);
  assert.match(saveFunction, /pg_advisory_xact_lock|assert_production_date_is_unsettled/);
  assert.match(saveFunction, /on conflict \(factory_id, labourer_id, production_date\)/);
  assert.match(saveFunction, /do update set quantity = excluded\.quantity/);
  assert.doesNotMatch(saveFunction, /do update set[^;]*brick_type_id/s);
  assert.match(saveFunction, /Production entry does not belong to this labourer and date/);
});

test("database trigger blocks insert, update, and delete through the latest settlement cutoff", () => {
  assert.match(migration, /before insert or update or delete on public\.production_entries/);
  assert.match(migration, /p_production_date <= latest_cutoff/);
  assert.match(migration, /Production through % is settled and cannot be changed/);
  assert.match(migration, /using errcode = 'P2520'/);
  assert.match(migration, /Production record identity and brick type snapshot cannot be changed/);
});

test("Production saves and settlements share the exact same account lock", () => {
  assert.match(migration, /production_account:/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(saveFunction, /assert_production_date_is_unsettled/);
});

test("direct rate authority locks each sorted labourer and rejects settled effective dates atomically", () => {
  assert.match(rateFunction, /order by selected\.labourer_id/);
  assert.match(rateFunction, /pg_advisory_xact_lock/);
  assert.match(rateFunction, /production_account:/);
  assert.match(rateFunction, /p_effective_from <= latest_cutoff/);
  assert.match(rateFunction, /using errcode = 'P2521'/);
  assert.match(rateFunction, /set effective_to = p_effective_from - 1/);
  assert.doesNotMatch(rateFunction, /set_production_labourer_origin/);
});

test("active Production no longer exposes or depends on Calculate Wages", () => {
  assert.doesNotMatch(dashboard, /Calculate Wages/);
  assert.match(legacyCalculator, /Production earnings are continuous\. Calculate Wages is no longer used/);
  assert.doesNotMatch(legacyCalculator, /insert into public\.weekly_earnings|insert into public\.production_weekly_earning_details/);
  assert.match(balanceService, /rpc\("get_production_labourer_account"/);
});

test("Mud and every unrelated module remain outside the cutover", () => {
  assert.doesNotMatch(migration, /create or replace function public\.calculate_mud_supply_wages/);
  assert.match(migration, /Mud Supply uses calculate_mud_supply_wages and is unaffected/);
  for (const boundary of ["transport_", "soil_", "staff_", "challans", "coal_", "vehicle_", "expense_"]) {
    const mutation = new RegExp(`(?:alter|drop|truncate|delete\\s+from|update|insert\\s+into)\\s+(?:table\\s+)?public\\.${boundary}`, "i");
    assert.doesNotMatch(migration, mutation);
  }
});

test("normal UI shows controlled settlement errors instead of raw database failures", () => {
  assert.match(entryScreen, /failure\.code === "p2520"/);
  assert.match(entryScreen, /You do not have access to save this Production entry/);
  assert.match(entryScreen, /The Production save could not be completed\. Please try again/);
});
