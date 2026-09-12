import assert from "node:assert/strict";
import { test } from "node:test";
import type { Vehicle } from "./types.ts";
import {
  buildVehicleTripHistories,
  type VehicleTrip,
} from "./vehicle-trip-model.ts";

const wageOnVehicle: Vehicle = {
  id: "vehicle-on",
  factoryId: "factory-a",
  vehicleNumber: "CURRENT-ON",
  normalizedVehicleNumber: "CURRENT-ON",
  deliveryWageTrackingEnabled: true,
  isActive: true,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-11T00:00:00Z",
};

const wageOffVehicle: Vehicle = {
  ...wageOnVehicle,
  id: "vehicle-off",
  vehicleNumber: "CURRENT-OFF",
  normalizedVehicleNumber: "CURRENT-OFF",
  deliveryWageTrackingEnabled: false,
};

function trip(
  challanId: string,
  vehicleId: string,
  challanDate: string,
  overrides: Partial<VehicleTrip> = {},
): VehicleTrip {
  return {
    challanId,
    challanNumber: challanId,
    challanDate,
    createdAt: `${challanDate}T09:00:00Z`,
    vehicleId,
    vehicleNumberSnapshot: `HISTORICAL-${vehicleId}`,
    customerNameSnapshot: `Customer ${challanId}`,
    destinationSnapshot: `Destination ${challanId}`,
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 750,
    ...overrides,
  };
}

test("Wage ON and Wage OFF Vehicles each count and show all three recorded trips", () => {
  const trips = [
    trip("on-1", wageOnVehicle.id, "2026-09-01"),
    trip("on-2", wageOnVehicle.id, "2026-09-02"),
    trip("on-3", wageOnVehicle.id, "2026-09-03"),
    trip("off-1", wageOffVehicle.id, "2026-09-01", {
      deliveryWageApplicableSnapshot: false,
      tripLabourWage: null,
    }),
    trip("off-2", wageOffVehicle.id, "2026-09-02", {
      deliveryWageApplicableSnapshot: false,
      tripLabourWage: null,
    }),
    trip("off-3", wageOffVehicle.id, "2026-09-03", {
      deliveryWageApplicableSnapshot: false,
      tripLabourWage: null,
    }),
  ];
  const histories = buildVehicleTripHistories([wageOnVehicle, wageOffVehicle], trips);
  for (const vehicleId of [wageOnVehicle.id, wageOffVehicle.id]) {
    const history = histories.find((item) => item.vehicleId === vehicleId)!;
    assert.equal(history.tripCount, 3);
    assert.equal(history.trips.length, 3);
  }
  assert.deepEqual(
    histories.find((item) => item.vehicleId === wageOffVehicle.id)?.trips
      .map((item) => item.tripLabourWage),
    [null, null, null],
  );
});

test("trip history is newest first and count always equals displayed rows", () => {
  const sameDayOlder = trip("same-a", wageOnVehicle.id, "2026-09-10", {
    createdAt: "2026-09-10T08:00:00Z",
  });
  const sameDayNewer = trip("same-b", wageOnVehicle.id, "2026-09-10", {
    createdAt: "2026-09-10T10:00:00Z",
  });
  const [history] = buildVehicleTripHistories([wageOnVehicle], [
    trip("old", wageOnVehicle.id, "2026-09-01"),
    sameDayOlder,
    sameDayNewer,
  ]);
  assert.equal(history.tripCount, history.trips.length);
  assert.deepEqual(history.trips.map((item) => item.challanId), ["same-b", "same-a", "old"]);
});

test("current Vehicle changes and archive state cannot rewrite saved trip snapshots", () => {
  const archivedAndRenamed = {
    ...wageOnVehicle,
    vehicleNumber: "RENAMED-NOW",
    normalizedVehicleNumber: "RENAMED-NOW",
    deliveryWageTrackingEnabled: false,
    isActive: false,
  };
  const historical = trip("challan-a", wageOnVehicle.id, "2026-09-05", {
    challanNumber: null,
    vehicleNumberSnapshot: "ORIGINAL-VEHICLE",
    customerNameSnapshot: "Historical Customer",
    destinationSnapshot: "Historical Destination",
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 500,
  });
  const [history] = buildVehicleTripHistories([archivedAndRenamed], [historical]);
  assert.equal(history.vehicleNumber, "RENAMED-NOW");
  assert.equal(history.isActive, false);
  assert.equal(history.deliveryWageTrackingEnabled, false);
  assert.deepEqual(history.trips[0], historical);
  assert.equal(history.trips[0]?.challanNumber, null);
});
