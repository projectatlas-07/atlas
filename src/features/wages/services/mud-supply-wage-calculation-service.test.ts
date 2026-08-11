import assert from "node:assert/strict";
import { mock, test } from "node:test";

type MudSupplyCalculationRow = {
  weekly_earning_id: string;
  groups_calculated: number;
  rows_skipped: number;
};

type RpcArgs = {
  p_factory_id: string;
  p_labour_group_id: string;
  p_week_start: string;
};

const calls: Array<[functionName: string, args: RpcArgs]> = [];
let response: {
  data: MudSupplyCalculationRow[] | null;
  error: { message: string; code: string; details: string | null; hint: string | null } | null;
} = { data: [], error: null };

const fakeSupabase = {
  rpc(functionName: string, args: RpcArgs) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { CalculateMudSupplyWagesError, calculateMudSupplyWages } = await import("./mud-supply-wage-calculation-service.ts");

function setResponse(
  data: MudSupplyCalculationRow[] | null,
  error: { message: string; code: string; details: string | null; hint: string | null } | null = null,
) {
  calls.length = 0;
  response = { data, error };
}

test("calls only calculate_mud_supply_wages with exact arguments and maps the created result", async () => {
  setResponse([{ weekly_earning_id: "earning-a", groups_calculated: 1, rows_skipped: 0 }]);

  assert.deepEqual(
    await calculateMudSupplyWages({
      factoryId: "factory-a",
      labourGroupId: "group-a",
      weekStart: "2026-08-03",
    }),
    { weeklyEarningId: "earning-a", groupsCalculated: 1, rowsSkipped: 0 },
  );
  assert.deepEqual(calls, [["calculate_mud_supply_wages", {
    p_factory_id: "factory-a",
    p_labour_group_id: "group-a",
    p_week_start: "2026-08-03",
  }]]);
});

test("maps an idempotent rerun result as a successful skip", async () => {
  setResponse([{ weekly_earning_id: "earning-a", groups_calculated: 0, rows_skipped: 1 }]);

  assert.deepEqual(
    await calculateMudSupplyWages({
      factoryId: "factory-a",
      labourGroupId: "group-b",
      weekStart: "2026-08-03",
    }),
    { weeklyEarningId: "earning-a", groupsCalculated: 0, rowsSkipped: 1 },
  );
});

test("preserves useful RPC error details", async () => {
  setResponse(null, {
    message: "No mud_supply wage rate applies to week starting 2026-08-03.",
    code: "P0001",
    details: "mud-rate resolution",
    hint: "Configure the historical mud-supply rate.",
  });

  await assert.rejects(
    () => calculateMudSupplyWages({
      factoryId: "factory-a",
      labourGroupId: "group-a",
      weekStart: "2026-08-03",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CalculateMudSupplyWagesError);
      assert.equal(error.message, "No mud_supply wage rate applies to week starting 2026-08-03.");
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "mud-rate resolution");
      assert.equal(error.hint, "Configure the historical mud-supply rate.");
      return true;
    },
  );
});

test("rejects an RPC response without a summary", async () => {
  setResponse([]);

  await assert.rejects(
    () => calculateMudSupplyWages({
      factoryId: "factory-a",
      labourGroupId: "group-a",
      weekStart: "2026-08-03",
    }),
    /calculate_mud_supply_wages returned no summary/,
  );
});
