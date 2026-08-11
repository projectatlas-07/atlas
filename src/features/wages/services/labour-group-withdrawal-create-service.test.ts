import assert from "node:assert/strict";
import { mock, test } from "node:test";

type WithdrawalRow = {
  withdrawal_id: string;
  withdrawal_factory_id: string;
  withdrawal_labour_group_id: string;
  withdrawal_date: string;
  withdrawal_amount: number;
  created_at: string;
  available_balance: number;
};

type RpcArgs = {
  p_factory_id: string;
  p_labour_group_id: string;
  p_withdrawal_date: string;
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
const { CreateLabourGroupWithdrawalError, createLabourGroupWithdrawal } = await import("./labour-group-withdrawal-create-service.ts");

function setResponse(
  data: WithdrawalRow[] | null,
  error: { message: string; code: string; details: string | null; hint: string | null } | null = null,
) {
  calls.length = 0;
  response = { data, error };
}

test("calls only create_labour_group_withdrawal with exact RPC arguments and maps its result", async () => {
  setResponse([{
    withdrawal_id: "withdrawal-a",
    withdrawal_factory_id: "factory-a",
    withdrawal_labour_group_id: "group-a",
    withdrawal_date: "2026-08-10",
    withdrawal_amount: 500.25,
    created_at: "2026-08-10T10:00:00Z",
    available_balance: 22499.75,
  }]);

  assert.deepEqual(
    await createLabourGroupWithdrawal({
      factoryId: "factory-a",
      labourGroupId: "group-a",
      withdrawalDate: "2026-08-10",
      amount: 500.25,
    }),
    {
      withdrawalId: "withdrawal-a",
      factoryId: "factory-a",
      labourGroupId: "group-a",
      withdrawalDate: "2026-08-10",
      amount: 500.25,
      createdAt: "2026-08-10T10:00:00Z",
      availableBalance: 22499.75,
    },
  );
  assert.deepEqual(calls, [["create_labour_group_withdrawal", {
    p_factory_id: "factory-a",
    p_labour_group_id: "group-a",
    p_withdrawal_date: "2026-08-10",
    p_amount: 500.25,
  }]]);
});

test("preserves useful database error details", async () => {
  setResponse(null, {
    message: "Withdrawal amount 24000 exceeds available balance 23000 as of 2026-08-10.",
    code: "P0001",
    details: "balance validation",
    hint: "Choose a smaller amount.",
  });

  await assert.rejects(
    () => createLabourGroupWithdrawal({
      factoryId: "factory-a",
      labourGroupId: "group-a",
      withdrawalDate: "2026-08-10",
      amount: 24000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CreateLabourGroupWithdrawalError);
      assert.equal(error.message, "Withdrawal amount 24000 exceeds available balance 23000 as of 2026-08-10.");
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "balance validation");
      assert.equal(error.hint, "Choose a smaller amount.");
      return true;
    },
  );
});

test("rejects an RPC response without a created withdrawal", async () => {
  setResponse([]);

  await assert.rejects(
    () => createLabourGroupWithdrawal({
      factoryId: "factory-a",
      labourGroupId: "group-a",
      withdrawalDate: "2026-08-10",
      amount: 100,
    }),
    /create_labour_group_withdrawal returned no withdrawal/,
  );
});
