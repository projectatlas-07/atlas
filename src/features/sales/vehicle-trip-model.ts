import type { ChallanNumber, Vehicle } from "./types.ts";

export type VehicleTrip = {
  challanId: string;
  challanNumber: ChallanNumber;
  challanDate: string;
  createdAt: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  customerNameSnapshot: string;
  destinationSnapshot: string;
  deliveryWageApplicableSnapshot: boolean;
  tripLabourWage: number | null;
};

export type VehicleTripHistory = {
  vehicleId: string;
  vehicleNumber: string;
  isActive: boolean;
  deliveryWageTrackingEnabled: boolean;
  tripCount: number;
  trips: VehicleTrip[];
};

export function sortVehicleTripsNewestFirst(
  trips: readonly VehicleTrip[],
): VehicleTrip[] {
  return [...trips].sort((left, right) =>
    right.challanDate.localeCompare(left.challanDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.challanId.localeCompare(left.challanId));
}

export function buildVehicleTripHistories(
  vehicles: readonly Vehicle[],
  trips: readonly VehicleTrip[],
): VehicleTripHistory[] {
  const histories = new Map<string, VehicleTripHistory>();
  for (const vehicle of vehicles) {
    histories.set(vehicle.id, {
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      isActive: vehicle.isActive,
      deliveryWageTrackingEnabled: vehicle.deliveryWageTrackingEnabled,
      tripCount: 0,
      trips: [],
    });
  }

  for (const trip of trips) {
    let history = histories.get(trip.vehicleId);
    if (!history) {
      history = {
        vehicleId: trip.vehicleId,
        vehicleNumber: trip.vehicleNumberSnapshot,
        isActive: false,
        deliveryWageTrackingEnabled: false,
        tripCount: 0,
        trips: [],
      };
      histories.set(trip.vehicleId, history);
    }
    history.trips.push(trip);
  }

  for (const history of histories.values()) {
    history.trips = sortVehicleTripsNewestFirst(history.trips);
    history.tripCount = history.trips.length;
  }

  return [...histories.values()].sort((left, right) =>
    Number(right.tripCount > 0) - Number(left.tripCount > 0)
      || left.vehicleNumber.localeCompare(right.vehicleNumber, "en-IN")
      || left.vehicleId.localeCompare(right.vehicleId));
}
