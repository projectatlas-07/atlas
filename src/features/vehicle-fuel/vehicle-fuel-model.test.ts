import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCreateVehicleFuelInput,
  buildVehicleFuelBatchPaymentInput,
  buildUpdateVehicleFuelInput,
  buildVehicleFuelPaymentInput,
  canChangeVehicleFuel,
  emptyVehicleFuelForm,
  emptyVehicleFuelBatchPaymentForm,
  filterVehicleFuelBatchPayments,
  filterVehicleFuelRecords,
  formatFuelTime,
  getLocalTime,
  getVehicleFuelPaymentAllocationReconciliation,
  getVehicleFuelPeriodOutstanding,
  isLocalTime,
  relativeRefuelAge,
  summarizeVehicleFuel,
  updateFuelMeasurement,
} from "./vehicle-fuel-model.ts";
import type { VehicleFuelBatchPayment, VehicleFuelRecord } from "./types.ts";

function completeForm() {
  let form = {
    ...emptyVehicleFuelForm("2026-09-14", "19:35"),
    vehicleId: "vehicle-a",
    pumpId: "pump-a",
  };
  form = updateFuelMeasurement(form, "litres", "40");
  return updateFuelMeasurement(form, "ratePerLitre", "92");
}

const baseRecord: VehicleFuelRecord = {
  id: "fuel-a", factoryId: "factory-a", fuelDate: "2026-09-14", fuelTime: "19:35:00",
  vehicleId: "vehicle-a", vehicleNumberSnapshot: "WB58 A 1234",
  pumpId: "pump-a", pumpNameSnapshot: "Shell Pump Kolkata",
  pumpAddressSnapshot: "Main Road", pumpMobileSnapshot: null,
  fuelType: "DIESEL", litres: 40, ratePerLitre: 92, fuelAmount: 3680,
  status: "active", isLocked: false, totalPaid: 0, outstandingAmount: 3680,
  paymentState: "unpaid", voidedAt: null,
  createdAt: "2026-09-14T14:05:00Z", updatedAt: "2026-09-14T14:05:00Z",
};

const baseBatchPayment: VehicleFuelBatchPayment = {
  id: "payment-a",
  factoryId: "factory-a",
  pumpId: "pump-a",
  pumpName: "Shell Pump Kolkata",
  vehicleIds: ["vehicle-a"],
  allocationCount: 1,
  allocations: [{
    fuelRecordId: "fuel-a",
    fuelDate: "2026-09-14",
    fuelTime: "19:35:00",
    vehicleId: "vehicle-a",
    vehicleNumberSnapshot: "WB58 A 1234",
    fuelType: "DIESEL",
    litres: 40,
    allocatedAmount: 3000,
  }],
  paymentDate: "2026-09-15",
  amount: 3000,
  paymentMode: "bank_transfer",
  note: "September Fuel payment",
  createdAt: "2026-09-15T10:00:00Z",
};

test("new Fuel entry defaults to today/time input and Diesel", () => {
  const form = emptyVehicleFuelForm("2026-09-14", "07:05");
  assert.equal(form.fuelDate, "2026-09-14");
  assert.equal(form.fuelTime, "07:05");
  assert.equal(form.fuelType, "DIESEL");
  assert.equal(getLocalTime(new Date(2026, 8, 14, 7, 5)), "07:05");
});

test("local wall-clock time validates without timezone conversion", () => {
  assert.equal(isLocalTime("00:00"), true);
  assert.equal(isLocalTime("23:59"), true);
  assert.equal(isLocalTime("24:00"), false);
  assert.equal(formatFuelTime("19:35:00"), "7:35 PM");
});

test("Litres plus Rate derives Amount with paise rounding", () => {
  const form = completeForm();
  assert.equal(form.fuelAmount, "3680");
  assert.deepEqual(buildCreateVehicleFuelInput("factory-a", form), {
    factoryId: "factory-a", fuelDate: "2026-09-14", fuelTime: "19:35",
    vehicleId: "vehicle-a", pumpId: "pump-a", fuelType: "DIESEL",
    litres: 40, ratePerLitre: 92, fuelAmount: null,
    initialPaidAmount: 0, initialPaymentMode: null,
  });
});

test("Rate plus Amount derives Litres", () => {
  let form = { ...emptyVehicleFuelForm("2026-09-10", "10:15"), vehicleId: "v", pumpId: "p" };
  form = updateFuelMeasurement(form, "ratePerLitre", "92");
  form = updateFuelMeasurement(form, "fuelAmount", "3680");
  assert.equal(form.litres, "40");
  assert.equal(buildCreateVehicleFuelInput("f", form)?.litres, null);
});

test("Litres plus Amount derives Rate", () => {
  let form = { ...emptyVehicleFuelForm("2026-09-10", "10:15"), vehicleId: "v", pumpId: "p" };
  form = updateFuelMeasurement(form, "litres", "40");
  form = updateFuelMeasurement(form, "fuelAmount", "3680");
  assert.equal(form.ratePerLitre, "92");
  assert.equal(buildCreateVehicleFuelInput("f", form)?.ratePerLitre, null);
});

test("smart calculation rejects zero, negatives, excess precision, and contradictory edits", () => {
  let zero = { ...emptyVehicleFuelForm("2026-09-10", "10:15"), vehicleId: "v", pumpId: "p" };
  zero = updateFuelMeasurement(zero, "ratePerLitre", "0");
  zero = updateFuelMeasurement(zero, "fuelAmount", "100");
  assert.equal(zero.litres, "");
  assert.equal(buildCreateVehicleFuelInput("f", zero), null);
  for (const value of ["-1", "1.1234567", "NaN"]) {
    assert.equal(buildCreateVehicleFuelInput("f", { ...completeForm(), litres: value }), null);
  }
});

test("decimal calculation avoids binary floating-point drift", () => {
  let form = { ...emptyVehicleFuelForm("2026-09-10", "10:15"), vehicleId: "v", pumpId: "p" };
  form = updateFuelMeasurement(form, "litres", "0.1");
  form = updateFuelMeasurement(form, "ratePerLitre", "0.2");
  assert.equal(form.fuelAmount, "0.02");
});

test("Petrol, back-entry, unpaid, partial, full, and overpayment states validate", () => {
  const petrol = { ...completeForm(), fuelDate: "2026-08-01", fuelType: "PETROL" as const };
  assert.equal(buildCreateVehicleFuelInput("factory-a", petrol)?.fuelDate, "2026-08-01");
  assert.equal(buildCreateVehicleFuelInput("factory-a", petrol)?.fuelType, "PETROL");
  assert.equal(buildCreateVehicleFuelInput("factory-a", { ...petrol, initialPaidAmount: "1000", initialPaymentMode: "cash" })?.initialPaidAmount, 1000);
  assert.equal(buildCreateVehicleFuelInput("factory-a", { ...petrol, initialPaidAmount: "3680", initialPaymentMode: "upi" })?.initialPaidAmount, 3680);
  assert.equal(buildCreateVehicleFuelInput("factory-a", { ...petrol, initialPaidAmount: "3680.01", initialPaymentMode: "cash" }), null);
  assert.equal(buildCreateVehicleFuelInput("factory-a", { ...petrol, fuelType: "CNG" as "PETROL" }), null);
});

test("unpaid corrections retain Fuel UUID while paid history locks", () => {
  assert.equal(buildUpdateVehicleFuelInput("factory-a", "fuel-a", completeForm())?.fuelRecordId, "fuel-a");
  assert.equal(canChangeVehicleFuel(baseRecord), true);
  assert.equal(canChangeVehicleFuel({ ...baseRecord, totalPaid: 1, isLocked: true }), false);
  assert.equal(canChangeVehicleFuel({ ...baseRecord, status: "void" }), false);
});

test("later Pump payment targets one obligation and rejects overpayment", () => {
  const partial = { ...baseRecord, totalPaid: 1000, outstandingAmount: 2680, isLocked: true };
  assert.equal(buildVehicleFuelPaymentInput("factory-a", {
    fuelRecordId: "fuel-a", paymentDate: "2026-09-15", amount: "2680",
    paymentMode: "bank_transfer", note: "Final",
  }, [partial])?.fuelRecordId, "fuel-a");
  assert.equal(buildVehicleFuelPaymentInput("factory-a", {
    fuelRecordId: "fuel-a", paymentDate: "2026-09-15", amount: "2680.01",
    paymentMode: "cash", note: "",
  }, [partial]), null);
});

test("vehicle/pump/date filters and statement totals exclude void Fuel", () => {
  const records = [
    baseRecord,
    { ...baseRecord, id: "b", fuelDate: "2026-09-13", vehicleId: "vehicle-b" },
    { ...baseRecord, id: "c", fuelDate: "2026-09-12", pumpId: "pump-b" },
    { ...baseRecord, id: "d", fuelDate: "2026-08-01" },
  ];
  assert.deepEqual(filterVehicleFuelRecords(records, "2026-09-01", "2026-09-30", "vehicle-a", "pump-a").map((row) => row.id), ["fuel-a"]);
  assert.deepEqual(summarizeVehicleFuel([baseRecord, { ...baseRecord, id: "v", status: "void" }]), {
    totalPurchased: 3680, totalPaid: 0, totalOutstanding: 3680, totalLitres: 40,
  });
});

test("Fuel archive filters genuine identifying fields, Fuel Type, and persisted state", () => {
  const records = [
    baseRecord,
    { ...baseRecord, id: "partial", vehicleNumberSnapshot: "RJ 14 AB 4321", paymentState: "partially_paid" as const, totalPaid: 1000, outstandingAmount: 2680 },
    { ...baseRecord, id: "petrol", pumpNameSnapshot: "North Pump", fuelType: "PETROL" as const, paymentState: "paid" as const, totalPaid: 3680, outstandingAmount: 0 },
    { ...baseRecord, id: "void", status: "void" as const },
  ];
  assert.deepEqual(filterVehicleFuelRecords(records, "", "", "", "", "RJ 14", "", "partially_paid").map((row) => row.id), ["partial"]);
  assert.deepEqual(filterVehicleFuelRecords(records, "", "", "", "", "north", "PETROL", "paid").map((row) => row.id), ["petrol"]);
  assert.deepEqual(filterVehicleFuelRecords(records, "", "", "", "", "", "", "void").map((row) => row.id), ["void"]);
  assert.deepEqual(filterVehicleFuelRecords(records, "", "", "", "", "", "", "unpaid").map((row) => row.id), ["fuel-a"]);
});

test("Pump Payment archive filters persisted Pump, note, vehicle, dates, and mode", () => {
  const payments = [
    baseBatchPayment,
    {
      ...baseBatchPayment,
      id: "payment-b",
      pumpId: "pump-b",
      pumpName: "Highway Fuel Hub",
      vehicleIds: ["vehicle-b"],
      paymentDate: "2026-09-16",
      paymentMode: "cash" as const,
      note: null,
      allocations: [{
        ...baseBatchPayment.allocations[0],
        fuelRecordId: "fuel-b",
        vehicleId: "vehicle-b",
        vehicleNumberSnapshot: "TRUCK-2",
      }],
      createdAt: "2026-09-16T09:00:00Z",
    },
    { ...baseBatchPayment, id: "payment-c", createdAt: "2026-09-15T11:00:00Z" },
  ];

  assert.deepEqual(filterVehicleFuelBatchPayments(
    payments, "", "", "", "", "", "September Fuel payment",
  ).map((payment) => payment.id), ["payment-c", "payment-a"]);
  assert.deepEqual(filterVehicleFuelBatchPayments(
    payments, "2026-09-16", "2026-09-16", "pump-b", "vehicle-b", "cash", "truck-2",
  ).map((payment) => payment.id), ["payment-b"]);
  assert.deepEqual(filterVehicleFuelBatchPayments(
    payments, "", "", "", "", "", "highway fuel hub",
  ).map((payment) => payment.id), ["payment-b"]);
  assert.deepEqual(filterVehicleFuelBatchPayments(
    payments, "2026-09-17", "2026-09-16",
  ), []);
});

test("Pump Payment reconciliation uses exact persisted allocation amounts", () => {
  assert.deepEqual(getVehicleFuelPaymentAllocationReconciliation(baseBatchPayment), {
    allocatedAmount: 3000,
    remainingAmount: 0,
    reconciles: true,
  });
  assert.deepEqual(getVehicleFuelPaymentAllocationReconciliation({
    ...baseBatchPayment,
    amount: 3500,
  }), {
    allocatedAmount: 3000,
    remainingAmount: 500,
    reconciles: false,
  });
});

test("Last Refuel relative age is deterministic at the calendar-date level", () => {
  assert.equal(relativeRefuelAge("2026-09-10", new Date(2026, 8, 14, 23, 59)), "4 days ago");
  assert.equal(relativeRefuelAge("2026-09-14", new Date(2026, 8, 14, 0, 1)), "today");
});

test("batch period includes only active outstanding Pump entries in the inclusive range", () => {
  const records = [
    { ...baseRecord, id: "old", fuelDate: "2026-09-10", fuelTime: "08:00:00", outstandingAmount: 2000 },
    { ...baseRecord, id: "boundary", fuelDate: "2026-09-14", fuelTime: "07:00:00", outstandingAmount: 3000 },
    { ...baseRecord, id: "outside", fuelDate: "2026-09-15", outstandingAmount: 4000 },
    { ...baseRecord, id: "other-pump", pumpId: "pump-b", outstandingAmount: 5000 },
    { ...baseRecord, id: "paid", outstandingAmount: 0, paymentState: "paid" as const },
    { ...baseRecord, id: "void", status: "void" as const, outstandingAmount: 1000 },
  ];
  const period = getVehicleFuelPeriodOutstanding(records, "pump-a", "2026-09-10", "2026-09-14");
  assert.equal(period.eligibleCount, 2);
  assert.equal(period.outstandingAmount, 5000);
  assert.deepEqual(period.eligibleRecords.map((record) => record.id), ["old", "boundary"]);
});

test("batch oldest-first order uses Fuel time then created-at and UUID tie-breakers", () => {
  const records = [
    { ...baseRecord, id: "z", fuelDate: "2026-09-10", fuelTime: "09:00:00", createdAt: "2026-09-10T01:00:00Z" },
    { ...baseRecord, id: "b", fuelDate: "2026-09-10", fuelTime: "08:00:00", createdAt: "2026-09-10T02:00:00Z" },
    { ...baseRecord, id: "a", fuelDate: "2026-09-10", fuelTime: "08:00:00", createdAt: "2026-09-10T02:00:00Z" },
    { ...baseRecord, id: "early-created", fuelDate: "2026-09-10", fuelTime: "08:00:00", createdAt: "2026-09-10T01:00:00Z" },
  ];
  assert.deepEqual(
    getVehicleFuelPeriodOutstanding(records, "pump-a", "2026-09-10", "2026-09-10")
      .eligibleRecords.map((record) => record.id),
    ["early-created", "a", "b", "z"],
  );
});

test("batch payment supports partial and full settlement but rejects invalid amounts and ranges", () => {
  const records = [baseRecord, { ...baseRecord, id: "second", outstandingAmount: 1320 }];
  const base = {
    ...emptyVehicleFuelBatchPaymentForm("2026-09-14"),
    pumpId: "pump-a", fromDate: "2026-09-01", toDate: "2026-09-14",
    amount: "2500", paymentMode: "cash",
  };
  assert.equal(buildVehicleFuelBatchPaymentInput("factory-a", base, records)?.amount, 2500);
  assert.equal(buildVehicleFuelBatchPaymentInput("factory-a", { ...base, amount: "5000" }, records)?.amount, 5000);
  for (const amount of ["0", "-1", "5000.01"]) {
    assert.equal(buildVehicleFuelBatchPaymentInput("factory-a", { ...base, amount }, records), null);
  }
  assert.equal(buildVehicleFuelBatchPaymentInput("factory-a", {
    ...base, fromDate: "2026-09-15", toDate: "2026-09-14",
  }, records), null);
});
