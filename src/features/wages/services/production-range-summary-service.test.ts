import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { ProductionWageRate } from "./production-wage-rate-read-service.ts";

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
  calculateProductionRangeSummary,
  listLabourerProductionEntriesForRange,
} = await import("./production-range-summary-service.ts");

function directRate(
  id: string,
  ratePer1000Bricks: number,
  effectiveFrom: string,
  effectiveTo: string | null,
): ProductionWageRate {
  return {
    id,
    factoryId: "factory-a",
    productionCrewId: null,
    labourerId: "labourer-a",
    ratePer1000Bricks,
    effectiveFrom,
    effectiveTo,
    createdAt: `${effectiveFrom}T00:00:00Z`,
    updatedAt: `${effectiveFrom}T00:00:00Z`,
  };
}

test("reads only the selected factory, labourer, and inclusive production-date range", async () => {
  calls.length = 0;
  response = {
    data: [
      { production_date: "2026-09-03", quantity: 1_250 },
      { production_date: "2026-09-09", quantity: 2_000 },
    ],
    error: null,
  };

  assert.deepEqual(await listLabourerProductionEntriesForRange({
    factoryId: "factory-a",
    labourerId: "labourer-a",
    range: { fromDate: "2026-09-03", toDate: "2026-09-09" },
  }), [
    { productionDate: "2026-09-03", quantity: 1_250 },
    { productionDate: "2026-09-09", quantity: 2_000 },
  ]);
  assert.deepEqual(calls, [
    ["from", "production_entries"],
    ["select", "production_date, quantity"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "labourer_id", "labourer-a"],
    ["gte", "production_date", "2026-09-03"],
    ["lte", "production_date", "2026-09-09"],
    ["order", "production_date"],
  ]);
});

test("rejects invalid identifiers and date ranges before reading production", async () => {
  calls.length = 0;
  await assert.rejects(
    () => listLabourerProductionEntriesForRange({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      range: { fromDate: "2026-09-10", toDate: "2026-09-09" },
    }),
    /valid inclusive date range/,
  );
  await assert.rejects(
    () => listLabourerProductionEntriesForRange({
      factoryId: "factory-a",
      labourerId: "",
      range: { fromDate: "2026-09-09", toDate: "2026-09-09" },
    }),
    /Labourer is required/,
  );
  assert.deepEqual(calls, []);
});

test("uses each direct rate period and aggregates same-day production", () => {
  const result = calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [
      { productionDate: "2026-09-01", quantity: 10_000 },
      { productionDate: "2026-09-01", quantity: 15_000 },
      { productionDate: "2026-09-20", quantity: 25_000 },
    ],
    wageRates: [
      directRate("rate-800", 800, "2026-09-01", "2026-09-14"),
      directRate("rate-900", 900, "2026-09-15", null),
    ],
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
  });

  assert.equal(result.rangeProduction, 50_000);
  assert.equal(result.rangeEarned, 42_500);
  assert.deepEqual(result.days.map((day) => ({
    date: day.productionDate,
    rate: day.ratePer1000Bricks,
    source: day.rateSource,
    earned: day.earned,
  })), [
    { date: "2026-09-01", rate: 800, source: "direct_labourer", earned: 20_000 },
    { date: "2026-09-20", rate: 900, source: "direct_labourer", earned: 22_500 },
  ]);
  assert.deepEqual(result.ratePeriods, [
    { productionWageRateId: "rate-800", ratePer1000Bricks: 800, fromDate: "2026-09-01", toDate: "2026-09-14" },
    { productionWageRateId: "rate-900", ratePer1000Bricks: 900, fromDate: "2026-09-15", toDate: "2026-09-30" },
  ]);
});

test("missing direct rates fail explicitly instead of earning zero", () => {
  assert.throws(() => calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [{ productionDate: "2026-09-05", quantity: 1_000 }],
    wageRates: [{ ...directRate("crew-row", 500, "2026-08-01", null), labourerId: null, productionCrewId: "legacy-crew" }],
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
  }), /Rate not set for this labourer on 2026-09-05/);
});

test("a single direct rate reports one used period and live production stays informational", () => {
  const result = calculateProductionRangeSummary({
    labourerId: "labourer-a",
    wageRates: [directRate("rate", 800, "2026-08-01", null)],
    entries: [
      { productionDate: "2026-09-10", quantity: 20_000 },
      { productionDate: "2026-09-11", quantity: 30_000 },
    ],
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
  });
  assert.deepEqual({ production: result.rangeProduction, earned: result.rangeEarned }, { production: 50_000, earned: 40_000 });
  assert.deepEqual(result.ratePeriods, [{ productionWageRateId: "rate", ratePer1000Bricks: 800, fromDate: "2026-09-01", toDate: "2026-09-30" }]);
});

test("an empty period has zero informational production and earnings", () => {
  assert.deepEqual(calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [],
    wageRates: [],
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
  }), { rangeProduction: 0, rangeEarned: 0, ratePeriods: [], days: [] });
});
