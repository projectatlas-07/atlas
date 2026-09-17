import assert from "node:assert/strict";
import { mock, test } from "node:test";

const calls: Array<[string, Record<string, unknown>]> = [];
let response: { data: unknown[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

const fakeSupabase = {
  rpc(functionName: string, args: Record<string, unknown>) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getMudGroupDailyAllocation, getMudGroupRangeAllocation } = await import("./mud-multi-group-allocation-service.ts");

test("reads the authoritative factory/date allocation and maps every group result", async () => {
  calls.length = 0;
  response = {
    data: [
      {
        labour_group_id: "group-a",
        member_count: 6,
        total_active_members: 15,
        eligible_factory_production: 100_000,
        allocated_production: 40_000,
        mud_group_rate_id: "rate-a",
        rate_per_1000_bricks: 100,
        earned_amount: 4_000,
      },
      {
        labour_group_id: "group-b",
        member_count: 9,
        total_active_members: 15,
        eligible_factory_production: 100_000,
        allocated_production: 60_000,
        mud_group_rate_id: "rate-b",
        rate_per_1000_bricks: 120,
        earned_amount: 7_200,
      },
    ],
    error: null,
  };

  const allocation = await getMudGroupDailyAllocation({
    factoryId: "factory-a",
    productionDate: "2026-09-10",
  });

  assert.deepEqual(calls, [["get_mud_group_daily_allocation", {
    p_factory_id: "factory-a",
    p_production_date: "2026-09-10",
  }]]);
  assert.deepEqual(allocation.map((group) => ({
    id: group.labourGroupId,
    production: group.allocatedProduction,
    earned: group.earnedAmount,
  })), [
    { id: "group-a", production: 40_000, earned: 4_000 },
    { id: "group-b", production: 60_000, earned: 7_200 },
  ]);
});

test("rejects missing factory and invalid calendar dates before the RPC", async () => {
  calls.length = 0;
  await assert.rejects(
    () => getMudGroupDailyAllocation({ factoryId: "", productionDate: "2026-09-10" }),
    /Factory is required/,
  );
  await assert.rejects(
    () => getMudGroupDailyAllocation({ factoryId: "factory-a", productionDate: "2026-02-30" }),
    /valid date/,
  );
  assert.deepEqual(calls, []);
});

test("surfaces explicit allocation configuration failures", async () => {
  response = { data: null, error: { message: "Mud rate not set for group group-a on 2026-09-10." } };
  await assert.rejects(
    () => getMudGroupDailyAllocation({ factoryId: "factory-a", productionDate: "2026-09-10" }),
    /Mud rate not set/,
  );
});

test("aggregates authoritative daily rows by group and preserves exact daily Production", async () => {
  calls.length = 0;
  response = {
    data: [
      { production_date: "2026-09-10", labour_group_id: "group-a", member_count: 6, total_active_members: 15, eligible_factory_production: 100_000, allocated_production: 40_000, mud_group_rate_id: "rate-a", rate_per_1000_bricks: 100, earned_amount: 4_000 },
      { production_date: "2026-09-10", labour_group_id: "group-b", member_count: 9, total_active_members: 15, eligible_factory_production: 100_000, allocated_production: 60_000, mud_group_rate_id: "rate-b", rate_per_1000_bricks: 120, earned_amount: 7_200 },
      { production_date: "2026-09-11", labour_group_id: "group-a", member_count: 1, total_active_members: 2, eligible_factory_production: 5, allocated_production: 3, mud_group_rate_id: "rate-a", rate_per_1000_bricks: 100, earned_amount: 0.3 },
      { production_date: "2026-09-11", labour_group_id: "group-b", member_count: 1, total_active_members: 2, eligible_factory_production: 5, allocated_production: 2, mud_group_rate_id: "rate-b", rate_per_1000_bricks: 120, earned_amount: 0.24 },
    ],
    error: null,
  };
  const summary = await getMudGroupRangeAllocation({
    factoryId: "factory-a",
    range: { fromDate: "2026-09-10", toDate: "2026-09-11" },
  });
  assert.deepEqual(calls, [["get_mud_group_range_allocation", {
    p_factory_id: "factory-a", p_from_date: "2026-09-10", p_to_date: "2026-09-11",
  }]]);
  assert.equal(summary.rangeProduction, 100_005);
  assert.deepEqual(summary.days.map((day) => day.allocatedProduction), [100_000, 5]);
  assert.deepEqual(summary.groups.map((group) => [group.labourGroupId, group.allocatedProduction]), [
    ["group-a", 40_003], ["group-b", 60_002],
  ]);
  assert.equal(summary.groups[0].informationalPerMemberEarned, (4_000 / 6) + 0.3);
});

test("range aggregation fails instead of accepting lost remainder bricks", async () => {
  response = {
    data: [
      { production_date: "2026-09-10", labour_group_id: "group-a", member_count: 1, total_active_members: 2, eligible_factory_production: 5, allocated_production: 2, mud_group_rate_id: "rate-a", rate_per_1000_bricks: 100, earned_amount: 0.2 },
      { production_date: "2026-09-10", labour_group_id: "group-b", member_count: 1, total_active_members: 2, eligible_factory_production: 5, allocated_production: 2, mud_group_rate_id: "rate-b", rate_per_1000_bricks: 120, earned_amount: 0.24 },
    ],
    error: null,
  };
  await assert.rejects(
    () => getMudGroupRangeAllocation({ factoryId: "factory-a", range: { fromDate: "2026-09-10", toDate: "2026-09-10" } }),
    /do not equal eligible Production/,
  );
});
