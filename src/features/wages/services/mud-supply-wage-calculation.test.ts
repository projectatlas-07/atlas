import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateInformationalPerMemberShare,
  calculateMudSupplyGroupWage,
  getActiveMudSupplyRate,
} from "./mud-supply-wage-calculation.ts";

test("calculates the authoritative group earning without rounding", () => {
  assert.equal(calculateMudSupplyGroupWage(100000, 230), 23000);
  assert.equal(calculateMudSupplyGroupWage(743, 230), 170.89);
  assert.equal(calculateMudSupplyGroupWage(0, 230), 0);
});

test("calculates the informational per-member share without rounding", () => {
  assert.equal(calculateInformationalPerMemberShare(23000, 8), 2875);
  assert.equal(calculateInformationalPerMemberShare(100, 3), 100 / 3);
});

test("rejects invalid calculation inputs", () => {
  assert.throws(() => calculateMudSupplyGroupWage(-1, 230), /greater than or equal to zero/);
  assert.throws(() => calculateMudSupplyGroupWage(1000, 0), /greater than zero/);
  assert.throws(() => calculateInformationalPerMemberShare(-1, 8), /greater than or equal to zero/);
  assert.throws(() => calculateInformationalPerMemberShare(23000, 0), /positive integer/);
  assert.throws(() => calculateInformationalPerMemberShare(23000, 1.5), /positive integer/);
});

test("resolves only the factory-wide mud-supply rate through the shared resolver", () => {
  const mudRate = { id: "mud", applies_to: "mud_supply" as const, rate_per_1000_bricks: 230, effective_from: "2026-07-27", effective_to: null };
  const productionRate = { id: "production", applies_to: "production" as const, rate_per_1000_bricks: 530, effective_from: "2026-07-27", effective_to: null };

  assert.equal(getActiveMudSupplyRate([productionRate, mudRate], "2026-08-03"), mudRate);
});
