import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChallanHeader, CustomerOutstandingChallan, CustomerPayment } from "@/features/sales/types";
import {
  applyPaymentLocks,
  buildCustomerPaymentInput,
  clearCustomerPaymentAllocations,
  emptyCustomerPaymentForm,
  getCustomerPaymentFormStatus,
  resolveCustomerDuesDateFilter,
  sortCustomerOutstandingChallans,
  setPaymentAmount,
  togglePaymentAllocation,
  fillOutstandingAllocation,
} from "./customer-payment-office-model.ts";

const candidates: CustomerOutstandingChallan[] = [{
  challanId: "challan-1",
  challanNumber: "41",
  challanDate: "2026-08-25",
  createdAt: "2026-08-25T10:00:00Z",
  challanStatus: "active",
  saleTotal: 10_000,
  totalPaid: 2_000,
  outstandingAmount: 8_000,
  paymentState: "partially_paid",
  isLocked: true,
  brickLines: [{ itemId: "item-1", particularsSnapshot: "Historical 1st Class", quantity: 1500 }],
}, {
  challanId: "challan-2",
  challanNumber: "42",
  challanDate: "2026-08-26",
  createdAt: "2026-08-26T10:00:00Z",
  challanStatus: "active",
  saleTotal: 5_000,
  totalPaid: 0,
  outstandingAmount: 5_000,
  paymentState: "unpaid",
  isLocked: false,
  brickLines: [{ itemId: "item-2", particularsSnapshot: "Historical 2nd Class", quantity: 2000 }],
}];

test("payment amount never auto-allocates to the oldest Challan", () => {
  const empty = emptyCustomerPaymentForm("2026-08-27");
  const changed = setPaymentAmount(empty, "8000");
  assert.deepEqual(changed.allocations, {});
  assert.equal(getCustomerPaymentFormStatus(changed, candidates).canSubmit, false);
});

test("explicit one or multiple Challan allocations must exactly equal payment", () => {
  let form = { ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "10000"), paymentMode: "cash" };
  form = fillOutstandingAllocation(form, candidates[0]!);
  assert.equal(getCustomerPaymentFormStatus(form, candidates).remainingAmount, 2_000);
  assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, false);

  form = togglePaymentAllocation(form, "challan-2", true);
  form = { ...form, allocations: { ...form.allocations, "challan-2": "2000" } };
  const status = getCustomerPaymentFormStatus(form, candidates);
  assert.deepEqual(status, {
    paymentAmount: 10_000,
    allocatedAmount: 10_000,
    remainingAmount: 0,
    canSubmit: true,
    error: "",
  });
  assert.deepEqual(buildCustomerPaymentInput("factory-a", "customer-a", form, candidates)?.allocations, [
    { challanId: "challan-1", amount: 8_000 },
    { challanId: "challan-2", amount: 2_000 },
  ]);
});

test("one Challan accepts either a partial payment or its full outstanding amount", () => {
  for (const amount of ["3000", "8000"]) {
    const form = {
      ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), amount),
      paymentMode: "upi",
      allocations: { "challan-1": amount },
    };
    assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, true);
  }
});

test("zero, negative, invalid, and over-outstanding allocations cannot submit", () => {
  for (const amount of ["0", "-1", "8000.001", "8000.01"]) {
    const form = {
      ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), amount === "8000.01" ? "8000.01" : "8000"),
      paymentMode: "cash",
      allocations: { "challan-1": amount },
    };
    assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, false);
  }
});

test("new customer payments require a supported persisted payment mode", () => {
  const base = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    allocations: { "challan-1": "3000" },
  };
  assert.equal(getCustomerPaymentFormStatus(base, candidates).canSubmit, false);
  const withMode = { ...base, paymentMode: "bank_transfer" };
  assert.equal(getCustomerPaymentFormStatus(withMode, candidates).canSubmit, true);
  assert.equal(
    buildCustomerPaymentInput("factory-a", "customer-a", withMode, candidates)?.paymentMode,
    "bank_transfer",
  );
});

test("successful payment locks only affected Challans and preserves unrelated object state", () => {
  const headers = [
    { id: "challan-1", isLocked: false },
    { id: "challan-2", isLocked: false },
  ] as ChallanHeader[];
  const payment = {
    allocations: [{ challanId: "challan-1" }],
  } as CustomerPayment;
  const next = applyPaymentLocks(headers, payment);
  assert.equal(next[0]?.isLocked, true);
  assert.strictEqual(next[1], headers[1]);
});

test("Customer Dues sorts chronologically with Newest first as the requested default", () => {
  const dated: CustomerOutstandingChallan[] = [
    {
      ...candidates[0]!,
      challanId: "sep-1",
      challanNumber: "999",
      challanDate: "2026-09-01",
      createdAt: "2026-09-01T09:00:00Z",
    },
    {
      ...candidates[0]!,
      challanId: "sep-10",
      challanNumber: null,
      challanDate: "2026-09-10",
      createdAt: "2026-09-10T09:00:00Z",
    },
    {
      ...candidates[0]!,
      challanId: "sep-5",
      challanNumber: "1",
      challanDate: "2026-09-05",
      createdAt: "2026-09-05T09:00:00Z",
    },
  ];
  assert.deepEqual(
    sortCustomerOutstandingChallans(dated, "newest").map((challan) => challan.challanId),
    ["sep-10", "sep-5", "sep-1"],
  );
  assert.deepEqual(
    sortCustomerOutstandingChallans(dated, "oldest").map((challan) => challan.challanId),
    ["sep-1", "sep-5", "sep-10"],
  );
  assert.deepEqual(
    sortCustomerOutstandingChallans(dated, "newest").map((challan) => challan.challanId),
    ["sep-10", "sep-5", "sep-1"],
  );
});

test("same-date dues use creation time then internal ID, never optional Challan No.", () => {
  const sameDate: CustomerOutstandingChallan[] = [{
    ...candidates[0]!, challanId: "id-a", challanNumber: "999", createdAt: "2026-09-05T09:00:00Z",
  }, {
    ...candidates[0]!, challanId: "id-z", challanNumber: null, createdAt: "2026-09-05T10:00:00Z",
  }, {
    ...candidates[0]!, challanId: "id-b", challanNumber: "1", createdAt: "2026-09-05T09:00:00Z",
  }].map((challan) => ({ ...challan, challanDate: "2026-09-05" }));

  assert.deepEqual(
    sortCustomerOutstandingChallans(sameDate, "newest").map((challan) => challan.challanId),
    ["id-z", "id-b", "id-a"],
  );
  assert.deepEqual(
    sortCustomerOutstandingChallans(sameDate, "oldest").map((challan) => challan.challanId),
    ["id-a", "id-b", "id-z"],
  );
});

test("sorting cannot detach allocations or Use outstanding from Challan IDs", () => {
  const newest = sortCustomerOutstandingChallans(candidates, "newest");
  let form = togglePaymentAllocation(emptyCustomerPaymentForm("2026-09-11"), "challan-1", true);
  form = { ...form, allocations: { ...form.allocations, "challan-1": "3000" } };
  const oldest = sortCustomerOutstandingChallans(newest, "oldest");
  form = fillOutstandingAllocation(form, oldest.find((challan) => challan.challanId === "challan-2")!);
  assert.deepEqual(form.allocations, { "challan-1": "3000", "challan-2": "5000" });
});

test("Customer Dues All, Today, and Yesterday use local date-only boundaries", () => {
  assert.deepEqual(resolveCustomerDuesDateFilter("all", "2026-09-10"), {
    range: null,
    error: "",
  });
  assert.deepEqual(resolveCustomerDuesDateFilter("today", "2026-09-10"), {
    range: { fromDate: "2026-09-10", toDate: "2026-09-10" },
    error: "",
  });
  assert.deepEqual(resolveCustomerDuesDateFilter("yesterday", "2026-09-01"), {
    range: { fromDate: "2026-08-31", toDate: "2026-08-31" },
    error: "",
  });
});

test("Customer Dues This Week spans Monday through Sunday", () => {
  assert.deepEqual(resolveCustomerDuesDateFilter("week", "2026-09-10"), {
    range: { fromDate: "2026-09-07", toDate: "2026-09-13" },
    error: "",
  });
  assert.deepEqual(resolveCustomerDuesDateFilter("week", "2026-09-13"), {
    range: { fromDate: "2026-09-07", toDate: "2026-09-13" },
    error: "",
  });
});

test("Customer Dues This Month spans the full calendar month", () => {
  assert.deepEqual(resolveCustomerDuesDateFilter("month", "2026-09-10"), {
    range: { fromDate: "2026-09-01", toDate: "2026-09-30" },
    error: "",
  });
  assert.deepEqual(resolveCustomerDuesDateFilter("month", "2028-02-15"), {
    range: { fromDate: "2028-02-01", toDate: "2028-02-29" },
    error: "",
  });
});

test("Customer Dues Custom is inclusive and rejects incomplete, invalid, or reversed ranges", () => {
  assert.deepEqual(
    resolveCustomerDuesDateFilter("custom", "2026-09-10", "2026-09-01", "2026-09-10"),
    { range: { fromDate: "2026-09-01", toDate: "2026-09-10" }, error: "" },
  );
  assert.equal(resolveCustomerDuesDateFilter("custom", "2026-09-10", "", "2026-09-10").range, null);
  assert.equal(resolveCustomerDuesDateFilter("custom", "2026-09-10", "2026-02-30", "2026-03-01").range, null);
  assert.deepEqual(
    resolveCustomerDuesDateFilter("custom", "2026-09-10", "2026-09-11", "2026-09-10"),
    { range: null, error: "From date cannot be after To date." },
  );
});

test("Newest and Oldest sorting stay chronological inside an inclusive filtered result", () => {
  const range = resolveCustomerDuesDateFilter(
    "custom",
    "2026-09-10",
    "2026-09-05",
    "2026-09-10",
  ).range!;
  const dated = [
    { ...candidates[0]!, challanId: "sep-1", challanDate: "2026-09-01" },
    { ...candidates[0]!, challanId: "sep-5", challanDate: "2026-09-05" },
    { ...candidates[0]!, challanId: "sep-10", challanDate: "2026-09-10" },
  ];
  const filtered = dated.filter((challan) => (
    challan.challanDate >= range.fromDate && challan.challanDate <= range.toDate
  ));
  assert.deepEqual(
    sortCustomerOutstandingChallans(filtered, "newest").map((challan) => challan.challanId),
    ["sep-10", "sep-5"],
  );
  assert.deepEqual(
    sortCustomerOutstandingChallans(filtered, "oldest").map((challan) => challan.challanId),
    ["sep-5", "sep-10"],
  );
});

test("filter changes clear only unsaved allocations before filtered sorting and Use outstanding", () => {
  const draft = {
    ...emptyCustomerPaymentForm("2026-09-10"),
    amount: "5000",
    paymentMode: "cash",
    note: "Keep this draft detail",
    allocations: { "challan-1": "3000" },
  };
  const cleared = clearCustomerPaymentAllocations(draft);
  assert.deepEqual(cleared, { ...draft, allocations: {} });

  const visible = sortCustomerOutstandingChallans([candidates[1]!], "oldest");
  const filled = fillOutstandingAllocation(cleared, visible[0]!);
  assert.deepEqual(filled.allocations, { "challan-2": "5000" });
  assert.equal(filled.amount, "5000");
  assert.equal(filled.paymentMode, "cash");
  assert.equal(filled.note, "Keep this draft detail");
});
