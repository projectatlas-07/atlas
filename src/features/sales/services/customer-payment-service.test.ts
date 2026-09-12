import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: Row | Row[] | null; error: DatabaseError | null };
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
const rpcResponses = new Map<string, Response>();
const tableResponses = new Map<string, Response>();

const fakeSupabase = {
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    const scopedKey = `${functionName}:${String(args.p_challan_id ?? "")}`;
    return Promise.resolve(
      rpcResponses.get(scopedKey)
      ?? rpcResponses.get(functionName)
      ?? { data: null, error: null },
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
      gte(column: string, value: string) {
        calls.push(["gte", column, value]);
        return builder;
      },
      lte(column: string, value: string) {
        calls.push(["lte", column, value]);
        return builder;
      },
      in(column: string, values: string[]) {
        calls.push(["in", column, values]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return builder;
      },
      then(resolve: (value: Response) => unknown) {
        return Promise.resolve(resolve(
          tableResponses.get(table) ?? { data: [], error: null },
        ));
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  CustomerPaymentServiceError,
  createCustomerPayment,
  getChallanPaymentState,
  getCustomerPayment,
  getCustomerSalesSummary,
  listCustomerOutstandingChallans,
  listCustomerPayments,
} = await import("./customer-payment-service.ts");

function reset(): void {
  calls.length = 0;
  rpcResponses.clear();
  tableResponses.clear();
}

const paymentRow = {
  id: "payment-1",
  factory_id: "factory-a",
  customer_id: "customer-a",
  customer_name_snapshot: "Customer A at payment",
  customer_address_snapshot: "Old customer address",
  customer_mobile_snapshot: "9000000001",
  company_name_snapshot: "Atlas Bricks at payment",
  company_business_description_snapshot: "Kiln and brick works",
  company_address_snapshot: "Old factory address",
  company_mobile_snapshot: "9000000002",
  payment_date: "2026-08-27",
  amount: "60000",
  payment_mode: "upi",
  note: "Bank reference 42",
  created_at: "2026-08-27T10:00:00Z",
};

const allocationRows = [{
  id: "allocation-1",
  factory_id: "factory-a",
  payment_id: "payment-1",
  challan_id: "challan-2",
  allocated_amount: "30000",
  created_at: "2026-08-27T10:00:00Z",
}, {
  id: "allocation-2",
  factory_id: "factory-a",
  payment_id: "payment-1",
  challan_id: "challan-1",
  allocated_amount: "30000",
  created_at: "2026-08-27T10:00:00Z",
}];

const challanNumberRows = [
  { id: "challan-1", challan_number: "41" },
  { id: "challan-2", challan_number: "42" },
];

test("creates one payment through the controlled RPC with explicit multi-Challan allocations", async () => {
  reset();
  rpcResponses.set("create_customer_payment", { data: paymentRow, error: null });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });

  const result = await createCustomerPayment({
    factoryId: "factory-a",
    customerId: "customer-a",
    paymentDate: "2026-08-27",
    amount: 60_000,
    paymentMode: "upi",
    note: "  Bank   reference 42 ",
    allocations: [
      { challanId: "challan-2", amount: 30_000 },
      { challanId: "challan-1", amount: 30_000 },
    ],
  });

  assert.equal(result.id, "payment-1");
  assert.equal(result.amount, 60_000);
  assert.equal(result.note, "Bank reference 42");
  assert.equal(result.paymentMode, "upi");
  assert.equal(result.customerNameSnapshot, "Customer A at payment");
  assert.deepEqual(result.allocations.map((allocation: { challanId: string }) => (
    allocation.challanId
  )), ["challan-2", "challan-1"]);
  assert.deepEqual(result.allocations.map((allocation: { challanNumber: string | null }) => (
    allocation.challanNumber
  )), ["42", "41"]);
  assert.deepEqual(calls[0], ["rpc", "create_customer_payment", {
    p_factory_id: "factory-a",
    p_customer_id: "customer-a",
    p_payment_date: "2026-08-27",
    p_amount: 60_000,
    p_payment_mode: "upi",
    p_note: "Bank reference 42",
    p_allocations: [
      { challan_id: "challan-2", amount: 30_000 },
      { challan_id: "challan-1", amount: 30_000 },
    ],
  }]);
  assert.equal(calls.some(([method]) => method === "insert"), false);
});

test("rejects invalid, duplicate, or non-equal allocations before calling Supabase", async () => {
  reset();
  const base = {
    factoryId: "factory-a",
    customerId: "customer-a",
    paymentDate: "2026-08-27",
    amount: 60_000,
    paymentMode: "cash" as const,
  };

  await assert.rejects(
    () => createCustomerPayment({ ...base, allocations: [] }),
    /between 1 and 100 allocations/,
  );
  await assert.rejects(
    () => createCustomerPayment({
      ...base,
      allocations: [
        { challanId: "challan-1", amount: 30_000 },
        { challanId: "challan-1", amount: 30_000 },
      ],
    }),
    /same Challan cannot appear twice/,
  );
  for (const allocatedAmount of [59_999, 60_001]) {
    await assert.rejects(
      () => createCustomerPayment({
        ...base,
        allocations: [{ challanId: "challan-1", amount: allocatedAmount }],
      }),
      /exactly equal/,
    );
  }
  await assert.rejects(
    () => createCustomerPayment({
      ...base,
      paymentDate: "2026-02-30",
      allocations: [{ challanId: "challan-1", amount: 60_000 }],
    }),
    /valid YYYY-MM-DD date/,
  );
  await assert.rejects(
    () => createCustomerPayment({
      ...base,
      amount: 1.001,
      allocations: [{ challanId: "challan-1", amount: 1.001 }],
    }),
    /at most two decimal places/,
  );
  await assert.rejects(
    () => createCustomerPayment({
      ...base,
      paymentMode: "bitcoin" as "cash",
      allocations: [{ challanId: "challan-1", amount: 60_000 }],
    }),
    /supported payment mode/,
  );
  assert.equal(calls.length, 0);
});

test("reads authoritative Challan payment state and customer outstanding summaries", async () => {
  reset();
  rpcResponses.set("get_challan_payment_state", {
    data: [{
      challan_id: "challan-1",
      challan_status: "active",
      sale_total: "100000",
      total_paid: "30000",
      outstanding_amount: "70000",
      payment_state: "partially_paid",
    }],
    error: null,
  });
  rpcResponses.set("get_customer_sales_summary", {
    data: [{
      customer_id: "customer-a",
      total_active_sales: "130000",
      total_payments_allocated: "30000",
      total_outstanding: "100000",
    }],
    error: null,
  });

  assert.deepEqual(await getChallanPaymentState("factory-a", "challan-1"), {
    challanId: "challan-1",
    challanStatus: "active",
    saleTotal: 100_000,
    totalPaid: 30_000,
    outstandingAmount: 70_000,
    paymentState: "partially_paid",
  });
  assert.deepEqual(await getCustomerSalesSummary("factory-a", "customer-a"), {
    customerId: "customer-a",
    totalActiveSales: 130_000,
    totalPaymentsAllocated: 30_000,
    totalOutstanding: 100_000,
  });
  assert.deepEqual(calls.filter(([method]) => method === "rpc").map((call) => call[1]), [
    "get_challan_payment_state",
    "get_customer_sales_summary",
  ]);
});

test("lists immutable payment history with source payment and Challan IDs", async () => {
  reset();
  tableResponses.set("customer_payments", { data: [paymentRow], error: null });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });

  const payments = await listCustomerPayments("factory-a", "customer-a");
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.id, "payment-1");
  assert.deepEqual(payments[0]?.allocations.map((allocation: { paymentId: string; challanId: string }) => ({
    paymentId: allocation.paymentId,
    challanId: allocation.challanId,
  })), [
    { paymentId: "payment-1", challanId: "challan-2" },
    { paymentId: "payment-1", challanId: "challan-1" },
  ]);
  assert.deepEqual(calls.find(([method]) => method === "in"), [
    "in", "payment_id", ["payment-1"],
  ]);
});

test("loads one receipt source with immutable payment-time snapshots and Challan numbers", async () => {
  reset();
  tableResponses.set("customer_payments", { data: [paymentRow], error: null });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });
  const payment = await getCustomerPayment("factory-a", "payment-1");
  assert.equal(payment.companyNameSnapshot, "Atlas Bricks at payment");
  assert.equal(payment.customerAddressSnapshot, "Old customer address");
  assert.deepEqual(payment.allocations.map((allocation: { challanNumber: string | null }) => allocation.challanNumber), ["42", "41"]);
  assert.deepEqual(calls.filter(([method]) => method === "eq").slice(0, 2), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "id", "payment-1"],
  ]);
});

test("lists outstanding Challans with one goods batch and authoritative payment states", async () => {
  reset();
  tableResponses.set("challans", {
    data: [{
      id: "challan-1", challan_number: "41", challan_date: "2026-08-25",
      created_at: "2026-08-25T09:00:00Z",
      challan_total: "80000", status: "active", is_locked: true,
    }, {
      id: "challan-2", challan_number: null, challan_date: "2026-08-26",
      created_at: "2026-08-26T09:00:00Z",
      challan_total: "5000", status: "active", is_locked: true,
    }],
    error: null,
  });
  rpcResponses.set("get_challan_payment_state:challan-1", {
    data: [{ challan_id: "challan-1", challan_status: "active", sale_total: "80000", total_paid: "50000", outstanding_amount: "30000", payment_state: "partially_paid" }],
    error: null,
  });
  rpcResponses.set("get_challan_payment_state:challan-2", {
    data: [{ challan_id: "challan-2", challan_status: "active", sale_total: "5000", total_paid: "5000", outstanding_amount: "0", payment_state: "paid" }],
    error: null,
  });
  tableResponses.set("challan_items", {
    data: [{
      id: "item-1", challan_id: "challan-1",
      brick_particulars_snapshot: "Historical 1st Class", quantity: "1500", line_position: 1,
    }, {
      id: "item-2", challan_id: "challan-1",
      brick_particulars_snapshot: "Historical 2nd Class", quantity: "2000", line_position: 2,
    }, {
      id: "item-paid", challan_id: "challan-2",
      brick_particulars_snapshot: "Paid goods", quantity: "1000", line_position: 1,
    }],
    error: null,
  });
  const result = await listCustomerOutstandingChallans("factory-a", "customer-a");
  assert.deepEqual(result, [{
    challanId: "challan-1",
    challanStatus: "active",
    saleTotal: 80_000,
    totalPaid: 50_000,
    outstandingAmount: 30_000,
    paymentState: "partially_paid",
    challanNumber: "41",
    challanDate: "2026-08-25",
    createdAt: "2026-08-25T09:00:00Z",
    isLocked: true,
    brickLines: [{
      itemId: "item-1", particularsSnapshot: "Historical 1st Class", quantity: 1500,
    }, {
      itemId: "item-2", particularsSnapshot: "Historical 2nd Class", quantity: 2000,
    }],
  }]);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "customer_id" && call[2] === "customer-a"));
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "status" && call[2] === "active"));
  assert.equal(calls.some(([method]) => method === "gte" || method === "lte"), false);
  assert.equal(calls.filter((call) => call[0] === "in" && call[1] === "challan_id").length, 1);
  assert.equal(calls.filter((call) => call[0] === "rpc" && call[1] === "get_challan_payment_state").length, 2);
});

test("filters candidate headers by inclusive challan_date before payment-state and goods reads", async () => {
  reset();
  tableResponses.set("challans", {
    data: [{
      id: "challan-in-range", challan_number: null, challan_date: "2026-09-10",
      created_at: "2020-01-01T09:00:00Z",
      challan_total: "9000", status: "active", is_locked: false,
    }],
    error: null,
  });
  rpcResponses.set("get_challan_payment_state:challan-in-range", {
    data: [{ challan_id: "challan-in-range", challan_status: "active", sale_total: "9000", total_paid: "1000", outstanding_amount: "8000", payment_state: "partially_paid" }],
    error: null,
  });
  tableResponses.set("challan_items", { data: [], error: null });

  const result = await listCustomerOutstandingChallans("factory-a", "customer-a", {
    fromDate: "2026-09-01",
    toDate: "2026-09-10",
  });

  assert.deepEqual(calls.filter(([method]) => method === "gte" || method === "lte"), [
    ["gte", "challan_date", "2026-09-01"],
    ["lte", "challan_date", "2026-09-10"],
  ]);
  assert.equal(result[0]?.challanDate, "2026-09-10");
  assert.equal(result[0]?.createdAt, "2020-01-01T09:00:00Z");
  assert.equal(result[0]?.outstandingAmount, 8000);
  const firstRpcIndex = calls.findIndex(([method]) => method === "rpc");
  const rangeEndIndex = calls.findIndex(([method]) => method === "lte");
  assert.ok(rangeEndIndex >= 0 && firstRpcIndex > rangeEndIndex);
  assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  assert.equal(calls.filter(([method, value]) => method === "from" && value === "challan_items").length, 1);
});

test("rejects invalid Customer Dues ranges before any Supabase request", async () => {
  reset();
  await assert.rejects(
    () => listCustomerOutstandingChallans("factory-a", "customer-a", {
      fromDate: "2026-09-11",
      toDate: "2026-09-10",
    }),
    /dateFrom must not be after dateTo/,
  );
  assert.deepEqual(calls, []);
});

test("outstanding Challan without a manual number keeps NULL and never fabricates a reference", async () => {
  reset();
  tableResponses.set("challans", {
    data: [{
      id: "challan-null", challan_number: null, challan_date: "2026-08-27",
      created_at: "2026-08-27T09:00:00Z",
      challan_total: "9000", status: "active", is_locked: false,
    }],
    error: null,
  });
  rpcResponses.set("get_challan_payment_state:challan-null", {
    data: [{ challan_id: "challan-null", challan_status: "active", sale_total: "9000", total_paid: "0", outstanding_amount: "9000", payment_state: "unpaid" }],
    error: null,
  });
  tableResponses.set("challan_items", {
    data: [{
      id: "item-null", challan_id: "challan-null",
      brick_particulars_snapshot: "1st Class", quantity: "1500", line_position: 1,
    }],
    error: null,
  });

  const result = await listCustomerOutstandingChallans("factory-a", "customer-a");
  assert.equal(result[0]?.challanNumber, null);
  assert.equal(result[0]?.outstandingAmount, 9000);
  assert.deepEqual(result[0]?.brickLines, [
    { itemId: "item-null", particularsSnapshot: "1st Class", quantity: 1500 },
  ]);
});

test("goods batch preserves factory-scoped read errors", async () => {
  reset();
  tableResponses.set("challans", {
    data: [{
      id: "challan-1", challan_number: "41", challan_date: "2026-08-25",
      created_at: "2026-08-25T09:00:00Z",
      challan_total: "80000", status: "active", is_locked: true,
    }],
    error: null,
  });
  rpcResponses.set("get_challan_payment_state:challan-1", {
    data: [{ challan_id: "challan-1", challan_status: "active", sale_total: "80000", total_paid: "0", outstanding_amount: "80000", payment_state: "unpaid" }],
    error: null,
  });
  tableResponses.set("challan_items", {
    data: null,
    error: { message: "Access denied.", code: "42501", details: null, hint: null },
  });

  await assert.rejects(
    () => listCustomerOutstandingChallans("factory-a", "customer-a"),
    (error: unknown) => error instanceof CustomerPaymentServiceError
      && error.code === "42501",
  );
});

test("preserves database overpayment, lifecycle, and factory-security errors", async () => {
  reset();
  rpcResponses.set("create_customer_payment", {
    data: null,
    error: {
      message: "Allocation exceeds the Challan outstanding amount.",
      code: "P3105",
      details: "authoritative outstanding",
      hint: null,
    },
  });

  await assert.rejects(
    () => createCustomerPayment({
      factoryId: "factory-a",
      customerId: "customer-a",
      paymentDate: "2026-08-27",
      amount: 70_001,
      paymentMode: "cash",
      allocations: [{ challanId: "challan-1", amount: 70_001 }],
    }),
    (error: unknown) => error instanceof CustomerPaymentServiceError
      && error.code === "P3105"
      && error.message.includes("outstanding"),
  );

  reset();
  rpcResponses.set("get_customer_sales_summary", {
    data: null,
    error: { message: "Access denied.", code: "42501", details: null, hint: null },
  });
  await assert.rejects(
    () => getCustomerSalesSummary("factory-b", "customer-a"),
    (error: unknown) => error instanceof CustomerPaymentServiceError
      && error.code === "42501",
  );
});

test("rejects successful RPC responses that omit their result row", async () => {
  reset();
  rpcResponses.set("create_customer_payment", { data: null, error: null });
  await assert.rejects(
    () => createCustomerPayment({
      factoryId: "factory-a",
      customerId: "customer-a",
      paymentDate: "2026-08-27",
      amount: 1,
      paymentMode: "cash",
      allocations: [{ challanId: "challan-1", amount: 1 }],
    }),
    /returned no payment/,
  );

  reset();
  rpcResponses.set("get_challan_payment_state", { data: [], error: null });
  await assert.rejects(
    () => getChallanPaymentState("factory-a", "challan-1"),
    /returned no state/,
  );
});
