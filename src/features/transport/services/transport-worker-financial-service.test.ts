import assert from "node:assert/strict";
import { mock, test } from "node:test";

type BalanceRow = {
  total_earned: number;
  total_withdrawn: number;
  available_balance: number;
};

type CreatedWithdrawalRow = {
  withdrawal_id: string;
  withdrawal_factory_id: string;
  withdrawal_transport_worker_id: string;
  withdrawal_date: string;
  withdrawal_amount: number;
  created_at: string;
  available_balance: number;
};

type HistoryRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  withdrawal_date: string;
  amount: number;
  created_at: string;
};

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let balanceResponse: { data: BalanceRow[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};
let createResponse: {
  data: CreatedWithdrawalRow[] | null;
  error: DatabaseError | null;
} = { data: [], error: null };
let historyResponse: {
  data: HistoryRow[] | null;
  error: DatabaseError | null;
} = { data: [], error: null };

const fakeSupabase = {
  rpc(functionName: string, args: Record<string, string | number>) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(
      functionName === "get_transport_worker_available_balance"
        ? balanceResponse
        : createResponse,
    );
  },
  from(table: string) {
    calls.push(["from", table]);
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return column === "id" ? Promise.resolve(historyResponse) : builder;
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  TransportWorkerFinancialServiceError,
  createTransportWorkerWithdrawal,
  getTransportWorkerAvailableBalance,
  listTransportWorkerWithdrawals,
} = await import("./transport-worker-financial-service.ts");

function reset(): void {
  calls.length = 0;
  balanceResponse = { data: [], error: null };
  createResponse = { data: [], error: null };
  historyResponse = { data: [], error: null };
}

test("loads the authoritative transport balance through the controlled RPC", async () => {
  reset();
  balanceResponse.data = [{
    total_earned: 8000,
    total_withdrawn: 3500,
    available_balance: 4500,
  }];

  assert.deepEqual(await getTransportWorkerAvailableBalance({
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
    asOfDate: "2026-08-16",
  }), {
    totalEarned: 8000,
    totalWithdrawn: 3500,
    availableBalance: 4500,
  });
  assert.deepEqual(calls, [[
    "rpc",
    "get_transport_worker_available_balance",
    {
      p_factory_id: "factory-a",
      p_transport_worker_id: "worker-a",
      p_as_of_date: "2026-08-16",
    },
  ]]);
});

test("creates a partial or full withdrawal only through the controlled RPC", async () => {
  reset();
  createResponse.data = [{
    withdrawal_id: "withdrawal-a",
    withdrawal_factory_id: "factory-a",
    withdrawal_transport_worker_id: "worker-a",
    withdrawal_date: "2026-08-16",
    withdrawal_amount: 2000,
    created_at: "2026-08-16T10:00:00Z",
    available_balance: 6000,
  }];

  assert.deepEqual(await createTransportWorkerWithdrawal({
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
    withdrawalDate: "2026-08-16",
    amount: 2000,
  }), {
    withdrawalId: "withdrawal-a",
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
    withdrawalDate: "2026-08-16",
    amount: 2000,
    createdAt: "2026-08-16T10:00:00Z",
    availableBalance: 6000,
  });
  assert.deepEqual(calls, [[
    "rpc",
    "create_transport_worker_withdrawal",
    {
      p_factory_id: "factory-a",
      p_transport_worker_id: "worker-a",
      p_withdrawal_date: "2026-08-16",
      p_amount: 2000,
    },
  ]]);
});

test("preserves withdrawal database error code, details, and hint", async () => {
  reset();
  createResponse = {
    data: null,
    error: {
      message: "Withdrawal amount 1000.01 exceeds available balance 1000.",
      code: "P0001",
      details: "authoritative balance validation",
      hint: "Choose a smaller amount.",
    },
  };

  await assert.rejects(
    () => createTransportWorkerWithdrawal({
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
      withdrawalDate: "2026-08-16",
      amount: 1000.01,
    }),
    (error: unknown) => {
      assert.ok(error instanceof TransportWorkerFinancialServiceError);
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "authoritative balance validation");
      assert.equal(error.hint, "Choose a smaller amount.");
      return true;
    },
  );
});

test("preserves available-balance request failures instead of returning zero", async () => {
  reset();
  balanceResponse = {
    data: null,
    error: {
      message: "You do not have access to this factory.",
      code: "42501",
      details: null,
      hint: null,
    },
  };

  await assert.rejects(
    () => getTransportWorkerAvailableBalance({
      factoryId: "factory-b",
      transportWorkerId: "worker-b",
      asOfDate: "2026-08-16",
    }),
    (error: unknown) => error instanceof TransportWorkerFinancialServiceError
      && error.code === "42501",
  );
});

test("lists transport withdrawals newest-first with deterministic tie-breakers", async () => {
  reset();
  historyResponse.data = [
    {
      id: "withdrawal-b",
      factory_id: "factory-a",
      transport_worker_id: "worker-a",
      withdrawal_date: "2026-08-16",
      amount: 1500,
      created_at: "2026-08-16T11:00:00Z",
    },
    {
      id: "withdrawal-a",
      factory_id: "factory-a",
      transport_worker_id: "worker-a",
      withdrawal_date: "2026-08-09",
      amount: 2000,
      created_at: "2026-08-09T10:00:00Z",
    },
  ];

  assert.deepEqual(await listTransportWorkerWithdrawals({
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
  }), [
    {
      withdrawalId: "withdrawal-b",
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
      withdrawalDate: "2026-08-16",
      amount: 1500,
      createdAt: "2026-08-16T11:00:00Z",
    },
    {
      withdrawalId: "withdrawal-a",
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
      withdrawalDate: "2026-08-09",
      amount: 2000,
      createdAt: "2026-08-09T10:00:00Z",
    },
  ]);
  assert.deepEqual(calls, [
    ["from", "transport_withdrawals"],
    ["select", "id, factory_id, transport_worker_id, withdrawal_date, amount, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "transport_worker_id", "worker-a"],
    ["order", "withdrawal_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("preserves withdrawal-history request failures", async () => {
  reset();
  historyResponse = {
    data: null,
    error: {
      message: "Withdrawal history request failed.",
      code: "08006",
      details: "connection unavailable",
      hint: null,
    },
  };

  await assert.rejects(
    () => listTransportWorkerWithdrawals({
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
    }),
    (error: unknown) => error instanceof TransportWorkerFinancialServiceError
      && error.code === "08006"
      && error.details === "connection unavailable",
  );
});

test("rejects successful RPC responses that contain no result row", async () => {
  reset();

  await assert.rejects(
    () => getTransportWorkerAvailableBalance({
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
      asOfDate: "2026-08-16",
    }),
    /get_transport_worker_available_balance returned no balance/,
  );

  await assert.rejects(
    () => createTransportWorkerWithdrawal({
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
      withdrawalDate: "2026-08-16",
      amount: 1,
    }),
    /create_transport_worker_withdrawal returned no withdrawal/,
  );
});
