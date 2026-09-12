import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { assertFactoryId } from "../../../lib/business-date-contract.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";
import {
  sortVehicleTripsNewestFirst,
  type VehicleTrip,
} from "../vehicle-trip-model.ts";

const VEHICLE_TRIP_COLUMNS =
  "id, challan_number, challan_date, created_at, vehicle_id, vehicle_number_snapshot, customer_name_snapshot, customer_address_snapshot, delivery_wage_applicable_snapshot, trip_labour_wage";

type VehicleTripRow = {
  id: string;
  challan_number: string | null;
  challan_date: string;
  created_at: string;
  vehicle_id: string;
  vehicle_number_snapshot: string;
  customer_name_snapshot: string;
  customer_address_snapshot: string;
  delivery_wage_applicable_snapshot: boolean;
  trip_labour_wage: number | string | null;
};

export class VehicleTripServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "VehicleTripServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function listVehicleTrips(factoryId: string): Promise<VehicleTrip[]> {
  assertFactoryId(factoryId);
  const rows = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase
      .from("challans")
      .select(VEHICLE_TRIP_COLUMNS)
      .eq("factory_id", factoryId)
      .eq("status", "active")
      .not("vehicle_id", "is", null)
      .not("vehicle_number_snapshot", "is", null)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new VehicleTripServiceError(error);
    return (data ?? []) as VehicleTripRow[];
  });

  return sortVehicleTripsNewestFirst(rows.map(mapVehicleTrip));
}

function mapVehicleTrip(row: VehicleTripRow): VehicleTrip {
  return {
    challanId: row.id,
    challanNumber: row.challan_number === null ? null : String(row.challan_number),
    challanDate: row.challan_date,
    createdAt: row.created_at,
    vehicleId: row.vehicle_id,
    vehicleNumberSnapshot: row.vehicle_number_snapshot,
    customerNameSnapshot: row.customer_name_snapshot,
    destinationSnapshot: row.customer_address_snapshot,
    deliveryWageApplicableSnapshot: row.delivery_wage_applicable_snapshot,
    tripLabourWage: row.trip_labour_wage === null
      ? null
      : parseMoney(row.trip_labour_wage),
  };
}

function parseMoney(value: number | string): number {
  const amount = Number(value);
  const paise = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(paise)
    || Math.abs(amount * 100 - paise) >= 1e-7 || amount <= 0) {
    throw new Error("Vehicle trip returned an invalid historical wage snapshot.");
  }
  return paise / 100;
}
