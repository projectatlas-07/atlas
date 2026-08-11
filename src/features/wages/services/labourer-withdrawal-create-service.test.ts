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
};

type RpcArgs = {
  p_factory_id: string;
  p_labourer_id: string;
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
const { CreateLabourerWithdrawalError, createLabourerWithdrawal } = await import("./labourer-withdrawal-create-service.ts");

function setResponse(
  data: WithdrawalRow[] | null,
  error: { message: string; code: string; details: string | null; hint: string | null } | null = null,
) {
  calls.length = 0;
  response = { data, error };
}

test("calls only create_labourer_withdrawal with exact RPC arguments and maps its result", async () => {
  setResponse([{
    withdrawal_id: "withdrawal-a",
    withdrawal_factory_id: "factory-a",
    withdrawal_labourer_id: "labourer-a",
    withdrawal_date: "2026-08-08",
    withdrawal_amount: 250.5,
    created_at: "2026-08-08T10:00:00Z",
    available_balance: 749.5,
  }]);

  assert.deepEqual(
    await createLabourerWithdrawal({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      withdrawalDate: "2026-08-08",
      amount: 250.5,
    }),
    {
      withdrawalId: "withdrawal-a",
      factoryId: "factory-a",
      labourerId: "labourer-a",
      withdrawalDate: "2026-08-08",
      amount: 250.5,
      createdAt: "2026-08-08T10:00:00Z",
      availableBalance: 749.5,
    },
  );
  assert.deepEqual(calls, [["create_labourer_withdrawal", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_withdrawal_date: "2026-08-08",
    p_amount: 250.5,
  }]]);
});

test("preserves useful database error details", async () => {
  setResponse(null, {
    message: "Withdrawal amount 800 exceeds available balance 749.5 as of 2026-08-08.",
    code: "P0001",
    details: "balance validation",
    hint: "Choose a smaller amount.",
  });

  await assert.rejects(
    () => createLabourerWithdrawal({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      withdrawalDate: "2026-08-08",
      amount: 800,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CreateLabourerWithdrawalError);
      assert.equal(error.message, "Withdrawal amount 800 exceeds available balance 749.5 as of 2026-08-08.");
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
    () => createLabourerWithdrawal({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      withdrawalDate: "2026-08-08",
      amount: 100,
    }),
    /create_labourer_withdrawal returned no withdrawal/,
  );
});
