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
  data: [],
  error: null,
};
let historyResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
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
  StaffPaymentServiceError,
  getStaffPaymentSummary,
  listStaffPayments,
  recordStaffPayment,
} = await import("./staff-payment-service.ts");

function reset(): void {
  calls.length = 0;
  rpcResponse = { data: [], error: null };
  historyResponse = { data: [], error: null };
}

test("records an arbitrary Staff payment only through the controlled RPC", async () => {
  reset();
  rpcResponse.data = [{
    payment_id: "payment-a",
    payment_factory_id: "factory-a",
    payment_staff_worker_id: "staff-a",
    payment_date: "2026-08-23",
    payment_amount: 130000,
    payment_note: "Final adjustment",
    created_at: "2026-08-23T10:00:00Z",
    total_paid: 245000,
  }];

  assert.deepEqual(await recordStaffPayment({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-23",
    amount: 130000,
    note: "  Final adjustment  ",
  }), {
    id: "payment-a",
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-23",
    amount: 130000,
    note: "Final adjustment",
    createdAt: "2026-08-23T10:00:00Z",
    totalPaid: 245000,
  });

  assert.deepEqual(calls, [["rpc", "record_staff_payment", {
    p_factory_id: "factory-a",
    p_staff_worker_id: "staff-a",
    p_payment_date: "2026-08-23",
    p_amount: 130000,
    p_note: "  Final adjustment  ",
  }]]);
});

test("loads cumulative total paid from the payment-only summary RPC", async () => {
  reset();
  rpcResponse.data = [{ total_paid: 245000 }];

  assert.deepEqual(await getStaffPaymentSummary({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
  }), { totalPaid: 245000 });

  assert.deepEqual(calls, [["rpc", "get_staff_payment_summary", {
    p_factory_id: "factory-a",
    p_staff_worker_id: "staff-a",
  }]]);
});

test("lists the complete Staff payment history newest first", async () => {
  reset();
  historyResponse.data = [{
    id: "payment-b",
    factory_id: "factory-a",
    staff_worker_id: "staff-a",
    payment_date: "2026-08-23",
    amount: 130000,
    note: null,
    created_at: "2026-08-23T11:00:00Z",
  }, {
    id: "payment-a",
    factory_id: "factory-a",
    staff_worker_id: "staff-a",
    payment_date: "2026-08-16",
    amount: 115000,
    note: "First payment",
    created_at: "2026-08-16T10:00:00Z",
  }];

  assert.deepEqual(await listStaffPayments({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
  }), [{
    id: "payment-b",
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-23",
    amount: 130000,
    note: null,
    createdAt: "2026-08-23T11:00:00Z",
  }, {
    id: "payment-a",
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-16",
    amount: 115000,
    note: "First payment",
    createdAt: "2026-08-16T10:00:00Z",
  }]);

  assert.deepEqual(calls, [
    ["from", "staff_payments"],
    ["select", "id, factory_id, staff_worker_id, payment_date, amount, note, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "staff_worker_id", "staff-a"],
    ["order", "payment_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("preserves payment database security and validation errors", async () => {
  reset();
  rpcResponse = {
    data: null,
    error: {
      message: "You do not have access to this factory.",
      code: "42501",
      details: "factory isolation",
      hint: null,
    },
  };

  await assert.rejects(
    () => recordStaffPayment({
      factoryId: "factory-b",
      staffWorkerId: "staff-b",
      paymentDate: "2026-08-23",
      amount: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaffPaymentServiceError);
      assert.equal(error.code, "42501");
      assert.equal(error.details, "factory isolation");
      return true;
    },
  );
});

test("rejects successful payment RPC responses with no result row", async () => {
  reset();

  await assert.rejects(
    () => recordStaffPayment({
      factoryId: "factory-a",
      staffWorkerId: "staff-a",
      paymentDate: "2026-08-23",
      amount: 1,
    }),
    /record_staff_payment returned no payment/,
  );

  await assert.rejects(
    () => getStaffPaymentSummary({
      factoryId: "factory-a",
      staffWorkerId: "staff-a",
    }),
    /get_staff_payment_summary returned no summary/,
  );
});
