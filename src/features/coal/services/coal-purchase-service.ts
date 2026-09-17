import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { isLocalDate } from "../../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../../sales/types.ts";
import type {
  CoalPayment,
  CoalPurchase,
  CoalReferenceKind,
  CoalReferenceValue,
  CreateCoalPaymentInput,
  CreateCoalPurchaseInput,
  CreateCoalSelectivePaymentInput,
  UpdateCoalPurchaseInput,
} from "../types.ts";

const REFERENCE_COLUMNS = "id, factory_id, kind, display_value, created_at";

type CoalReferenceRow = {
  id: string;
  factory_id: string;
  kind: CoalReferenceKind;
  display_value: string;
  created_at: string;
};

type CoalPurchaseRow = {
  id: string;
  factory_id: string;
  purchase_date: string;
  seller_id: string;
  seller_name_snapshot: string;
  seller_address_snapshot: string | null;
  seller_mobile_snapshot: string | null;
  coal_name_reference_id: string;
  coal_name_snapshot: string;
  source_reference_id: string;
  source_location_snapshot: string;
  coal_challan_number: string | null;
  vehicle_number_snapshot: string;
  quantity: number | string;
  rate: number | string;
  coal_amount: number | string;
  separate_freight_amount: number | string;
  final_total: number | string;
  status: "active" | "void";
  is_locked: boolean;
  total_paid: number | string;
  outstanding_amount: number | string;
  payment_state: "unpaid" | "partially_paid" | "paid";
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type CoalPaymentRow = {
  payment_id: string;
  factory_id: string;
  seller_id: string;
  seller_name_snapshot: string;
  allocation_count: number | string;
  allocations: Array<{
    purchase_id: string;
    purchase_date: string;
    coal_challan_number: string | null;
    coal_name_snapshot: string;
    source_location_snapshot: string;
    vehicle_number_snapshot: string;
    allocated_amount: number | string;
  }>;
  payment_date: string;
  amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null;
  created_at: string;
};

export class CoalPurchaseServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(readableCoalError(error));
    this.name = "CoalPurchaseServiceError";
    this.code = error.code;
  }
}

export async function listCoalReferenceValues(
  factoryId: string,
): Promise<CoalReferenceValue[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase.from("coal_reference_values")
    .select(REFERENCE_COLUMNS)
    .eq("factory_id", factoryId)
    .order("kind", { ascending: true })
    .order("display_value", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new CoalPurchaseServiceError(error);
  return ((data ?? []) as CoalReferenceRow[]).map(mapReference);
}

export async function createCoalReferenceValue(
  factoryId: string,
  kind: CoalReferenceKind,
  displayValue: string,
): Promise<CoalReferenceValue> {
  requireId(factoryId, "factoryId");
  if (kind !== "coal_name" && kind !== "source_location") throw new Error("Invalid Coal reference kind.");
  const normalized = normalizeText(displayValue);
  if (!normalized || normalized.length > 120) throw new Error("Enter a value of at most 120 characters.");
  const { data, error } = await supabase.rpc("create_coal_reference_value", {
    p_factory_id: factoryId,
    p_kind: kind,
    p_display_value: normalized,
  });
  if (error) throw new CoalPurchaseServiceError(error);
  if (!data) throw new Error("create_coal_reference_value returned no value.");
  return mapReference(data);
}

export async function listCoalPurchases(
  factoryId: string,
  sellerId: string | null = null,
): Promise<CoalPurchase[]> {
  requireId(factoryId, "factoryId");
  if (sellerId !== null) requireId(sellerId, "sellerId");
  const { data, error } = await supabase.rpc("list_coal_purchases", {
    p_factory_id: factoryId,
    p_seller_id: sellerId,
  });
  if (error) throw new CoalPurchaseServiceError(error);
  return ((data ?? []) as CoalPurchaseRow[]).map(mapPurchase);
}

export async function createCoalPurchase(
  input: CreateCoalPurchaseInput,
): Promise<CoalPurchase> {
  validatePurchaseInput(input);
  const { data, error } = await supabase.rpc("create_coal_purchase", purchaseRpcArgs(input));
  if (error) throw new CoalPurchaseServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("create_coal_purchase returned no purchase.");
  return mapPurchase(row);
}

export async function updateCoalPurchase(
  input: UpdateCoalPurchaseInput,
): Promise<CoalPurchase> {
  requireId(input.purchaseId, "purchaseId");
  validatePurchaseInput({ ...input, initialPaidAmount: 0, initialPaymentMode: null });
  const { data, error } = await supabase.rpc("update_coal_purchase", {
    p_factory_id: input.factoryId,
    p_purchase_id: input.purchaseId,
    p_purchase_date: input.purchaseDate,
    p_seller_id: input.sellerId,
    p_coal_name_reference_id: input.coalNameReferenceId,
    p_source_reference_id: input.sourceReferenceId,
    p_coal_challan_number: normalizeOptionalText(input.coalChallanNumber),
    p_vehicle_number: normalizeVehicle(input.vehicleNumber),
    p_quantity: input.quantity,
    p_rate: input.rate,
    p_coal_amount: input.coalAmount,
    p_separate_freight_amount: input.separateFreightAmount,
  });
  if (error) throw new CoalPurchaseServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("update_coal_purchase returned no purchase.");
  return mapPurchase(row);
}

export async function voidCoalPurchase(
  factoryId: string,
  purchaseId: string,
): Promise<CoalPurchase> {
  requireId(factoryId, "factoryId");
  requireId(purchaseId, "purchaseId");
  const { data, error } = await supabase.rpc("void_coal_purchase", {
    p_factory_id: factoryId,
    p_purchase_id: purchaseId,
  });
  if (error) throw new CoalPurchaseServiceError(error);
  const row = data?.[0];
  if (!row) throw new Error("void_coal_purchase returned no purchase.");
  return mapPurchase(row);
}

export async function createCoalPayment(input: CreateCoalPaymentInput): Promise<string> {
  requireId(input.factoryId, "factoryId");
  requireId(input.purchaseId, "purchaseId");
  if (!isLocalDate(input.paymentDate)) throw new Error("Choose a valid payment date.");
  assertMoney(input.amount, "Payment amount", false);
  if (!isNewCustomerPaymentMode(input.paymentMode)) throw new Error("Choose a payment mode.");
  const note = normalizeOptionalText(input.note);
  const { data, error } = await supabase.rpc("create_coal_payment", {
    p_factory_id: input.factoryId,
    p_purchase_id: input.purchaseId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: note,
  });
  if (error) throw new CoalPurchaseServiceError(error);
  if (!data?.id) throw new Error("create_coal_payment returned no payment.");
  return data.id;
}

export async function createCoalSelectivePayment(
  input: CreateCoalSelectivePaymentInput,
): Promise<string> {
  requireId(input.factoryId, "factoryId");
  requireId(input.sellerId, "sellerId");
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.fromDate > input.toDate) {
    throw new Error("Choose a valid inclusive date range.");
  }
  if (!isLocalDate(input.paymentDate)) throw new Error("Choose a valid payment date.");
  if (!isNewCustomerPaymentMode(input.paymentMode)) throw new Error("Choose a payment mode.");
  if (input.allocations.length === 0 || input.allocations.length > 100) {
    throw new Error("Select between 1 and 100 Coal Purchases.");
  }
  const seen = new Set<string>();
  for (const allocation of input.allocations) {
    requireId(allocation.purchaseId, "purchaseId");
    if (seen.has(allocation.purchaseId)) throw new Error("A Coal Purchase can only be selected once.");
    seen.add(allocation.purchaseId);
    assertMoney(allocation.amount, "Pay This Time", false);
  }
  const note = normalizeOptionalText(input.note);
  if (note && note.length > 500) throw new Error("Note must be at most 500 characters.");
  const { data, error } = await supabase.rpc("create_coal_selective_payment", {
    p_factory_id: input.factoryId,
    p_seller_id: input.sellerId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_payment_date: input.paymentDate,
    p_payment_mode: input.paymentMode,
    p_note: note,
    p_allocations: input.allocations.map((allocation) => ({
      purchase_id: allocation.purchaseId,
      amount: allocation.amount,
    })),
  });
  if (error) throw new CoalPurchaseServiceError(error);
  if (!data?.id) throw new Error("create_coal_selective_payment returned no payment.");
  return data.id;
}

export async function listCoalPayments(
  factoryId: string,
  sellerId: string | null = null,
): Promise<CoalPayment[]> {
  requireId(factoryId, "factoryId");
  if (sellerId !== null) requireId(sellerId, "sellerId");
  const { data, error } = await supabase.rpc("list_coal_selective_payments", {
    p_factory_id: factoryId,
    p_seller_id: sellerId,
  });
  if (error) throw new CoalPurchaseServiceError(error);
  return ((data ?? []) as CoalPaymentRow[]).map((row) => ({
    id: row.payment_id,
    factoryId: row.factory_id,
    sellerId: row.seller_id,
    sellerNameSnapshot: row.seller_name_snapshot,
    allocationCount: Number(row.allocation_count),
    allocations: row.allocations.map((allocation) => ({
      purchaseId: allocation.purchase_id,
      purchaseDate: allocation.purchase_date,
      coalChallanNumber: allocation.coal_challan_number,
      coalNameSnapshot: allocation.coal_name_snapshot,
      sourceLocationSnapshot: allocation.source_location_snapshot,
      vehicleNumberSnapshot: allocation.vehicle_number_snapshot,
      allocatedAmount: Number(allocation.allocated_amount),
    })),
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    note: row.note,
    createdAt: row.created_at,
  }));
}

function purchaseRpcArgs(input: CreateCoalPurchaseInput) {
  return {
    p_factory_id: input.factoryId,
    p_purchase_date: input.purchaseDate,
    p_seller_id: input.sellerId,
    p_coal_name_reference_id: input.coalNameReferenceId,
    p_source_reference_id: input.sourceReferenceId,
    p_coal_challan_number: normalizeOptionalText(input.coalChallanNumber),
    p_vehicle_number: normalizeVehicle(input.vehicleNumber),
    p_quantity: input.quantity,
    p_rate: input.rate,
    p_coal_amount: input.coalAmount,
    p_separate_freight_amount: input.separateFreightAmount,
    p_initial_paid_amount: input.initialPaidAmount,
    p_initial_payment_mode: input.initialPaymentMode ?? null,
  };
}

function validatePurchaseInput(input: CreateCoalPurchaseInput): void {
  requireId(input.factoryId, "factoryId");
  requireId(input.sellerId, "sellerId");
  requireId(input.coalNameReferenceId, "coalNameReferenceId");
  requireId(input.sourceReferenceId, "sourceReferenceId");
  if (!isLocalDate(input.purchaseDate)) throw new Error("Choose a valid purchase date.");
  if (!normalizeVehicle(input.vehicleNumber)) throw new Error("Vehicle Number is required.");
  if ([input.quantity, input.rate, input.coalAmount].filter((value) => value !== null).length !== 2) {
    throw new Error("Supply exactly two of Quantity, Rate, and Coal Amount.");
  }
  if (input.quantity !== null) assertDecimal(input.quantity, "Quantity", 6);
  if (input.rate !== null) assertDecimal(input.rate, "Rate", 6);
  if (input.coalAmount !== null) assertMoney(input.coalAmount, "Coal amount", false);
  assertMoney(input.separateFreightAmount, "Separate freight", true);
  assertMoney(input.initialPaidAmount, "Initial Paid", true);
  if (input.initialPaidAmount > 0 && !input.initialPaymentMode) {
    throw new Error("Choose a payment mode when Initial Paid is greater than zero.");
  }
}

function mapReference(row: CoalReferenceRow): CoalReferenceValue {
  return {
    id: row.id,
    factoryId: row.factory_id,
    kind: row.kind,
    value: row.display_value,
    createdAt: row.created_at,
  };
}

function mapPurchase(row: CoalPurchaseRow): CoalPurchase {
  return {
    id: row.id,
    factoryId: row.factory_id,
    purchaseDate: row.purchase_date,
    sellerId: row.seller_id,
    sellerNameSnapshot: row.seller_name_snapshot,
    sellerAddressSnapshot: row.seller_address_snapshot,
    sellerMobileSnapshot: row.seller_mobile_snapshot,
    coalNameReferenceId: row.coal_name_reference_id,
    coalNameSnapshot: row.coal_name_snapshot,
    sourceReferenceId: row.source_reference_id,
    sourceLocationSnapshot: row.source_location_snapshot,
    coalChallanNumber: row.coal_challan_number,
    vehicleNumberSnapshot: row.vehicle_number_snapshot,
    quantity: Number(row.quantity),
    rate: Number(row.rate),
    coalAmount: Number(row.coal_amount),
    separateFreightAmount: Number(row.separate_freight_amount),
    finalTotal: Number(row.final_total),
    status: row.status,
    isLocked: row.is_locked,
    totalPaid: Number(row.total_paid),
    outstandingAmount: Number(row.outstanding_amount),
    paymentState: row.payment_state,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readableCoalError(error: PostgrestError): string {
  if (error.code === "P4002") return "Seller does not belong to this factory.";
  if (error.code === "P4201") return "Enter any two of Quantity, Rate, and Coal Amount.";
  if (error.code === "P4202") return "Check Quantity, Rate, and Coal Amount.";
  if (error.code === "P4203") return "Coal Name or Source does not belong to this factory.";
  if (error.code === "P4204") return "Check the separate freight and Final Total.";
  if (error.code === "P4205" || error.code === "P4105") return "Payment cannot exceed the outstanding amount.";
  if (error.code === "P4210") return "A selected Coal Purchase is outside this seller/date range or is no longer payable.";
  if (error.code === "P4206") return "Coal Purchase does not belong to this factory.";
  if (error.code === "P4207") return "Coal Purchase history must use the dedicated Coal workflow.";
  if (error.code === "P4104") return "A paid or void Coal Purchase cannot be changed.";
  if (error.code === "P3200") return "Choose a supported payment mode.";
  return error.message;
}

function normalizeVehicle(value: string): string {
  return normalizeText(value).toUpperCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = normalizeText(value ?? "");
  return normalized || null;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertDecimal(value: number, label: string, decimalPlaces: number): void {
  const factor = 10 ** decimalPlaces;
  if (!Number.isFinite(value) || value <= 0
    || !Number.isSafeInteger(Math.round(value * factor))
    || Math.abs(value * factor - Math.round(value * factor)) >= 1e-6) {
    throw new Error(`${label} must be positive and use at most ${decimalPlaces} decimal places.`);
  }
}

function assertMoney(value: number, label: string, allowZero: boolean): void {
  const paise = value * 100;
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)
    || !Number.isSafeInteger(Math.round(paise))
    || Math.abs(paise - Math.round(paise)) >= 1e-7) {
    throw new Error(`${label} must be ${allowZero ? "non-negative" : "positive"} and use at most two decimal places.`);
  }
}
