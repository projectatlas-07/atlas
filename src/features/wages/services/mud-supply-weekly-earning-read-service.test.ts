import assert from "node:assert/strict";
import { mock, test } from "node:test";

type EarningRow = {
  id: string;
  labour_group_id: string | null;
  week_start: string;
  quantity_used: number;
  rate_used: number | null;
  amount: number;
  calculated_at: string;
};

type QueryCall = [method: string, column?: string, value?: string];

const calls: QueryCall[] = [];
let response: { data: EarningRow | null; error: { message: string } | null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "weekly_earnings");
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          single() {
            calls.push(["single"]);
            return Promise.resolve(response);
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getMudSupplyWeeklyEarning } = await import("./mud-supply-weekly-earning-read-service.ts");

function setResponse(data: EarningRow | null, error: { message: string } | null = null) {
  calls.length = 0;
  response = { data, error };
}

test("loads and maps the exact stored group earning snapshot", async () => {
  setResponse({
    id: "earning-a",
    labour_group_id: "group-a",
    week_start: "2026-08-03",
    quantity_used: 100000,
    rate_used: 230,
    amount: 23000,
    calculated_at: "2026-08-10T09:00:00Z",
  });

  assert.deepEqual(
    await getMudSupplyWeeklyEarning({
      factoryId: "factory-a",
      weeklyEarningId: "earning-a",
      weekStart: "2026-08-03",
    }),
    {
      id: "earning-a",
      labourGroupId: "group-a",
      weekStart: "2026-08-03",
      quantityUsed: 100000,
      rateUsed: 230,
      amount: 23000,
      calculatedAt: "2026-08-10T09:00:00Z",
    },
  );
  assert.deepEqual(calls, [
    ["from", "weekly_earnings"],
    ["select", "id, labour_group_id, week_start, quantity_used, rate_used, amount, calculated_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "id", "earning-a"],
    ["eq", "week_start", "2026-08-03"],
    ["single"],
  ]);
});

test("surfaces database errors", async () => {
  setResponse(null, { message: "Stored mud earning request failed." });

  await assert.rejects(
    () => getMudSupplyWeeklyEarning({ factoryId: "factory-a", weeklyEarningId: "earning-a", weekStart: "2026-08-03" }),
    /Stored mud earning request failed/,
  );
});

test("rejects a non-group earning response", async () => {
  setResponse({
    id: "earning-a",
    labour_group_id: null,
    week_start: "2026-08-03",
    quantity_used: 100000,
    rate_used: 230,
    amount: 23000,
    calculated_at: "2026-08-10T09:00:00Z",
  });

  await assert.rejects(
    () => getMudSupplyWeeklyEarning({ factoryId: "factory-a", weeklyEarningId: "earning-a", weekStart: "2026-08-03" }),
    /not a labour-group earning/,
  );
});

test("rejects a group earning without its required legacy rate snapshot", async () => {
  setResponse({
    id: "earning-a",
    labour_group_id: "group-a",
    week_start: "2026-08-03",
    quantity_used: 100000,
    rate_used: null,
    amount: 23000,
    calculated_at: "2026-08-10T09:00:00Z",
  });

  await assert.rejects(
    () => getMudSupplyWeeklyEarning({ factoryId: "factory-a", weeklyEarningId: "earning-a", weekStart: "2026-08-03" }),
    /missing its rate snapshot/,
  );
});
