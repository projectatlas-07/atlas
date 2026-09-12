import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  getMondayWageWeekStart,
  isWageEarningsDateRange,
  resolveWageEarningsDateRange,
} from "./wage-earnings-date-range.ts";

test("wage earnings ranges default to This Week", () => {
  assert.equal(DEFAULT_WAGE_EARNINGS_DATE_PRESET, "this_week");
});

test("This Week resolves to the containing Monday through Sunday", () => {
  assert.deepEqual(resolveWageEarningsDateRange("this_week", "2026-09-11"), {
    fromDate: "2026-09-07",
    toDate: "2026-09-13",
  });
  assert.deepEqual(resolveWageEarningsDateRange("this_week", "2026-09-13"), {
    fromDate: "2026-09-07",
    toDate: "2026-09-13",
  });
});

test("Last Week resolves to the previous Monday through Sunday across months", () => {
  assert.deepEqual(resolveWageEarningsDateRange("last_week", "2026-09-02"), {
    fromDate: "2026-08-24",
    toDate: "2026-08-30",
  });
});

test("each work date resolves to its containing Monday wage-week start", () => {
  assert.equal(getMondayWageWeekStart("2026-09-07"), "2026-09-07");
  assert.equal(getMondayWageWeekStart("2026-09-09"), "2026-09-07");
  assert.equal(getMondayWageWeekStart("2026-09-13"), "2026-09-07");
  assert.equal(getMondayWageWeekStart("2026-09-14"), "2026-09-14");
  assert.equal(getMondayWageWeekStart("2026-02-30"), null);
});

test("This Month resolves to the first and last calendar day", () => {
  assert.deepEqual(resolveWageEarningsDateRange("this_month", "2026-02-10"), {
    fromDate: "2026-02-01",
    toDate: "2026-02-28",
  });
  assert.deepEqual(resolveWageEarningsDateRange("this_month", "2028-02-10"), {
    fromDate: "2028-02-01",
    toDate: "2028-02-29",
  });
});

test("Custom preserves both inclusive boundary dates", () => {
  assert.deepEqual(resolveWageEarningsDateRange(
    "custom",
    "2026-09-11",
    "2026-09-03",
    "2026-09-19",
  ), {
    fromDate: "2026-09-03",
    toDate: "2026-09-19",
  });
  assert.deepEqual(resolveWageEarningsDateRange(
    "custom",
    "2026-09-11",
    "2026-09-03",
    "2026-09-03",
  ), {
    fromDate: "2026-09-03",
    toDate: "2026-09-03",
  });
});

test("invalid dates and reversed Custom ranges fail closed", () => {
  assert.equal(resolveWageEarningsDateRange("this_week", "2026-02-30"), null);
  assert.equal(resolveWageEarningsDateRange(
    "today" as never,
    "2026-09-11",
  ), null);
  assert.equal(resolveWageEarningsDateRange(
    "custom",
    "2026-09-11",
    "",
    "2026-09-19",
  ), null);
  assert.equal(resolveWageEarningsDateRange(
    "custom",
    "2026-09-11",
    "2026-09-20",
    "2026-09-19",
  ), null);
  assert.equal(isWageEarningsDateRange({
    fromDate: "2026-09-20",
    toDate: "2026-09-19",
  }), false);
});
