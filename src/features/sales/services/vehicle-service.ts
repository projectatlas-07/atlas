import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { Vehicle } from "../types.ts";

const VEHICLE_COLUMNS =
  "id, factory_id, vehicle_number, normalized_vehicle_number, delivery_wage_tracking_enabled, is_active, created_at, updated_at";

type VehicleRow = {
  id: string;
  factory_id: string;
  vehicle_number: string;
  normalized_vehicle_number: string;
  delivery_wage_tracking_enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export class VehicleServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableVehicleError(error));
    this.name = "VehicleServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableVehicleError(error: PostgrestError): string {
  if (error.code === "P3102") return "Vehicle does not belong to this factory.";
  if (error.code === "P3103") return "This Vehicle is already archived.";
  if (error.code === "P3104") return "This Vehicle is already active.";
  if (error.code === "P3105") return "This Vehicle is archived. Restore it before use.";
  if (error.code === "22023" || error.code === "23514") {
    return "Enter a valid Vehicle number using letters, numbers, spaces, or hyphens.";
  }
  return error.message;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function normalizeVehicleInput(value: string): string {
  const displayNumber = value.trim().replace(/\s+/g, " ").toUpperCase();
  const normalizedNumber = displayNumber.replace(/\s+/g, "");
  if (!normalizedNumber || normalizedNumber.length > 32
    || !/^[A-Z0-9-]+$/.test(normalizedNumber)) {
    throw new Error("Vehicle number must use only letters, numbers, spaces, or hyphens.");
  }
  return displayNumber;
}

function mapVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    factoryId: row.factory_id,
    vehicleNumber: row.vehicle_number,
    normalizedVehicleNumber: row.normalized_vehicle_number,
    deliveryWageTrackingEnabled: row.delivery_wage_tracking_enabled,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listVehicles(
  factoryId: string,
  includeArchived = false,
): Promise<Vehicle[]> {
  requireId(factoryId, "factoryId");
  let query = supabase
    .from("vehicles")
    .select(VEHICLE_COLUMNS)
    .eq("factory_id", factoryId);
  if (!includeArchived) query = query.eq("is_active", true);
  const { data, error } = await query
    .order("normalized_vehicle_number", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new VehicleServiceError(error);
  return (data ?? []).map(mapVehicle);
}

export async function findOrCreateVehicle(input: Readonly<{
  factoryId: string;
  vehicleNumber: string;
  deliveryWageTrackingEnabled: boolean;
}>): Promise<Vehicle> {
  requireId(input.factoryId, "factoryId");
  const { data, error } = await supabase.rpc("find_or_create_vehicle", {
    p_factory_id: input.factoryId,
    p_vehicle_number: normalizeVehicleInput(input.vehicleNumber),
    p_delivery_wage_tracking_enabled: input.deliveryWageTrackingEnabled,
  });

  if (error) throw new VehicleServiceError(error);
  if (!data) throw new Error("find_or_create_vehicle returned no Vehicle.");
  return mapVehicle(data);
}

export async function setVehicleDeliveryWageTracking(input: Readonly<{
  factoryId: string;
  vehicleId: string;
  enabled: boolean;
}>): Promise<Vehicle> {
  requireId(input.factoryId, "factoryId");
  requireId(input.vehicleId, "vehicleId");
  const { data, error } = await supabase.rpc("set_vehicle_delivery_wage_tracking", {
    p_factory_id: input.factoryId,
    p_vehicle_id: input.vehicleId,
    p_enabled: input.enabled,
  });
  if (error) throw new VehicleServiceError(error);
  if (!data) throw new Error("set_vehicle_delivery_wage_tracking returned no Vehicle.");
  return mapVehicle(data);
}

async function changeVehicleLifecycle(
  functionName: "archive_vehicle" | "restore_vehicle",
  factoryId: string,
  vehicleId: string,
): Promise<Vehicle> {
  requireId(factoryId, "factoryId");
  requireId(vehicleId, "vehicleId");
  const { data, error } = await supabase.rpc(functionName, {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw new VehicleServiceError(error);
  if (!data) throw new Error(`${functionName} returned no Vehicle.`);
  return mapVehicle(data);
}

export function archiveVehicle(factoryId: string, vehicleId: string): Promise<Vehicle> {
  return changeVehicleLifecycle("archive_vehicle", factoryId, vehicleId);
}

export function restoreVehicle(factoryId: string, vehicleId: string): Promise<Vehicle> {
  return changeVehicleLifecycle("restore_vehicle", factoryId, vehicleId);
}
