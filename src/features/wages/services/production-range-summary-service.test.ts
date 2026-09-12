import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { ProductionCrewAssignment } from "./production-crew-assignment-service.ts";
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

function assignment(
  id: string,
  crewId: string,
  effectiveFrom: string,
  effectiveTo: string | null,
): ProductionCrewAssignment {
  return {
    id,
    factoryId: "factory-a",
    labourerId: "labourer-a",
    productionCrewId: crewId,
    effectiveFrom,
    effectiveTo,
    createdAt: `${effectiveFrom}T00:00:00Z`,
    updatedAt: `${effectiveFrom}T00:00:00Z`,
  };
}

function crewRate(
  id: string,
  crewId: string,
  ratePer1000Bricks: number,
  effectiveFrom: string,
  effectiveTo: string | null,
): ProductionWageRate {
  return {
    id,
    factoryId: "factory-a",
    productionCrewId: crewId,
    labourerId: null,
    ratePer1000Bricks,
    effectiveFrom,
    effectiveTo,
    createdAt: `${effectiveFrom}T00:00:00Z`,
    updatedAt: `${effectiveFrom}T00:00:00Z`,
  };
}

function overrideRate(
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

test("resolves every work date across rate changes, crew moves, overrides, and wage weeks", () => {
  const result = calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [
      { productionDate: "2026-08-30", quantity: 1_000 },
      { productionDate: "2026-09-01", quantity: 1_000 },
      { productionDate: "2026-09-02", quantity: 1_000 },
      { productionDate: "2026-09-03", quantity: 500 },
      { productionDate: "2026-09-03", quantity: 500 },
      { productionDate: "2026-09-05", quantity: 1_000 },
      { productionDate: "2026-09-07", quantity: 1_000 },
      { productionDate: "2026-09-08", quantity: 1_000 },
    ],
    crewAssignments: [
      assignment("assignment-a", "crew-a", "2026-08-01", "2026-09-04"),
      assignment("assignment-b", "crew-b", "2026-09-05", null),
    ],
    wageRates: [
      crewRate("crew-a-old", "crew-a", 500, "2026-08-01", "2026-08-31"),
      crewRate("crew-a-new", "crew-a", 550, "2026-09-01", null),
      crewRate("crew-b", "crew-b", 600, "2026-08-01", null),
      overrideRate("override", 700, "2026-09-02", "2026-09-07"),
    ],
  });

  assert.equal(result.rangeProduction, 7_000);
  assert.equal(result.rangeEarned, 4_450);
  assert.deepEqual(result.days.map((day) => ({
    date: day.productionDate,
    rate: day.ratePer1000Bricks,
    source: day.rateSource,
    crew: day.productionCrewId,
    earned: day.earned,
  })), [
    { date: "2026-08-30", rate: 500, source: "crew_default", crew: "crew-a", earned: 500 },
    { date: "2026-09-01", rate: 550, source: "crew_default", crew: "crew-a", earned: 550 },
    { date: "2026-09-02", rate: 700, source: "individual_override", crew: null, earned: 700 },
    { date: "2026-09-03", rate: 700, source: "individual_override", crew: null, earned: 700 },
    { date: "2026-09-05", rate: 700, source: "individual_override", crew: null, earned: 700 },
    { date: "2026-09-07", rate: 700, source: "individual_override", crew: null, earned: 700 },
    { date: "2026-09-08", rate: 600, source: "crew_default", crew: "crew-b", earned: 600 },
  ]);
});

test("follows weekly lifecycle behavior for leave gaps while still allowing a dated override", () => {
  const crewAssignments = [
    assignment("before-leave", "crew-a", "2026-08-01", "2026-09-03"),
    assignment("after-return", "crew-a", "2026-09-08", null),
  ];
  const wageRates = [crewRate("crew-a", "crew-a", 500, "2026-08-01", null)];

  assert.throws(() => calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [{ productionDate: "2026-09-05", quantity: 1_000 }],
    crewAssignments,
    wageRates,
  }), /No production crew assignment.*2026-09-05/);

  const withOverride = calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [{ productionDate: "2026-09-05", quantity: 1_000 }],
    crewAssignments,
    wageRates: [...wageRates, overrideRate("leave-override", 650, "2026-09-05", "2026-09-05")],
  });
  assert.equal(withOverride.rangeEarned, 650);
});

test("a modern full-week calculation reconciles and current source edits remain informational", () => {
  const shared = {
    labourerId: "labourer-a",
    crewAssignments: [assignment("assignment-a", "crew-a", "2026-08-01", null)],
    wageRates: [crewRate("crew-a", "crew-a", 500, "2026-08-01", null)],
  };
  const settled = calculateProductionRangeSummary({
    ...shared,
    entries: [
      { productionDate: "2026-08-31", quantity: 2_000 },
      { productionDate: "2026-09-01", quantity: 3_000 },
    ],
  });
  assert.deepEqual(
    { quantityUsed: settled.rangeProduction, amount: settled.rangeEarned },
    { quantityUsed: 5_000, amount: 2_500 },
  );

  const editedCurrent = calculateProductionRangeSummary({
    ...shared,
    entries: [{ productionDate: "2026-09-11", quantity: 4_000 }],
  });
  assert.equal(editedCurrent.rangeEarned, 2_000);
  const reEditedCurrent = calculateProductionRangeSummary({
    ...shared,
    entries: [{ productionDate: "2026-09-11", quantity: 4_500 }],
  });
  assert.equal(reEditedCurrent.rangeEarned, 2_250);
});

test("an empty period has zero informational production and earnings", () => {
  assert.deepEqual(calculateProductionRangeSummary({
    labourerId: "labourer-a",
    entries: [],
    crewAssignments: [],
    wageRates: [],
  }), { rangeProduction: 0, rangeEarned: 0, days: [] });
});
