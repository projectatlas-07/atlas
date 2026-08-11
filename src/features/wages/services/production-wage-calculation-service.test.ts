import assert from "node:assert/strict";
import { mock, test } from "node:test";

const calls: Array<[functionName: string, args: Record<string, string>]> = [];
let response: {
  data: Array<{ labourers_calculated: number; rows_skipped: number }> | null;
  error: { message: string; code: string; details: string | null; hint: string | null } | null;
} = {
  data: [{ labourers_calculated: 2, rows_skipped: 1 }],
  error: null,
};

const fakeSupabase = {
  rpc(functionName: string, args: Record<string, string>) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { CalculateProductionWagesError, calculateProductionWages } = await import("./production-wage-calculation-service.ts");

function setResponse(
  data: Array<{ labourers_calculated: number; rows_skipped: number }> | null,
  error: { message: string; code: string; details: string | null; hint: string | null } | null = null,
) {
  calls.length = 0;
  response = { data, error };
}

test("calls only calculate_production_wages with the exact RPC arguments", async () => {
  setResponse([{ labourers_calculated: 2, rows_skipped: 1 }]);

  assert.deepEqual(
    await calculateProductionWages({ factoryId: "factory-a", weekStart: "2026-08-03" }),
    { labourersCalculated: 2, rowsSkipped: 1 },
  );
  assert.deepEqual(calls, [["calculate_production_wages", {
    p_factory_id: "factory-a",
    p_week_start: "2026-08-03",
  }]]);
});

test("preserves useful RPC error details", async () => {
  setResponse(null, {
    message: "Week starting 2026-08-03 is not completed yet.",
    code: "P0001",
    details: "completed-week validation",
    hint: "Choose a previous week.",
  });

  await assert.rejects(
    () => calculateProductionWages({ factoryId: "factory-a", weekStart: "2026-08-03" }),
    (error: unknown) => {
      assert.ok(error instanceof CalculateProductionWagesError);
      assert.equal(error.message, "Week starting 2026-08-03 is not completed yet.");
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "completed-week validation");
      assert.equal(error.hint, "Choose a previous week.");
      return true;
    },
  );
});

test("rejects an RPC response without a summary", async () => {
  setResponse([]);

  await assert.rejects(
    () => calculateProductionWages({ factoryId: "factory-a", weekStart: "2026-08-03" }),
    /calculate_production_wages returned no summary/,
  );
});
