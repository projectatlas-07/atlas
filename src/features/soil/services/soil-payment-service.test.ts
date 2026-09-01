import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let rpcResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};
let listResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};

const fakeSupabase = {
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponse);
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
        return builder;
      },
      then(resolve: (value: typeof listResponse) => unknown) {
        return Promise.resolve(resolve(listResponse));
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  SoilPaymentServiceError,
  createSoilPayment,
  getSoilFinancialSummary,
  listSoilPayments,
} = await import("./soil-payment-service.ts");

function reset(): void {
  calls.length = 0;
  rpcResponse = { data: [], error: null };
  listResponse = { data: [], error: null };
}

test("creates an individual payment only through the controlled balance RPC", async () => {
  reset();
  rpcResponse.data = [{
    payment_id: "payment-a",
    payment_factory_id: "factory-a",
    payment_soil_worker_id: "worker-raju",
    payment_date: "2026-08-26",
    payment_amount: "600",
    created_at: "2026-08-26T10:00:00Z",
    total_earned: "1000",
    total_paid: "600",
    available_balance: "400",
  }];

  assert.deepEqual(await createSoilPayment({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    paymentDate: "2026-08-26",
    amount: 600,
  }), {
    id: "payment-a",
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    paymentDate: "2026-08-26",
    amount: 600,
    createdAt: "2026-08-26T10:00:00Z",
    totalEarned: 1000,
    totalPaid: 600,
    availableBalance: 400,
  });

  assert.deepEqual(calls, [["rpc", "create_soil_payment", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "worker-raju",
    p_payment_date: "2026-08-26",
    p_amount: 600,
  }]]);
});

test("reads earned, paid, and available only from the financial-summary RPC", async () => {
  reset();
  rpcResponse.data = [{
    total_earned: "1800",
    total_additions: "500",
    total_deductions: "300",
    total_paid: "1000",
    available_balance: "1000",
  }];

  assert.deepEqual(await getSoilFinancialSummary({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
  }), {
    totalEarned: 1800,
    totalAdditions: 500,
    totalDeductions: 300,
    totalPaid: 1000,
    availableBalance: 1000,
  });
  assert.equal(calls[0]?.[1], "get_soil_financial_summary");
});

test("lists immutable payment history in deterministic newest-first order", async () => {
  reset();
  listResponse.data = [{
    id: "payment-b",
    factory_id: "factory-a",
    soil_worker_id: "worker-raju",
    payment_date: "2026-08-27",
    amount: "400",
    created_at: "2026-08-27T10:00:00Z",
  }, {
    id: "payment-a",
    factory_id: "factory-a",
    soil_worker_id: "worker-raju",
    payment_date: "2026-08-26",
    amount: "600",
    created_at: "2026-08-26T10:00:00Z",
  }];

  assert.deepEqual((await listSoilPayments({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
  })).map((payment: { amount: number }) => payment.amount), [400, 600]);
  assert.deepEqual(calls.filter(([method]) => method === "order"), [
    ["order", "payment_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("rejects invalid identities, dates, and non-positive or non-finite amounts locally", async () => {
  reset();
  await assert.rejects(
    () => createSoilPayment({
      factoryId: "", soilWorkerId: "worker", paymentDate: "2026-08-26", amount: 1,
    }),
    /factoryId is required/,
  );
  for (const paymentDate of ["2026-02-30", "26-08-2026"]) {
    await assert.rejects(
      () => createSoilPayment({
        factoryId: "factory", soilWorkerId: "worker", paymentDate, amount: 1,
      }),
      /valid YYYY-MM-DD date/,
    );
  }
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => createSoilPayment({
        factoryId: "factory", soilWorkerId: "worker", paymentDate: "2026-08-26", amount,
      }),
      /positive finite number/,
    );
  }
  assert.equal(calls.length, 0);
});

test("preserves overpayment and factory-security database failures", async () => {
  reset();
  rpcResponse = {
    data: null,
    error: {
      message: "Payment amount exceeds available balance.",
      code: "P2802",
      details: "authoritative database balance",
      hint: null,
    },
  };
  await assert.rejects(
    () => createSoilPayment({
      factoryId: "factory-a",
      soilWorkerId: "worker-raju",
      paymentDate: "2026-08-26",
      amount: 1001,
    }),
    (error: unknown) => error instanceof SoilPaymentServiceError
      && error.code === "P2802"
      && error.message.includes("available balance"),
  );

  reset();
  listResponse.error = {
    message: "Access denied.", code: "42501", details: null, hint: null,
  };
  await assert.rejects(
    () => listSoilPayments({ factoryId: "factory-b", soilWorkerId: "worker-b" }),
    (error: unknown) => error instanceof SoilPaymentServiceError
      && error.code === "42501",
  );
});

test("rejects successful RPC responses that omit their result row", async () => {
  reset();
  await assert.rejects(
    () => createSoilPayment({
      factoryId: "factory-a",
      soilWorkerId: "worker-raju",
      paymentDate: "2026-08-26",
      amount: 1,
    }),
    /returned no payment/,
  );
  await assert.rejects(
    () => getSoilFinancialSummary({
      factoryId: "factory-a", soilWorkerId: "worker-raju",
    }),
    /returned no summary/,
  );
});
