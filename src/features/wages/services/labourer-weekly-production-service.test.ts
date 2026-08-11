import assert from "node:assert/strict";
import { mock, test } from "node:test";

type QueryCall = [method: string, column?: string, value?: string];

const calls: QueryCall[] = [];
let response: { data: Array<{ quantity: number }> | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return {
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
            return Promise.resolve(response);
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourerWeeklyProduction } = await import("./labourer-weekly-production-service.ts");

function setResponse(data: Array<{ quantity: number }> | null, error: { message: string } | null = null) {
  calls.length = 0;
  response = { data, error };
}

test("sums Monday–Sunday production and applies every factory, labourer, and date filter", async () => {
  setResponse([{ quantity: 120 }, { quantity: 80 }]);

  const total = await getLabourerWeeklyProduction({
    factoryId: "factory-a",
    labourerId: "labourer-a",
    weekStart: "2026-08-03",
  });

  assert.equal(total, 200);
  assert.deepEqual(calls, [
    ["from", "production_entries"],
    ["select", "quantity"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "labourer_id", "labourer-a"],
    ["gte", "production_date", "2026-08-03"],
    ["lte", "production_date", "2026-08-09"],
  ]);
});

test("returns zero when the week has no production", async () => {
  setResponse([]);

  assert.equal(await getLabourerWeeklyProduction({
    factoryId: "factory-a",
    labourerId: "labourer-a",
    weekStart: "2026-08-03",
  }), 0);
});

test("rejects a non-Monday week before querying Supabase", async () => {
  setResponse([{ quantity: 100 }]);

  await assert.rejects(
    () => getLabourerWeeklyProduction({ factoryId: "factory-a", labourerId: "labourer-a", weekStart: "2026-08-04" }),
    /week_start must be a Monday/,
  );
  assert.deepEqual(calls, []);
});

test("surfaces a Supabase failure instead of returning zero", async () => {
  setResponse(null, { message: "Production request failed." });

  await assert.rejects(
    () => getLabourerWeeklyProduction({ factoryId: "factory-a", labourerId: "labourer-a", weekStart: "2026-08-03" }),
    /Production request failed/,
  );
});
