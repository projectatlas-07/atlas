import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { summarizeSalesRegister } from "../sales-register-model.ts";
import { refreshCustomerPaymentQueries, isCustomerPaymentReadCurrent } from "../../office/customer-payment-office-model.ts";

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
let heldPaymentRead: Promise<Response> | null = null;

function applyRequestedOrdering(rows: unknown[]): unknown[] {
  const orderCalls = calls.filter(([method]) => method === "order") as Array<[
    "order",
    string,
    { ascending: boolean },
  ]>;
  return [...rows].sort((leftValue, rightValue) => {
    const left = leftValue as Record<string, unknown>;
    const right = rightValue as Record<string, unknown>;
    for (const [, column, options] of orderCalls) {
      const comparison = String(left[column]).localeCompare(String(right[column]));
      if (comparison !== 0) return options.ascending ? comparison : -comparison;
    }
    return 0;
  });
}

function queryBuilder() {
  // Model the service's actual inclusive date predicates, not prefiltered fixtures.
  let fromDate: string | null = null;
  let toDate: string | null = null;
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
      if (column === "challan_date") fromDate = value;
      return builder;
    },
    lte(column: string, value: string) {
      calls.push(["lte", column, value]);
      if (column === "challan_date") toDate = value;
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
      const orderedResponse = response.data === null
        ? response
        : { ...response, data: applyRequestedOrdering(response.data.filter((value) => {
          const date = String((value as Record<string, unknown>).challan_date);
          return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
        })) };
      return Promise.resolve(orderedResponse).then(onFulfilled, onRejected);
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
    if (functionName === "get_challan_payment_state" && heldPaymentRead) return heldPaymentRead;
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
  heldPaymentRead = null;
}

function registerRow(
  id: string,
  challanDate: string,
  createdAt: string,
  total: string,
  status: "active" | "void",
  noteOnly = false,
): Record<string, unknown> {
  return {
    id,
    challan_number: "11",
    challan_date: challanDate,
    created_at: createdAt,
    customer_name_snapshot: id,
    challan_total: total,
    vehicle_number: null,
    status,
    challan_items: noteOnly ? [] : [{
      brick_particulars_snapshot: "Class One",
      quantity: "1",
      line_amount: total,
      line_position: 1,
    }],
    challan_flexible_lines: noteOnly ? [{
      line_type: "NOTE",
      line_category: "NON_FINANCIAL",
      amount: "0",
    }] : [],
  };
}

test("Sales Register orders by business date, then newest creation, then stable internal ID", async () => {
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
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
  assert.equal(
    calls.some(([method, column]) => method === "order" && column === "challan_number"),
    false,
  );
});

test("Register awaits fresh lifetime payment reads inside its own query, ignoring separate cached payment state and payment date", async () => {
  reset();
  response.data = [registerRow("challan-a", "2026-08-26", "2026-08-26T12:00:00Z", "3500", "active")];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const paymentKey = ["office-challan-payment-state", "factory-a", "challan-a"];
  client.setQueryData(paymentKey, { totalPaid: 0, outstandingAmount: 3500 });
  let release!: (value: Response) => void;
  heldPaymentRead = new Promise((resolve) => { release = resolve; });
  const range = { fromDate: "2026-08-26", toDate: "2026-08-26" };
  const registerKey = ["office-sales-register", "factory-a", range.fromDate, range.toDate];
  let completed = false;
  const read = client.fetchQuery({ queryKey: registerKey, queryFn: () => listSalesRegister("factory-a", range) })
    .then((entries) => { completed = true; return entries; });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(completed, false); assert.equal(client.getQueryData(registerKey), undefined);
    assert.deepEqual(calls.filter(([method]) => method === "rpc"), [["rpc", "get_challan_payment_state", {
      p_factory_id: "factory-a", p_challan_id: "challan-a",
    }]]);
    // A receipt dated D2 (September 2) contributes lifetime allocations to a D1 (August 26) row.
    // The read RPC accepts no payment-date filter; Register inclusion is Challan-date-only.
    release({ data: [{ challan_id: "challan-a", challan_status: "active", sale_total: "3500",
      total_paid: "1250.75", outstanding_amount: "2249.25", payment_state: "partially_paid" }], error: null });
    const entries = await read;
    assert.equal(entries[0].paidAmount, 1250.75); assert.equal(entries[0].outstandingAmount, 2249.25);
    assert.equal(entries[0].paymentState, "partially_paid");
    assert.deepEqual(calls.filter(([method]) => method === "gte" || method === "lte"), [
      ["gte", "challan_date", "2026-08-26"], ["lte", "challan_date", "2026-08-26"],
    ]);
    assert.deepEqual(client.getQueryData(paymentKey), { totalPaid: 0, outstandingAmount: 3500 });
  } finally { release({ data: [], error: null }); await read; client.clear(); }
});

test("C10 out-of-range allocation refreshes observed Register without including that Challan in its totals", async () => {
  reset();
  response.data = [
    registerRow("inside-period", "2026-07-20", "2026-07-20T12:00:00Z", "500", "active"),
    registerRow("allocated-outside-period", "2026-08-26", "2026-08-26T12:00:00Z", "3500", "active"),
  ];
  rpcResponses.set("get_challan_payment_state", { data: [{ challan_id: "inside-period", challan_status: "active",
    sale_total: "500", total_paid: "0", outstanding_amount: "500", payment_state: "unpaid" }], error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const range = { fromDate: "2026-07-01", toDate: "2026-07-31" };
  const key = ["office-sales-register", "factory-a", range.fromDate, range.toDate];
  client.setQueryData(key, []);
  const inactiveRange = { fromDate: "2026-08-01", toDate: "2026-08-31" };
  const inactiveKey = ["office-sales-register", "factory-a", inactiveRange.fromDate, inactiveRange.toDate];
  client.setQueryData(inactiveKey, []);
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
    queryFn: () => listSalesRegister("factory-a", range) });
  const stop = observer.subscribe(() => {});
  try {
    // A confirmed September payment allocates to the August Challan. Range eligibility
    // is deliberately independent of payment date and allocation membership.
    await refreshCustomerPaymentQueries(client, "factory-a", "customer-a", ["allocated-outside-period"]);
    const result = observer.getCurrentResult();
    assert.equal(isCustomerPaymentReadCurrent({ isFetching: result.isFetching, error: result.error,
      dataUpdatedAt: result.dataUpdatedAt, isInvalidated: client.getQueryState(key)?.isInvalidated }), true);
    assert.deepEqual(result.data?.map((entry) => entry.challanId), ["inside-period"]);
    assert.equal(summarizeSalesRegister(result.data!).totalRevenue, 500);
    assert.equal(result.data?.[0].paidAmount, 0); assert.equal(result.data?.[0].outstandingAmount, 500);
    assert.equal(client.getQueryState(inactiveKey)?.isInvalidated, true);
    assert.deepEqual(calls.filter(([method]) => method === "gte" || method === "lte"), [
      ["gte", "challan_date", range.fromDate], ["lte", "challan_date", range.toDate],
    ]);
    assert.deepEqual(calls.filter(([method]) => method === "rpc"), [["rpc", "get_challan_payment_state", {
      p_factory_id: "factory-a", p_challan_id: "inside-period",
    }]]);
    assert.deepEqual(calls.filter(([method]) => method === "eq"), [["eq", "factory_id", "factory-a"]]);
  } finally { stop(); client.clear(); }
});

test("same-date duplicate and note-only Challans remain newest-created-first on repeated reads", async () => {
  reset();
  response.data = [
    registerRow("older-30000", "2026-09-14", "2026-09-14T09:00:00Z", "30000", "active"),
    registerRow("note-only", "2026-09-14", "2026-09-14T10:00:00Z", "0", "active", true),
    registerRow("middle-24000", "2026-09-14", "2026-09-14T11:00:00Z", "24000", "void"),
    registerRow("newest-50000", "2026-09-14", "2026-09-14T12:00:00Z", "50000", "active"),
    registerRow("newer-business-date", "2026-09-15", "2026-09-13T08:00:00Z", "1000", "active"),
    registerRow("back-entered-old-date", "2026-09-10", "2026-09-16T08:00:00Z", "2000", "active"),
  ];
  rpcResponses.set("get_challan_payment_state", {
    data: [{
      challan_id: "payment-target",
      challan_status: "active",
      sale_total: "0",
      total_paid: "0",
      outstanding_amount: "0",
      payment_state: "unpaid",
    }],
    error: null,
  });

  const range = { fromDate: "2026-09-10", toDate: "2026-09-15" };
  const firstRead = await listSalesRegister("factory-a", range);
  const secondRead = await listSalesRegister("factory-a", range);
  const expectedIds = [
    "newer-business-date",
    "newest-50000",
    "middle-24000",
    "note-only",
    "older-30000",
    "back-entered-old-date",
  ];

  assert.deepEqual(firstRead.map((entry) => entry.challanId), expectedIds);
  assert.deepEqual(secondRead.map((entry) => entry.challanId), expectedIds);
  assert.equal(firstRead.every((entry) => entry.challanNumber === "11"), true);
  assert.equal(firstRead.find((entry) => entry.challanId === "note-only")?.items.length, 0);
  assert.equal(firstRead.find((entry) => entry.challanId === "middle-24000")?.status, "void");
  assert.deepEqual(summarizeSalesRegister(firstRead), {
    brickRevenue: 83000,
    otherRevenue: 0,
    totalRevenue: 83000,
    activeChallans: 5,
    totalBrickQuantity: 4,
    voidChallans: 1,
  });
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
    challanNumber: "42",
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

test("Sales Register keeps an exact Amount-driven ₹80,000 row", async () => {
  reset();
  response.data = [{
    id: "challan-exact",
    challan_number: "44",
    challan_date: "2026-09-10",
    customer_name_snapshot: "Exact Customer",
    challan_total: "80000.00",
    vehicle_number: null,
    status: "active",
    challan_items: [{
      brick_particulars_snapshot: "Class One",
      quantity: "12347",
      line_amount: "80000.00",
      line_position: 1,
    }],
    challan_flexible_lines: [],
  }];
  rpcResponses.set("get_challan_payment_state", {
    data: [{
      challan_id: "challan-exact",
      challan_status: "active",
      sale_total: "80000.00",
      total_paid: "0",
      outstanding_amount: "80000.00",
      payment_state: "unpaid",
    }],
    error: null,
  });

  const [entry] = await listSalesRegister("factory-a", {
    fromDate: "2026-09-10",
    toDate: "2026-09-10",
  });
  assert.deepEqual({
    brickRevenue: entry?.brickRevenue,
    totalRevenue: entry?.totalRevenue,
    outstandingAmount: entry?.outstandingAmount,
  }, {
    brickRevenue: 80000,
    totalRevenue: 80000,
    outstandingAmount: 80000,
  });
});

test("void rows keep their revenue split but do not request payment state", async () => {
  reset();
  response.data = [{
    id: "challan-void",
    challan_number: "43",
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
    challan_number: "99",
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
      && /Challan 99/.test(error.message),
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
