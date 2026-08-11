import assert from "node:assert/strict";
import test from "node:test";

import { calculateProductionWage } from "./production-wage-calculation.ts";

test("calculates ₹2,600 for 5,000 bricks at ₹520 per 1,000", () => {
  assert.equal(calculateProductionWage(5000, 520), 2600);
});

test("calculates ₹2,650 for 5,000 bricks at ₹530 per 1,000", () => {
  assert.equal(calculateProductionWage(5000, 530), 2650);
});

test("preserves the formula result without rounding", () => {
  assert.equal(calculateProductionWage(743, 530), 393.79);
});

test("returns zero for zero quantity", () => {
  assert.equal(calculateProductionWage(0, 530), 0);
});

test("rejects negative quantity and non-positive rate", () => {
  assert.throws(() => calculateProductionWage(-1, 530), /Quantity must be greater than or equal to zero/);
  assert.throws(() => calculateProductionWage(1000, 0), /Rate per 1,000 bricks must be greater than zero/);
  assert.throws(() => calculateProductionWage(1000, -1), /Rate per 1,000 bricks must be greater than zero/);
});
