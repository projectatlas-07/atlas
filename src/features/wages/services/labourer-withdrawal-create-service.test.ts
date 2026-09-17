import assert from "node:assert/strict";
import { mock, test } from "node:test";

type WithdrawalRow = {
  withdrawal_id: string;
  withdrawal_factory_id: string;
  withdrawal_labourer_id: string;
  withdrawal_date: string;
  withdrawal_amount: number;
  created_at: string;
  available_balance: number;
  settlement_id: string;
  settled_through: string;
};

type RpcArgs = {
  p_factory_id: string;
  p_labourer_id: string;
  p_withdrawal_date: string;
  p_settlement_cutoff: string;
  p_amount: number;
};

const calls: Array<[functionName: string, args: RpcArgs]> = [];
let response: {
  data: WithdrawalRow[] | null;
  error: { message: string; code: string; details: string | null; hint: string | null } | null;
} = { data: [], error: null };

const fakeSupabase = {
  rpc(functionName: string, args: RpcArgs) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const {
  CreateLabourerWithdrawalError,
  createLabourerWithdrawal,
  getDefaultSettlementCutoff,
} = await import("./labourer-withdrawal-create-service.ts");

test("calls the settlement-aware withdrawal RPC and maps its result", async () => {
  calls.length = 0;
  response = { data: [{
    withdrawal_id: "withdrawal-a",
    withdrawal_factory_id: "factory-a",
    withdrawal_labourer_id: "labourer-a",
    withdrawal_date: "2026-09-15",
    withdrawal_amount: 250.5,
    created_at: "2026-09-15T10:00:00Z",
    available_balance: 749.5,
    settlement_id: "settlement-a",
    settled_through: "2026-09-14",
  }], error: null };

  assert.deepEqual(
    await createLabourerWithdrawal({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      withdrawalDate: "2026-09-15",
      settlementCutoff: "2026-09-14",
      amount: 250.5,
    }),
    {
      withdrawalId: "withdrawal-a",
      factoryId: "factory-a",
      labourerId: "labourer-a",
      withdrawalDate: "2026-09-15",
      amount: 250.5,
      createdAt: "2026-09-15T10:00:00Z",
      availableBalance: 749.5,
      settlementId: "settlement-a",
      settledThrough: "2026-09-14",
    },
  );
  assert.deepEqual(calls, [["create_labourer_withdrawal", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_withdrawal_date: "2026-09-15",
    p_settlement_cutoff: "2026-09-14",
    p_amount: 250.5,
  }]]);
});

test("defaults settlement to the previous day without moving behind the latest cutoff", () => {
  assert.equal(getDefaultSettlementCutoff("2026-09-15", null), "2026-09-14");
  assert.equal(getDefaultSettlementCutoff("2026-09-15", "2026-09-14"), "2026-09-14");
  assert.equal(getDefaultSettlementCutoff("2026-09-15", "2026-09-15"), "2026-09-15");
  assert.equal(getDefaultSettlementCutoff("invalid", null), "");
});

test("rejects invalid dates, reversed cutoff, and amount before the RPC", async () => {
  calls.length = 0;
  await assert.rejects(() => createLabourerWithdrawal({
    factoryId: "factory-a", labourerId: "labourer-a", withdrawalDate: "2026-02-30",
    settlementCutoff: "2026-02-28", amount: 100,
  }), /valid withdrawal date/);
  await assert.rejects(() => createLabourerWithdrawal({
    factoryId: "factory-a", labourerId: "labourer-a", withdrawalDate: "2026-09-15",
    settlementCutoff: "2026-09-16", amount: 100,
  }), /cannot be after/);
  await assert.rejects(() => createLabourerWithdrawal({
    factoryId: "factory-a", labourerId: "labourer-a", withdrawalDate: "2026-09-15",
    settlementCutoff: "2026-09-14", amount: Number.NaN,
  }), /greater than zero/);
  assert.deepEqual(calls, []);
});

test("preserves useful database error details", async () => {
  calls.length = 0;
  response = { data: null, error: {
    message: "Withdrawal amount 800 exceeds available balance 749.5 as of 2026-09-15.",
    code: "P0001",
    details: "balance validation",
    hint: "Choose a smaller amount.",
  } };

  await assert.rejects(
    () => createLabourerWithdrawal({
      factoryId: "factory-a", labourerId: "labourer-a", withdrawalDate: "2026-09-15",
      settlementCutoff: "2026-09-14", amount: 800,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CreateLabourerWithdrawalError);
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "balance validation");
      assert.equal(error.hint, "Choose a smaller amount.");
      return true;
    },
  );
});

test("rejects an RPC response without a created withdrawal", async () => {
  calls.length = 0;
  response = { data: [], error: null };
  await assert.rejects(
    () => createLabourerWithdrawal({
      factoryId: "factory-a", labourerId: "labourer-a", withdrawalDate: "2026-09-15",
      settlementCutoff: "2026-09-14", amount: 100,
    }),
    /returned no withdrawal/,
  );
});
