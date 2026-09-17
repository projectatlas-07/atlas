import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../../supabase/migrations/20260916000057_add_mud_shadow_certification_gate.sql", import.meta.url), "utf8");

test("certification is derived from the latest completed locked Mud week", () => {
  assert.match(migration, /max\(earnings\.week_start\)/);
  assert.match(migration, /earnings\.week_start \+ 6 < business_today/);
  assert.match(migration, /get_mud_shadow_weekly_comparisons/);
  assert.match(migration, /comparison_count <> 1/);
  assert.match(migration, /comparison\.status = 'PARITY_OK'/);
});

test("only exact parity is READY and rate-change correctness remains non-certifying", () => {
  assert.match(migration, /'READY'::text/);
  assert.match(migration, /'WAITING_FOR_COMPLETED_WEEK'::text/);
  assert.match(migration, /'CONFIGURATION_ERROR'::text/);
  assert.match(migration, /'UNEXPECTED_MISMATCH'::text/);
  assert.match(migration, /mid-week Mud rate change[\s\S]*cannot certify settlement cutover/);
});

test("both transition authority and table guard reject uncertified SETTLEMENT", () => {
  const guardMessage = /Mud settlement cutover requires a completed SHADOW week with PARITY_OK\./g;
  assert.equal([...migration.matchAll(guardMessage)].length, 2);
  assert.match(migration, /old\.accounting_mode = 'SHADOW' and new\.accounting_mode = 'SETTLEMENT'/);
  assert.match(migration, /current_mode = 'SHADOW' and p_new_mode = 'SETTLEMENT'/);
  assert.match(migration, /using errcode = 'P3100'/);
});

test("LEGACY_WEEKLY to SHADOW remains an allowed transition", () => {
  assert.match(migration, /old\.accounting_mode = 'LEGACY_WEEKLY' and new\.accounting_mode = 'SHADOW'/);
  assert.match(migration, /current_mode = 'LEGACY_WEEKLY' and p_new_mode = 'SHADOW'/);
});
