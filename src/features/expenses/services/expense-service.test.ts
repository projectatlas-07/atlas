import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type ErrorRow = { message: string; code: string; details: string | null; hint: string | null };
type Response = { data: Row | Row[] | null; error: ErrorRow | null };
type Call = [string, string, unknown];

const calls: Call[] = [];
const rpcResponses = new Map<string, Response>();
const tableResponses = new Map<string, Response[]>();

function queryBuilder(table: string) {
  const response = tableResponses.get(table)?.shift() ?? { data: [], error: null };
  const query = {
    select(columns: string) { calls.push(["select", table, columns]); return query; },
    eq(column: string, value: unknown) { calls.push(["eq", column, value]); return query; },
    in(column: string, value: unknown) { calls.push(["in", column, value]); return query; },
    order(column: string, options: unknown) { calls.push(["order", column, options]); return query; },
    then(resolve: (value: Response) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  return query;
}

const fakeSupabase = {
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponses.get(functionName) ?? { data: null, error: null });
  },
  from(table: string) {
    calls.push(["from", table, null]);
    return queryBuilder(table);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  ExpenseServiceError,
  createExpensePayment,
  createExpenseRecord,
  createSupplier,
  getExpenseRecordPaymentState,
  getSupplierExpenseSummary,
  listExpensePayments,
  listExpenseRecords,
  listSuppliers,
  updateExpenseRecord,
  updateSupplier,
  voidExpenseRecord,
} = await import("./expense-service.ts");

const supplierRow = {
  id: "supplier-a", factory_id: "factory-a", name: "ABC Coal",
  address: "Coal Market", mobile: "9111111111",
  created_at: "2026-08-28T09:00:00Z", updated_at: "2026-08-28T09:00:00Z",
};
const baseRecordRow = {
  id: "record-a", factory_id: "factory-a", business_date: "2026-08-28",
  kind: "purchase", supplier_id: "supplier-a", counterparty_name_snapshot: "ABC Coal",
  counterparty_address_snapshot: "Coal Market", counterparty_mobile_snapshot: "9111111111",
  description: "Coal", total_amount: "100000", note: "Invoice ABC-1", status: "active",
  is_locked: false, voided_at: null, voided_by: null,
  created_at: "2026-08-28T10:00:00Z", updated_at: "2026-08-28T10:00:00Z",
  created_by: "user-a",
};
const listedRecordRow = {
  expense_record_id: "record-a", factory_id: "factory-a", business_date: "2026-08-28",
  kind: "purchase", supplier_id: "supplier-a", counterparty_name_snapshot: "ABC Coal",
  counterparty_address_snapshot: "Coal Market", counterparty_mobile_snapshot: "9111111111",
  description: "Coal", total_amount: "100000", note: "Invoice ABC-1", status: "active",
  is_locked: true, total_paid: "40000", outstanding_amount: "60000",
  payment_state: "partially_paid", voided_at: null,
  created_at: "2026-08-28T10:00:00Z", updated_at: "2026-08-28T10:00:00Z",
};
const paymentRow = {
  id: "payment-a", factory_id: "factory-a", payment_date: "2026-08-28",
  amount: "40000", payment_mode: "upi", note: "Partial payment",
  created_at: "2026-08-28T11:00:00Z", created_by: "user-a",
};
const allocationRow = {
  id: "allocation-a", factory_id: "factory-a", payment_id: "payment-a",
  expense_record_id: "record-a", allocated_amount: "40000",
  created_at: "2026-08-28T11:00:00Z",
};
const referenceRow = {
  id: "record-a", kind: "purchase", counterparty_name_snapshot: "ABC Coal",
  description: "Coal",
};

function reset(): void {
  calls.length = 0;
  rpcResponses.clear();
  tableResponses.clear();
}

test("supplier master loads and writes only through factory-scoped controlled RPCs", async () => {
  reset();
  tableResponses.set("suppliers", [{ data: [supplierRow], error: null }]);
  assert.equal((await listSuppliers("factory-a"))[0]?.name, "ABC Coal");

  reset();
  rpcResponses.set("create_supplier", { data: supplierRow, error: null });
  await createSupplier({
    factoryId: "factory-a", name: "  ABC   Coal ", address: " Coal   Market ", mobile: " 9111111111 ",
  });
  assert.deepEqual(calls[0], ["rpc", "create_supplier", {
    p_factory_id: "factory-a", p_name: "ABC Coal", p_address: "Coal Market", p_mobile: "9111111111",
  }]);

  reset();
  rpcResponses.set("update_supplier", { data: { ...supplierRow, name: "ABC Coal New" }, error: null });
  assert.equal((await updateSupplier({
    factoryId: "factory-a", supplierId: "supplier-a", name: "ABC Coal New",
  })).name, "ABC Coal New");
  assert.equal(calls[0]?.[1], "update_supplier");
});

test("purchase creation keeps cost separate from payment and uses snapshot inputs", async () => {
  reset();
  rpcResponses.set("create_expense_record", { data: baseRecordRow, error: null });
  const record = await createExpenseRecord({
    factoryId: "factory-a", businessDate: "2026-08-28", kind: "purchase",
    supplierId: "supplier-a", description: "  Coal ", totalAmount: 100_000,
    note: " Invoice   ABC-1 ",
  });
  assert.equal(record.totalPaid, 0);
  assert.equal(record.outstandingAmount, 100_000);
  assert.equal(record.paymentState, "unpaid");
  assert.deepEqual(calls[0], ["rpc", "create_expense_record", {
    p_factory_id: "factory-a", p_business_date: "2026-08-28", p_kind: "purchase",
    p_supplier_id: "supplier-a", p_counterparty_name: null, p_description: "Coal",
    p_total_amount: 100_000, p_note: "Invoice ABC-1",
  }]);
});

test("unpaid source update and void stay on controlled lifecycle RPCs", async () => {
  reset();
  rpcResponses.set("update_expense_record", {
    data: { ...baseRecordRow, description: "Coal corrected" }, error: null,
  });
  assert.equal((await updateExpenseRecord({
    factoryId: "factory-a", expenseRecordId: "record-a", businessDate: "2026-08-28",
    kind: "purchase", supplierId: "supplier-a", description: "Coal corrected", totalAmount: 100_000,
  })).description, "Coal corrected");
  assert.equal(calls[0]?.[1], "update_expense_record");

  reset();
  rpcResponses.set("void_expense_record", {
    data: { ...baseRecordRow, status: "void", voided_at: "2026-08-28T12:00:00Z" }, error: null,
  });
  const voided = await voidExpenseRecord("factory-a", "record-a");
  assert.equal(voided.status, "void");
  assert.equal(voided.outstandingAmount, 0);
  assert.equal(calls[0]?.[1], "void_expense_record");
});

test("outgoing payment persists explicit allocations and maps immutable history", async () => {
  reset();
  rpcResponses.set("create_expense_payment", { data: paymentRow, error: null });
  tableResponses.set("expense_payment_allocations", [{ data: [allocationRow], error: null }]);
  tableResponses.set("expense_records", [{ data: [referenceRow], error: null }]);
  const payment = await createExpensePayment({
    factoryId: "factory-a", paymentDate: "2026-08-28", amount: 40_000,
    paymentMode: "upi", note: "Partial payment",
    allocations: [{ expenseRecordId: "record-a", amount: 40_000 }],
  });
  assert.equal(payment.allocations.length, 1);
  assert.equal(payment.allocations[0]?.description, "Coal");
  assert.deepEqual(calls[0], ["rpc", "create_expense_payment", {
    p_factory_id: "factory-a", p_payment_date: "2026-08-28", p_amount: 40_000,
    p_payment_mode: "upi", p_note: "Partial payment",
    p_allocations: [{ expense_record_id: "record-a", amount: 40_000 }],
  }]);
});

test("a committed payment is not reported as failed when its follow-up history read fails", async () => {
  reset();
  rpcResponses.set("create_expense_payment", { data: paymentRow, error: null });
  tableResponses.set("expense_payment_allocations", [{
    data: null,
    error: { message: "Temporary read failure", code: "PGRST000", details: null, hint: null },
  }]);
  const payment = await createExpensePayment({
    factoryId: "factory-a", paymentDate: "2026-08-28", amount: 40_000,
    paymentMode: "upi", note: "Partial payment",
    allocations: [{ expenseRecordId: "record-a", amount: 40_000 }],
  });
  assert.equal(payment.id, "payment-a");
  assert.deepEqual(payment.allocations, []);
});

test("allocation equality, duplicate targets, bad modes, and invalid amounts stop locally", async () => {
  const valid = {
    factoryId: "factory-a", paymentDate: "2026-08-28", amount: 8_000,
    paymentMode: "cash" as const, note: null,
  };
  for (const allocations of [
    [],
    [{ expenseRecordId: "record-a", amount: 7_999 }],
    [{ expenseRecordId: "record-a", amount: 4_000 }, { expenseRecordId: "record-a", amount: 4_000 }],
  ]) {
    reset();
    await assert.rejects(() => createExpensePayment({ ...valid, allocations }));
    assert.equal(calls.length, 0);
  }
  reset();
  await assert.rejects(() => createExpensePayment({
    ...valid, paymentMode: "card" as "cash",
    allocations: [{ expenseRecordId: "record-a", amount: 8_000 }],
  }), /supported payment mode/);
  await assert.rejects(() => createExpenseRecord({
    factoryId: "factory-a", businessDate: "2026-02-30", kind: "expense",
    counterpartyName: "Garage", description: "Repair", totalAmount: 0,
  }));
  assert.equal(calls.length, 0);
});

test("derived record and supplier reads preserve authoritative totals", async () => {
  reset();
  rpcResponses.set("list_expense_records", { data: [listedRecordRow], error: null });
  const record = (await listExpenseRecords("factory-a", "supplier-a"))[0]!;
  assert.deepEqual({ paid: record.totalPaid, due: record.outstandingAmount, state: record.paymentState }, {
    paid: 40_000, due: 60_000, state: "partially_paid",
  });

  reset();
  rpcResponses.set("get_expense_record_payment_state", {
    data: [{
      expense_record_id: "record-a", status: "active", kind: "purchase",
      total_amount: "100000", total_paid: "40000", outstanding_amount: "60000",
      payment_state: "partially_paid", is_locked: true,
    }], error: null,
  });
  assert.equal((await getExpenseRecordPaymentState("factory-a", "record-a")).isLocked, true);

  reset();
  rpcResponses.set("get_supplier_expense_summary", {
    data: [{
      supplier_id: "supplier-a", active_record_count: 1, total_cost: "100000",
      total_paid: "40000", total_outstanding: "60000",
    }], error: null,
  });
  assert.equal((await getSupplierExpenseSummary("factory-a", "supplier-a")).totalOutstanding, 60_000);
});

test("payment history is one header with nested allocation references", async () => {
  reset();
  tableResponses.set("expense_payments", [{ data: [paymentRow], error: null }]);
  tableResponses.set("expense_payment_allocations", [{ data: [allocationRow], error: null }]);
  tableResponses.set("expense_records", [{ data: [referenceRow], error: null }]);
  const payments = await listExpensePayments("factory-a");
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.amount, 40_000);
  assert.equal(payments[0]?.allocations.length, 1);
});

test("database lifecycle and factory errors remain typed", async () => {
  reset();
  rpcResponses.set("void_expense_record", {
    data: null,
    error: { message: "Locked", code: "P4104", details: null, hint: null },
  });
  await assert.rejects(
    () => voidExpenseRecord("factory-a", "record-a"),
    (error: unknown) => error instanceof ExpenseServiceError
      && error.code === "P4104" && /financially locked/.test(error.message),
  );
});
