import assert from "node:assert/strict";
import { mock, test } from "node:test";

const rpcCalls: Array<[string, Record<string, unknown>]> = [];
let rpcResponse: { data: unknown; error: null | { message: string; code: string; details: null; hint: null } } = { data: null, error: null };
const fakeSupabase = {
  rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push([name, args]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const service = await import("./mud-settlement-account-service.ts");

test("reads the authoritative SETTLEMENT account", async () => {
  rpcCalls.length = 0;
  rpcResponse = { data: [{ settled_earned: 11000, live_earned: 500, total_earned: 11500, total_withdrawn: 7000, available_balance: 4500, latest_settlement_cutoff: "2026-09-10" }], error: null };
  assert.deepEqual(await service.getMudSettlementAccount({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-09-11" }), {
    settledEarned: 11000,
    liveEarned: 500,
    totalEarned: 11500,
    totalWithdrawn: 7000,
    availableBalance: 4500,
    latestSettlementCutoff: "2026-09-10",
  });
  assert.deepEqual(rpcCalls[0], ["get_mud_group_settlement_account", { p_factory_id: "factory-a", p_labour_group_id: "group-a", p_as_of_date: "2026-09-11" }]);
});

test("creates withdrawals only through the atomic Mud settlement authority", async () => {
  rpcCalls.length = 0;
  rpcResponse = { data: [{ withdrawal_id: "withdrawal-a", settlement_id: "settlement-a", previous_cutoff: "2026-09-10", settled_through: "2026-09-11", withdrawal_date: "2026-09-12", withdrawal_amount: 1000, settled_earned: 12000, total_withdrawn: 8000, settled_available_balance: 4000, daily_snapshots: 1, group_snapshots: 2, was_replayed: false }], error: null };
  const result = await service.createMudSettlementWithdrawal({ factoryId: "factory-a", withdrawalId: "withdrawal-a", labourGroupId: "group-a", withdrawalDate: "2026-09-12", settlementCutoff: "2026-09-11", amount: 1000 });
  assert.equal(result.settledAvailableBalance, 4000);
  assert.deepEqual(rpcCalls[0], ["create_mud_settlement_withdrawal", { p_factory_id: "factory-a", p_withdrawal_id: "withdrawal-a", p_labour_group_id: "group-a", p_withdrawal_date: "2026-09-12", p_settlement_cutoff: "2026-09-11", p_amount: 1000 }]);
});

test("defaults the cutoff to the previous day without moving behind an existing cutoff", () => {
  assert.equal(service.getDefaultMudSettlementCutoff("2026-09-12", "2026-09-06"), "2026-09-11");
  assert.equal(service.getDefaultMudSettlementCutoff("2026-09-10", "2026-09-10"), "2026-09-10");
});

test("validates withdrawal input before the database call and maps known database errors", async () => {
  rpcCalls.length = 0;
  await assert.rejects(() => service.createMudSettlementWithdrawal({ factoryId: "factory-a", withdrawalId: "withdrawal-a", labourGroupId: "group-a", withdrawalDate: "2026-09-12", settlementCutoff: "2026-09-12", amount: 1 }), /must be before/);
  assert.deepEqual(rpcCalls, []);

  rpcResponse = { data: null, error: { message: "raw database detail", code: "P3303", details: null, hint: null } };
  await assert.rejects(() => service.createMudSettlementWithdrawal({ factoryId: "factory-a", withdrawalId: "withdrawal-a", labourGroupId: "group-a", withdrawalDate: "2026-09-12", settlementCutoff: "2026-09-11", amount: 999999 }), /exceeds this group's earnings settled/);
});
