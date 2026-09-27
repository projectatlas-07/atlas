import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  VehicleWageAccountSummary,
  VehicleWagePayment,
} from "../sales/vehicle-wage-model.ts";
import { buildVehicleWageAccounts } from "../sales/vehicle-wage-model.ts";
import type { Vehicle } from "../sales/types.ts";
import {
  filterVehicleWageOverviewAccounts,
  formatVehicleWageLastPaid,
  latestEffectiveVehicleWagePayment,
} from "./vehicle-wage-overview-model.ts";

const accounts: VehicleWageAccountSummary[] = [
  {
    vehicleId: "active-a",
    vehicleNumber: "WB12AB1234",
    isActive: true,
    deliveryWageTrackingEnabled: true,
    earnedAmount: 500,
    qualifyingTripCount: 2,
    trips: [],
  },
  {
    vehicleId: "archived-b",
    vehicleNumber: "WB99ZZ9999",
    isActive: false,
    deliveryWageTrackingEnabled: false,
    earnedAmount: 0,
    qualifyingTripCount: 0,
    trips: [],
  },
];

test("overview filters by lifecycle and vehicle number without changing account values", () => {
  assert.deepEqual(filterVehicleWageOverviewAccounts({
    accounts,
    lifecycle: "active",
    search: "12ab",
  }).map((account) => account.vehicleId), ["active-a"]);
  assert.deepEqual(filterVehicleWageOverviewAccounts({
    accounts,
    lifecycle: "archived",
    search: "",
  }).map((account) => account.vehicleId), ["archived-b"]);
  assert.equal(accounts[0]?.earnedAmount, 500);
});

test("WB99AB9876 keeps its archived master identity when it sorts to the final archived row", () => {
  const archivedVehicles: Vehicle[] = [
    {
      id: "40d0547f-e54a-4e9b-9d00-0a542a30622f",
      factoryId: "factory-a",
      vehicleNumber: "VW26EC4D98AFFM",
      normalizedVehicleNumber: "VW26EC4D98AFFM",
      deliveryWageTrackingEnabled: true,
      isActive: false,
      createdAt: "2026-09-01T14:45:49.935798Z",
      updatedAt: "2026-09-27T15:29:47.572465Z",
    },
    {
      id: "78fbce51-23e2-4194-b72b-27748650975b",
      factoryId: "factory-a",
      vehicleNumber: "WB99AB9876",
      normalizedVehicleNumber: "WB99AB9876",
      deliveryWageTrackingEnabled: true,
      isActive: false,
      createdAt: "2026-09-01T10:15:27.506308Z",
      updatedAt: "2026-09-01T11:02:46.537203Z",
    },
  ];
  const visible = filterVehicleWageOverviewAccounts({
    accounts: buildVehicleWageAccounts(archivedVehicles, []),
    lifecycle: "archived",
    search: "",
  });

  assert.deepEqual(visible.map((account) => account.vehicleNumber), [
    "VW26EC4D98AFFM",
    "WB99AB9876",
  ]);
  assert.deepEqual(visible.at(-1), {
    vehicleId: "78fbce51-23e2-4194-b72b-27748650975b",
    vehicleNumber: "WB99AB9876",
    isActive: false,
    deliveryWageTrackingEnabled: true,
    earnedAmount: 0,
    qualifyingTripCount: 0,
    trips: [],
  });
});

test("Last Paid ignores fully reversed payments and keeps immutable history intact", () => {
  const payments: VehicleWagePayment[] = [
    {
      id: "new-reversed",
      factoryId: "factory-a",
      vehicleId: "active-a",
      paymentDate: "2026-09-25",
      amount: 300,
      note: null,
      createdAt: "2026-09-25T10:00:00Z",
      createdBy: "user-a",
      reversal: {
        id: "reversal-a",
        factoryId: "factory-a",
        paymentId: "new-reversed",
        reversalDate: "2026-09-26",
        reason: "Wrong amount",
        createdAt: "2026-09-26T10:00:00Z",
        createdBy: "user-a",
      },
    },
    {
      id: "effective",
      factoryId: "factory-a",
      vehicleId: "active-a",
      paymentDate: "2026-09-20",
      amount: 200,
      note: null,
      createdAt: "2026-09-20T10:00:00Z",
      createdBy: "user-a",
      reversal: null,
    },
  ];
  assert.equal(latestEffectiveVehicleWagePayment(payments)?.id, "effective");
  assert.equal(payments.length, 2);
});

test("Last Paid uses business dates and clear empty history copy", () => {
  assert.equal(formatVehicleWageLastPaid(null, "2026-09-27"), "No payments yet");
  assert.equal(formatVehicleWageLastPaid("2026-09-27", "2026-09-27"), "Paid today");
  assert.equal(formatVehicleWageLastPaid("2026-09-22", "2026-09-27"), "Last paid 5 days ago");
  assert.equal(formatVehicleWageLastPaid("2026-07-01", "2026-09-27"), "Last paid 01/07/2026");
});
