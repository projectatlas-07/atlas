import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVehicleMaintenanceBatchPaymentInput,
  buildCreateVehicleMaintenanceInput,
  buildUpdateVehicleMaintenanceInput,
  buildVehicleMaintenancePaymentInput,
  canChangeVehicleMaintenance,
  emptyVehicleMaintenanceBatchPaymentForm,
  emptyVehicleMaintenanceForm,
  filterVehicleMaintenanceBatchPayments,
  filterVehicleMaintenanceRecords,
  getVehicleMaintenancePaymentAllocationReconciliation,
  getVehicleMaintenancePeriodOutstanding,
  summarizeVehicleMaintenance,
} from "./vehicle-maintenance-model.ts";
import type {
  VehicleMaintenanceBatchPayment,
  VehicleMaintenanceRecord,
} from "./types.ts";

const baseForm = {
  ...emptyVehicleMaintenanceForm("2026-09-10"),
  vehicleId: "vehicle-a",
  garageId: "garage-a",
  workDescription: "Rear tyre replacement",
  totalAmount: "8000",
};

const baseRecord: VehicleMaintenanceRecord = {
  id: "maintenance-a", factoryId: "factory-a", maintenanceDate: "2026-09-10",
  vehicleId: "vehicle-a", vehicleNumberSnapshot: "WB58 A 1234",
  garageId: "garage-a", garageNameSnapshot: "Rahman Garage",
  garageAddressSnapshot: null, garageMobileSnapshot: null,
  workDescription: "Rear tyre replacement", totalAmount: 8000,
  status: "active", isLocked: false, totalPaid: 0, outstandingAmount: 8000,
  paymentState: "unpaid", voidedAt: null,
  createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
};

const baseBatchPayment: VehicleMaintenanceBatchPayment = {
  id: "payment-a",
  factoryId: "factory-a",
  garageId: "garage-a",
  garageNameSnapshot: "Rahman Garage",
  vehicleIds: ["vehicle-a"],
  allocationCount: 1,
  allocations: [{
    maintenanceId: "maintenance-a",
    maintenanceDate: "2026-09-10",
    vehicleId: "vehicle-a",
    vehicleNumberSnapshot: "WB58 A 1234",
    workDescription: "Rear tyre replacement",
    allocatedAmount: 3000,
  }],
  paymentDate: "2026-09-12",
  amount: 3000,
  paymentMode: "bank_transfer",
  note: "Final tyre payment",
  createdAt: "2026-09-12T10:00:00Z",
};

test("creates back-entered unpaid Maintenance with stable vehicle and garage IDs", () => {
  assert.deepEqual(buildCreateVehicleMaintenanceInput("factory-a", baseForm), {
    factoryId: "factory-a", maintenanceDate: "2026-09-10",
    vehicleId: "vehicle-a", garageId: "garage-a",
    workDescription: "Rear tyre replacement", totalAmount: 8000,
    initialPaidAmount: 0, initialPaymentMode: null,
  });
});

test("supports partial and full initial payment while rejecting overpayment", () => {
  assert.equal(buildCreateVehicleMaintenanceInput("factory-a", {
    ...baseForm, initialPaidAmount: "5000", initialPaymentMode: "cash",
  })?.initialPaidAmount, 5000);
  assert.equal(buildCreateVehicleMaintenanceInput("factory-a", {
    ...baseForm, initialPaidAmount: "8000", initialPaymentMode: "upi",
  })?.initialPaidAmount, 8000);
  assert.equal(buildCreateVehicleMaintenanceInput("factory-a", {
    ...baseForm, initialPaidAmount: "8000.01", initialPaymentMode: "cash",
  }), null);
});

test("money and work validation reject zero, negative, excess precision, and blank work", () => {
  for (const totalAmount of ["0", "-1", "1.001", "NaN", ""]) {
    assert.equal(buildCreateVehicleMaintenanceInput("factory-a", { ...baseForm, totalAmount }), null);
  }
  assert.equal(buildCreateVehicleMaintenanceInput("factory-a", {
    ...baseForm, workDescription: "   ",
  }), null);
});

test("unpaid correction preserves internal Maintenance identity", () => {
  assert.equal(buildUpdateVehicleMaintenanceInput(
    "factory-a", "maintenance-a", { ...baseForm, totalAmount: "8500" },
  )?.maintenanceId, "maintenance-a");
});

test("later Garage payment targets one internal obligation and cannot overpay", () => {
  const partial = { ...baseRecord, isLocked: true, totalPaid: 5000, outstandingAmount: 3000, paymentState: "partially_paid" as const };
  assert.equal(buildVehicleMaintenancePaymentInput("factory-a", {
    maintenanceId: partial.id, paymentDate: "2026-09-12", amount: "3000",
    paymentMode: "bank_transfer", note: "Final payment",
  }, [partial])?.maintenanceId, partial.id);
  assert.equal(buildVehicleMaintenancePaymentInput("factory-a", {
    maintenanceId: partial.id, paymentDate: "2026-09-12", amount: "3000.01",
    paymentMode: "cash", note: "",
  }, [partial]), null);
});

test("Garage period due includes only active outstanding jobs in the inclusive range", () => {
  const rows = [
    { ...baseRecord, id: "outside", maintenanceDate: "2026-09-01" },
    { ...baseRecord, id: "oldest", maintenanceDate: "2026-09-02", outstandingAmount: 5000 },
    { ...baseRecord, id: "same-late", maintenanceDate: "2026-09-08", createdAt: "2026-09-08T10:00:00Z", outstandingAmount: 6000 },
    { ...baseRecord, id: "same-early", maintenanceDate: "2026-09-08", createdAt: "2026-09-08T09:00:00Z", outstandingAmount: 3000 },
    { ...baseRecord, id: "other-garage", garageId: "garage-b", outstandingAmount: 2000 },
    { ...baseRecord, id: "paid", outstandingAmount: 0, paymentState: "paid" as const },
    { ...baseRecord, id: "void", status: "void" as const, outstandingAmount: 700 },
  ];
  const period = getVehicleMaintenancePeriodOutstanding(
    rows, "garage-a", "2026-09-02", "2026-09-08",
  );
  assert.equal(period.eligibleCount, 3);
  assert.equal(period.outstandingAmount, 14000);
  assert.deepEqual(period.eligibleRecords.map((record) => record.id), [
    "oldest", "same-early", "same-late",
  ]);
});

test("Garage batch payment accepts partial/full due and rejects invalid amounts or range", () => {
  const rows = [
    { ...baseRecord, id: "first", maintenanceDate: "2026-09-02", outstandingAmount: 5000 },
    { ...baseRecord, id: "second", maintenanceDate: "2026-09-08", outstandingAmount: 3000 },
  ];
  const form = {
    ...emptyVehicleMaintenanceBatchPaymentForm("2026-09-12"),
    garageId: "garage-a",
    fromDate: "2026-09-02",
    paymentMode: "bank_transfer",
  };
  assert.equal(buildVehicleMaintenanceBatchPaymentInput(
    "factory-a", { ...form, amount: "6000" }, rows,
  )?.amount, 6000);
  assert.equal(buildVehicleMaintenanceBatchPaymentInput(
    "factory-a", { ...form, amount: "8000" }, rows,
  )?.amount, 8000);
  for (const amount of ["0", "-1", "8000.01"]) {
    assert.equal(buildVehicleMaintenanceBatchPaymentInput(
      "factory-a", { ...form, amount }, rows,
    ), null);
  }
  assert.equal(buildVehicleMaintenanceBatchPaymentInput(
    "factory-a", { ...form, fromDate: "2026-09-13", amount: "1" }, rows,
  ), null);
});

test("vehicle and Garage date filters preserve multiple relationship combinations", () => {
  const rows = [
    baseRecord,
    { ...baseRecord, id: "b", maintenanceDate: "2026-09-11", vehicleId: "vehicle-b" },
    { ...baseRecord, id: "c", maintenanceDate: "2026-09-12", garageId: "garage-b" },
    { ...baseRecord, id: "d", maintenanceDate: "2026-08-01" },
  ];
  assert.deepEqual(filterVehicleMaintenanceRecords(rows, "2026-09-01", "2026-09-30", "vehicle-a", "garage-a").map((row) => row.id), ["maintenance-a"]);
  assert.equal(filterVehicleMaintenanceRecords(rows, "2026-09-01", "2026-09-30").length, 3);
  assert.equal(filterVehicleMaintenanceRecords(rows, "", "").length, 4);
});

test("Maintenance archive filters genuine snapshots and authoritative states", () => {
  const rows = [
    baseRecord,
    { ...baseRecord, id: "partial", vehicleNumberSnapshot: "TRUCK-2", totalPaid: 2000, outstandingAmount: 6000, paymentState: "partially_paid" as const, isLocked: true },
    { ...baseRecord, id: "paid", garageNameSnapshot: "Metro Garage", totalPaid: 8000, outstandingAmount: 0, paymentState: "paid" as const, isLocked: true },
    { ...baseRecord, id: "void", workDescription: "Brake repair", status: "void" as const, outstandingAmount: 0 },
  ];
  assert.deepEqual(filterVehicleMaintenanceRecords(rows, "2026-09-01", "2026-09-30", "", "", "partially_paid", "truck-2").map((row) => row.id), ["partial"]);
  assert.deepEqual(filterVehicleMaintenanceRecords(rows, "2026-09-01", "2026-09-30", "", "", "paid", "metro").map((row) => row.id), ["paid"]);
  assert.deepEqual(filterVehicleMaintenanceRecords(rows, "2026-09-01", "2026-09-30", "", "", "void", "brake").map((row) => row.id), ["void"]);
  assert.deepEqual(filterVehicleMaintenanceRecords(rows, "2026-09-01", "2026-09-30", "", "", "unpaid", "rahman").map((row) => row.id), ["maintenance-a"]);
});

test("Garage Payment archive filters persisted payment and allocation snapshots", () => {
  const rows: VehicleMaintenanceBatchPayment[] = [
    baseBatchPayment,
    {
      ...baseBatchPayment,
      id: "payment-b",
      garageId: "garage-b",
      garageNameSnapshot: "Metro Motors",
      vehicleIds: ["vehicle-b"],
      paymentDate: "2026-09-14",
      paymentMode: "cash",
      note: null,
      createdAt: "2026-09-14T09:00:00Z",
      allocations: [{
        ...baseBatchPayment.allocations[0],
        maintenanceId: "maintenance-b",
        vehicleId: "vehicle-b",
        vehicleNumberSnapshot: "TRUCK-2",
        workDescription: "Brake repair",
      }],
    },
    {
      ...baseBatchPayment,
      id: "payment-c",
      paymentDate: "2026-09-14",
      createdAt: "2026-09-14T11:00:00Z",
    },
  ];

  assert.deepEqual(filterVehicleMaintenanceBatchPayments(
    rows, "", "", "", "", "", "tyre",
  ).map((payment) => payment.id), ["payment-c", "payment-a"]);
  assert.deepEqual(filterVehicleMaintenanceBatchPayments(
    rows, "2026-09-14", "2026-09-14", "garage-b", "vehicle-b", "cash", "brake",
  ).map((payment) => payment.id), ["payment-b"]);
  assert.deepEqual(filterVehicleMaintenanceBatchPayments(
    rows, "", "", "", "", "", "truck-2",
  ).map((payment) => payment.id), ["payment-b"]);
  assert.deepEqual(filterVehicleMaintenanceBatchPayments(
    rows, "", "", "", "", "", "metro motors",
  ).map((payment) => payment.id), ["payment-b"]);
  assert.deepEqual(filterVehicleMaintenanceBatchPayments(
    rows, "", "", "", "", "", "final tyre payment",
  ).map((payment) => payment.id), ["payment-c", "payment-a"]);
  assert.deepEqual(filterVehicleMaintenanceBatchPayments(
    rows, "2026-09-15", "2026-09-14",
  ), []);
});

test("Garage Payment reconciliation uses exact persisted allocation amounts", () => {
  assert.deepEqual(getVehicleMaintenancePaymentAllocationReconciliation(baseBatchPayment), {
    allocatedAmount: 3000,
    remainingAmount: 0,
    reconciles: true,
  });
  assert.deepEqual(getVehicleMaintenancePaymentAllocationReconciliation({
    ...baseBatchPayment,
    amount: 3500,
  }), {
    allocatedAmount: 3000,
    remainingAmount: 500,
    reconciles: false,
  });
});

test("history summary excludes void jobs and derives billed, paid, and outstanding", () => {
  assert.deepEqual(summarizeVehicleMaintenance([
    { ...baseRecord, totalPaid: 5000, outstandingAmount: 3000 },
    { ...baseRecord, id: "void", status: "void", outstandingAmount: 0 },
  ]), { totalBilled: 8000, totalPaid: 5000, totalOutstanding: 3000, activeJobs: 1 });
});

test("only unpaid active Maintenance can be corrected or voided", () => {
  assert.equal(canChangeVehicleMaintenance(baseRecord), true);
  assert.equal(canChangeVehicleMaintenance({ ...baseRecord, totalPaid: 1, isLocked: true }), false);
  assert.equal(canChangeVehicleMaintenance({ ...baseRecord, status: "void" }), false);
});
