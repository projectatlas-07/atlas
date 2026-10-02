import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCoalPaymentInput,
  buildCoalSelectivePaymentInput,
  buildCreateCoalPurchaseInput,
  canChangeCoalPurchase,
  emptyCoalPaymentForm,
  emptyCoalSelectivePaymentForm,
  emptyCoalPurchaseForm,
  filterCoalPayments,
  filterCoalPurchases,
  getCoalFinalTotal,
  getCoalPaymentAllocationReconciliation,
  getCoalSelectivePaymentStatus,
  getDerivedCoalMeasurementField,
  getEligibleCoalSettlementPurchases,
  summarizeCoalPurchases,
  setCoalSettlementAllocation,
  setCoalSettlementPaymentAmount,
  toggleCoalSettlementPurchase,
  updateCoalMeasurement,
} from "./coal-purchase-model.ts";
import type { CoalPayment, CoalPurchase } from "./types.ts";

function baseForm() {
  return {
    ...emptyCoalPurchaseForm("2026-09-14"),
    sellerId: "seller-a",
    coalNameReferenceId: "coal-a",
    sourceReferenceId: "source-a",
    vehicleNumber: "wb 58 a 1234",
  };
}

function purchase(overrides: Partial<CoalPurchase> = {}): CoalPurchase {
  return {
    id: "purchase-a",
    factoryId: "factory-a",
    purchaseDate: "2026-09-14",
    sellerId: "seller-a",
    sellerNameSnapshot: "Seller A",
    sellerAddressSnapshot: null,
    sellerMobileSnapshot: null,
    coalNameReferenceId: "coal-a",
    coalNameSnapshot: "Steam Coal",
    sourceReferenceId: "source-a",
    sourceLocationSnapshot: "Raniganj",
    coalChallanNumber: null,
    vehicleNumberSnapshot: "WB 58 A 1234",
    quantity: 10,
    rate: 3000,
    coalAmount: 30000,
    separateFreightAmount: 0,
    finalTotal: 30000,
    status: "active",
    isLocked: false,
    totalPaid: 0,
    outstandingAmount: 30000,
    paymentState: "unpaid",
    voidedAt: null,
    createdAt: "2026-09-14T10:00:00Z",
    updatedAt: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

function payment(overrides: Partial<CoalPayment> = {}): CoalPayment {
  return {
    id: "payment-a",
    factoryId: "factory-a",
    sellerId: "seller-a",
    sellerNameSnapshot: "Seller A",
    allocationCount: 2,
    allocations: [],
    paymentDate: "2026-09-18",
    amount: 25000,
    paymentMode: "bank_transfer",
    note: null,
    createdAt: "2026-09-18T10:00:00Z",
    ...overrides,
  };
}

test("quantity plus rate derives amount with money rounding", () => {
  let form = updateCoalMeasurement(baseForm(), "quantity", "12.345678");
  form = updateCoalMeasurement(form, "rate", "6479.306714");
  assert.equal(form.coalAmount, "79991.43");
  assert.equal(getDerivedCoalMeasurementField(form), "coalAmount");
});

test("quantity plus amount derives rate without floating-point drift", () => {
  let form = updateCoalMeasurement(baseForm(), "quantity", "12.347");
  form = updateCoalMeasurement(form, "coalAmount", "80000");
  assert.equal(form.rate, "6479.306714");
  assert.equal(getDerivedCoalMeasurementField(form), "rate");
});

test("rate plus amount derives quantity and editing the derived field changes authority", () => {
  let form = updateCoalMeasurement(baseForm(), "rate", "8000");
  form = updateCoalMeasurement(form, "coalAmount", "30000");
  assert.equal(form.quantity, "3.75");
  form = updateCoalMeasurement(form, "quantity", "4");
  assert.equal(form.rate, "7500");
  assert.equal(getDerivedCoalMeasurementField(form), "rate");
});

test("zero, negative, excess precision, and division-by-zero inputs fail closed", () => {
  for (const [firstField, firstValue, secondField, secondValue] of [
    ["quantity", "0", "coalAmount", "100"],
    ["quantity", "-1", "rate", "100"],
    ["rate", "0", "coalAmount", "100"],
    ["quantity", "1.0000001", "rate", "100"],
    ["quantity", "1", "coalAmount", "100.001"],
  ] as const) {
    let form = updateCoalMeasurement(baseForm(), firstField, firstValue);
    form = updateCoalMeasurement(form, secondField, secondValue);
    assert.equal(buildCreateCoalPurchaseInput("factory-a", form), null);
  }
});

test("freight defaults away and adds only when explicitly enabled", () => {
  let form = updateCoalMeasurement(baseForm(), "quantity", "10");
  form = updateCoalMeasurement(form, "rate", "3000");
  assert.equal(getCoalFinalTotal(form), 30000);
  assert.equal(buildCreateCoalPurchaseInput("factory-a", form)?.separateFreightAmount, 0);
  form = { ...form, hasSeparateFreight: true, separateFreightAmount: "1250.50" };
  assert.equal(getCoalFinalTotal(form), 31250.5);
  assert.equal(buildCreateCoalPurchaseInput("factory-a", form)?.separateFreightAmount, 1250.5);
});

test("initial Paid supports unpaid, partial, and full but rejects overpayment", () => {
  let form = updateCoalMeasurement(baseForm(), "quantity", "10");
  form = updateCoalMeasurement(form, "rate", "3000");
  assert.equal(buildCreateCoalPurchaseInput("factory-a", form)?.initialPaidAmount, 0);
  assert.equal(buildCreateCoalPurchaseInput("factory-a", {
    ...form, initialPaidAmount: "10000", initialPaymentMode: "cash",
  })?.initialPaidAmount, 10000);
  assert.equal(buildCreateCoalPurchaseInput("factory-a", {
    ...form, initialPaidAmount: "30000", initialPaymentMode: "upi",
  })?.initialPaidAmount, 30000);
  assert.equal(buildCreateCoalPurchaseInput("factory-a", {
    ...form, initialPaidAmount: "30000.01", initialPaymentMode: "cash",
  }), null);
});

test("manual Coal Challan numbers are optional, duplicate-safe display data", () => {
  let form = updateCoalMeasurement(baseForm(), "quantity", "10");
  form = updateCoalMeasurement(form, "rate", "3000");
  assert.equal(buildCreateCoalPurchaseInput("factory-a", form)?.coalChallanNumber, null);
  assert.equal(buildCreateCoalPurchaseInput("factory-a", {
    ...form, coalChallanNumber: " 11 ",
  })?.coalChallanNumber, "11");
});

test("later payments target internal purchase ID and cannot exceed its current due", () => {
  const partial = purchase({ totalPaid: 10000, outstandingAmount: 20000, paymentState: "partially_paid", isLocked: true });
  const base = { ...emptyCoalPaymentForm("2026-09-15", partial.id), paymentMode: "bank_transfer" };
  assert.equal(buildCoalPaymentInput("factory-a", { ...base, amount: "20000" }, [partial])?.purchaseId, partial.id);
  assert.equal(buildCoalPaymentInput("factory-a", { ...base, amount: "20000.01" }, [partial]), null);
});

test("seller date-range history and totals keep sellers, back-entry dates, and voids separate", () => {
  const purchases = [
    purchase(),
    purchase({ id: "purchase-b", purchaseDate: "2026-09-10", finalTotal: 10000, totalPaid: 2500, outstandingAmount: 7500 }),
    purchase({ id: "purchase-other", sellerId: "seller-b", sellerNameSnapshot: "Seller B" }),
    purchase({ id: "purchase-void", status: "void", outstandingAmount: 0 }),
  ];
  const filtered = filterCoalPurchases(purchases, "2026-09-01", "2026-09-14", "seller-a");
  assert.deepEqual(filtered.map((entry) => entry.id), ["purchase-void", "purchase-a", "purchase-b"]);
  assert.deepEqual(summarizeCoalPurchases(filtered), {
    totalPurchased: 40000,
    totalPaid: 2500,
    totalOutstanding: 37500,
    activePurchases: 2,
  });
});

test("Payment Status definitions use authoritative Paid and Outstanding values", () => {
  const purchases = [
    purchase({ id: "unpaid", totalPaid: 0, outstandingAmount: 30000, paymentState: "unpaid" }),
    purchase({ id: "partial", totalPaid: 10000, outstandingAmount: 20000, paymentState: "partially_paid" }),
    purchase({ id: "paid", totalPaid: 30000, outstandingAmount: 0, paymentState: "paid" }),
    purchase({ id: "void", status: "void", totalPaid: 0, outstandingAmount: 0 }),
  ];
  const ids = (status: "all" | "unpaid" | "partial" | "paid") =>
    filterCoalPurchases(purchases, "2026-09-01", "2026-09-30", "", status)
      .map((entry) => entry.id).sort();
  assert.deepEqual(ids("all"), ["paid", "partial", "unpaid", "void"]);
  assert.deepEqual(ids("unpaid"), ["unpaid"]);
  assert.deepEqual(ids("partial"), ["partial"]);
  assert.deepEqual(ids("paid"), ["paid"]);
});

test("Payment Status combines with seller and inclusive date range without leaking rows", () => {
  const purchases = [
    purchase({ id: "match-start", purchaseDate: "2026-09-01", totalPaid: 1, outstandingAmount: 29999 }),
    purchase({ id: "match-end", purchaseDate: "2026-09-30", totalPaid: 2, outstandingAmount: 29998 }),
    purchase({ id: "outside", purchaseDate: "2026-08-31", totalPaid: 1, outstandingAmount: 29999 }),
    purchase({ id: "other-seller", sellerId: "seller-b", totalPaid: 1, outstandingAmount: 29999 }),
    purchase({ id: "wrong-status", totalPaid: 0, outstandingAmount: 30000 }),
  ];
  const filtered = filterCoalPurchases(
    purchases, "2026-09-01", "2026-09-30", "seller-a", "partial",
  );
  assert.deepEqual(filtered.map((entry) => entry.id), ["match-end", "match-start"]);
  assert.deepEqual(summarizeCoalPurchases(filtered), {
    totalPurchased: 60000,
    totalPaid: 3,
    totalOutstanding: 59997,
    activePurchases: 2,
  });
});

test("Coal Purchase archive search matches only genuine identifying fields", () => {
  const purchases = [
    purchase({ id: "seller", sellerNameSnapshot: "Dhanbad Minerals" }),
    purchase({ id: "coal", coalNameSnapshot: "Grade G11 Steam" }),
    purchase({ id: "source", sourceLocationSnapshot: "Central Siding" }),
    purchase({ id: "challan", coalChallanNumber: "CH-204" }),
    purchase({ id: "vehicle", vehicleNumberSnapshot: "WB58 A 1234" }),
    purchase({ id: "outside", sellerNameSnapshot: "Another Seller" }),
  ];

  const ids = (searchTerm: string) => filterCoalPurchases(
    purchases, "2026-09-01", "2026-09-30", "", "all", searchTerm,
  ).map((entry) => entry.id);

  assert.deepEqual(ids("dhanbad"), ["seller"]);
  assert.deepEqual(ids("g11"), ["coal"]);
  assert.deepEqual(ids("central"), ["source"]);
  assert.deepEqual(ids("ch-204"), ["challan"]);
  assert.deepEqual(ids("wb58"), ["vehicle"]);
  assert.deepEqual(ids("   ").sort(), purchases.map((entry) => entry.id).sort());
});

test("Detailed Purchase History is newest-first with deterministic same-date ordering", () => {
  const filtered = filterCoalPurchases([
    purchase({ id: "purchase-old-created", purchaseDate: "2026-09-20", createdAt: "2026-09-20T08:00:00Z" }),
    purchase({ id: "purchase-z", purchaseDate: "2026-09-20", createdAt: "2026-09-20T10:00:00Z" }),
    purchase({ id: "purchase-a", purchaseDate: "2026-09-20", createdAt: "2026-09-20T10:00:00Z" }),
    purchase({ id: "void", purchaseDate: "2026-09-21", status: "void", outstandingAmount: 0 }),
  ], "2026-09-01", "2026-09-30");
  assert.deepEqual(filtered.map((entry) => entry.id), [
    "void", "purchase-z", "purchase-a", "purchase-old-created",
  ]);
  assert.deepEqual(summarizeCoalPurchases(filtered), {
    totalPurchased: 90000,
    totalPaid: 0,
    totalOutstanding: 90000,
    activePurchases: 3,
  });
});

test("Seller Payment History uses inclusive payment dates and the shared Seller scope", () => {
  const payments = [
    payment({ id: "before", paymentDate: "2026-08-31" }),
    payment({ id: "start", paymentDate: "2026-09-01" }),
    payment({ id: "end", paymentDate: "2026-09-30" }),
    payment({ id: "other", sellerId: "seller-b", sellerNameSnapshot: "Seller B" }),
  ];
  assert.deepEqual(new Set(filterCoalPayments(
    payments, "2026-09-01", "2026-09-30",
  ).map((entry) => entry.sellerId)), new Set(["seller-a", "seller-b"]));
  assert.deepEqual(filterCoalPayments(
    payments, "2026-09-01", "2026-09-30", "seller-a",
  ).map((entry) => entry.id), ["end", "start"]);
});

test("Seller Payment History is newest-first and renders one grouped payment with allocations intact", () => {
  const grouped = payment({
    id: "grouped",
    paymentDate: "2026-09-20",
    createdAt: "2026-09-20T10:00:00Z",
    allocationCount: 2,
    allocations: [
      { purchaseId: "purchase-a", purchaseDate: "2026-09-10", coalChallanNumber: "11", coalNameSnapshot: "Steam Coal", sourceLocationSnapshot: "Raniganj", vehicleNumberSnapshot: "WB 58 A 1234", allocatedAmount: 10000 },
      { purchaseId: "purchase-b", purchaseDate: "2026-09-11", coalChallanNumber: "12", coalNameSnapshot: "Steam Coal", sourceLocationSnapshot: "Raniganj", vehicleNumberSnapshot: "WB 58 A 1235", allocatedAmount: 15000 },
    ],
  });
  const filtered = filterCoalPayments([
    payment({ id: "older-date", paymentDate: "2026-09-19", createdAt: "2026-09-21T12:00:00Z" }),
    payment({ id: "older-created", paymentDate: "2026-09-20", createdAt: "2026-09-20T09:00:00Z" }),
    grouped,
    grouped,
  ], "2026-09-01", "2026-09-30");
  assert.deepEqual(filtered.map((entry) => entry.id), ["grouped", "older-created", "older-date"]);
  assert.equal(filtered.filter((entry) => entry.id === grouped.id).length, 1);
  assert.deepEqual(filtered[0]?.allocations, grouped.allocations);
});

test("Seller Payment archive filters persisted payment and allocation snapshots", () => {
  const first = payment({
    id: "first",
    sellerNameSnapshot: "Dhanbad Minerals",
    paymentMode: "bank_transfer",
    note: "September settlement",
    allocations: [{
      purchaseId: "purchase-a",
      purchaseDate: "2026-09-10",
      coalChallanNumber: "CH-204",
      coalNameSnapshot: "Steam Coal",
      sourceLocationSnapshot: "Central Siding",
      vehicleNumberSnapshot: "WB58 A 1234",
      allocatedAmount: 25000,
    }],
  });
  const second = payment({ id: "second", sellerId: "seller-b", paymentMode: "cash" });

  const ids = (mode: "" | CoalPayment["paymentMode"], search: string) => filterCoalPayments(
    [first, second], "2026-09-01", "2026-09-30", "", mode, search,
  ).map((entry) => entry.id);

  assert.deepEqual(ids("bank_transfer", ""), ["first"]);
  for (const search of ["dhanbad", "september", "ch-204", "steam", "central", "wb58"]) {
    assert.deepEqual(ids("", search), ["first"]);
  }
});

test("persisted Seller Payment allocations reconcile in paise without current purchase balances", () => {
  assert.deepEqual(getCoalPaymentAllocationReconciliation(payment({
    amount: 25000,
    allocations: [
      { purchaseId: "a", purchaseDate: "2026-09-10", coalChallanNumber: null, coalNameSnapshot: "A", sourceLocationSnapshot: "A", vehicleNumberSnapshot: "A", allocatedAmount: 10000.1 },
      { purchaseId: "b", purchaseDate: "2026-09-11", coalChallanNumber: null, coalNameSnapshot: "B", sourceLocationSnapshot: "B", vehicleNumberSnapshot: "B", allocatedAmount: 14999.9 },
    ],
  })), { allocatedAmount: 25000, remainingAmount: 0, reconciles: true });

  assert.deepEqual(getCoalPaymentAllocationReconciliation(payment({
    amount: 25000,
    allocations: [{ purchaseId: "a", purchaseDate: "2026-09-10", coalChallanNumber: null, coalNameSnapshot: "A", sourceLocationSnapshot: "A", vehicleNumberSnapshot: "A", allocatedAmount: 24000 }],
  })), { allocatedAmount: 24000, remainingAmount: 1000, reconciles: false });
});

test("only unpaid active Coal Purchases may be corrected or voided", () => {
  assert.equal(canChangeCoalPurchase(purchase()), true);
  assert.equal(canChangeCoalPurchase(purchase({ isLocked: true, totalPaid: 1 })), false);
  assert.equal(canChangeCoalPurchase(purchase({ status: "void" })), false);
});

test("seller and inclusive date range expose only eligible outstanding Coal Purchases", () => {
  const purchases = [
    purchase({ id: "inside-start", purchaseDate: "2026-09-01" }),
    purchase({ id: "inside-end", purchaseDate: "2026-09-30" }),
    purchase({ id: "outside", purchaseDate: "2026-08-31" }),
    purchase({ id: "other-seller", sellerId: "seller-b" }),
    purchase({ id: "paid", outstandingAmount: 0, paymentState: "paid" }),
    purchase({ id: "void", status: "void", outstandingAmount: 100 }),
  ];
  assert.deepEqual(
    getEligibleCoalSettlementPurchases(purchases, "seller-a", "2026-09-01", "2026-09-30")
      .map((entry) => entry.id),
    ["inside-start", "inside-end"],
  );
  assert.deepEqual(getEligibleCoalSettlementPurchases(
    purchases, "seller-a", "2026-09-30", "2026-09-01",
  ), []);
});

test("selection defaults to full due and reconciles payment across multiple purchases", () => {
  const first = purchase({ id: "first", outstandingAmount: 800000, finalTotal: 1800000, totalPaid: 1000000 });
  const second = purchase({ id: "second", purchaseDate: "2026-09-20", outstandingAmount: 1500000, finalTotal: 2000000, totalPaid: 500000 });
  let form = { ...emptyCoalSelectivePaymentForm("2026-09-30"), sellerId: "seller-a", paymentMode: "bank_transfer" };
  form = toggleCoalSettlementPurchase(form, first, true);
  assert.equal(form.amount, "800000");
  form = toggleCoalSettlementPurchase(form, second, true);
  assert.equal(form.amount, "2300000");
  form = setCoalSettlementAllocation(form, second.id, "500000");
  assert.deepEqual(form.allocations, { first: "800000", second: "500000" });
  assert.equal(form.amount, "1300000");
  assert.deepEqual(getCoalSelectivePaymentStatus(form, [first, second]), {
    periodOutstanding: 2300000,
    selectedPurchases: 2,
    paymentAmount: 1300000,
    allocatedAmount: 1300000,
    remainingAmount: 0,
    selectedPayment: 1300000,
    canSubmit: true,
    error: "",
  });
  assert.deepEqual(buildCoalSelectivePaymentInput("factory-a", form, [first, second])?.allocations, [
    { purchaseId: "first", amount: 800000 },
    { purchaseId: "second", amount: 500000 },
  ]);
});

test("deselection removes its allocation and returns payment to the remaining total or empty state", () => {
  const first = purchase({ id: "first", outstandingAmount: 80000 });
  const second = purchase({ id: "second", outstandingAmount: 20000 });
  let form = emptyCoalSelectivePaymentForm("2026-09-30");
  form = toggleCoalSettlementPurchase(form, first, true);
  form = toggleCoalSettlementPurchase(form, second, true);
  assert.equal(form.amount, "100000");

  form = toggleCoalSettlementPurchase(form, first, false);
  assert.deepEqual(form.allocations, { second: "20000" });
  assert.equal(form.amount, "20000");

  form = toggleCoalSettlementPurchase(form, second, false);
  assert.deepEqual(form.allocations, {});
  assert.equal(form.amount, "");
});

test("editing payment amount keeps one selected Coal Purchase allocation partial and valid", () => {
  const due = purchase({ outstandingAmount: 80000 });
  let form = {
    ...toggleCoalSettlementPurchase(emptyCoalSelectivePaymentForm("2026-09-30"), due, true),
    sellerId: due.sellerId,
    paymentMode: "upi",
  };
  form = setCoalSettlementPaymentAmount(form, "30000");
  assert.equal(form.amount, "30000");
  assert.deepEqual(form.allocations, { [due.id]: "30000" });
  assert.equal(getCoalSelectivePaymentStatus(form, [due]).canSubmit, true);
});

test("an auto-reconciled allocation still cannot exceed the purchase outstanding balance", () => {
  const due = purchase({ outstandingAmount: 1000 });
  let form = {
    ...toggleCoalSettlementPurchase(emptyCoalSelectivePaymentForm("2026-09-30"), due, true),
    sellerId: due.sellerId,
    paymentMode: "cash",
  };
  form = setCoalSettlementAllocation(form, due.id, "1000.01");
  assert.equal(form.amount, "1000.01");
  assert.match(getCoalSelectivePaymentStatus(form, [due]).error, /exceeds its outstanding amount/);
  assert.equal(buildCoalSelectivePaymentInput("factory-a", form, [due]), null);
});

test("selective payment rejects no selection, zero, negative, over-allocation, and invalid ranges", () => {
  const due = purchase({ outstandingAmount: 1000 });
  const base = { ...emptyCoalSelectivePaymentForm("2026-09-30"), sellerId: "seller-a", amount: "1000", paymentMode: "cash" };
  assert.equal(buildCoalSelectivePaymentInput("factory-a", base, [due]), null);
  for (const amount of ["0", "-1", "1000.01"]) {
    assert.equal(buildCoalSelectivePaymentInput("factory-a", {
      ...base, allocations: { [due.id]: amount },
    }, [due]), null);
  }
  assert.equal(buildCoalSelectivePaymentInput("factory-a", {
    ...base, fromDate: "2026-10-01", toDate: "2026-09-01", allocations: { [due.id]: "1" },
  }, [due]), null);
  assert.equal(buildCoalSelectivePaymentInput("factory-a", {
    ...base, amount: "999", allocations: { [due.id]: "1000" },
  }, [due]), null);
  assert.equal(buildCoalSelectivePaymentInput("factory-a", {
    ...base, amount: "1000", allocations: { [due.id]: "999" },
  }, [due]), null);
});

test("selective payment exposes payment, allocated, and remaining without changing allocation authority", () => {
  const due = purchase({ outstandingAmount: 2000 });
  const base = {
    ...emptyCoalSelectivePaymentForm("2026-09-30"),
    sellerId: "seller-a",
    amount: "1500",
    paymentMode: "cash",
    allocations: { [due.id]: "1000" },
  };
  assert.deepEqual(getCoalSelectivePaymentStatus(base, [due]), {
    periodOutstanding: 2000,
    selectedPurchases: 1,
    paymentAmount: 1500,
    allocatedAmount: 1000,
    remainingAmount: 500,
    selectedPayment: 1000,
    canSubmit: false,
    error: "Allocate the full payment amount before saving.",
  });
  assert.equal(getCoalSelectivePaymentStatus({
    ...base,
    amount: "999",
  }, [due]).error, "Allocated amount cannot exceed the payment amount.");
});
