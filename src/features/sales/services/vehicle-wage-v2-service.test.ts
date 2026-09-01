import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: unknown; error: DatabaseError | null };

const calls: unknown[][] = [];
let rpcResponse: Response = { data: [], error: null };
let tableResponse: Response = { data: [], error: null };
let reversalResponse: Response = { data: [], error: null };

const fakeSupabase = {
  rpc(name: string, input: Record<string, unknown>) {
    calls.push(["rpc", name, input]);
    return Promise.resolve(rpcResponse);
  },
  from(table: string) {
    calls.push(["from", table]);
    let orderCount = 0;
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(["eq", column, value]);
        return builder;
      },
      in(column: string, value: unknown[]) {
        calls.push(["in", column, value]);
        return Promise.resolve(reversalResponse);
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        orderCount += 1;
        return orderCount === 3 ? Promise.resolve(tableResponse) : builder;
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  VehicleWageServiceError,
  getVehicleWageLifetimeAccount,
  listVehicleWagePayments,
  recordVehicleWagePayment,
  reverseVehicleWagePayment,
} = await import("./vehicle-wage-service.ts");

function reset(): void {
  calls.length = 0;
  rpcResponse = { data: [], error: null };
  tableResponse = { data: [], error: null };
  reversalResponse = { data: [], error: null };
}

test("reads authoritative lifetime Earned, Paid, and Available from one RPC", async () => {
  reset();
  rpcResponse.data = [{
    total_earned: "2000.00",
    total_paid: "1200.00",
    available_balance: "800.00",
  }];
  assert.deepEqual(await getVehicleWageLifetimeAccount("factory-a", "vehicle-a"), {
    totalEarned: 2000,
    totalPaid: 1200,
    availableBalance: 800,
  });
  assert.deepEqual(calls[0], ["rpc", "get_vehicle_wage_account_summary", {
    p_factory_id: "factory-a",
    p_vehicle_id: "vehicle-a",
  }]);
});

test("records through the authoritative RPC and returns resulting totals", async () => {
  reset();
  rpcResponse.data = [{
    payment_id: "payment-a",
    payment_factory_id: "factory-a",
    payment_vehicle_id: "vehicle-a",
    payment_date: "2026-09-01",
    payment_amount: "1200.00",
    payment_note: "Weekly payment",
    created_at: "2026-09-01T10:00:00Z",
    created_by: "user-a",
    total_earned: "2000.00",
    total_paid: "1200.00",
    available_balance: "800.00",
  }];
  const recorded = await recordVehicleWagePayment({
    factoryId: "factory-a",
    vehicleId: "vehicle-a",
    paymentDate: "2026-09-01",
    amount: 1200,
    note: "Weekly payment",
  });
  assert.equal(recorded.availableBalance, 800);
  assert.equal(recorded.note, "Weekly payment");
  assert.deepEqual(calls[0], ["rpc", "record_vehicle_wage_payment", {
    p_factory_id: "factory-a",
    p_vehicle_id: "vehicle-a",
    p_payment_date: "2026-09-01",
    p_amount: 1200,
    p_note: "Weekly payment",
  }]);
});

test("lists immutable history through factory-scoped RLS without a join", async () => {
  reset();
  tableResponse.data = [{
    id: "payment-a",
    factory_id: "factory-a",
    vehicle_id: "vehicle-a",
    payment_date: "2026-09-05",
    amount: "500.00",
    note: null,
    created_at: "2026-09-05T10:00:00Z",
    created_by: "user-a",
  }];
  reversalResponse.data = [{
    id: "reversal-a",
    factory_id: "factory-a",
    payment_id: "payment-a",
    reversal_date: "2026-09-06",
    reason: "Wrong amount",
    created_at: "2026-09-06T10:00:00Z",
    created_by: "user-a",
  }];
  const payments = await listVehicleWagePayments("factory-a", "vehicle-a");
  assert.equal(payments[0]?.amount, 500);
  assert.equal(payments[0]?.reversal?.reason, "Wrong amount");
  assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "vehicle_id", "vehicle-a"],
    ["eq", "factory_id", "factory-a"],
  ]);
  assert.equal(calls.some((call) => call[0] === "join"), false);
  assert.deepEqual(calls.find((call) => call[0] === "in"), [
    "in", "payment_id", ["payment-a"],
  ]);
});

test("reverses one full payment through the authoritative RPC and maps effective totals", async () => {
  reset();
  rpcResponse.data = [{
    reversal_id: "reversal-a",
    reversal_factory_id: "factory-a",
    reversed_payment_id: "payment-a",
    reversal_vehicle_id: "vehicle-a",
    reversal_date: "2026-09-06",
    reversal_amount: "1200.00",
    reversal_reason: "Wrong amount",
    created_at: "2026-09-06T10:00:00Z",
    created_by: "user-a",
    total_earned: "2000.00",
    total_paid: "0.00",
    available_balance: "2000.00",
  }];
  const reversal = await reverseVehicleWagePayment({
    factoryId: "factory-a",
    paymentId: "payment-a",
    reversalDate: "2026-09-06",
    reason: "Wrong amount",
  });
  assert.equal(reversal.amount, 1200);
  assert.equal(reversal.totalPaid, 0);
  assert.equal(reversal.availableBalance, 2000);
  assert.deepEqual(calls[0], ["rpc", "reverse_vehicle_wage_payment", {
    p_factory_id: "factory-a",
    p_payment_id: "payment-a",
    p_reversal_date: "2026-09-06",
    p_reason: "Wrong amount",
  }]);
});

test("maps overpayment and changed-account SQLSTATEs to clear actions", async () => {
  reset();
  rpcResponse.error = {
    message: "raw overpayment",
    code: "P3110",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => recordVehicleWagePayment({
      factoryId: "factory-a", vehicleId: "vehicle-a",
      paymentDate: "2026-09-01", amount: 801, note: null,
    }),
    (error: unknown) => error instanceof VehicleWageServiceError
      && error.code === "P3110"
      && error.message === "Payment exceeds available Vehicle wage balance.",
  );

  rpcResponse.error.code = "40001";
  await assert.rejects(
    () => getVehicleWageLifetimeAccount("factory-a", "vehicle-a"),
    /changed while you were saving/,
  );
});

test("maps duplicate reversal, missing payment, and invalid reversal input clearly", async () => {
  reset();
  rpcResponse.error = {
    message: "raw duplicate",
    code: "P3121",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => reverseVehicleWagePayment({
      factoryId: "factory-a", paymentId: "payment-a",
      reversalDate: "2026-09-06", reason: "Wrong amount",
    }),
    /already been reversed/,
  );
  rpcResponse.error.code = "P3120";
  await assert.rejects(
    () => reverseVehicleWagePayment({
      factoryId: "factory-a", paymentId: "payment-b",
      reversalDate: "2026-09-06", reason: "Wrong payment",
    }),
    /not found for this factory/,
  );

  reset();
  await assert.rejects(
    () => reverseVehicleWagePayment({
      factoryId: "factory-a", paymentId: "payment-a",
      reversalDate: "2026-02-30", reason: "Wrong amount",
    }),
    /reversalDate must be a valid/,
  );
  await assert.rejects(
    () => reverseVehicleWagePayment({
      factoryId: "factory-a", paymentId: "payment-a",
      reversalDate: "2026-09-06", reason: "  not normalized  ",
    }),
    /reason is required, normalized/,
  );
  assert.equal(calls.length, 0);
});

test("invalid IDs, dates, amounts, and precision stop before the database", async () => {
  reset();
  await assert.rejects(
    () => getVehicleWageLifetimeAccount("", "vehicle-a"),
    /factoryId is required/,
  );
  for (const input of [
    { paymentDate: "2026-02-30", amount: 1 },
    { paymentDate: "2026-09-01", amount: 0 },
    { paymentDate: "2026-09-01", amount: 1.001 },
  ]) {
    await assert.rejects(() => recordVehicleWagePayment({
      factoryId: "factory-a", vehicleId: "vehicle-a", note: null, ...input,
    }));
  }
  assert.equal(calls.length, 0);
});
