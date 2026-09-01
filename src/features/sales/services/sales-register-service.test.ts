import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: unknown[] | null; error: DatabaseError | null };
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let response: Response = { data: [], error: null };
const rpcResponses = new Map<string, Response>();

function queryBuilder() {
  const builder = {
    select(columns: string) {
      calls.push(["select", columns]);
      return builder;
    },
    eq(column: string, value: string) {
      calls.push(["eq", column, value]);
      return builder;
    },
    gte(column: string, value: string) {
      calls.push(["gte", column, value]);
      return builder;
    },
    lte(column: string, value: string) {
      calls.push(["lte", column, value]);
      return builder;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.push(["order", column, options]);
      return builder;
    },
    then<TResult1 = Response, TResult2 = never>(
      onFulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(response).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return queryBuilder();
  },
  rpc(functionName: string, args: Record<string, unknown>) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponses.get(functionName) ?? { data: [], error: null });
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  listSalesRegister,
  SalesRegisterReconciliationError,
  SalesRegisterServiceError,
} = await import("./sales-register-service.ts");

function reset(): void {
  calls.length = 0;
  response = { data: [], error: null };
  rpcResponses.clear();
}

test("Sales Register query is factory-scoped, inclusive, deterministic, and date-range limited", async () => {
  reset();
  await listSalesRegister("factory-a", { fromDate: "2026-08-01", toDate: "2026-08-27" });
  assert.equal(calls[0][1], "challans");
  assert.ok(String(calls[1][1]).includes("challan_items"));
  assert.ok(String(calls[1][1]).includes("line_amount"));
  assert.ok(String(calls[1][1]).includes("challan_flexible_lines"));
  assert.deepEqual(calls.slice(2), [
    ["eq", "factory_id", "factory-a"],
    ["gte", "challan_date", "2026-08-01"],
    ["lte", "challan_date", "2026-08-27"],
    ["order", "challan_date", { ascending: false }],
    ["order", "challan_number", { ascending: false }],
  ]);
});

test("service derives the explicit revenue split from persisted authoritative rows", async () => {
  reset();
  response.data = [{
    id: "challan-a",
    challan_number: "42",
    challan_date: "2026-08-27",
    customer_name_snapshot: "Historical Customer",
    challan_total: "4321.09",
    vehicle_number: "RJ14AB1234",
    status: "active",
    challan_items: [
      { brick_particulars_snapshot: "Historical Class Two", quantity: "750", line_amount: "1000", line_position: 2 },
      { brick_particulars_snapshot: "Historical Class One", quantity: "1500", line_amount: "3000", line_position: 1 },
    ],
    challan_flexible_lines: [
      { line_type: "NOTE", line_category: "NON_FINANCIAL", amount: "0" },
      { line_type: "EXTRA_CHARGE", line_category: "OTHER_REVENUE", amount: "321.09" },
    ],
  }];
  rpcResponses.set("get_challan_payment_state", {
    data: [{
      challan_id: "challan-a",
      challan_status: "active",
      sale_total: "4321.09",
      total_paid: "1000",
      outstanding_amount: "3321.09",
      payment_state: "partially_paid",
    }],
    error: null,
  });

  assert.deepEqual(await listSalesRegister("factory-a", {
    fromDate: "2026-08-27",
    toDate: "2026-08-27",
  }), [{
    challanId: "challan-a",
    challanNumber: 42,
    challanDate: "2026-08-27",
    customerNameSnapshot: "Historical Customer",
    items: [
      { particularsSnapshot: "Historical Class One", quantity: 1500, linePosition: 1 },
      { particularsSnapshot: "Historical Class Two", quantity: 750, linePosition: 2 },
    ],
    brickRevenue: 4000,
    otherRevenue: 321.09,
    totalRevenue: 4321.09,
    vehicleNumber: "RJ14AB1234",
    status: "active",
    paymentState: "partially_paid",
    paidAmount: 1000,
    outstandingAmount: 3321.09,
  }]);
});

test("void rows keep their revenue split but do not request payment state", async () => {
  reset();
  response.data = [{
    id: "challan-void",
    challan_number: 43,
    challan_date: "2026-08-27",
    customer_name_snapshot: "Historical Customer",
    challan_total: "5000",
    vehicle_number: "RJ14AB1234",
    status: "void",
    challan_items: [],
    challan_flexible_lines: [{
      line_type: "EXTRA_CHARGE", line_category: "OTHER_REVENUE", amount: "5000",
    }],
  }];
  const entries = await listSalesRegister("factory-a", {
    fromDate: "2026-08-27", toDate: "2026-08-27",
  });
  assert.deepEqual(
    [entries[0]?.brickRevenue, entries[0]?.otherRevenue, entries[0]?.totalRevenue],
    [0, 5000, 5000],
  );
  assert.equal(entries[0]?.paymentState, null);
  assert.equal(calls.some(([method]) => method === "rpc"), false);
});

test("service refuses a register row whose category split does not reconcile", async () => {
  reset();
  response.data = [{
    id: "challan-bad",
    challan_number: 99,
    challan_date: "2026-08-27",
    customer_name_snapshot: "Historical Customer",
    challan_total: "102000",
    vehicle_number: "RJ14AB1234",
    status: "active",
    challan_items: [{
      brick_particulars_snapshot: "Historical Class One",
      quantity: "1000",
      line_amount: "100000",
      line_position: 1,
    }],
    challan_flexible_lines: [{
      line_type: "EXTRA_CHARGE",
      line_category: "OTHER_REVENUE",
      amount: "1000",
    }],
  }];

  await assert.rejects(
    () => listSalesRegister("factory-a", {
      fromDate: "2026-08-27", toDate: "2026-08-27",
    }),
    (error: unknown) => error instanceof SalesRegisterReconciliationError
      && error.code === "SALES_REVENUE_MISMATCH"
      && /Challan #99/.test(error.message),
  );
  assert.equal(calls.some(([method]) => method === "rpc"), false);
});

test("invalid ranges stop locally and database failures remain typed", async () => {
  reset();
  await assert.rejects(
    () => listSalesRegister("factory-a", { fromDate: "2026-08-28", toDate: "2026-08-27" }),
    /start date/,
  );
  assert.equal(calls.length, 0);

  response.error = {
    message: "Access denied",
    code: "42501",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => listSalesRegister("factory-a", { fromDate: "2026-08-01", toDate: "2026-08-27" }),
    (error: unknown) => error instanceof SalesRegisterServiceError
      && error.code === "42501",
  );
});
