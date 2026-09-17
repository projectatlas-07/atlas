import assert from "node:assert/strict";
import { mock, test } from "node:test";

const rpcCalls: Array<[string, Record<string, unknown>]> = [];
let rpcResponse: { data: unknown; error: null | { message: string; code: string; details: null; hint: null } } = { data: null, error: null };
const stateQuery = {
  select() { return this; },
  eq() { return this; },
  single() { return Promise.resolve({ data: { accounting_mode: "LEGACY_WEEKLY" }, error: null }); },
};
const fakeSupabase = {
  rpc(name: string, args: Record<string, unknown>) { rpcCalls.push([name, args]); return Promise.resolve(rpcResponse); },
  from(name: string) { assert.equal(name, "mud_accounting_states"); return stateQuery; },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const service = await import("./mud-group-configuration-service.ts");

test("reads live group configuration and the separate legacy accounting mode", async () => {
  rpcCalls.length = 0;
  rpcResponse = { data: [{ labour_group_id: "group-a", group_name: "A", current_member_count: 6, current_rate_per_1000_bricks: 100, is_earning: true, current_term_id: "term-a", current_rate_id: "rate-a", accounting_mode: "LEGACY_WEEKLY" }], error: null };
  const groups = await service.listMudGroupConfigurations({ factoryId: "factory-a", asOfDate: "2026-09-16" });
  assert.deepEqual(groups[0], { groupId: "group-a", name: "A", currentMemberCount: 6, currentRatePer1000Bricks: 100, isEarning: true, currentTermId: "term-a", currentRateId: "rate-a", accountingMode: "LEGACY_WEEKLY" });
  assert.equal(await service.getMudAccountingMode("factory-a"), "LEGACY_WEEKLY");
  assert.deepEqual(rpcCalls[0], ["get_mud_group_configuration", { p_factory_id: "factory-a", p_as_of_date: "2026-09-16" }]);
});

test("creates a second group atomically with its first term and group rate", async () => {
  rpcCalls.length = 0; rpcResponse = { data: "group-b", error: null };
  assert.equal(await service.createMudGroup({ factoryId: "factory-a", name: " Group B ", memberCount: 9, earningStartDate: "2026-09-01", initialRate: 120, rateEffectiveDate: "2026-09-01" }), "group-b");
  assert.deepEqual(rpcCalls[0], ["create_mud_group", { p_factory_id: "factory-a", p_name: "Group B", p_member_count: 9, p_earning_start_date: "2026-09-01", p_initial_rate: 120, p_rate_effective_date: "2026-09-01" }]);
});

test("uses only controlled RPCs for member, rate, stop, and restart history", async () => {
  rpcCalls.length = 0; rpcResponse = { data: "history-row", error: null };
  await service.editMudGroupMembers({ factoryId: "factory-a", groupId: "group-a", memberCount: 7, effectiveFrom: "2026-09-10" });
  await service.setMudGroupRate({ factoryId: "factory-a", groupId: "group-a", ratePer1000Bricks: 110, effectiveFrom: "2026-09-12" });
  await service.stopMudGroupEarning({ factoryId: "factory-a", groupId: "group-a", stopDate: "2026-09-20" });
  await service.restartMudGroupEarning({ factoryId: "factory-a", groupId: "group-a", memberCount: 8, restartDate: "2026-09-25" });
  assert.deepEqual(rpcCalls.map(([name]) => name), ["set_mud_group_member_count", "set_mud_group_rate", "stop_mud_group_earning", "restart_mud_group_earning"]);
});

test("invalid configuration fails before any database call", async () => {
  rpcCalls.length = 0;
  await assert.rejects(() => service.createMudGroup({ factoryId: "factory-a", name: "A", memberCount: 0, initialRate: 100 }), /positive integer/);
  await assert.rejects(() => service.createMudGroup({ factoryId: "factory-a", name: "A", memberCount: 1, earningStartDate: "2026-09-01", initialRate: 100, rateEffectiveDate: "2026-09-02" }), /cover the first earning date/);
  await assert.rejects(() => service.setMudGroupRate({ factoryId: "factory-a", groupId: "group-a", ratePer1000Bricks: 0, effectiveFrom: "2026-09-01" }), /greater than zero/);
  assert.deepEqual(rpcCalls, []);
});
