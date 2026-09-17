import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../../supabase/migrations/20260916000058_add_mud_cutover_readiness_preview.sql", import.meta.url), "utf8");

test("readiness requires SHADOW plus READY PARITY_OK certification", () => {
  assert.match(migration, /current_mode <> 'SHADOW'/);
  assert.match(migration, /certification\.certification_status <> 'READY'/);
  assert.match(migration, /certification\.parity_status <> 'PARITY_OK'/);
  assert.match(migration, /'READY_FOR_CUTOVER'::text/);
  assert.match(migration, /'BLOCKED'::text/);
});

test("readiness blocks duplicate cutover and derives a strict Sunday to Monday boundary", () => {
  assert.match(migration, /mud_factory_settlements/);
  assert.match(migration, /mud_group_legacy_openings/);
  assert.match(migration, /resolved_cutoff := coalesce\(p_cutoff_override, resolved_final_week \+ 6\)/);
  assert.match(migration, /extract\(isodow from resolved_cutoff\) <> 7/);
  assert.match(migration, /extract\(isodow from resolved_settlement_start\) <> 1/);
});

test("preview keeps opening earnings and withdrawals separate with exact balance", () => {
  assert.match(migration, /legacy_locked_earning_total numeric/);
  assert.match(migration, /existing_withdrawals numeric/);
  assert.match(migration, /proposed_opening_amount numeric/);
  assert.match(migration, /resulting_balance numeric/);
  assert.match(migration, /preview_group\.locked_earned - preview_group\.withdrawn < 0/);
});

test("preview is read-only and validates next-day member/rate allocation", () => {
  assert.match(migration, /get_mud_group_daily_allocation/);
  assert.doesNotMatch(migration, /insert into public\.(mud_factory_settlements|mud_group_legacy_openings)/i);
  assert.doesNotMatch(migration, /transition_mud_accounting_mode\s*\(/i);
});
