import assert from "node:assert/strict";
import { mock, test } from "node:test";

type EarningsRow = {
  id: string;
  week_start: string;
  quantity_used: number;
  wage_rate_id: string | null;
  rate_used: number | null;
  amount: number;
  calculated_at: string;
};

type QueryCall = [method: string, column?: string, value?: string | { ascending: boolean }];

const calls: QueryCall[] = [];
let response: { data: EarningsRow[] | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "weekly_earnings");
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            return Promise.resolve(response);
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourerEarningsHistory } = await import("./labourer-earnings-history-service.ts");

function setResponse(data: EarningsRow[] | null, error: { message: string } | null = null) {
  calls.length = 0;
  response = { data, error };
}

test("filters by factory and labourer, orders newest week first, and preserves stored snapshots", async () => {
  const lockedEntries: EarningsRow[] = [
    { id: "earning-new", week_start: "2026-08-03", quantity_used: 1500, wage_rate_id: null, rate_used: null, amount: 795, calculated_at: "2026-08-10T09:00:00Z" },
    { id: "earning-old", week_start: "2026-07-27", quantity_used: 1000, wage_rate_id: "rate-520", rate_used: 520, amount: 520, calculated_at: "2026-08-03T09:00:00Z" },
  ];
  setResponse(lockedEntries);

  assert.deepEqual(
    await getLabourerEarningsHistory({ factoryId: "factory-a", labourerId: "labourer-a" }),
    lockedEntries,
  );
  assert.deepEqual(calls, [
    ["select", "id, week_start, quantity_used, wage_rate_id, rate_used, amount, calculated_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "labourer_id", "labourer-a"],
    ["order", "week_start", { ascending: false }],
  ]);
});

test("returns an empty list when the labourer has no locked earnings", async () => {
  setResponse([]);

  assert.deepEqual(await getLabourerEarningsHistory({ factoryId: "factory-a", labourerId: "labourer-a" }), []);
});

test("surfaces Supabase failures", async () => {
  setResponse(null, { message: "Weekly earnings request failed." });

  await assert.rejects(
    () => getLabourerEarningsHistory({ factoryId: "factory-a", labourerId: "labourer-a" }),
    /Weekly earnings request failed/,
  );
});
