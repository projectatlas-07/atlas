import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ChallanHeader,
  Customer,
  CustomerOutstandingChallan,
  CustomerPayment,
  NewCustomerPaymentMode,
} from "@/features/sales/types";
import {
  applyPaymentLocks,
  buildCustomerPaymentInput,
  clearCustomerPaymentAllocations,
  clearCustomerPaymentMethodAmounts,
  emptyCustomerPaymentForm,
  filterCustomersForPaymentSelection,
  filterCustomerPaymentsForExpandedView,
  getCustomerPaymentFormStatus,
  resolveCustomerDuesDateFilter,
  setCustomerPaymentMethodAmount,
  setPaymentAllocation,
  sortCustomerOutstandingChallans,
  setPaymentAmount,
  toggleCustomerPaymentMode,
  togglePaymentAllocation,
  type CustomerPaymentForm,
} from "./customer-payment-office-model.ts";

const candidates: CustomerOutstandingChallan[] = [{
  challanId: "challan-1",
  challanNumber: "11",
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
  challanNumber: "11",
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

const customers: Customer[] = [{
  id: "customer-a",
  factoryId: "factory-a",
  name: "Maa Kali Traders",
  address: "Old Market Road",
  mobile: "+91 90000 00001",
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z",
}, {
  id: "customer-b",
  factoryId: "factory-a",
  name: "Bengal Builders",
  address: "Station Road",
  mobile: "80000-00002",
  createdAt: "2026-08-02T09:00:00Z",
  updatedAt: "2026-08-02T09:00:00Z",
}];

test("customer payment selection filters the loaded list by name and normalized mobile", () => {
  assert.deepEqual(
    filterCustomersForPaymentSelection(customers, "  kali  ").map((customer) => customer.id),
    ["customer-a"],
  );
  assert.deepEqual(
    filterCustomersForPaymentSelection(customers, "8000000002").map((customer) => customer.id),
    ["customer-b"],
  );
  assert.deepEqual(
    filterCustomersForPaymentSelection(customers, "").map((customer) => customer.id),
    ["customer-a", "customer-b"],
  );
  assert.deepEqual(filterCustomersForPaymentSelection(customers, "missing"), []);
});

const paymentHistoryBase: CustomerPayment = {
  id: "payment-a",
  factoryId: "factory-a",
  customerId: "customer-a",
  customerNameSnapshot: "Historical Customer A",
  customerAddressSnapshot: "Old Market Road",
  customerMobileSnapshot: "9000000001",
  companyNameSnapshot: "Atlas Bricks",
  companyBusinessDescriptionSnapshot: "Brick works",
  companyAddressSnapshot: "Factory Road",
  companyMobileSnapshot: "9000000000",
  paymentDate: "2026-09-10",
  amount: 8_000,
  paymentMode: "cash",
  methods: [{ mode: "cash", splitAmount: null }],
  note: "Final site collection",
  createdAt: "2026-09-10T09:00:00Z",
  allocations: [{
    id: "allocation-a",
    factoryId: "factory-a",
    paymentId: "payment-a",
    challanId: "challan-a",
    challanNumber: "11",
    challanDate: "2026-09-08",
    allocatedAmount: 8_000,
    createdAt: "2026-09-10T09:00:00Z",
  }],
};

test("payment amount never auto-allocates to the oldest Challan", () => {
  const empty = emptyCustomerPaymentForm("2026-08-27");
  const changed = setPaymentAmount(empty, "8000");
  assert.deepEqual(changed.allocations, {});
  assert.equal(getCustomerPaymentFormStatus(changed, candidates).canSubmit, false);
});

test("selecting a Challan fills its current outstanding into payment and allocation", () => {
  const form = togglePaymentAllocation(
    emptyCustomerPaymentForm("2026-08-27"),
    candidates[0]!,
    true,
  );
  assert.equal(form.amount, "8000");
  assert.deepEqual(form.allocations, { "challan-1": "8000" });
});

test("explicit one or multiple Challan allocations must exactly equal payment", () => {
  let form: CustomerPaymentForm = {
    ...togglePaymentAllocation(emptyCustomerPaymentForm("2026-08-27"), candidates[0]!, true),
    paymentModes: ["cash" as const],
  };
  form = togglePaymentAllocation(form, candidates[1]!, true);
  assert.equal(form.amount, "13000");
  form = setPaymentAllocation(form, "challan-2", "2000");
  const status = getCustomerPaymentFormStatus(form, candidates);
  assert.deepEqual(status, {
    paymentAmount: 10_000,
    allocatedAmount: 10_000,
    remainingAmount: 0,
    canSubmit: true,
    error: "",
    methodSplitError: "",
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
      paymentModes: ["upi" as const],
      allocations: { "challan-1": amount },
    };
    assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, true);
  }
});

test("editing the suggested payment amount keeps one selected allocation partial and valid", () => {
  let form: CustomerPaymentForm = {
    ...togglePaymentAllocation(emptyCustomerPaymentForm("2026-08-27"), candidates[0]!, true),
    paymentModes: ["upi" as const],
  };
  form = setPaymentAmount(form, "3000");
  assert.equal(form.amount, "3000");
  assert.deepEqual(form.allocations, { "challan-1": "3000" });
  assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, true);
});

test("changing or clearing the selected Challan refreshes the suggested amount", () => {
  let form = togglePaymentAllocation(
    emptyCustomerPaymentForm("2026-08-27"),
    candidates[0]!,
    true,
  );
  form = togglePaymentAllocation(form, candidates[0]!, false);
  assert.equal(form.amount, "");
  assert.deepEqual(form.allocations, {});

  form = togglePaymentAllocation(form, candidates[1]!, true);
  assert.equal(form.amount, "5000");
  assert.deepEqual(form.allocations, { "challan-2": "5000" });
});

test("first, non-first, and multiple selections remain UUID-safe with duplicate visible numbers", () => {
  const duplicateRows = [
    candidates[0]!,
    candidates[1]!,
    { ...candidates[0]!, challanId: "challan-3", challanNumber: "11", outstandingAmount: 2_000 },
  ];
  let form = emptyCustomerPaymentForm("2026-08-27");

  form = togglePaymentAllocation(form, duplicateRows[0]!, true);
  assert.deepEqual(Object.keys(form.allocations), ["challan-1"]);

  form = togglePaymentAllocation(form, duplicateRows[1]!, true);
  assert.deepEqual(Object.keys(form.allocations), ["challan-1", "challan-2"]);

  form = togglePaymentAllocation(form, duplicateRows[0]!, false);
  assert.deepEqual(Object.keys(form.allocations), ["challan-2"]);

  form = togglePaymentAllocation(form, duplicateRows[2]!, true);
  assert.deepEqual(Object.keys(form.allocations), ["challan-2", "challan-3"]);
});

test("zero, negative, invalid, and over-outstanding allocations cannot submit", () => {
  for (const amount of ["0", "-1", "8000.001", "8000.01"]) {
    const form = {
      ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), amount === "8000.01" ? "8000.01" : "8000"),
      paymentModes: ["cash" as const],
      allocations: { "challan-1": amount },
    };
    assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, false);
  }
  let overpaid: CustomerPaymentForm = {
    ...togglePaymentAllocation(emptyCustomerPaymentForm("2026-08-27"), candidates[0]!, true),
    paymentModes: ["cash" as const],
  };
  overpaid = setPaymentAmount(overpaid, "8000.01");
  assert.equal(getCustomerPaymentFormStatus(overpaid, candidates).canSubmit, false);
  assert.match(getCustomerPaymentFormStatus(overpaid, candidates).error, /exceeds its outstanding amount/);
});

test("customer payments require one or more unique supported payment modes", () => {
  const base = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    allocations: { "challan-1": "3000" },
  };
  assert.equal(getCustomerPaymentFormStatus(base, candidates).canSubmit, false);
  const withOneMode = { ...base, paymentModes: ["bank_transfer" as const] };
  assert.equal(getCustomerPaymentFormStatus(withOneMode, candidates).canSubmit, true);
  assert.deepEqual(
    buildCustomerPaymentInput("factory-a", "customer-a", withOneMode, candidates)?.methods,
    [{ mode: "bank_transfer", splitAmount: null }],
  );

  const withThreeModes = {
    ...base,
    paymentModes: ["cash" as const, "upi" as const, "cheque" as const],
  };
  assert.equal(getCustomerPaymentFormStatus(withThreeModes, candidates).canSubmit, true);
  assert.deepEqual(
    buildCustomerPaymentInput("factory-a", "customer-a", withThreeModes, candidates)?.methods,
    [
      { mode: "cash", splitAmount: null },
      { mode: "upi", splitAmount: null },
      { mode: "cheque", splitAmount: null },
    ],
  );

  assert.equal(getCustomerPaymentFormStatus({
    ...base,
    paymentModes: ["upi" as const, "upi" as const],
  }, candidates).canSubmit, false);
});

test("payment-mode toggles cannot create duplicates and preserve canonical order", () => {
  let form = emptyCustomerPaymentForm("2026-08-27");
  assert.deepEqual(form.paymentModes, []);
  form = toggleCustomerPaymentMode(form, "cheque");
  form = toggleCustomerPaymentMode(form, "upi");
  assert.deepEqual(form.paymentModes, ["upi", "cheque"]);
  form = toggleCustomerPaymentMode(form, "upi");
  assert.deepEqual(form.paymentModes, ["cheque"]);
  form = toggleCustomerPaymentMode(form, "upi");
  assert.deepEqual(form.paymentModes, ["upi", "cheque"]);
});

test("selected payment methods may all remain unsplit", () => {
  const form: CustomerPaymentForm = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    paymentModes: ["upi", "cheque"],
    allocations: { "challan-1": "3000" },
  };

  const status = getCustomerPaymentFormStatus(form, candidates);
  assert.equal(status.methodSplitError, "");
  assert.equal(status.canSubmit, true);
  assert.deepEqual(
    buildCustomerPaymentInput("factory-a", "customer-a", form, candidates)?.methods,
    [
      { mode: "upi", splitAmount: null },
      { mode: "cheque", splitAmount: null },
    ],
  );
});

test("customer payment input preserves the existing optional note", () => {
  const form: CustomerPaymentForm = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    paymentModes: ["upi"],
    note: "Bank reference 42",
    allocations: { "challan-1": "3000" },
  };

  assert.equal(
    buildCustomerPaymentInput("factory-a", "customer-a", form, candidates)?.note,
    "Bank reference 42",
  );
});

test("explicit payment-method amounts must all be positive and equal the payment total", () => {
  const largeCandidate: CustomerOutstandingChallan = {
    ...candidates[0]!,
    challanId: "challan-large",
    outstandingAmount: 100_000,
    saleTotal: 100_000,
    totalPaid: 0,
  };
  const base: CustomerPaymentForm = {
    ...emptyCustomerPaymentForm("2026-08-27"),
    amount: "100000",
    paymentModes: ["upi", "cheque"],
    allocations: { "challan-large": "100000" },
  };
  const exact = setCustomerPaymentMethodAmount(
    setCustomerPaymentMethodAmount(base, "upi", "10000"),
    "cheque",
    "90000",
  );

  assert.equal(getCustomerPaymentFormStatus(exact, [largeCandidate]).canSubmit, true);
  assert.deepEqual(
    buildCustomerPaymentInput("factory-a", "customer-a", exact, [largeCandidate])?.methods,
    [
      { mode: "upi", splitAmount: 10_000 },
      { mode: "cheque", splitAmount: 90_000 },
    ],
  );

  for (const paymentMethodAmounts of [
    { upi: "10000" },
    { upi: "10000", cheque: "89999.99" },
    { upi: "10000", cheque: "90000.01" },
    { upi: "0", cheque: "100000" },
    { upi: "-1", cheque: "100001" },
    { upi: "10000.001", cheque: "89999.999" },
  ] satisfies Array<Partial<Record<NewCustomerPaymentMode, string>>>) {
    const invalid = { ...base, paymentMethodAmounts };
    const status = getCustomerPaymentFormStatus(invalid, [largeCandidate]);
    assert.equal(status.canSubmit, false);
    assert.notEqual(status.methodSplitError, "");
    assert.equal(buildCustomerPaymentInput("factory-a", "customer-a", invalid, [largeCandidate]), null);
  }
});

test("method split state follows mode selection and revalidates when payment total changes", () => {
  let form: CustomerPaymentForm = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    paymentModes: ["upi", "cheque"],
    allocations: { "challan-1": "3000" },
  };
  form = setCustomerPaymentMethodAmount(form, "upi", "1000");
  assert.match(getCustomerPaymentFormStatus(form, candidates).methodSplitError, /every selected method/);
  form = setCustomerPaymentMethodAmount(form, "cheque", "2000");
  assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, true);

  form = setPaymentAmount(form, "2500");
  assert.match(getCustomerPaymentFormStatus(form, candidates).methodSplitError, /must equal/);
  assert.equal(getCustomerPaymentFormStatus(form, candidates).canSubmit, false);

  form = toggleCustomerPaymentMode(form, "cheque");
  assert.deepEqual(form.paymentModes, ["upi"]);
  assert.equal(form.paymentMethodAmounts.cheque, undefined);
  form = toggleCustomerPaymentMode(form, "cheque");
  assert.equal(form.paymentMethodAmounts.cheque, undefined);
});

test("removing the optional split clears amounts without changing selected modes", () => {
  const form: CustomerPaymentForm = {
    ...setPaymentAmount(emptyCustomerPaymentForm("2026-08-27"), "3000"),
    paymentModes: ["upi", "cheque"],
    paymentMethodAmounts: { upi: "1000", cheque: "2000" },
    allocations: { "challan-1": "3000" },
  };

  const cleared = clearCustomerPaymentMethodAmounts(form);
  assert.deepEqual(cleared.paymentModes, ["upi", "cheque"]);
  assert.deepEqual(cleared.paymentMethodAmounts, {});
  assert.equal(getCustomerPaymentFormStatus(cleared, candidates).canSubmit, true);
  assert.deepEqual(
    buildCustomerPaymentInput("factory-a", "customer-a", cleared, candidates)?.methods,
    [
      { mode: "upi", splitAmount: null },
      { mode: "cheque", splitAmount: null },
    ],
  );
});

test("payment locks only the selected ID when visible Challan numbers are duplicates", () => {
  const headers = [
    { id: "challan-1", challanNumber: "11", isLocked: false },
    { id: "challan-2", challanNumber: "11", isLocked: false },
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

test("sorting cannot detach checkbox allocations from Challan IDs", () => {
  const newest = sortCustomerOutstandingChallans(candidates, "newest");
  let form = togglePaymentAllocation(emptyCustomerPaymentForm("2026-09-11"), candidates[0]!, true);
  form = { ...form, allocations: { ...form.allocations, "challan-1": "3000" } };
  const oldest = sortCustomerOutstandingChallans(newest, "oldest");
  form = togglePaymentAllocation(
    form,
    oldest.find((challan) => challan.challanId === "challan-2")!,
    true,
  );
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

test("All Payments search uses immutable customer snapshots, notes, and Challan references", () => {
  const other = {
    ...paymentHistoryBase,
    id: "payment-b",
    customerId: "customer-b",
    customerNameSnapshot: "Customer B",
    note: null,
    allocations: [{
      ...paymentHistoryBase.allocations[0]!,
      id: "allocation-b",
      paymentId: "payment-b",
      challanId: "challan-b",
      challanNumber: "22",
    }],
  };
  const filters = {
    period: "all" as const,
    sort: "newest" as const,
    localToday: "2026-09-10",
    customFrom: "",
    customTo: "",
  };

  for (const searchText of ["historical customer", "site collection", "challan 11"]) {
    assert.deepEqual(
      filterCustomerPaymentsForExpandedView(
        [other, paymentHistoryBase],
        { ...filters, searchText },
      ).payments.map((payment) => payment.id),
      ["payment-a"],
    );
  }
});

test("All Payments keeps authoritative newest-first UUID ordering and supports explicit real sorts", () => {
  const sameDateEarlier = {
    ...paymentHistoryBase,
    id: "payment-b",
    amount: 12_000,
    createdAt: "2026-09-10T08:00:00Z",
  };
  const sameInstantLaterId = {
    ...paymentHistoryBase,
    id: "payment-z",
    amount: 4_000,
  };
  const older = {
    ...paymentHistoryBase,
    id: "payment-old",
    amount: 20_000,
    paymentDate: "2026-09-09",
    createdAt: "2026-09-11T10:00:00Z",
  };
  const payments = [paymentHistoryBase, older, sameDateEarlier, sameInstantLaterId];
  const filters = {
    searchText: "",
    period: "all" as const,
    localToday: "2026-09-10",
    customFrom: "",
    customTo: "",
  };

  assert.deepEqual(
    filterCustomerPaymentsForExpandedView(payments, { ...filters, sort: "newest" })
      .payments.map((payment) => payment.id),
    ["payment-z", "payment-a", "payment-b", "payment-old"],
  );
  assert.deepEqual(
    filterCustomerPaymentsForExpandedView(payments, { ...filters, sort: "oldest" })
      .payments.map((payment) => payment.id),
    ["payment-old", "payment-b", "payment-a", "payment-z"],
  );
  assert.deepEqual(
    filterCustomerPaymentsForExpandedView(payments, { ...filters, sort: "amount-high" })
      .payments.map((payment) => payment.id),
    ["payment-old", "payment-b", "payment-a", "payment-z"],
  );
});

test("All Payments date ranges are inclusive and reject invalid custom ranges", () => {
  const rows = [
    { ...paymentHistoryBase, id: "from", paymentDate: "2026-09-01" },
    { ...paymentHistoryBase, id: "inside", paymentDate: "2026-09-05" },
    { ...paymentHistoryBase, id: "to", paymentDate: "2026-09-10" },
    { ...paymentHistoryBase, id: "outside", paymentDate: "2026-08-31" },
  ];
  const filters = {
    searchText: "",
    period: "custom" as const,
    sort: "newest" as const,
    localToday: "2026-09-10",
  };

  assert.deepEqual(
    filterCustomerPaymentsForExpandedView(rows, {
      ...filters,
      customFrom: "2026-09-01",
      customTo: "2026-09-10",
    }).payments.map((payment) => payment.id),
    ["to", "inside", "from"],
  );
  assert.equal(
    filterCustomerPaymentsForExpandedView(rows, {
      ...filters,
      customFrom: "2026-09-11",
      customTo: "2026-09-10",
    }).error,
    "From date cannot be after To date.",
  );
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

test("filter changes clear the unsaved selection suggestion before sorted checkbox selection", () => {
  const draft = {
    ...emptyCustomerPaymentForm("2026-09-10"),
    amount: "5000",
    paymentModes: ["cash" as const],
    note: "Keep this draft detail",
    allocations: { "challan-1": "3000" },
  };
  const cleared = clearCustomerPaymentAllocations(draft);
  assert.deepEqual(cleared, { ...draft, amount: "", allocations: {} });

  const visible = sortCustomerOutstandingChallans([candidates[1]!], "oldest");
  const filled = togglePaymentAllocation(cleared, visible[0]!, true);
  assert.deepEqual(filled.allocations, { "challan-2": "5000" });
  assert.equal(filled.amount, "5000");
  assert.deepEqual(filled.paymentModes, ["cash"]);
  assert.equal(filled.note, "Keep this draft detail");
});
