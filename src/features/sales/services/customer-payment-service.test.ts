import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  emptyCustomerPaymentForm, isCustomerPaymentReadCurrent,
  refreshCustomerPaymentQueries, saveCustomerPaymentAndRefresh,
} from "../../office/customer-payment-office-model.ts";
import { CustomerPaymentUnknownOutcomeError } from "../types.ts";
import { loadPaymentReceiptDetails } from "../payment-receipt-model.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import type { CustomerPaymentForm } from "../../office/customer-payment-office-model.ts";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: Row | Row[] | null; error: DatabaseError | null; status?: number };
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
    const orderings: Array<{ column: string; ascending: boolean }> = [];
    let afterId: string | null = null;
    let maximumRows = Number.POSITIVE_INFINITY;
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
      gt(column: string, value: string) {
        calls.push(["gt", column, value]);
        if (column === "id") afterId = value;
        return builder;
      },
      in(column: string, values: string[]) {
        calls.push(["in", column, values]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        orderings.push({ column, ascending: options.ascending });
        return builder;
      },
      limit(value: number) {
        calls.push(["limit", value]);
        maximumRows = value;
        return builder;
      },
      then(resolve: (value: Response) => unknown) {
        const response = tableResponses.get(table) ?? { data: [], error: null };
        if (response.error || !Array.isArray(response.data)) {
          return Promise.resolve(resolve(response));
        }
        const data = response.data
          .filter((row) => afterId === null || String(row.id) > afterId)
          .sort((left, right) => {
            for (const ordering of orderings) {
              const comparison = String(left[ordering.column]).localeCompare(
                String(right[ordering.column]),
              );
              if (comparison !== 0) return ordering.ascending ? comparison : -comparison;
            }
            return 0;
          })
          .slice(0, maximumRows);
        return Promise.resolve(resolve({ data, error: null }));
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
  createCustomerPaymentWithMethods,
  getChallanPaymentState,
  getCustomerPayment,
  getCustomerSalesSummary,
  listFactoryCustomerPayments,
  listCustomerOutstandingChallans,
  listCustomerPayments,
} = await import("./customer-payment-service.ts");

function reset(): void {
  calls.length = 0;
  rpcResponses.clear();
  tableResponses.clear();
}

const paymentRow = {
  id: "11111111-1111-4111-8111-111111111111",
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
  payment_id: "11111111-1111-4111-8111-111111111111",
  challan_id: "challan-2",
  allocated_amount: "30000",
  created_at: "2026-08-27T10:00:00Z",
}, {
  id: "allocation-2",
  factory_id: "factory-a",
  payment_id: "11111111-1111-4111-8111-111111111111",
  challan_id: "challan-1",
  allocated_amount: "30000",
  created_at: "2026-08-27T10:00:00Z",
}];

const paymentMethodRows = [{
  factory_id: "factory-a",
  payment_id: "11111111-1111-4111-8111-111111111111",
  mode: "upi",
  split_amount: null,
  created_at: "2026-08-27T10:00:00Z",
}];

const challanNumberRows = [
  { id: "challan-1", challan_number: "41", challan_date: "2026-08-25" },
  { id: "challan-2", challan_number: "42", challan_date: "2026-08-26" },
];

test("creates one payment through the controlled RPC with explicit multi-Challan allocations", async () => {
  reset();
  rpcResponses.set("create_customer_payment", { data: paymentRow, error: null });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("customer_payment_methods", { data: paymentMethodRows, error: null });
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

  assert.equal(result.id, "11111111-1111-4111-8111-111111111111");
  assert.ok(result.detailsStatus === "ready");
  assert.equal(result.amount, 60_000);
  assert.equal(result.note, "Bank reference 42");
  assert.equal(result.paymentMode, "upi");
  assert.deepEqual(result.methods, [{ mode: "upi", splitAmount: null }]);
  assert.equal(result.customerNameSnapshot, "Customer A at payment");
  assert.deepEqual(result.allocations.map((allocation: { challanId: string }) => (
    allocation.challanId
  )), ["challan-2", "challan-1"]);
  assert.deepEqual(result.allocations.map((allocation: { challanNumber: string | null }) => (
    allocation.challanNumber
  )), ["42", "41"]);
  assert.deepEqual(result.allocations.map((allocation: { challanDate: string }) => (
    allocation.challanDate
  )), ["2026-08-26", "2026-08-25"]);
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

test("creates one multi-mode payment through the new RPC without changing allocations", async () => {
  reset();
  const multiPaymentRow = { ...paymentRow, payment_mode: "multiple" };
  rpcResponses.set("create_customer_payment_with_methods", {
    data: multiPaymentRow,
    error: null,
  });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("customer_payment_methods", {
    data: [{
      ...paymentMethodRows[0], mode: "upi", split_amount: "10000",
    }, {
      ...paymentMethodRows[0], mode: "cheque", split_amount: "50000",
    }],
    error: null,
  });
  tableResponses.set("challans", { data: challanNumberRows, error: null });

  const result = await createCustomerPaymentWithMethods({
    factoryId: "factory-a",
    customerId: "customer-a",
    paymentDate: "2026-08-27",
    amount: 60_000,
    methods: [
      { mode: "upi", splitAmount: 10_000 },
      { mode: "cheque", splitAmount: 50_000 },
    ],
    note: "  Split   tender ",
    allocations: [
      { challanId: "challan-2", amount: 30_000 },
      { challanId: "challan-1", amount: 30_000 },
    ],
  });

  assert.equal(result.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.paymentMode, "multiple");
  assert.ok(result.detailsStatus === "ready");
  assert.deepEqual(result.methods, [
    { mode: "cheque", splitAmount: 50_000 },
    { mode: "upi", splitAmount: 10_000 },
  ]);
  assert.equal(result.allocations.length, 2);
  assert.deepEqual(calls[0], ["rpc", "create_customer_payment_with_methods", {
    p_factory_id: "factory-a",
    p_customer_id: "customer-a",
    p_payment_date: "2026-08-27",
    p_amount: 60_000,
    p_payment_methods: [
      { mode: "upi", amount: 10_000 },
      { mode: "cheque", amount: 50_000 },
    ],
    p_note: "Split tender",
    p_allocations: [
      { challan_id: "challan-2", amount: 30_000 },
      { challan_id: "challan-1", amount: 30_000 },
    ],
  }]);
});

test("rejects partial, duplicate, and mismatched method splits before calling Supabase", async () => {
  const base = {
    factoryId: "factory-a",
    customerId: "customer-a",
    paymentDate: "2026-08-27",
    amount: 60_000,
    allocations: [{ challanId: "challan-1", amount: 60_000 }],
  };

  for (const methods of [
    [{ mode: "upi", splitAmount: 10_000 }, { mode: "cheque" }],
    [{ mode: "upi" }, { mode: "upi" }],
    [{ mode: "upi", splitAmount: 10_000 }, { mode: "cheque", splitAmount: 40_000 }],
  ] as const) {
    reset();
    await assert.rejects(
      () => createCustomerPaymentWithMethods({ ...base, methods: [...methods] }),
      /every payment method|same payment mode|exactly equal/,
    );
    assert.equal(calls.length, 0);
  }
});

test("new writer sends unsplit methods as explicit NULL amounts", async () => {
  reset();
  rpcResponses.set("create_customer_payment_with_methods", {
    data: { ...paymentRow, payment_mode: "multiple" },
    error: null,
  });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });
  tableResponses.set("customer_payment_methods", {
    data: [{ ...paymentMethodRows[0], mode: "upi" }, {
      ...paymentMethodRows[0], mode: "cheque",
    }],
    error: null,
  });

  const result = await createCustomerPaymentWithMethods({
    factoryId: "factory-a",
    customerId: "customer-a",
    paymentDate: "2026-08-27",
    amount: 60_000,
    methods: [{ mode: "upi" }, { mode: "cheque", splitAmount: null }],
    allocations: [{ challanId: "challan-1", amount: 60_000 }],
  });

  assert.deepEqual((calls[0]?.[2] as { p_payment_methods: unknown }).p_payment_methods, [
    { mode: "upi", amount: null },
    { mode: "cheque", amount: null },
  ]);
  assert.ok(result.detailsStatus === "ready");
  assert.deepEqual(result.methods, [
    { mode: "cheque", splitAmount: null },
    { mode: "upi", splitAmount: null },
  ]);
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
  tableResponses.set("customer_payment_methods", { data: paymentMethodRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });

  const payments = await listCustomerPayments("factory-a", "customer-a");
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.id, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(payments[0]?.methods, [{ mode: "upi", splitAmount: null }]);
  assert.deepEqual(payments[0]?.allocations.map((allocation: { paymentId: string; challanId: string }) => ({
    paymentId: allocation.paymentId,
    challanId: allocation.challanId,
  })), [
    { paymentId: "11111111-1111-4111-8111-111111111111", challanId: "challan-2" },
    { paymentId: "11111111-1111-4111-8111-111111111111", challanId: "challan-1" },
  ]);
  assert.deepEqual(calls.find(([method]) => method === "in"), [
    "in", "payment_id", ["11111111-1111-4111-8111-111111111111"],
  ]);
  assert.ok(calls.some((call) => call[0] === "eq"
    && call[1] === "customer_id"
    && call[2] === "customer-a"));
  assert.equal(calls.filter((call) => call[0] === "from"
    && call[1] === "customer_payment_methods").length, 1);
  assert.deepEqual(calls.filter(([method]) => method === "order").slice(0, 3), [
    ["order", "payment_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("lists factory-wide payments for multiple customers with allocations and UUID-safe duplicate Challan numbers", async () => {
  reset();
  const paymentA = {
    ...paymentRow,
    id: "00000000-0000-4000-8000-000000000001",
    customer_id: "customer-a",
    customer_name_snapshot: "Customer A at payment",
    payment_date: "2026-09-10",
    created_at: "2026-09-10T09:00:00Z",
  };
  const paymentB = {
    ...paymentRow,
    id: "00000000-0000-4000-8000-000000000002",
    customer_id: "customer-b",
    customer_name_snapshot: "Customer B at payment",
    payment_date: "2026-09-10",
    created_at: "2026-09-10T10:00:00Z",
  };
  const paymentC = {
    ...paymentRow,
    id: "00000000-0000-4000-8000-000000000003",
    customer_id: "customer-c",
    customer_name_snapshot: "Customer C at payment",
    payment_date: "2026-09-10",
    created_at: "2026-09-10T10:00:00Z",
  };
  const olderPayment = {
    ...paymentRow,
    id: "00000000-0000-4000-8000-000000000004",
    customer_id: "customer-b",
    customer_name_snapshot: "Customer B at payment",
    payment_date: "2026-09-09",
    created_at: "2026-09-11T12:00:00Z",
  };
  tableResponses.set("customer_payments", {
    data: [paymentA, olderPayment, paymentC, paymentB],
    error: null,
  });
  tableResponses.set("customer_payment_allocations", {
    data: [{
      id: "allocation-b",
      factory_id: "factory-a",
      payment_id: paymentB.id,
      challan_id: "challan-duplicate-b",
      allocated_amount: "20000",
      created_at: "2026-09-10T10:00:00Z",
    }, {
      id: "allocation-a-2",
      factory_id: "factory-a",
      payment_id: paymentA.id,
      challan_id: "challan-extra",
      allocated_amount: "30000",
      created_at: "2026-09-10T09:00:01Z",
    }, {
      id: "allocation-a-1",
      factory_id: "factory-a",
      payment_id: paymentA.id,
      challan_id: "challan-duplicate-a",
      allocated_amount: "30000",
      created_at: "2026-09-10T09:00:00Z",
    }],
    error: null,
  });
  tableResponses.set("customer_payment_methods", {
    data: [{
      factory_id: "factory-a", payment_id: paymentA.id,
      mode: "cash", split_amount: null, created_at: paymentA.created_at,
    }, {
      factory_id: "factory-a", payment_id: paymentB.id,
      mode: "upi", split_amount: "5000", created_at: paymentB.created_at,
    }, {
      factory_id: "factory-a", payment_id: paymentB.id,
      mode: "cheque", split_amount: "55000", created_at: paymentB.created_at,
    }],
    error: null,
  });
  tableResponses.set("challans", {
    data: [
      { id: "challan-duplicate-a", challan_number: "11", challan_date: "2026-09-01" },
      { id: "challan-duplicate-b", challan_number: "11", challan_date: "2026-09-02" },
      { id: "challan-extra", challan_number: null, challan_date: "2026-09-03" },
    ],
    error: null,
  });

  const payments = await listFactoryCustomerPayments("factory-a");

  assert.deepEqual(payments.map((payment: { id: string }) => payment.id), [
    paymentC.id,
    paymentB.id,
    paymentA.id,
    olderPayment.id,
  ]);
  assert.deepEqual(payments.map((payment: { customerId: string }) => payment.customerId), [
    "customer-c",
    "customer-b",
    "customer-a",
    "customer-b",
  ]);
  const customerAPayment = payments.find((payment: { id: string }) => payment.id === paymentA.id);
  assert.deepEqual(customerAPayment?.allocations.map((allocation: {
    challanId: string;
    challanNumber: string | null;
    allocatedAmount: number;
  }) => ({
    challanId: allocation.challanId,
    challanNumber: allocation.challanNumber,
    allocatedAmount: allocation.allocatedAmount,
  })), [{
    challanId: "challan-duplicate-a",
    challanNumber: "11",
    allocatedAmount: 30_000,
  }, {
    challanId: "challan-extra",
    challanNumber: null,
    allocatedAmount: 30_000,
  }]);
  const customerBPayment = payments.find((payment: { id: string }) => payment.id === paymentB.id);
  assert.equal(customerBPayment?.allocations[0]?.challanId, "challan-duplicate-b");
  assert.equal(customerBPayment?.allocations[0]?.challanNumber, "11");
  assert.deepEqual(customerBPayment?.methods, [{
    mode: "cheque", splitAmount: 55_000,
  }, {
    mode: "upi", splitAmount: 5_000,
  }]);
  assert.deepEqual(payments.find((payment: { id: string }) => payment.id === paymentC.id)?.methods, [{
    mode: "upi", splitAmount: null,
  }]);

  assert.equal(calls.some((call) => call[0] === "eq" && call[1] === "customer_id"), false);
  assert.equal(calls.filter((call) => call[0] === "eq"
    && call[1] === "factory_id"
    && call[2] === "factory-a").length, 4);
  assert.equal(calls.filter((call) => call[0] === "from"
    && call[1] === "customer_payment_allocations").length, 1);
  assert.equal(calls.filter((call) => call[0] === "from"
    && call[1] === "customer_payment_methods").length, 1);
  assert.deepEqual(calls.filter(([method]) => method === "limit"), [
    ["limit", 500],
    ["limit", 500],
  ]);
});

test("factory-wide payment history returns empty without unnecessary allocation reads", async () => {
  reset();
  tableResponses.set("customer_payments", { data: [], error: null });

  assert.deepEqual(await listFactoryCustomerPayments("factory-empty"), []);
  assert.deepEqual(calls.filter(([method]) => method === "from"), [
    ["from", "customer_payments"],
  ]);
  assert.ok(calls.some((call) => call[0] === "eq"
    && call[1] === "factory_id"
    && call[2] === "factory-empty"));
});

test("loads one receipt source with immutable payment-time snapshots and Challan numbers", async () => {
  reset();
  tableResponses.set("customer_payments", { data: [paymentRow], error: null });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("customer_payment_methods", { data: paymentMethodRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });
  const payment = await getCustomerPayment("factory-a", "11111111-1111-4111-8111-111111111111");
  assert.ok(payment.detailsStatus === "ready");
  assert.equal(payment.companyNameSnapshot, "Atlas Bricks at payment");
  assert.equal(payment.customerAddressSnapshot, "Old customer address");
  assert.deepEqual(payment.methods, [{ mode: "upi", splitAmount: null }]);
  assert.deepEqual(payment.allocations.map((allocation: { challanNumber: string | null }) => allocation.challanNumber), ["42", "41"]);
  assert.deepEqual(calls.filter(([method]) => method === "eq").slice(0, 2), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "id", "11111111-1111-4111-8111-111111111111"],
  ]);
});

test("falls back to a legacy scalar without inventing a split when child methods are missing", async () => {
  reset();
  tableResponses.set("customer_payments", { data: [paymentRow], error: null });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });
  tableResponses.set("customer_payment_methods", { data: [], error: null });

  const payment = await getCustomerPayment("factory-a", "11111111-1111-4111-8111-111111111111");
  assert.ok(payment.detailsStatus === "ready");
  assert.deepEqual(payment.methods, [{ mode: "upi", splitAmount: null }]);

  reset();
  tableResponses.set("customer_payments", {
    data: [{ ...paymentRow, payment_mode: "multiple" }], error: null,
  });
  tableResponses.set("customer_payment_allocations", { data: [], error: null });
  tableResponses.set("customer_payment_methods", { data: [], error: null });
  const unavailable = await getCustomerPayment("factory-a", "11111111-1111-4111-8111-111111111111");
  assert.equal(unavailable.detailsStatus, "unavailable");
  assert.equal("methods" in unavailable, false);
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
    (error: unknown) => error instanceof CustomerPaymentUnknownOutcomeError,
  );

  reset();
  rpcResponses.set("get_challan_payment_state", { data: [], error: null });
  await assert.rejects(
    () => getChallanPaymentState("factory-a", "challan-1"),
    /returned no state/,
  );
});

const submission = {
  factoryId: "factory-a", customerId: "customer-a", paymentDate: "2026-08-27",
  amount: 60_000, methods: [{ mode: "upi" as const, splitAmount: 30_000 }, { mode: "cash" as const, splitAmount: 30_000 }],
  allocations: [{ challanId: "challan-1", amount: 30_000 }, { challanId: "challan-2", amount: 30_000 }],
};
const readError = { message: "Provider detail must not leak", code: "PGRST000", details: null, hint: null };

function prepareSubmission(split: boolean) {
  reset();
  rpcResponses.set(split ? "create_customer_payment_with_methods" : "create_customer_payment", {
    data: { ...paymentRow, payment_mode: split ? "multiple" : "upi" }, error: null,
  });
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  tableResponses.set("challans", { data: challanNumberRows, error: null });
  tableResponses.set("customer_payment_methods", { data: split ? [
    { ...paymentMethodRows[0], mode: "upi", split_amount: "30000" },
    { ...paymentMethodRows[0], mode: "cash", split_amount: "30000" },
  ] : paymentMethodRows, error: null });
  return () => split ? createCustomerPaymentWithMethods(submission)
    : createCustomerPayment({ ...submission, paymentMode: "upi" });
}

for (const split of [false, true]) {
  const label = split ? "split-mode" : "single-mode";
  for (const failure of ["allocations", "methods", "references", "missing-reference", "method-mapping", "missing-children"]) {
    test(`${label} committed success survives ${failure} hydration failure without fabricated receipt children`, async () => {
      const create = prepareSubmission(split);
      if (failure === "allocations") tableResponses.set("customer_payment_allocations", { data: null, error: readError });
      if (failure === "methods") tableResponses.set("customer_payment_methods", { data: null, error: readError });
      if (failure === "references") tableResponses.set("challans", { data: null, error: readError });
      if (failure === "missing-reference") tableResponses.set("challans", { data: [], error: null });
      if (failure === "method-mapping") tableResponses.set("customer_payment_methods", { data: [{ ...paymentMethodRows[0], split_amount: "not-money" }], error: null });
      if (failure === "missing-children") tableResponses.set("customer_payment_methods", { data: [], error: null });
      const result = await create();
      assert.equal(result.id, paymentRow.id);
      assert.equal(result.amount, 60_000);
      assert.equal(result.detailsStatus, "unavailable");
      assert.equal("allocations" in result, false);
      assert.equal("methods" in result, false);
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    });
  }
  test(`${label} explicit RPC rejection preserves failure and does not hydrate or reset`, async () => {
    const create = prepareSubmission(split);
    rpcResponses.set(split ? "create_customer_payment_with_methods" : "create_customer_payment", {
      data: null, error: { ...readError, code: "P3105", message: "Allocation exceeds outstanding." },
    });
    let resets = 0;
    const outcome = await saveCustomerPaymentAndRefresh(submission, create, () => { resets++; }, () => {}, async () => {});
    assert.equal(outcome.status, "failed");
    assert.equal(resets, 0);
    assert.equal(calls.filter(([method]) => method === "from").length, 0);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  });
  test(`${label} missing/malformed authoritative ID remains unknown without draft reset or retry`, async () => {
    for (const row of [null, ...[undefined, null, "", "payment-1", "00000000-0000-0000-0000-000000000000"]
      .map((id) => ({ ...paymentRow, id }))]) {
      const create = prepareSubmission(split);
      rpcResponses.set(split ? "create_customer_payment_with_methods" : "create_customer_payment", {
        data: row, error: null,
      });
      let resets = 0; let refreshed = false;
      const outcome = await saveCustomerPaymentAndRefresh(submission, create, () => { resets++; }, () => {}, async () => { refreshed = true; });
      assert.equal(outcome.status, "unknown");
      assert.equal(resets, 0);
      assert.equal(refreshed, false);
      assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
      assert.equal(calls.filter(([method]) => method === "from").length, 0);
    }
  });
}

test("a lost RPC response remains unknown and never automatically issues another RPC", async () => {
  const create = prepareSubmission(true);
  rpcResponses.set("create_customer_payment_with_methods", { data: null, error: { ...readError, code: "", message: "Failed to fetch" }, status: 0 });
  let resets = 0;
  const result = await saveCustomerPaymentAndRefresh(submission, create, () => { resets++; }, () => {}, async () => {});
  assert.equal(result.status, "unknown");
  assert.equal(resets, 0);
  assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
});

test("confirmed split payment resets its draft before a throwing post-save callback and keeps saved status", async () => {
  const create = prepareSubmission(true);
  let draft: CustomerPaymentForm = { ...emptyCustomerPaymentForm("2026-08-27"), amount: "60000", paymentModes: ["cash" as const, "upi" as const],
    paymentMethodAmounts: { cash: "30000", upi: "30000" }, allocations: { "challan-1": "30000", "challan-2": "30000" } };
  const events: string[] = [];
  const outcome = await saveCustomerPaymentAndRefresh(submission, create, () => {
    draft = emptyCustomerPaymentForm("2026-08-27"); events.push("reset");
  }, () => { events.push("callback"); throw new Error("Post-save failed"); }, async () => { events.push("refresh"); });
  assert.equal(draft.amount, "");
  assert.deepEqual(draft.allocations, {});
  assert.deepEqual(draft.paymentMethodAmounts, {});
  assert.equal(events[0], "reset");
  assert.ok(events.includes("refresh"));
  assert.ok(outcome.status === "saved");
  assert.equal(outcome.refresh, "outdated");
  assert.ok(outcome.payment.detailsStatus === "ready");
  assert.deepEqual(outcome.payment.methods.map((method) => method.splitAmount), [30_000, 30_000]);
  assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
});

test("failed hydration and failed refetch stay saved; hidden/customer navigation cannot verify stale balances; Refresh only reads", async () => {
  const create = prepareSubmission(true);
  tableResponses.set("customer_payment_methods", { data: null, error: readError });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["office-customer-payment-summary", "factory-a", "customer-a"];
  const history = ["office-customer-payment-history", "factory-a", "customer-a"];
  const allPayments = ["office-factory-customer-payments", "factory-a"];
  let failReads = true; let refreshReads = 0;
  const queryFn = async () => { refreshReads++; if (failReads) throw new Error("Read unavailable"); return { totalOutstanding: 10 }; };
  client.setQueryData(key, { totalOutstanding: 100 });
  client.setQueryData(history, []);
  client.setQueryData(allPayments, []);
  const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: Infinity });
  const historyObserver = new QueryObserver(client, { queryKey: history, queryFn, staleTime: Infinity });
  const allPaymentsObserver = new QueryObserver(client, { queryKey: allPayments, queryFn, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  const unsubscribeHistory = historyObserver.subscribe(() => {});
  const unsubscribeAll = allPaymentsObserver.subscribe(() => {});
  let draft = { ...emptyCustomerPaymentForm("2026-08-27"), amount: "60000" };
  try {
    const outcome = await saveCustomerPaymentAndRefresh(submission, create,
      () => { draft = emptyCustomerPaymentForm("2026-08-27"); }, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", ["challan-1", "challan-2"]));
    assert.ok(outcome.status === "saved");
    assert.equal(outcome.payment.id, paymentRow.id);
    assert.equal(outcome.payment.detailsStatus, "unavailable");
    assert.equal(outcome.refresh, "outdated");
    assert.equal(draft.amount, "");
    const state = client.getQueryState(key)!;
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: false, error: state.error,
      isInvalidated: state.isInvalidated, dataUpdatedAt: state.dataUpdatedAt }), false);
    // Office tabs only hide the observer: retaining cached data does not make it current.
    assert.equal(client.getQueryData<{ totalOutstanding: number }>(key)?.totalOutstanding, 100);
    observer.setOptions({ queryKey: ["office-customer-payment-summary", "factory-a", "customer-b"], queryFn, enabled: false });
    assert.equal(client.getQueryState(key)?.isInvalidated, true);
    observer.setOptions({ queryKey: key, queryFn, staleTime: Infinity });
    assert.equal(client.getQueryState(key)?.isInvalidated, true);
    // All Payments is mounted but disabled behind its tab; invalidation survives navigation.
    assert.equal(client.getQueryState(allPayments)?.isInvalidated, true);
    allPaymentsObserver.setOptions({ queryKey: allPayments, queryFn, enabled: true });
    const navigating = client.getQueryState(allPayments)!;
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: navigating.fetchStatus === "fetching",
      error: navigating.error, isInvalidated: navigating.isInvalidated, dataUpdatedAt: navigating.dataUpdatedAt }), false);
    failReads = false;
    await refreshCustomerPaymentQueries(client, "factory-a", "customer-a", ["challan-1", "challan-2"]);
    const fresh = client.getQueryState(key)!;
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: false, error: fresh.error,
      isInvalidated: fresh.isInvalidated, dataUpdatedAt: fresh.dataUpdatedAt }), true);
    const freshAll = client.getQueryState(allPayments)!;
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: freshAll.fetchStatus === "fetching", error: freshAll.error,
      isInvalidated: freshAll.isInvalidated, dataUpdatedAt: freshAll.dataUpdatedAt }), true);
    assert.ok(refreshReads >= 3);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally { unsubscribe(); unsubscribeHistory(); unsubscribeAll(); client.clear(); }
});

test("submitted Challan IDs are refresh targets only, even when receipt allocations are unavailable", async () => {
  const keys: unknown[] = [];
  const client = new QueryClient();
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = async (filters, options) => { keys.push(filters?.queryKey); return invalidate(filters, options); };
  await refreshCustomerPaymentQueries(client,
    "factory-a", "customer-a", ["challan-1", "challan-1", "challan-2"]);
  assert.ok(keys.some((key) => JSON.stringify(key) === JSON.stringify(["office-challan-payment-state", "factory-a", "challan-1"])));
  assert.ok(keys.some((key) => JSON.stringify(key) === JSON.stringify(["office-sales-challan", "factory-a", "challan-2"])));
  assert.equal(keys.length, 11);
});

test("receipt route distinguishes not found from unavailable children and Retry details never writes", async () => {
  const create = prepareSubmission(true);
  tableResponses.set("customer_payment_allocations", { data: null, error: readError });
  const committed = await create();
  assert.equal(committed.detailsStatus, "unavailable");
  tableResponses.set("customer_payments", { data: [{ ...paymentRow, payment_mode: "multiple" }], error: null });
  const read = () => getCustomerPayment("factory-a", paymentRow.id);
  const unavailable = await loadPaymentReceiptDetails(paymentRow.id, read);
  assert.ok(unavailable.status === "details-unavailable");
  assert.equal(unavailable.paymentId, paymentRow.id);
  assert.equal(unavailable.message, ATLAS_UI_STRINGS.payment.detailsUnavailable);
  assert.equal("receipt" in unavailable, false);
  tableResponses.set("customer_payment_allocations", { data: allocationRows, error: null });
  const ready = await loadPaymentReceiptDetails(paymentRow.id, read);
  assert.ok(ready.status === "ready");
  assert.equal(ready.receipt.allocations.length, 2);
  assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  tableResponses.set("customer_payments", { data: [], error: null });
  const missing = await loadPaymentReceiptDetails(paymentRow.id, read);
  assert.equal(missing.status, "not-found");
  assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flushQueries = () => new Promise<void>((resolve) => setImmediate(resolve));

test("post-save freshness rejects pre-save first loads without cancelling an unrelated request", async () => {
  const create = prepareSubmission(true);
  tableResponses.set("customer_payment_methods", { data: null, error: readError });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = [
    ["office-customer-payment-history", "factory-a", "customer-a"],
    ["office-challan-payment-state", "factory-a", "challan-1"],
  ];
  const old = keys.map(() => deferred<string>());
  const replacement = keys.map(() => deferred<string>());
  const starts: boolean[][] = keys.map(() => []);
  let confirmed = false;
  let settled = false;
  let draft = "60000";
  const observers = keys.map((queryKey, index) => new QueryObserver(client, {
    queryKey, queryFn: () => {
      starts[index]!.push(confirmed);
      return starts[index]!.length === 1 ? old[index]!.promise : replacement[index]!.promise;
    },
  }));
  const unsubscribes = observers.map((observer) => observer.subscribe(() => {}));
  const unrelated = deferred<string>();
  const unrelatedKey = ["office-production", "factory-a"];
  let unrelatedStarts = 0;
  const unrelatedObserver = new QueryObserver(client, { queryKey: unrelatedKey,
    queryFn: () => { unrelatedStarts++; return unrelated.promise; } });
  const unsubscribeUnrelated = unrelatedObserver.subscribe(() => {});
  const save = saveCustomerPaymentAndRefresh(submission, create,
    () => { confirmed = true; draft = ""; }, () => {},
    () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", ["challan-1"]))
    .then((outcome) => { settled = true; return outcome; });
  try {
    await flushQueries();
    old.forEach((read) => read.resolve("OLD"));
    await flushQueries();
    assert.equal(confirmed, true);
    assert.equal(draft, "");
    assert.deepEqual(starts, [[false, true], [false, true]], "replacement reads must start after confirmation");
    assert.equal(settled, false, "CURRENT must wait for replacement-read completion");
    for (const key of keys) {
      const state = client.getQueryState(key)!;
      assert.notEqual(state.data, "OLD");
      assert.equal(state.error, null, "cancellation must not become a load failure");
      assert.equal(isCustomerPaymentReadCurrent({ isFetching: state.fetchStatus !== "idle",
        error: state.error, isInvalidated: state.isInvalidated, dataUpdatedAt: state.dataUpdatedAt }), false);
    }
    assert.equal(unrelatedStarts, 1);
    assert.equal(client.getQueryState(unrelatedKey)?.fetchStatus, "fetching");
    replacement.forEach((read) => read.resolve("POST-SAVE"));
    const outcome = await save;
    assert.ok(outcome.status === "saved");
    assert.equal(outcome.refresh, "current");
    assert.equal(outcome.payment.id, paymentRow.id);
    assert.equal(outcome.payment.detailsStatus, "unavailable");
    assert.equal("allocations" in outcome.payment, false);
    assert.equal("methods" in outcome.payment, false);
    for (const key of keys) assert.equal(client.getQueryData(key), "POST-SAVE");
    unrelated.resolve("UNRELATED COMPLETED");
    await flushQueries();
    assert.equal(client.getQueryData(unrelatedKey), "UNRELATED COMPLETED");
    assert.equal(unrelatedStarts, 1);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally {
    old.forEach((read) => read.resolve("OLD"));
    replacement.forEach((read) => read.resolve("POST-SAVE"));
    unrelated.resolve("UNRELATED COMPLETED");
    await save;
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    unsubscribeUnrelated(); client.clear();
  }
});

test("paused post-save reads stay saved/outdated; repeated offline Refresh never writes and online completion restores CURRENT", { timeout: 2000 }, async () => {
  const wasOnline = onlineManager.isOnline();
  const create = prepareSubmission(true);
  tableResponses.set("customer_payment_methods", { data: null, error: readError });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.mount();
  const key = ["office-customer-payment-summary", "factory-a", "customer-a"];
  client.setQueryData(key, "OLD BALANCE");
  const completed = deferred<string>();
  const starts: boolean[] = [];
  let confirmed = false; let draft = "60000"; let savedId = "";
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
    queryFn: () => { starts.push(confirmed); return completed.promise; } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const outcome = await saveCustomerPaymentAndRefresh(submission, create, (payment) => {
      confirmed = true; draft = ""; savedId = payment.id; onlineManager.setOnline(false);
    }, () => {}, () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", []));
    assert.ok(outcome.status === "saved");
    assert.equal(outcome.refresh, "outdated", "paused promises must not classify reads as CURRENT");
    assert.equal(savedId, paymentRow.id);
    assert.equal(draft, "");
    assert.equal(outcome.payment.detailsStatus, "unavailable");
    assert.equal("allocations" in outcome.payment, false);
    assert.equal("methods" in outcome.payment, false);
    // The existing saved banner/Refresh action uses this exact outcome condition.
    assert.notEqual(outcome.refresh, "current");
    const paused = client.getQueryState(key)!;
    assert.equal(paused.fetchStatus, "paused");
    assert.equal(paused.status, "success", "cached success status alone is not post-save freshness");
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: false, error: paused.error,
      isInvalidated: paused.isInvalidated, dataUpdatedAt: paused.dataUpdatedAt }), false);
    assert.deepEqual(starts, []);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(() => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", []),
        { message: ATLAS_UI_STRINGS.payment.balancesOutdated });
    }
    assert.deepEqual(starts, []);
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    onlineManager.setOnline(true);
    let refreshed = false;
    const refresh = refreshCustomerPaymentQueries(client, "factory-a", "customer-a", [])
      .then(() => { refreshed = true; });
    await flushQueries();
    assert.ok(starts.length > 0 && starts.every(Boolean));
    assert.equal(refreshed, false);
    completed.resolve("POST-SAVE BALANCE");
    await refresh;
    const fresh = client.getQueryState(key)!;
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: fresh.fetchStatus !== "idle", error: fresh.error,
      isInvalidated: fresh.isInvalidated, dataUpdatedAt: fresh.dataUpdatedAt }), true);
    assert.equal(fresh.data, "POST-SAVE BALANCE");
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally {
    completed.resolve("POST-SAVE BALANCE");
    unsubscribe(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline);
  }
});

test("a Register read pausing during retry cannot leave the confirmed payment UI blocking indefinitely", { timeout: 2000 }, async () => {
  const wasOnline = onlineManager.isOnline();
  const create = prepareSubmission(true);
  tableResponses.set("customer_payment_methods", { data: null, error: readError });
  const client = new QueryClient();
  client.mount();
  const summaryKey = ["office-customer-payment-summary", "factory-a", "customer-a"];
  const relatedKey = ["office-sales-register", "factory-a", "2026-08-25", "2026-08-26"];
  client.setQueryData(summaryKey, "OLD");
  client.setQueryData(relatedKey, "OLD");
  let relatedStarts = 0; let draft = "60000";
  const summary = new QueryObserver(client, { queryKey: summaryKey, staleTime: Infinity,
    queryFn: async () => "POST-SAVE" });
  const related = new QueryObserver(client, { queryKey: relatedKey, enabled: true, staleTime: Infinity, retry: 1, retryDelay: 0,
    queryFn: async () => {
      if (++relatedStarts === 1) { onlineManager.setOnline(false); throw new Error("Network lost during read"); }
      return "POST-SAVE";
    } });
  const unsubscribeSummary = summary.subscribe(() => {});
  const unsubscribeRelated = related.subscribe(() => {});
  try {
    const outcome = await saveCustomerPaymentAndRefresh(submission, create, () => { draft = ""; }, () => {},
      () => refreshCustomerPaymentQueries(client, "factory-a", "customer-a", []));
    assert.ok(outcome.status === "saved");
    assert.equal(outcome.payment.id, paymentRow.id);
    assert.equal(relatedStarts, 1, "eligible Register replacement read must actually start before pausing");
    assert.equal(outcome.refresh, "outdated");
    assert.equal(draft, "");
    assert.equal(client.getQueryData(summaryKey), "POST-SAVE");
    assert.equal(client.getQueryState(relatedKey)?.fetchStatus, "paused");
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
    onlineManager.setOnline(true);
    await refreshCustomerPaymentQueries(client, "factory-a", "customer-a", []);
    assert.equal(client.getQueryData(relatedKey), "POST-SAVE");
    assert.equal(calls.filter(([method]) => method === "rpc").length, 1);
  } finally {
    unsubscribeSummary(); unsubscribeRelated(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline);
  }
});
