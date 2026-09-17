import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { isLocalDate } from "../../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../../sales/types.ts";
import { isLocalTime } from "../vehicle-fuel-model.ts";
import type {
  CreateVehicleFuelInput,
  CreateVehicleFuelBatchPaymentInput,
  CreateVehicleFuelPaymentInput,
  UpdateVehicleFuelInput,
  VehicleFuelPayment,
  VehicleFuelBatchPayment,
  VehicleFuelRecord,
} from "../types.ts";

type FuelRow = {
  id: string; factory_id: string; fuel_date: string; fuel_time: string;
  vehicle_id: string; vehicle_number_snapshot: string;
  pump_id: string; pump_name_snapshot: string;
  pump_address_snapshot: string | null; pump_mobile_snapshot: string | null;
  fuel_type: "DIESEL" | "PETROL"; litres: number | string;
  rate_per_litre: number | string; fuel_amount: number | string;
  status: "active" | "void"; is_locked: boolean;
  total_paid: number | string; outstanding_amount: number | string;
  payment_state: "unpaid" | "partially_paid" | "paid";
  voided_at: string | null; created_at: string; updated_at: string;
};

type FuelPaymentRow = {
  payment_id: string; factory_id: string; fuel_record_id: string;
  vehicle_id: string; vehicle_number_snapshot: string;
  pump_id: string; pump_name_snapshot: string;
  payment_date: string; amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null; created_at: string;
};

type FuelBatchPaymentRow = {
  payment_id: string; factory_id: string; pump_id: string; pump_name: string;
  vehicle_ids: string[]; allocation_count: number | string;
  allocations: Array<{
    fuel_record_id: string; fuel_date: string; fuel_time: string;
    vehicle_id: string; vehicle_number_snapshot: string;
    fuel_type: "DIESEL" | "PETROL"; litres: number | string;
    allocated_amount: number | string;
  }>;
  payment_date: string; amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null; created_at: string;
};

export class VehicleFuelServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(readableError(error));
    this.name = "VehicleFuelServiceError";
    this.code = error.code;
  }
}

export async function listVehicleFuelRecords(
  factoryId: string,
  vehicleId: string | null = null,
  pumpId: string | null = null,
): Promise<VehicleFuelRecord[]> {
  requireId(factoryId, "factoryId");
  if (vehicleId !== null) requireId(vehicleId, "vehicleId");
  if (pumpId !== null) requireId(pumpId, "pumpId");
  const { data, error } = await supabase.rpc("list_vehicle_fuel_records", {
    p_factory_id: factoryId, p_vehicle_id: vehicleId, p_pump_id: pumpId,
  });
  if (error) throw new VehicleFuelServiceError(error);
  return ((data ?? []) as FuelRow[]).map(mapRecord);
}

export async function getPreviousVehicleRefuel(
  factoryId: string,
  vehicleId: string,
  beforeDate: string,
  beforeTime: string,
  excludeFuelRecordId: string | null = null,
): Promise<VehicleFuelRecord | null> {
  requireId(factoryId, "factoryId");
  requireId(vehicleId, "vehicleId");
  if (!isLocalDate(beforeDate) || !isLocalTime(beforeTime)) throw new Error("Choose a valid Fuel date and time.");
  const { data, error } = await supabase.rpc("get_previous_vehicle_refuel", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
    p_before_date: beforeDate,
    p_before_time: beforeTime,
    p_exclude_fuel_record_id: excludeFuelRecordId,
  });
  if (error) throw new VehicleFuelServiceError(error);
  const row = (data as FuelRow[] | null)?.[0];
  return row ? mapRecord(row) : null;
}

export async function createVehicleFuel(input: CreateVehicleFuelInput): Promise<VehicleFuelRecord> {
  validateRecordInput(input);
  const { data, error } = await supabase.rpc("create_vehicle_fuel", fuelRpcArgs(input));
  if (error) throw new VehicleFuelServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("create_vehicle_fuel returned no record.");
  return mapRecord(row);
}

export async function updateVehicleFuel(input: UpdateVehicleFuelInput): Promise<VehicleFuelRecord> {
  requireId(input.fuelRecordId, "fuelRecordId");
  validateRecordInput({ ...input, initialPaidAmount: 0, initialPaymentMode: null });
  const { data, error } = await supabase.rpc("update_vehicle_fuel", {
    p_factory_id: input.factoryId,
    p_fuel_record_id: input.fuelRecordId,
    p_fuel_date: input.fuelDate,
    p_fuel_time: input.fuelTime,
    p_vehicle_id: input.vehicleId,
    p_pump_id: input.pumpId,
    p_fuel_type: input.fuelType,
    p_litres: input.litres,
    p_rate_per_litre: input.ratePerLitre,
    p_fuel_amount: input.fuelAmount,
  });
  if (error) throw new VehicleFuelServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("update_vehicle_fuel returned no record.");
  return mapRecord(row);
}

export async function voidVehicleFuel(factoryId: string, fuelRecordId: string): Promise<VehicleFuelRecord> {
  requireId(factoryId, "factoryId");
  requireId(fuelRecordId, "fuelRecordId");
  const { data, error } = await supabase.rpc("void_vehicle_fuel", {
    p_factory_id: factoryId, p_fuel_record_id: fuelRecordId,
  });
  if (error) throw new VehicleFuelServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("void_vehicle_fuel returned no record.");
  return mapRecord(row);
}

export async function createVehicleFuelPayment(input: CreateVehicleFuelPaymentInput): Promise<string> {
  requireId(input.factoryId, "factoryId");
  requireId(input.fuelRecordId, "fuelRecordId");
  if (!isLocalDate(input.paymentDate)) throw new Error("Choose a valid payment date.");
  assertMoney(input.amount, "Payment amount", false);
  if (!isNewCustomerPaymentMode(input.paymentMode)) throw new Error("Choose a payment mode.");
  const { data, error } = await supabase.rpc("create_vehicle_fuel_payment", {
    p_factory_id: input.factoryId,
    p_fuel_record_id: input.fuelRecordId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: normalizeOptionalText(input.note),
  });
  if (error) throw new VehicleFuelServiceError(error);
  if (!data?.id) throw new Error("create_vehicle_fuel_payment returned no payment.");
  return data.id;
}

export async function createVehicleFuelBatchPayment(
  input: CreateVehicleFuelBatchPaymentInput,
): Promise<string> {
  requireId(input.factoryId, "factoryId");
  requireId(input.pumpId, "pumpId");
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.fromDate > input.toDate) {
    throw new Error("Choose a valid inclusive Fuel date range.");
  }
  if (!isLocalDate(input.paymentDate)) throw new Error("Choose a valid payment date.");
  assertMoney(input.amount, "Payment amount", false);
  if (!isNewCustomerPaymentMode(input.paymentMode)) throw new Error("Choose a payment mode.");
  const { data, error } = await supabase.rpc("create_vehicle_fuel_batch_payment", {
    p_factory_id: input.factoryId,
    p_pump_id: input.pumpId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: normalizeOptionalText(input.note),
  });
  if (error) throw new VehicleFuelServiceError(error);
  if (!data?.id) throw new Error("create_vehicle_fuel_batch_payment returned no payment.");
  return data.id;
}

export async function listVehicleFuelPayments(
  factoryId: string,
  vehicleId: string | null = null,
  pumpId: string | null = null,
): Promise<VehicleFuelPayment[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase.rpc("list_vehicle_fuel_payments", {
    p_factory_id: factoryId, p_vehicle_id: vehicleId, p_pump_id: pumpId,
  });
  if (error) throw new VehicleFuelServiceError(error);
  return ((data ?? []) as FuelPaymentRow[]).map((row) => ({
    id: row.payment_id, factoryId: row.factory_id, fuelRecordId: row.fuel_record_id,
    vehicleId: row.vehicle_id, vehicleNumberSnapshot: row.vehicle_number_snapshot,
    pumpId: row.pump_id, pumpNameSnapshot: row.pump_name_snapshot,
    paymentDate: row.payment_date, amount: Number(row.amount),
    paymentMode: row.payment_mode, note: row.note, createdAt: row.created_at,
  }));
}

export async function listVehicleFuelBatchPayments(
  factoryId: string,
  pumpId: string | null = null,
): Promise<VehicleFuelBatchPayment[]> {
  requireId(factoryId, "factoryId");
  if (pumpId !== null) requireId(pumpId, "pumpId");
  const { data, error } = await supabase.rpc("list_vehicle_fuel_batch_payments", {
    p_factory_id: factoryId, p_pump_id: pumpId,
  });
  if (error) throw new VehicleFuelServiceError(error);
  return ((data ?? []) as FuelBatchPaymentRow[]).map((row) => ({
    id: row.payment_id, factoryId: row.factory_id, pumpId: row.pump_id,
    pumpName: row.pump_name, vehicleIds: row.vehicle_ids,
    allocationCount: Number(row.allocation_count),
    allocations: row.allocations.map((allocation) => ({
      fuelRecordId: allocation.fuel_record_id,
      fuelDate: allocation.fuel_date,
      fuelTime: allocation.fuel_time,
      vehicleId: allocation.vehicle_id,
      vehicleNumberSnapshot: allocation.vehicle_number_snapshot,
      fuelType: allocation.fuel_type,
      litres: Number(allocation.litres),
      allocatedAmount: Number(allocation.allocated_amount),
    })),
    paymentDate: row.payment_date,
    amount: Number(row.amount), paymentMode: row.payment_mode,
    note: row.note, createdAt: row.created_at,
  }));
}

function fuelRpcArgs(input: CreateVehicleFuelInput) {
  return {
    p_factory_id: input.factoryId, p_fuel_date: input.fuelDate,
    p_fuel_time: input.fuelTime, p_vehicle_id: input.vehicleId,
    p_pump_id: input.pumpId, p_fuel_type: input.fuelType,
    p_litres: input.litres, p_rate_per_litre: input.ratePerLitre,
    p_fuel_amount: input.fuelAmount, p_initial_paid_amount: input.initialPaidAmount,
    p_initial_payment_mode: input.initialPaymentMode,
  };
}

function validateRecordInput(input: CreateVehicleFuelInput): void {
  requireId(input.factoryId, "factoryId");
  requireId(input.vehicleId, "vehicleId");
  requireId(input.pumpId, "pumpId");
  if (!isLocalDate(input.fuelDate) || !isLocalTime(input.fuelTime)) throw new Error("Choose a valid Fuel date and time.");
  if (input.fuelType !== "DIESEL" && input.fuelType !== "PETROL") throw new Error("Choose Diesel or Petrol.");
  if ([input.litres, input.ratePerLitre, input.fuelAmount].filter((value) => value !== null).length !== 2) {
    throw new Error("Supply exactly two of Litres, Rate, and Amount.");
  }
  if (input.litres !== null) assertDecimal(input.litres, "Litres", 6);
  if (input.ratePerLitre !== null) assertDecimal(input.ratePerLitre, "Rate", 6);
  if (input.fuelAmount !== null) assertMoney(input.fuelAmount, "Fuel amount", false);
  assertMoney(input.initialPaidAmount, "Initial Paid", true);
  if (input.fuelAmount !== null && input.initialPaidAmount > input.fuelAmount) {
    throw new Error("Initial Paid cannot exceed Fuel amount.");
  }
  if (input.initialPaidAmount > 0 && !input.initialPaymentMode) throw new Error("Choose a payment mode.");
}

function mapRecord(row: FuelRow): VehicleFuelRecord {
  return {
    id: row.id, factoryId: row.factory_id, fuelDate: row.fuel_date,
    fuelTime: row.fuel_time, vehicleId: row.vehicle_id,
    vehicleNumberSnapshot: row.vehicle_number_snapshot, pumpId: row.pump_id,
    pumpNameSnapshot: row.pump_name_snapshot, pumpAddressSnapshot: row.pump_address_snapshot,
    pumpMobileSnapshot: row.pump_mobile_snapshot, fuelType: row.fuel_type,
    litres: Number(row.litres), ratePerLitre: Number(row.rate_per_litre),
    fuelAmount: Number(row.fuel_amount), status: row.status, isLocked: row.is_locked,
    totalPaid: Number(row.total_paid), outstandingAmount: Number(row.outstanding_amount),
    paymentState: row.payment_state, voidedAt: row.voided_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function readableError(error: PostgrestError): string {
  if (error.code === "P4501") return "Vehicle does not belong to this factory.";
  if (error.code === "P4502") return "Archived Vehicles cannot receive new Fuel entries. Restore the Vehicle first.";
  if (error.code === "P4503") return "Choose a supplier assigned as a Fuel Pump.";
  if (error.code === "P4504") return "Fuel record does not belong to this factory.";
  if (error.code === "P4505") return "Fuel records can only change through their dedicated controls.";
  if (error.code === "P4510") return "Payment exceeds the current outstanding Fuel dues in this Pump and date range.";
  if (error.code === "P4104") return "Paid or partially-paid Fuel is financially locked.";
  if (error.code === "P4105") return "Payment exceeds the outstanding Fuel amount.";
  if (error.code === "P3200") return "Choose a supported payment mode.";
  if (error.code === "22023" || error.code === "23514") return "Check the Fuel date, time, type, litres, rate, and amounts.";
  return error.message;
}

function assertDecimal(value: number, label: string, decimals: number): void {
  const factor = 10 ** decimals;
  if (!Number.isFinite(value) || value <= 0 || value >= 1_000_000_000_000
    || Math.round(value * factor) !== value * factor) {
    throw new Error(`${label} must be positive and use at most ${decimals} decimal places.`);
  }
}

function assertMoney(value: number, label: string, allowZero: boolean): void {
  if (!Number.isFinite(value) || (!allowZero && value <= 0) || value < 0
    || value >= 10_000_000_000_000_000 || Math.round(value * 100) !== value * 100) {
    throw new Error(`${label} must ${allowZero ? "be non-negative" : "be positive"} and use at most two decimal places.`);
  }
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}
