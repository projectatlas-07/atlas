import assert from "node:assert/strict";
import test from "node:test";

import { assertCompletedWageWeek } from "./completed-wage-week-validation.ts";

test("allows a completed past week", () => {
  assert.doesNotThrow(() => assertCompletedWageWeek("2026-07-27", "2026-08-03"));
});

test("rejects the current week", () => {
  assert.throws(
    () => assertCompletedWageWeek("2026-08-03", "2026-08-06"),
    /Week starting 2026-08-03 is not completed yet/,
  );
});

test("rejects a future week", () => {
  assert.throws(
    () => assertCompletedWageWeek("2026-08-10", "2026-08-08"),
    /Week starting 2026-08-10 is not completed yet/,
  );
});

test("rejects the week on its Sunday", () => {
  assert.throws(
    () => assertCompletedWageWeek("2026-08-03", "2026-08-09"),
    /Week starting 2026-08-03 is not completed yet/,
  );
});

test("allows the previous week on the following Monday", () => {
  assert.doesNotThrow(() => assertCompletedWageWeek("2026-08-03", "2026-08-10"));
});

test("rejects a non-Monday week start", () => {
  assert.throws(
    () => assertCompletedWageWeek("2026-08-04", "2026-08-10"),
    /week_start must be a Monday/,
  );
});
