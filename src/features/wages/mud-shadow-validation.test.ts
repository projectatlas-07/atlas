import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const phase4Migration = readFileSync(
  new URL("../../../supabase/migrations/20260916000055_create_mud_shadow_comparison_readout.sql", import.meta.url),
  "utf8",
);
const migration = phase4Migration + readFileSync(
  new URL("../../../supabase/migrations/20260916000056_fix_mud_shadow_uuid_aggregation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_mud_shadow_validation.sql", import.meta.url),
  "utf8",
);

describe("parity_tests", () => {
  test("constant-rate single-group weeks require exact numeric parity", () => {
    const dailyProduction = [1000, 1000, 1000, 1000, 1000, 1000, 1000];
    const newDailyTotal = dailyProduction.reduce((sum, quantity) => sum + quantity * 100 / 1000, 0);
    const legacyWeeklyTotal = dailyProduction.reduce((sum, quantity) => sum + quantity, 0) * 100 / 1000;
    assert.equal(newDailyTotal, 700);
    assert.equal(newDailyTotal, legacyWeeklyTotal);
    assert.match(migration, /if difference = 0 then[\s\S]*status := 'PARITY_OK'/);
  });

  test("constant-rate differences remain visible as unexpected mismatches", () => {
    assert.match(migration, /status := 'UNEXPECTED_MISMATCH'/);
    assert.match(verifier, /legacy_earning <> 701[\s\S]*new_engine_earning <> 700[\s\S]*difference <> -1/);
  });
});

describe("mud_rate_change_correctness_tests", () => {
  test("daily rates produce the exact hand-calculated total", () => {
    const production = [1000, 1000, 1000, 1000, 1000, 1000, 1000];
    const rates = [100, 100, 100, 120, 120, 120, 120];
    const expectedDailyCorrect = production.reduce((sum, quantity, index) => sum + quantity * rates[index] / 1000, 0);
    const legacyMondayRate = production.reduce((sum, quantity) => sum + quantity, 0) * rates[0] / 1000;
    assert.equal(expectedDailyCorrect, 780);
    assert.equal(legacyMondayRate, 700);
    assert.equal(expectedDailyCorrect - legacyMondayRate, 80);
    assert.match(migration, /status := 'EXPECTED_RATE_CHANGE_DIFFERENCE'/);
    assert.match(verifier, /legacy_earning <> 700[\s\S]*new_engine_earning <> 780[\s\S]*difference <> 80/);
  });
});

test("SHADOW readout reports configuration failures without falling back to legacy values", () => {
  assert.match(migration, /status := 'CONFIGURATION_ERROR'/);
  assert.match(migration, /new_engine_earning := null/);
  assert.match(migration, /difference := null/);
  assert.doesNotMatch(migration, /new_engine_earning := legacy_row\.amount/);
});

test("Phase 4 does not mutate financial authority or settlement data", () => {
  assert.doesNotMatch(migration, /create or replace function public\.(calculate_mud_supply_wages|create_labour_group_withdrawal|create_mud_factory_settlement|create_mud_legacy_opening)/);
  assert.doesNotMatch(migration, /insert into public\.(withdrawals|weekly_earnings|mud_factory_settlements|mud_group_legacy_openings)/);
  assert.doesNotMatch(migration, /update public\.mud_accounting_states/);
});
