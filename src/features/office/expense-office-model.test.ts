import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ExpensePayment,
  ExpenseRecord,
  ExpenseRecordPaymentState,
} from "../expenses/types.ts";
import {
  applyExpensePaymentStates,
  buildExpensePaymentInput,
  buildExpenseRecordInput,
  buildSupplierInput,
  emptyExpensePaymentForm,
  emptyExpenseRecordForm,
  expenseRecordFormFromSaved,
  fillExpenseOutstandingAllocation,
  filterExpenseRecords,
  getExpensePaymentCandidates,
  getExpensePaymentFormStatus,
  getExpenseRecordEligibility,
  getPaymentsForExpenseRecord,
  resolveExpenseDateRange,
  setExpensePaymentAmount,
  summarizeExpenseRecords,
  toggleExpensePaymentAllocation,
} from "./expense-office-model.ts";

function record(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: "record-1",
    factoryId: "factory-a",
    businessDate: "2026-09-01",
    kind: "purchase",
    supplierId: "supplier-1",
    counterpartyNameSnapshot: "Historical Coal Supplier",
    counterpartyAddressSnapshot: "Old Road",
    counterpartyMobileSnapshot: "9000000000",
    description: "Coal purchase",
    totalAmount: 100_000,
    note: "Invoice 41",
    status: "active",
    isLocked: false,
    totalPaid: 0,
    outstandingAmount: 100_000,
    paymentState: "unpaid",
    voidedAt: null,
    createdAt: "2026-09-01T05:00:00Z",
    updatedAt: "2026-09-01T05:00:00Z",
    ...overrides,
  };
}

const candidates = [
  record(),
  record({
    id: "record-2",
    kind: "expense",
    supplierId: null,
    counterpartyNameSnapshot: "Town Garage",
    description: "Tractor repair",
    totalAmount: 30_000,
    totalPaid: 10_000,
    outstandingAmount: 20_000,
    paymentState: "partially_paid",
    isLocked: true,
  }),
];

test("Purchase and miscellaneous Expense creation use the S7A source input", () => {
  assert.deepEqual(buildExpenseRecordInput("factory-a", {
    ...emptyExpenseRecordForm("2026-09-01", "purchase"),
    supplierId: "supplier-1",
    description: "  Coal   purchase ",
    amount: "100000",
    referenceNote: " Invoice 41 ",
  }), {
    factoryId: "factory-a",
    businessDate: "2026-09-01",
    kind: "purchase",
    supplierId: "supplier-1",
    counterpartyName: null,
    description: "Coal purchase",
    totalAmount: 100_000,
    note: "Invoice 41",
  });
  assert.deepEqual(buildExpenseRecordInput("factory-a", {
    ...emptyExpenseRecordForm("2026-09-01", "expense"),
    counterpartyName: " Town   Garage ",
    description: " Tractor repair ",
    amount: "5000.50",
  })?.supplierId, null);
});

test("quick supplier creation is normalized and supplier selection owns identity", () => {
  assert.deepEqual(buildSupplierInput("factory-a", {
    name: " ABC   Coal ", address: " Mine Road ", mobile: " 9000000000 ",
  }), {
    factoryId: "factory-a",
    name: "ABC Coal",
    address: "Mine Road",
    mobile: "9000000000",
  });
  assert.equal(buildSupplierInput("factory-a", { name: " ", address: "", mobile: "" }), null);
  const form = expenseRecordFormFromSaved(record());
  assert.equal(form.supplierId, "supplier-1");
  assert.equal(form.counterpartyName, "");
});

test("source creation requires a positive two-decimal amount and local business date", () => {
  for (const amount of ["", "0", "-1", "10.001"]) {
    assert.equal(buildExpenseRecordInput("factory-a", {
      ...emptyExpenseRecordForm("2026-09-01"),
      counterpartyName: "Cash vendor",
      description: "Diesel",
      amount,
    }), null);
  }
  assert.equal(buildExpenseRecordInput("factory-a", {
    ...emptyExpenseRecordForm("2026-02-30"),
    counterpartyName: "Cash vendor",
    description: "Diesel",
    amount: "100",
  }), null);
});

test("date presets reuse local Sales boundaries including Yesterday and month rollover", () => {
  assert.deepEqual(resolveExpenseDateRange("today", "2026-09-01"), {
    fromDate: "2026-09-01", toDate: "2026-09-01",
  });
  assert.deepEqual(resolveExpenseDateRange("yesterday", "2026-09-01"), {
    fromDate: "2026-08-31", toDate: "2026-08-31",
  });
  assert.deepEqual(resolveExpenseDateRange("week", "2026-09-03"), {
    fromDate: "2026-08-31", toDate: "2026-09-03",
  });
  assert.deepEqual(resolveExpenseDateRange("month", "2026-09-03"), {
    fromDate: "2026-09-01", toDate: "2026-09-03",
  });
  assert.deepEqual(resolveExpenseDateRange("custom", "2026-09-03", "2026-08-01", "2026-08-31"), {
    fromDate: "2026-08-01", toDate: "2026-08-31",
  });
});

test("register keeps one source row, kind distinction, and historical snapshots", () => {
  const rows = [
    record(),
    record({ id: "record-2", kind: "expense", businessDate: "2026-09-02" }),
  ];
  const filtered = filterExpenseRecords(rows, {
    fromDate: "2026-09-01", toDate: "2026-09-02",
  }, "purchase");
  assert.deepEqual(filtered.map((item) => item.id), ["record-1"]);
  assert.equal(filtered[0]?.counterpartyNameSnapshot, "Historical Coal Supplier");
});

test("range summary uses authoritative Paid and Due and excludes void records", () => {
  const summary = summarizeExpenseRecords([
    record({ totalPaid: 40_000, outstandingAmount: 60_000, paymentState: "partially_paid" }),
    record({ id: "record-2", kind: "expense", totalAmount: 5_000, totalPaid: 5_000, outstandingAmount: 0, paymentState: "paid" }),
    record({ id: "record-3", status: "void", totalAmount: 9_000, outstandingAmount: 0 }),
  ]);
  assert.deepEqual(summary, {
    totalPurchases: 100_000,
    totalExpenses: 5_000,
    totalPaid: 45_000,
    totalOutstanding: 60_000,
  });
});

test("only active unpaid records can edit or void and Delete never exists in the model", () => {
  assert.deepEqual(getExpenseRecordEligibility(record()), {
    canEdit: true, canVoid: true, reason: null,
  });
  assert.deepEqual(getExpenseRecordEligibility(record({ isLocked: true, totalPaid: 1 })), {
    canEdit: false, canVoid: false, reason: "locked",
  });
  assert.deepEqual(getExpenseRecordEligibility(record({ status: "void" })), {
    canEdit: false, canVoid: false, reason: "void",
  });
});

test("payment amount never selects or allocates an Expense/Purchase automatically", () => {
  const changed = setExpensePaymentAmount(emptyExpensePaymentForm("2026-09-01"), "8000");
  assert.deepEqual(changed.allocations, {});
  assert.equal(getExpensePaymentFormStatus(changed, candidates).canSubmit, false);
});

test("explicit single and multi-record allocations must equal the payment", () => {
  let single = {
    ...emptyExpensePaymentForm("2026-09-01"), amount: "40000", paymentMode: "upi",
  };
  single = toggleExpensePaymentAllocation(single, "record-1", true);
  single = { ...single, allocations: { "record-1": "40000" } };
  assert.equal(getExpensePaymentFormStatus(single, candidates).canSubmit, true);

  let multi = {
    ...emptyExpensePaymentForm("2026-09-01"), amount: "60000", paymentMode: "bank_transfer",
  };
  multi = toggleExpensePaymentAllocation(multi, "record-1", true);
  multi = toggleExpensePaymentAllocation(multi, "record-2", true);
  multi = { ...multi, allocations: { "record-1": "40000", "record-2": "20000" } };
  assert.deepEqual(buildExpensePaymentInput("factory-a", multi, candidates)?.allocations, [
    { expenseRecordId: "record-1", amount: 40_000 },
    { expenseRecordId: "record-2", amount: 20_000 },
  ]);
});

test("Pay full due works only after explicit selection", () => {
  const empty = emptyExpensePaymentForm("2026-09-01");
  assert.strictEqual(fillExpenseOutstandingAllocation(empty, candidates[0]!), empty);
  const selected = toggleExpensePaymentAllocation(empty, "record-1", true);
  assert.equal(fillExpenseOutstandingAllocation(selected, candidates[0]!).allocations["record-1"], "100000");
});

test("overpayment, missing mode, invalid equality, and unavailable records cannot submit", () => {
  const noMode = {
    ...emptyExpensePaymentForm("2026-09-01"), amount: "1000", allocations: { "record-1": "1000" },
  };
  assert.equal(getExpensePaymentFormStatus(noMode, candidates).canSubmit, false);
  assert.equal(getExpensePaymentFormStatus({ ...noMode, paymentMode: "cash", allocations: { "record-1": "100001" } }, candidates).canSubmit, false);
  assert.equal(getExpensePaymentFormStatus({ ...noMode, paymentMode: "cash", allocations: { "record-1": "500" } }, candidates).canSubmit, false);
  const unavailable = [
    record({ id: "paid", paymentState: "paid", outstandingAmount: 0 }),
    record({ id: "void", status: "void", outstandingAmount: 0 }),
  ];
  assert.deepEqual(getExpensePaymentCandidates(unavailable), []);
  assert.equal(getExpensePaymentFormStatus({
    ...noMode,
    paymentMode: "cash",
    note: "x".repeat(501),
  }, candidates).canSubmit, false);
});

test("successful payment state refresh touches affected sources only", () => {
  const records = [record(), record({ id: "record-2" })];
  const states: ExpenseRecordPaymentState[] = [{
    expenseRecordId: "record-1",
    status: "active",
    kind: "purchase",
    totalAmount: 100_000,
    totalPaid: 40_000,
    outstandingAmount: 60_000,
    paymentState: "partially_paid",
    isLocked: true,
  }];
  const next = applyExpensePaymentStates(records, states);
  assert.equal(next[0]?.totalPaid, 40_000);
  assert.equal(next[0]?.outstandingAmount, 60_000);
  assert.equal(next[0]?.isLocked, true);
  assert.strictEqual(next[1], records[1]);
});

test("payment history is one immutable event with nested allocations", () => {
  const payment = {
    id: "payment-1",
    allocations: [
      { expenseRecordId: "record-1", allocatedAmount: 40_000 },
      { expenseRecordId: "record-2", allocatedAmount: 20_000 },
    ],
  } as ExpensePayment;
  assert.deepEqual(getPaymentsForExpenseRecord([payment], "record-2"), [payment]);
  assert.equal(getPaymentsForExpenseRecord([payment], "missing").length, 0);
});
