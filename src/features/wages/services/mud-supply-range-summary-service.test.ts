import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { WageRate } from "./wage-rate-service.ts";

type QueryCall = [method: string, column?: string, value?: string];
type ProductionRow = { production_date: string; quantity: number };

const calls: QueryCall[] = [];
let response: { data: ProductionRow[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return this;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        return this;
      },
      gte(column: string, value: string) {
        calls.push(["gte", column, value]);
        return this;
      },
      lte(column: string, value: string) {
        calls.push(["lte", column, value]);
        return this;
      },
      order(column: string) {
        calls.push(["order", column]);
        return Promise.resolve(response);
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  calculateMudSupplyRangeSummary,
  listMudSupplyProductionForRange,
} = await import("./mud-supply-range-summary-service.ts");

function mudRate(
  id: string,
  ratePer1000Bricks: number,
  effectiveFrom: string,
  effectiveTo: string | null,
): WageRate {
  return {
    id,
    applies_to: "mud_supply",
    rate_per_1000_bricks: ratePer1000Bricks,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
  };
}

test("reads all eligible factory production inside the inclusive work-date range", async () => {
  calls.length = 0;
  response = {
    data: [
      { production_date: "2026-09-09", quantity: 2_000 },
      { production_date: "2026-09-17", quantity: 3_000 },
    ],
    error: null,
  };

  assert.deepEqual(await listMudSupplyProductionForRange({
    factoryId: "factory-a",
    range: { fromDate: "2026-09-09", toDate: "2026-09-17" },
  }), [
    { productionDate: "2026-09-09", quantity: 2_000 },
    { productionDate: "2026-09-17", quantity: 3_000 },
  ]);
  assert.deepEqual(calls, [
    ["from", "production_entries"],
    ["select", "production_date, quantity"],
    ["eq", "factory_id", "factory-a"],
    ["gte", "production_date", "2026-09-09"],
    ["lte", "production_date", "2026-09-17"],
    ["order", "production_date"],
  ]);
});

test("rejects invalid range input before reading Production", async () => {
  calls.length = 0;
  await assert.rejects(
    () => listMudSupplyProductionForRange({
      factoryId: "factory-a",
      range: { fromDate: "2026-09-18", toDate: "2026-09-17" },
    }),
    /valid inclusive date range/,
  );
  await assert.rejects(
    () => listMudSupplyProductionForRange({
      factoryId: "",
      range: { fromDate: "2026-09-17", toDate: "2026-09-17" },
    }),
    /Factory is required/,
  );
  assert.deepEqual(calls, []);
});

test("a range spanning a mid-week change uses each date's exact historical Mud rate", () => {
  const entries = [
    "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13",
    "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17",
  ].map((productionDate) => ({ productionDate, quantity: 1_000 }));
  const result = calculateMudSupplyRangeSummary({
    entries,
    wageRates: [
      mudRate("rate-a", 230, "2026-09-01", "2026-09-14"),
      mudRate("rate-b", 250, "2026-09-15", null),
      { id: "production", applies_to: "production", rate_per_1000_bricks: 900, effective_from: "2026-09-07", effective_to: null },
    ],
    range: { fromDate: "2026-09-09", toDate: "2026-09-17" },
  });

  assert.equal(result.rangeProduction, 9_000);
  assert.equal(result.rangeEarned, 2_130);
  assert.deepEqual(result.days.map((day) => day.ratePer1000Bricks), [
    230, 230, 230, 230, 230, 230, 250, 250, 250,
  ]);
  assert.deepEqual(result.ratePeriods, [
    { wageRateId: "rate-a", ratePer1000Bricks: 230, fromDate: "2026-09-09", toDate: "2026-09-14" },
    { wageRateId: "rate-b", ratePer1000Bricks: 250, fromDate: "2026-09-15", toDate: "2026-09-17" },
  ]);
});

test("daily quantities are summed before applying the existing no-rounding Mud formula", () => {
  const result = calculateMudSupplyRangeSummary({
    entries: [
      { productionDate: "2026-09-09", quantity: 500 },
      { productionDate: "2026-09-09", quantity: 243 },
    ],
    wageRates: [mudRate("rate-a", 230, "2026-09-07", null)],
    range: { fromDate: "2026-09-09", toDate: "2026-09-09" },
  });

  assert.equal(result.rangeProduction, 743);
  assert.equal(result.rangeEarned, 170.89);
  assert.deepEqual(result.days, [{
    productionDate: "2026-09-09",
    quantity: 743,
    ratePer1000Bricks: 230,
    earned: 170.89,
  }]);
  assert.deepEqual(result.ratePeriods, [{
    wageRateId: "rate-a",
    ratePer1000Bricks: 230,
    fromDate: "2026-09-09",
    toDate: "2026-09-09",
  }]);
});

test("an unchanged complete week reconciles and unfinished source edits remain informational", () => {
  const wageRates = [mudRate("week-a", 230, "2026-08-31", null)];
  const settled = calculateMudSupplyRangeSummary({
    entries: [
      { productionDate: "2026-08-31", quantity: 3_000 },
      { productionDate: "2026-09-06", quantity: 4_000 },
    ],
    wageRates,
    range: { fromDate: "2026-08-31", toDate: "2026-09-06" },
  });
  const lockedWeeklyEarning = { quantityUsed: 7_000, amount: 1_610 };
  assert.deepEqual(
    { quantityUsed: settled.rangeProduction, amount: settled.rangeEarned },
    lockedWeeklyEarning,
  );

  const current = calculateMudSupplyRangeSummary({
    entries: [{ productionDate: "2026-09-09", quantity: 5_000 }],
    wageRates,
    range: { fromDate: "2026-09-07", toDate: "2026-09-13" },
  });
  const editedCurrent = calculateMudSupplyRangeSummary({
    entries: [{ productionDate: "2026-09-09", quantity: 5_500 }],
    wageRates,
    range: { fromDate: "2026-09-07", toDate: "2026-09-13" },
  });
  assert.equal(current.rangeEarned, 1_150);
  assert.equal(editedCurrent.rangeEarned, 1_265);
});

test("missing or overlapping historical Mud rates fail instead of fabricating earnings", () => {
  const entries = [{ productionDate: "2026-09-09", quantity: 1_000 }];
  assert.throws(
    () => calculateMudSupplyRangeSummary({ entries, wageRates: [], range: { fromDate: "2026-09-09", toDate: "2026-09-09" } }),
    /Mud rate not set for 2026-09-09/,
  );
  assert.throws(
    () => calculateMudSupplyRangeSummary({
      entries,
      wageRates: [
        mudRate("a", 230, "2026-09-07", null),
        mudRate("b", 250, "2026-09-07", null),
      ],
      range: { fromDate: "2026-09-09", toDate: "2026-09-09" },
    }),
    /Overlapping Mud rates apply on 2026-09-09/,
  );
});

test("missing coverage is explicit even when the uncovered date has no Production", () => {
  assert.throws(() => calculateMudSupplyRangeSummary({
    entries: [{ productionDate: "2026-09-15", quantity: 1_000 }],
    wageRates: [mudRate("late", 250, "2026-09-15", null)],
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
  }), /Mud rate not set for 2026-09-01/);
});

test("an empty Production period stays zero but still reports its one applicable rate", () => {
  assert.deepEqual(calculateMudSupplyRangeSummary({
    entries: [],
    wageRates: [mudRate("rate", 230, "2026-08-01", null)],
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
  }), {
    rangeProduction: 0,
    rangeEarned: 0,
    ratePeriods: [{ wageRateId: "rate", ratePer1000Bricks: 230, fromDate: "2026-09-01", toDate: "2026-09-30" }],
    days: [],
  });
});
