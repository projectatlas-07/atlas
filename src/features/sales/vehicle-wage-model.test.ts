import assert from "node:assert/strict";
import { test } from "node:test";
import type { Vehicle } from "./types.ts";
import {
  applyVehicleWagePaymentReversal,
  buildVehicleWageAccounts,
  buildVehicleWagePaymentInput,
  buildVehicleWagePaymentReversalInput,
  getEligibleVehicleWageTrips,
  insertVehicleWagePaymentNewestFirst,
  resolveVehicleWageDateRange,
  summarizeVehicleWageRange,
  type VehicleWageChallanSnapshot,
} from "./vehicle-wage-model.ts";

const vehicleA: Vehicle = {
  id: "vehicle-a",
  factoryId: "factory-a",
  vehicleNumber: "WB12AB1234",
  normalizedVehicleNumber: "WB12AB1234",
  deliveryWageTrackingEnabled: true,
  isActive: true,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};
const vehicleB: Vehicle = {
  ...vehicleA,
  id: "vehicle-b",
  vehicleNumber: "WB12CD5678",
  normalizedVehicleNumber: "WB12CD5678",
};

function snapshot(
  challanId: string,
  vehicle: Vehicle,
  challanDate: string,
  tripLabourWage: number | null,
  overrides: Partial<VehicleWageChallanSnapshot> = {},
): VehicleWageChallanSnapshot {
  return {
    challanId,
    challanNumber: Number(challanId.replace(/\D/g, "")) || 1,
    challanDate,
    vehicleId: vehicle.id,
    vehicleNumberSnapshot: vehicle.vehicleNumber,
    deliveryWageApplicableSnapshot: true,
    tripLabourWage,
    status: "active",
    ...overrides,
  };
}

test("Vehicle A earns ₹1,250 from two active Challan snapshots", () => {
  const trips = getEligibleVehicleWageTrips([
    snapshot("challan-101", vehicleA, "2026-09-01", 750),
    snapshot("challan-108", vehicleA, "2026-09-02", 500),
  ]);
  const [account] = buildVehicleWageAccounts([vehicleA], trips);
  assert.equal(account.earnedAmount, 1250);
  assert.equal(account.qualifyingTripCount, 2);
  assert.deepEqual(account.trips.map((trip) => trip.challanNumber), [108, 101]);
});

test("multiple Vehicles remain separate accounts without line-join multiplication", () => {
  const trips = getEligibleVehicleWageTrips([
    snapshot("challan-101", vehicleA, "2026-09-01", 750),
    snapshot("challan-108", vehicleA, "2026-09-02", 500),
    snapshot("challan-114", vehicleB, "2026-09-03", 1200),
  ]);
  const accounts = buildVehicleWageAccounts([vehicleA, vehicleB], trips);
  assert.equal(accounts.find((account) => account.vehicleId === vehicleA.id)?.earnedAmount, 1250);
  assert.equal(accounts.find((account) => account.vehicleId === vehicleB.id)?.earnedAmount, 1200);
  assert.deepEqual(summarizeVehicleWageRange(accounts), {
    earnedAmount: 2450,
    qualifyingTripCount: 3,
    vehicleCountWithEarnings: 2,
  });
});

test("void trip preserves its stored ₹500 snapshot but contributes zero exposure", () => {
  const active = snapshot("challan-101", vehicleA, "2026-09-01", 750);
  const voidSnapshot = snapshot("challan-108", vehicleA, "2026-09-02", 500, {
    status: "void",
  });
  const sources = [active, voidSnapshot];
  const [account] = buildVehicleWageAccounts(
    [vehicleA],
    getEligibleVehicleWageTrips(sources),
  );
  assert.equal(sources[1].tripLabourWage, 500);
  assert.equal(account.earnedAmount, 750);
  assert.equal(account.qualifyingTripCount, 1);
});

test("tracking OFF and archived master state do not erase historical earned trips", () => {
  const historicalTrips = getEligibleVehicleWageTrips([
    snapshot("challan-101", vehicleA, "2026-09-01", 750),
  ]);
  const nowOffAndArchived = {
    ...vehicleA,
    deliveryWageTrackingEnabled: false,
    isActive: false,
  };
  const [account] = buildVehicleWageAccounts([nowOffAndArchived], historicalTrips);
  assert.equal(account.earnedAmount, 750);
  assert.equal(account.deliveryWageTrackingEnabled, false);
  assert.equal(account.isActive, false);
  assert.equal(account.vehicleNumber, "WB12AB1234");
});

test("date ranges support one day, current week, and arbitrary inclusive dates", () => {
  assert.deepEqual(resolveVehicleWageDateRange("today", "2026-09-12"), {
    fromDate: "2026-09-12",
    toDate: "2026-09-12",
  });
  assert.deepEqual(resolveVehicleWageDateRange("week", "2026-09-12"), {
    fromDate: "2026-09-07",
    toDate: "2026-09-12",
  });
  assert.deepEqual(resolveVehicleWageDateRange(
    "custom",
    "2026-09-12",
    "2026-09-01",
    "2026-09-05",
  ), { fromDate: "2026-09-01", toDate: "2026-09-05" });
  assert.deepEqual(resolveVehicleWageDateRange(
    "custom",
    "2026-09-12",
    "2026-09-12",
    "2026-09-12",
  ), { fromDate: "2026-09-12", toDate: "2026-09-12" });
});

test("no-Vehicle, Tracking-OFF, NULL, zero, and invalid precision rows earn nothing", () => {
  const ineligible = [
    snapshot("challan-1", vehicleA, "2026-09-01", 750, {
      vehicleId: null,
      vehicleNumberSnapshot: null,
      deliveryWageApplicableSnapshot: false,
      tripLabourWage: null,
    }),
    snapshot("challan-2", vehicleA, "2026-09-01", null, {
      deliveryWageApplicableSnapshot: false,
    }),
    snapshot("challan-3", vehicleA, "2026-09-01", 0),
    snapshot("challan-4", vehicleA, "2026-09-01", 10.001),
  ];
  assert.deepEqual(getEligibleVehicleWageTrips(ineligible), []);
  const [zeroAccount] = buildVehicleWageAccounts([vehicleA], []);
  assert.equal(zeroAccount.earnedAmount, 0);
  assert.equal(zeroAccount.qualifyingTripCount, 0);
});

test("money aggregation uses integer paise and never drifts", () => {
  const trips = getEligibleVehicleWageTrips([
    snapshot("challan-1", vehicleA, "2026-09-01", 750.1),
    snapshot("challan-2", vehicleA, "2026-09-02", 500.2),
  ]);
  const [account] = buildVehicleWageAccounts([vehicleA], trips);
  assert.equal(account.earnedAmount, 1250.3);
});

test("customer revenue and later payment state cannot alter Challan-derived Vehicle wage", () => {
  const sourceWithUnrelatedCustomerFinancials = {
    ...snapshot("challan-101", vehicleA, "2026-09-01", 750),
    brickRevenue: 100_000,
    otherRevenue: 2_000,
    challanTotal: 102_000,
    customerPaidAmount: 60_000,
    customerOutstandingAmount: 42_000,
  };
  const [account] = buildVehicleWageAccounts(
    [vehicleA],
    getEligibleVehicleWageTrips([sourceWithUnrelatedCustomerFinancials]),
  );
  assert.equal(account.earnedAmount, 750);
});

test("a duplicated Challan source fails closed instead of multiplying one trip", () => {
  const source = snapshot("challan-101", vehicleA, "2026-09-01", 750);
  assert.throws(
    () => getEligibleVehicleWageTrips([source, { ...source }]),
    /duplicated Challan #101/,
  );
});

test("V2 payment input accepts exact paise and normalizes an optional note", () => {
  assert.deepEqual(buildVehicleWagePaymentInput(
    "factory-a", "vehicle-a", "2026-09-01", "800.50", "  Weekly   payment  ",
  ), {
    factoryId: "factory-a",
    vehicleId: "vehicle-a",
    paymentDate: "2026-09-01",
    amount: 800.5,
    note: "Weekly payment",
  });
  for (const amount of ["", "0", "-1", "1.001", "NaN", "1000000000"]) {
    assert.equal(buildVehicleWagePaymentInput(
      "factory-a", "vehicle-a", "2026-09-01", amount, "",
    ), null);
  }
  assert.equal(buildVehicleWagePaymentInput(
    "factory-a", "vehicle-a", "2026-02-30", "1", "",
  ), null);
});

test("immutable payment history remains independent and newest-first", () => {
  const older = {
    id: "payment-a", factoryId: "factory-a", vehicleId: "vehicle-a",
    paymentDate: "2026-09-05", amount: 500, note: "Weekly payment",
    createdAt: "2026-09-05T10:00:00Z", createdBy: "user-a", reversal: null,
  };
  const newer = {
    ...older, id: "payment-b", paymentDate: "2026-09-12", amount: 750,
    note: null, createdAt: "2026-09-12T10:00:00Z",
  };
  assert.deepEqual(
    insertVehicleWagePaymentNewestFirst([older], newer).map((payment) => payment.id),
    ["payment-b", "payment-a"],
  );
});

test("V4 full-reversal input requires a non-backdated date and normalized reason", () => {
  assert.deepEqual(buildVehicleWagePaymentReversalInput(
    "factory-a", "payment-a", "2026-09-05", "2026-09-06", "  Wrong   amount  ",
  ), {
    factoryId: "factory-a",
    paymentId: "payment-a",
    reversalDate: "2026-09-06",
    reason: "Wrong amount",
  });
  for (const input of [
    { reversalDate: "2026-09-04", reason: "Backdated" },
    { reversalDate: "2026-02-30", reason: "Bad date" },
    { reversalDate: "2026-09-06", reason: "   " },
  ]) assert.equal(buildVehicleWagePaymentReversalInput(
    "factory-a", "payment-a", "2026-09-05", input.reversalDate, input.reason,
  ), null);
});

test("V4 applies one immutable reversal status without removing the payment", () => {
  const payment = {
    id: "payment-a", factoryId: "factory-a", vehicleId: "vehicle-a",
    paymentDate: "2026-09-05", amount: 1200, note: "Wrong amount",
    createdAt: "2026-09-05T10:00:00Z", createdBy: "user-a", reversal: null,
  };
  const [updated] = applyVehicleWagePaymentReversal([payment], {
    id: "reversal-a",
    factoryId: "factory-a",
    paymentId: "payment-a",
    vehicleId: "vehicle-a",
    reversalDate: "2026-09-06",
    amount: 1200,
    reason: "Incorrect amount",
    createdAt: "2026-09-06T10:00:00Z",
    createdBy: "user-a",
    totalEarned: 2000,
    totalPaid: 0,
    availableBalance: 2000,
  });
  assert.equal(updated.id, payment.id);
  assert.equal(updated.amount, 1200);
  assert.deepEqual(updated.reversal, {
    id: "reversal-a",
    factoryId: "factory-a",
    paymentId: "payment-a",
    reversalDate: "2026-09-06",
    reason: "Incorrect amount",
    createdAt: "2026-09-06T10:00:00Z",
    createdBy: "user-a",
  });
});
