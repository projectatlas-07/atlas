import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import {
  getEligibleVehicleWageTrips,
  isVehicleWageDateRange,
  type RecordVehicleWagePaymentInput,
  type RecordedVehicleWagePayment,
  type ReverseVehicleWagePaymentInput,
  type ReversedVehicleWagePayment,
  type VehicleWageChallanSnapshot,
  type VehicleWageDateRange,
  type VehicleWageLifetimeAccount,
  type VehicleWagePayment,
  type VehicleWageTrip,
} from "../vehicle-wage-model.ts";
import { assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import { sumFiniteNumbers } from "../../../lib/numeric-total.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";

const VEHICLE_WAGE_TRIP_COLUMNS =
  "id, challan_number, challan_date, vehicle_id, vehicle_number_snapshot, delivery_wage_applicable_snapshot, trip_labour_wage, status";

type VehicleWageTripRow = {
  id: string;
  challan_number: number | string;
  challan_date: string;
  vehicle_id: string | null;
  vehicle_number_snapshot: string | null;
  delivery_wage_applicable_snapshot: boolean;
  trip_labour_wage: number | string | null;
  status: "active" | "void";
};

type VehicleWagePaymentRow = {
  id: string;
  factory_id: string;
  vehicle_id: string;
  payment_date: string;
  amount: number | string;
  note: string | null;
  created_at: string;
  created_by: string;
};

type VehicleWagePaymentReversalRow = {
  id: string;
  factory_id: string;
  payment_id: string;
  reversal_date: string;
  reason: string;
  created_at: string;
  created_by: string;
};

export class VehicleWageServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableVehicleWageError(error));
    this.name = "VehicleWageServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function getVehicleWagePaidTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  const payments = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase.from("vehicle_wage_payments")
      .select("id, amount")
      .eq("factory_id", factoryId)
      .gte("payment_date", dateFrom)
      .lte("payment_date", dateTo)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new VehicleWageServiceError(error);
    return data ?? [];
  });
  if (payments.length === 0) return 0;

  const paymentIds = new Set(payments.map((payment) => payment.id));
  const reversals = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase.from("vehicle_wage_payment_reversals")
      .select("id, payment_id")
      .eq("factory_id", factoryId)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new VehicleWageServiceError(error);
    return data ?? [];
  });

  const reversedPaymentIds = new Set(reversals
    .filter((reversal) => paymentIds.has(reversal.payment_id))
    .map((reversal) => reversal.payment_id));
  return sumFiniteNumbers(
    payments
      .filter((payment) => !reversedPaymentIds.has(payment.id))
      .map((payment) => payment.amount),
    "Vehicle Delivery Wage Paid total",
  );
}

function readableVehicleWageError(error: PostgrestError): string {
  if (error.code === "P3110") {
    return "Payment exceeds available Vehicle wage balance.";
  }
  if (error.code === "P3120") {
    return "Vehicle wage payment was not found for this factory.";
  }
  if (error.code === "P3121") {
    return "This Vehicle wage payment has already been reversed.";
  }
  if (error.code === "P3122") {
    return "Vehicle wage payment reversal history is immutable.";
  }
  if (["P3111", "P3113", "40001", "40P01"].includes(error.code)) {
    return "This Vehicle account changed while you were saving. Please review the latest balance.";
  }
  if (error.code === "P3102" || error.code === "23503") {
    return "Vehicle does not belong to this factory.";
  }
  if (error.code === "22023" || error.code === "23514") {
    return "Check the payment or reversal date, amount, note, and reason.";
  }
  return error.message;
}

export async function listVehicleWageTrips(
  factoryId: string,
  range: VehicleWageDateRange,
): Promise<VehicleWageTrip[]> {
  if (!factoryId.trim()) throw new Error("factoryId is required.");
  if (!isVehicleWageDateRange(range)) {
    throw new Error("Vehicle wage dates must be a valid inclusive range.");
  }

  const { data, error } = await supabase
    .from("challans")
    .select(VEHICLE_WAGE_TRIP_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("status", "active")
    .eq("delivery_wage_applicable_snapshot", true)
    .not("vehicle_id", "is", null)
    .not("vehicle_number_snapshot", "is", null)
    .not("trip_labour_wage", "is", null)
    .gt("trip_labour_wage", 0)
    .gte("challan_date", range.fromDate)
    .lte("challan_date", range.toDate)
    .order("challan_date", { ascending: false })
    .order("challan_number", { ascending: false });

  if (error) throw new VehicleWageServiceError(error);
  const snapshots = ((data ?? []) as VehicleWageTripRow[]).map(mapSnapshot);
  return getEligibleVehicleWageTrips(snapshots);
}

export async function getVehicleWageLifetimeAccount(
  factoryId: string,
  vehicleId: string,
): Promise<VehicleWageLifetimeAccount> {
  assertRequiredId(factoryId, "factoryId");
  assertRequiredId(vehicleId, "vehicleId");
  const { data, error } = await supabase.rpc("get_vehicle_wage_account_summary", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw new VehicleWageServiceError(error);
  const account = data?.[0];
  if (!account) throw new Error("get_vehicle_wage_account_summary returned no account.");
  return {
    totalEarned: parseMoney(account.total_earned, "Total Earned"),
    totalPaid: parseMoney(account.total_paid, "Total Paid"),
    availableBalance: parseMoney(account.available_balance, "Available Balance"),
  };
}

export async function listVehicleWagePayments(
  factoryId: string,
  vehicleId: string,
): Promise<VehicleWagePayment[]> {
  assertRequiredId(factoryId, "factoryId");
  assertRequiredId(vehicleId, "vehicleId");
  const { data, error } = await supabase
    .from("vehicle_wage_payments")
    .select("id, factory_id, vehicle_id, payment_date, amount, note, created_at, created_by")
    .eq("factory_id", factoryId)
    .eq("vehicle_id", vehicleId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new VehicleWageServiceError(error);
  const payments = ((data ?? []) as VehicleWagePaymentRow[]).map(mapPayment);
  if (payments.length === 0) return payments;

  const { data: reversalData, error: reversalError } = await supabase
    .from("vehicle_wage_payment_reversals")
    .select("id, factory_id, payment_id, reversal_date, reason, created_at, created_by")
    .eq("factory_id", factoryId)
    .in("payment_id", payments.map((payment) => payment.id));
  if (reversalError) throw new VehicleWageServiceError(reversalError);
  const reversals = new Map<string, ReturnType<typeof mapReversal>>();
  for (const row of (reversalData ?? []) as VehicleWagePaymentReversalRow[]) {
    if (reversals.has(row.payment_id)) {
      throw new Error("Vehicle wage payment history returned duplicate reversals.");
    }
    reversals.set(row.payment_id, mapReversal(row));
  }
  return payments.map((payment) => ({
    ...payment,
    reversal: reversals.get(payment.id) ?? null,
  }));
}

export async function recordVehicleWagePayment(
  input: RecordVehicleWagePaymentInput,
): Promise<RecordedVehicleWagePayment> {
  assertRequiredId(input.factoryId, "factoryId");
  assertRequiredId(input.vehicleId, "vehicleId");
  assertCanonicalDate(input.paymentDate);
  assertPaymentAmount(input.amount);
  const { data, error } = await supabase.rpc("record_vehicle_wage_payment", {
    p_factory_id: input.factoryId,
    p_vehicle_id: input.vehicleId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_note: input.note,
  });
  if (error) throw new VehicleWageServiceError(error);
  const payment = data?.[0];
  if (!payment) throw new Error("record_vehicle_wage_payment returned no payment.");
  return {
    id: payment.payment_id,
    factoryId: payment.payment_factory_id,
    vehicleId: payment.payment_vehicle_id,
    paymentDate: payment.payment_date,
    amount: parseMoney(payment.payment_amount, "Payment amount"),
    note: payment.payment_note,
    createdAt: payment.created_at,
    createdBy: payment.created_by,
    reversal: null,
    totalEarned: parseMoney(payment.total_earned, "Total Earned"),
    totalPaid: parseMoney(payment.total_paid, "Total Paid"),
    availableBalance: parseMoney(payment.available_balance, "Available Balance"),
  };
}

export async function reverseVehicleWagePayment(
  input: ReverseVehicleWagePaymentInput,
): Promise<ReversedVehicleWagePayment> {
  assertRequiredId(input.factoryId, "factoryId");
  assertRequiredId(input.paymentId, "paymentId");
  assertCanonicalDate(input.reversalDate, "reversalDate");
  assertReversalReason(input.reason);
  const { data, error } = await supabase.rpc("reverse_vehicle_wage_payment", {
    p_factory_id: input.factoryId,
    p_payment_id: input.paymentId,
    p_reversal_date: input.reversalDate,
    p_reason: input.reason,
  });
  if (error) throw new VehicleWageServiceError(error);
  const reversal = data?.[0];
  if (!reversal) throw new Error("reverse_vehicle_wage_payment returned no reversal.");
  return {
    id: reversal.reversal_id,
    factoryId: reversal.reversal_factory_id,
    paymentId: reversal.reversed_payment_id,
    vehicleId: reversal.reversal_vehicle_id,
    reversalDate: reversal.reversal_date,
    amount: parseMoney(reversal.reversal_amount, "Reversal amount"),
    reason: reversal.reversal_reason,
    createdAt: reversal.created_at,
    createdBy: reversal.created_by,
    totalEarned: parseMoney(reversal.total_earned, "Total Earned"),
    totalPaid: parseMoney(reversal.total_paid, "Total Paid"),
    availableBalance: parseMoney(reversal.available_balance, "Available Balance"),
  };
}

function mapSnapshot(row: VehicleWageTripRow): VehicleWageChallanSnapshot {
  return {
    challanId: row.id,
    challanNumber: Number(row.challan_number),
    challanDate: row.challan_date,
    vehicleId: row.vehicle_id,
    vehicleNumberSnapshot: row.vehicle_number_snapshot,
    deliveryWageApplicableSnapshot: row.delivery_wage_applicable_snapshot,
    tripLabourWage: row.trip_labour_wage === null ? null : Number(row.trip_labour_wage),
    status: row.status,
  };
}

function mapPayment(row: VehicleWagePaymentRow): VehicleWagePayment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    vehicleId: row.vehicle_id,
    paymentDate: row.payment_date,
    amount: parseMoney(row.amount, "Payment amount"),
    note: row.note,
    createdAt: row.created_at,
    createdBy: row.created_by,
    reversal: null,
  };
}

function mapReversal(row: VehicleWagePaymentReversalRow) {
  return {
    id: row.id,
    factoryId: row.factory_id,
    paymentId: row.payment_id,
    reversalDate: row.reversal_date,
    reason: row.reason,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function assertRequiredId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertCanonicalDate(value: string, label = "paymentDate"): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
}

function assertReversalReason(value: string): void {
  if (!value || value !== value.trim().replace(/\s+/g, " ")
    || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("reason is required, normalized, and at most 500 characters.");
  }
}

function assertPaymentAmount(value: number): void {
  const paise = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || value >= 1_000_000_000
    || !Number.isSafeInteger(paise) || Math.abs(value * 100 - paise) >= 1e-7) {
    throw new Error("amount must be positive and use at most two decimal places.");
  }
}

function parseMoney(value: number | string, label: string): number {
  const amount = Number(value);
  const paise = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(paise)
    || Math.abs(amount * 100 - paise) >= 1e-7) {
    throw new Error(`${label} returned an invalid monetary amount.`);
  }
  return paise / 100;
}
