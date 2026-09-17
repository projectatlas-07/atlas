import assert from "node:assert/strict";
import { mock, test } from "node:test";

const rpcCalls: Array<[string, Record<string, unknown>]> = [];
let rpcResponse: {
  data: unknown;
  error: null | { message: string; code: string; details: null; hint: null };
} = { data: [], error: null };

const fakeSupabase = {
  rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push([name, args]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const service = await import("./mud-shadow-comparison-service.ts");

test("maps all four SHADOW comparison statuses without rounding amounts", async () => {
  rpcCalls.length = 0;
  rpcResponse = {
    data: [
      { week_start: "2026-08-17", labour_group_id: "group-a", legacy_weekly_earning_id: "earning-1", legacy_earning: 700, new_engine_earning: null, difference: null, status: "CONFIGURATION_ERROR", detail: "Missing term" },
      { week_start: "2026-08-24", labour_group_id: "group-a", legacy_weekly_earning_id: "earning-2", legacy_earning: 701, new_engine_earning: 700, difference: -1, status: "UNEXPECTED_MISMATCH", detail: "Mismatch" },
      { week_start: "2026-08-31", labour_group_id: "group-a", legacy_weekly_earning_id: "earning-3", legacy_earning: 700, new_engine_earning: 700, difference: 0, status: "PARITY_OK", detail: "Match" },
      { week_start: "2026-09-07", labour_group_id: "group-a", legacy_weekly_earning_id: "earning-4", legacy_earning: 700, new_engine_earning: 780, difference: 80, status: "EXPECTED_RATE_CHANGE_DIFFERENCE", detail: "Dated rates" },
    ],
    error: null,
  };

  const rows = await service.getMudShadowWeeklyComparisons({
    factoryId: "factory-a",
    fromWeekStart: "2026-08-17",
    toWeekStart: "2026-09-07",
    today: "2026-09-16",
  });

  assert.deepEqual(rows.map((row) => [row.status, row.legacyEarning, row.newEngineEarning, row.difference]), [
    ["CONFIGURATION_ERROR", 700, null, null],
    ["UNEXPECTED_MISMATCH", 701, 700, -1],
    ["PARITY_OK", 700, 700, 0],
    ["EXPECTED_RATE_CHANGE_DIFFERENCE", 700, 780, 80],
  ]);
  assert.deepEqual(rpcCalls[0], ["get_mud_shadow_weekly_comparisons", {
    p_factory_id: "factory-a",
    p_from_week_start: "2026-08-17",
    p_to_week_start: "2026-09-07",
  }]);
});

test("rejects incomplete, non-Monday, and reversed week ranges before the RPC", async () => {
  rpcCalls.length = 0;
  await assert.rejects(
    () => service.getMudShadowWeeklyComparisons({ factoryId: "factory-a", fromWeekStart: "2026-09-07", toWeekStart: "2026-09-14", today: "2026-09-16" }),
    /not completed/,
  );
  await assert.rejects(
    () => service.getMudShadowWeeklyComparisons({ factoryId: "factory-a", fromWeekStart: "2026-09-08", toWeekStart: "2026-09-08", today: "2026-09-16" }),
    /Monday/,
  );
  await assert.rejects(
    () => service.getMudShadowWeeklyComparisons({ factoryId: "factory-a", fromWeekStart: "2026-09-07", toWeekStart: "2026-08-31", today: "2026-09-16" }),
    /From week/,
  );
  assert.deepEqual(rpcCalls, []);
});

test("preserves explicit SHADOW RPC failures", async () => {
  rpcResponse = { data: null, error: { message: "Mud SHADOW comparison requires SHADOW mode.", code: "P3001", details: null, hint: null } };
  await assert.rejects(
    () => service.getMudShadowWeeklyComparisons({ factoryId: "factory-a", fromWeekStart: "2026-08-31", toWeekStart: "2026-08-31", today: "2026-09-16" }),
    (error: unknown) => error instanceof service.MudShadowComparisonError && error.code === "P3001",
  );
});
