import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = {
  id: string;
  factory_id: string;
  production_crew_id: string | null;
  labourer_id: string | null;
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type Call = [method: string, value?: unknown, secondValue?: unknown];
const calls: Call[] = [];
let response: { data: Row[] | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        let orderCount = 0;
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            orderCount += 1;
            return orderCount === 2 ? Promise.resolve(response) : this;
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const {
  getCurrentCrewProductionWageRate,
  getCurrentLabourerProductionWageRateOverride,
  getProductionWageRatesForFactory,
} = await import("./production-wage-rate-read-service.ts");

function row(overrides: Partial<Row>): Row {
  return {
    id: "rate-a",
    factory_id: "factory-a",
    production_crew_id: "crew-a",
    labourer_id: null,
    rate_per_1000_bricks: 520,
    effective_from: "2026-08-01",
    effective_to: null,
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

test("reads factory-scoped production rates and maps crew and labourer rows", async () => {
  calls.length = 0;
  response = { data: [row({}), row({ id: "override-a", production_crew_id: null, labourer_id: "labourer-a", rate_per_1000_bricks: 550 })], error: null };

  const rates = await getProductionWageRatesForFactory("factory-a");
  assert.deepEqual(rates[0], {
    id: "rate-a",
    factoryId: "factory-a",
    productionCrewId: "crew-a",
    labourerId: null,
    ratePer1000Bricks: 520,
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z",
  });
  assert.equal(rates[1].labourerId, "labourer-a");
  assert.deepEqual(calls, [
    ["from", "production_wage_rates"],
    ["select", "id, factory_id, production_crew_id, labourer_id, rate_per_1000_bricks, effective_from, effective_to, created_at, updated_at"],
    ["eq", "factory_id", "factory-a"],
    ["order", "effective_from", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("selects crew and labourer current rates only when their period covers the date", () => {
  const rates = [
    row({ id: "crew-expired", effective_from: "2026-07-01", effective_to: "2026-07-31" }),
    row({ id: "crew-current", effective_from: "2026-08-01", effective_to: "2026-08-31" }),
    row({ id: "crew-future", effective_from: "2026-09-01", effective_to: null }),
    row({ id: "override-expired", production_crew_id: null, labourer_id: "labourer-a", effective_from: "2026-07-01", effective_to: "2026-07-31" }),
    row({ id: "override-current", production_crew_id: null, labourer_id: "labourer-a", effective_from: "2026-08-10", effective_to: "2026-08-20" }),
    row({ id: "override-future", production_crew_id: null, labourer_id: "labourer-a", effective_from: "2026-08-21", effective_to: null }),
  ].map((item) => ({
    id: item.id,
    factoryId: item.factory_id,
    productionCrewId: item.production_crew_id,
    labourerId: item.labourer_id,
    ratePer1000Bricks: item.rate_per_1000_bricks,
    effectiveFrom: item.effective_from,
    effectiveTo: item.effective_to,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));

  assert.equal(getCurrentCrewProductionWageRate(rates, "crew-a", "2026-08-16")?.id, "crew-current");
  assert.equal(getCurrentLabourerProductionWageRateOverride(rates, "labourer-a", "2026-08-16")?.id, "override-current");
  assert.equal(getCurrentCrewProductionWageRate(rates, "crew-a", "2026-06-01"), null);
  assert.equal(getCurrentLabourerProductionWageRateOverride(rates, "labourer-a", "2026-08-05"), null);
});
