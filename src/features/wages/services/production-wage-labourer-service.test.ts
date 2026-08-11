import assert from "node:assert/strict";
import { mock, test } from "node:test";

type QueryCall = [table: string, method: string, column?: string, value?: string | string[]];

const calls: QueryCall[] = [];
let productionResponse: { data: Array<{ labourer_id: string; quantity: number }> | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  from(table: "production_entries") {
    return {
      select(columns: string) {
        calls.push([table, "select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push([table, "eq", column, value]);
            return this;
          },
          gte(column: string, value: string) {
            calls.push([table, "gte", column, value]);
            return this;
          },
          lte(column: string, value: string) {
            calls.push([table, "lte", column, value]);
            return Promise.resolve(productionResponse);
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getProductionWageLabourers } = await import("./production-wage-labourer-service.ts");

function setResponses(
  productionData: Array<{ labourer_id: string; quantity: number }> | null,
  productionError: { message: string } | null = null,
) {
  calls.length = 0;
  productionResponse = { data: productionData, error: productionError };
}

test("sums production separately for each labourer", async () => {
  setResponses(
    [
      { labourer_id: "labourer-b", quantity: 50 },
      { labourer_id: "labourer-a", quantity: 100 },
      { labourer_id: "labourer-a", quantity: 25 },
    ],
  );

  assert.deepEqual(await getProductionWageLabourers({ factoryId: "factory-a", weekStart: "2026-08-03" }), [
    { labourerId: "labourer-a", quantity: 125 },
    { labourerId: "labourer-b", quantity: 50 },
  ]);
  assert.deepEqual(calls, [
    ["production_entries", "select", "labourer_id, quantity"],
    ["production_entries", "eq", "factory_id", "factory-a"],
    ["production_entries", "gte", "production_date", "2026-08-03"],
    ["production_entries", "lte", "production_date", "2026-08-09"],
  ]);
});

test("returns an empty list when the week has no production", async () => {
  setResponses([]);

  assert.deepEqual(await getProductionWageLabourers({ factoryId: "factory-a", weekStart: "2026-08-03" }), []);
});

test("rejects a non-Monday week before querying Supabase", async () => {
  setResponses([]);

  await assert.rejects(
    () => getProductionWageLabourers({ factoryId: "factory-a", weekStart: "2026-08-04" }),
    /week_start must be a Monday/,
  );
  assert.deepEqual(calls, []);
});

test("surfaces production request failures", async () => {
  setResponses(null, { message: "Production request failed." });
  await assert.rejects(
    () => getProductionWageLabourers({ factoryId: "factory-a", weekStart: "2026-08-03" }),
    /Production request failed/,
  );
});
