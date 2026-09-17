import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { isLocalDate } from "../../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../../sales/types.ts";
import type {
  CreateVehicleMaintenanceBatchPaymentInput,
  CreateVehicleMaintenanceInput,
  CreateVehicleMaintenancePaymentInput,
  UpdateVehicleMaintenanceInput,
  VehicleMaintenanceBatchPayment,
  VehicleMaintenancePayment,
  VehicleMaintenanceRecord,
} from "../types.ts";

type MaintenanceRow = {
  id: string; factory_id: string; maintenance_date: string;
  vehicle_id: string; vehicle_number_snapshot: string;
  garage_id: string; garage_name_snapshot: string;
  garage_address_snapshot: string | null; garage_mobile_snapshot: string | null;
  work_description: string; total_amount: number | string;
  status: "active" | "void"; is_locked: boolean;
  total_paid: number | string; outstanding_amount: number | string;
  payment_state: "unpaid" | "partially_paid" | "paid";
  voided_at: string | null; created_at: string; updated_at: string;
};

type MaintenancePaymentRow = {
  payment_id: string; factory_id: string; maintenance_id: string;
  vehicle_id: string; vehicle_number_snapshot: string;
  garage_id: string; garage_name_snapshot: string;
  payment_date: string; amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null; created_at: string;
};

type MaintenanceBatchPaymentRow = {
  payment_id: string; factory_id: string;
  garage_id: string; garage_name_snapshot: string;
  vehicle_ids: string[]; allocation_count: number | string;
  allocations: Array<{
    maintenance_id: string; maintenance_date: string;
    vehicle_id: string; vehicle_number_snapshot: string;
    work_description: string; allocated_amount: number | string;
  }>;
  payment_date: string; amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null; created_at: string;
};

export class VehicleMaintenanceServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(readableError(error));
    this.name = "VehicleMaintenanceServiceError";
    this.code = error.code;
  }
}

export async function listVehicleMaintenanceRecords(
  factoryId: string,
  vehicleId: string | null = null,
  garageId: string | null = null,
): Promise<VehicleMaintenanceRecord[]> {
  requireId(factoryId, "factoryId");
  if (vehicleId !== null) requireId(vehicleId, "vehicleId");
  if (garageId !== null) requireId(garageId, "garageId");
  const { data, error } = await supabase.rpc("list_vehicle_maintenance_records", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
    p_garage_id: garageId,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  return ((data ?? []) as MaintenanceRow[]).map(mapRecord);
}

export async function createVehicleMaintenance(
  input: CreateVehicleMaintenanceInput,
): Promise<VehicleMaintenanceRecord> {
  validateRecordInput(input);
  const { data, error } = await supabase.rpc("create_vehicle_maintenance", {
    p_factory_id: input.factoryId,
    p_maintenance_date: input.maintenanceDate,
    p_vehicle_id: input.vehicleId,
    p_garage_id: input.garageId,
    p_work_description: normalizeText(input.workDescription),
    p_total_amount: input.totalAmount,
    p_initial_paid_amount: input.initialPaidAmount,
    p_initial_payment_mode: input.initialPaymentMode,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("create_vehicle_maintenance returned no record.");
  return mapRecord(row);
}

export async function updateVehicleMaintenance(
  input: UpdateVehicleMaintenanceInput,
): Promise<VehicleMaintenanceRecord> {
  requireId(input.maintenanceId, "maintenanceId");
  validateRecordInput({ ...input, initialPaidAmount: 0, initialPaymentMode: null });
  const { data, error } = await supabase.rpc("update_vehicle_maintenance", {
    p_factory_id: input.factoryId,
    p_maintenance_id: input.maintenanceId,
    p_maintenance_date: input.maintenanceDate,
    p_vehicle_id: input.vehicleId,
    p_garage_id: input.garageId,
    p_work_description: normalizeText(input.workDescription),
    p_total_amount: input.totalAmount,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("update_vehicle_maintenance returned no record.");
  return mapRecord(row);
}

export async function voidVehicleMaintenance(
  factoryId: string,
  maintenanceId: string,
): Promise<VehicleMaintenanceRecord> {
  requireId(factoryId, "factoryId");
  requireId(maintenanceId, "maintenanceId");
  const { data, error } = await supabase.rpc("void_vehicle_maintenance", {
    p_factory_id: factoryId,
    p_maintenance_id: maintenanceId,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("void_vehicle_maintenance returned no record.");
  return mapRecord(row);
}

export async function createVehicleMaintenancePayment(
  input: CreateVehicleMaintenancePaymentInput,
): Promise<string> {
  requireId(input.factoryId, "factoryId");
  requireId(input.maintenanceId, "maintenanceId");
  if (!isLocalDate(input.paymentDate)) throw new Error("Choose a valid payment date.");
  assertMoney(input.amount, "Payment amount", false);
  if (!isNewCustomerPaymentMode(input.paymentMode)) throw new Error("Choose a payment mode.");
  const note = normalizeOptionalText(input.note);
  const { data, error } = await supabase.rpc("create_vehicle_maintenance_payment", {
    p_factory_id: input.factoryId,
    p_maintenance_id: input.maintenanceId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: note,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  if (!data?.id) throw new Error("create_vehicle_maintenance_payment returned no payment.");
  return data.id;
}

export async function createVehicleMaintenanceBatchPayment(
  input: CreateVehicleMaintenanceBatchPaymentInput,
): Promise<string> {
  requireId(input.factoryId, "factoryId");
  requireId(input.garageId, "garageId");
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.fromDate > input.toDate) {
    throw new Error("Choose a valid inclusive Maintenance date range.");
  }
  if (!isLocalDate(input.paymentDate)) throw new Error("Choose a valid payment date.");
  assertMoney(input.amount, "Payment amount", false);
  if (!isNewCustomerPaymentMode(input.paymentMode)) throw new Error("Choose a payment mode.");
  const { data, error } = await supabase.rpc("create_vehicle_maintenance_batch_payment", {
    p_factory_id: input.factoryId,
    p_garage_id: input.garageId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: normalizeOptionalText(input.note),
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  if (!data?.id) throw new Error("create_vehicle_maintenance_batch_payment returned no payment.");
  return data.id;
}

export async function listVehicleMaintenancePayments(
  factoryId: string,
  vehicleId: string | null = null,
  garageId: string | null = null,
): Promise<VehicleMaintenancePayment[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase.rpc("list_vehicle_maintenance_payments", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
    p_garage_id: garageId,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  return ((data ?? []) as MaintenancePaymentRow[]).map((row) => ({
    id: row.payment_id,
    factoryId: row.factory_id,
    maintenanceId: row.maintenance_id,
    vehicleId: row.vehicle_id,
    vehicleNumberSnapshot: row.vehicle_number_snapshot,
    garageId: row.garage_id,
    garageNameSnapshot: row.garage_name_snapshot,
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export async function listVehicleMaintenanceBatchPayments(
  factoryId: string,
  garageId: string | null = null,
): Promise<VehicleMaintenanceBatchPayment[]> {
  requireId(factoryId, "factoryId");
  if (garageId !== null) requireId(garageId, "garageId");
  const { data, error } = await supabase.rpc("list_vehicle_maintenance_batch_payments", {
    p_factory_id: factoryId,
    p_garage_id: garageId,
  });
  if (error) throw new VehicleMaintenanceServiceError(error);
  return ((data ?? []) as MaintenanceBatchPaymentRow[]).map((row) => ({
    id: row.payment_id,
    factoryId: row.factory_id,
    garageId: row.garage_id,
    garageNameSnapshot: row.garage_name_snapshot,
    vehicleIds: row.vehicle_ids,
    allocationCount: Number(row.allocation_count),
    allocations: row.allocations.map((allocation) => ({
      maintenanceId: allocation.maintenance_id,
      maintenanceDate: allocation.maintenance_date,
      vehicleId: allocation.vehicle_id,
      vehicleNumberSnapshot: allocation.vehicle_number_snapshot,
      workDescription: allocation.work_description,
      allocatedAmount: Number(allocation.allocated_amount),
    })),
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    note: row.note,
    createdAt: row.created_at,
  }));
}

function validateRecordInput(input: CreateVehicleMaintenanceInput): void {
  requireId(input.factoryId, "factoryId");
  requireId(input.vehicleId, "vehicleId");
  requireId(input.garageId, "garageId");
  if (!isLocalDate(input.maintenanceDate)) throw new Error("Choose a valid Maintenance date.");
  const work = normalizeText(input.workDescription);
  if (!work || work.length > 300) throw new Error("Work / Repair must be between 1 and 300 characters.");
  assertMoney(input.totalAmount, "Maintenance amount", false);
  assertMoney(input.initialPaidAmount, "Initial Paid", true);
  if (input.initialPaidAmount > input.totalAmount) throw new Error("Initial Paid cannot exceed Maintenance amount.");
  if (input.initialPaidAmount > 0 && !input.initialPaymentMode) throw new Error("Choose a payment mode.");
}

function mapRecord(row: MaintenanceRow): VehicleMaintenanceRecord {
  return {
    id: row.id, factoryId: row.factory_id, maintenanceDate: row.maintenance_date,
    vehicleId: row.vehicle_id, vehicleNumberSnapshot: row.vehicle_number_snapshot,
    garageId: row.garage_id, garageNameSnapshot: row.garage_name_snapshot,
    garageAddressSnapshot: row.garage_address_snapshot,
    garageMobileSnapshot: row.garage_mobile_snapshot,
    workDescription: row.work_description, totalAmount: Number(row.total_amount),
    status: row.status, isLocked: row.is_locked, totalPaid: Number(row.total_paid),
    outstandingAmount: Number(row.outstanding_amount), paymentState: row.payment_state,
    voidedAt: row.voided_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function readableError(error: PostgrestError): string {
  if (error.code === "P4301") return "Vehicle does not belong to this factory.";
  if (error.code === "P4302") return "Archived Vehicles cannot receive new Maintenance. Restore the Vehicle first.";
  if (error.code === "P4303") return "Garage does not belong to this factory.";
  if (error.code === "P4304") return "Vehicle Maintenance does not belong to this factory.";
  if (error.code === "P4305") return "Vehicle Maintenance can only change through its dedicated controls.";
  if (error.code === "P4310") return "Payment exceeds the current outstanding Maintenance dues for this Garage and date range.";
  if (error.code === "P4104") return "Paid or partially-paid Maintenance is financially locked.";
  if (error.code === "P4105") return "Payment exceeds the outstanding Maintenance amount.";
  if (error.code === "P3200") return "Choose a supported payment mode.";
  if (error.code === "22023" || error.code === "23514") return "Check the date, work description, and amounts.";
  return error.message;
}

function assertMoney(value: number, label: string, allowZero: boolean): void {
  if (!Number.isFinite(value) || (!allowZero && value <= 0) || value < 0
    || value >= 10_000_000_000_000_000 || Math.round(value * 100) !== value * 100) {
    throw new Error(`${label} must ${allowZero ? "be non-negative" : "be positive"} and use at most two decimal places.`);
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = normalizeText(value ?? "");
  return normalized || null;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}
