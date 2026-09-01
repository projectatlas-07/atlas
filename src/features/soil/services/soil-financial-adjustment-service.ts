import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  CreatedSoilFinancialAdjustment,
  SoilFinancialAdjustment,
  SoilFinancialAdjustmentType,
} from "../types.ts";

type SoilFinancialAdjustmentRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  adjustment_type: SoilFinancialAdjustmentType;
  adjustment_date: string;
  amount: number | string;
  reason: string;
  created_at: string;
};

export type SoilFinancialAdjustmentReadInput = {
  factoryId: string;
  soilWorkerId: string;
};

export type CreateSoilFinancialAdjustmentInput =
  SoilFinancialAdjustmentReadInput & {
    adjustmentType: SoilFinancialAdjustmentType;
    adjustmentDate: string;
    amount: number;
    reason: string;
  };

export class SoilFinancialAdjustmentServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableAdjustmentError(error));
    this.name = "SoilFinancialAdjustmentServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableAdjustmentError(error: PostgrestError): string {
  if (error.code === "P2902") {
    return "Deduction exceeds this Soil worker's available balance.";
  }
  if (error.code === "P2602" || error.code === "23503") {
    return "Soil worker does not belong to this factory.";
  }
  if (error.code === "22023" || error.code === "23514") {
    return "Check the adjustment type, date, amount, and reason.";
  }
  return error.message;
}

function assertRequiredId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertCanonicalAdjustmentDate(adjustmentDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(adjustmentDate)) {
    throw new Error("adjustmentDate must be a valid YYYY-MM-DD date.");
  }
  const date = new Date(`${adjustmentDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== adjustmentDate) {
    throw new Error("adjustmentDate must be a valid YYYY-MM-DD date.");
  }
}

function assertReadInput(input: SoilFinancialAdjustmentReadInput): void {
  assertRequiredId(input.factoryId, "factoryId");
  assertRequiredId(input.soilWorkerId, "soilWorkerId");
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new Error("reason is required.");
  return normalized;
}

function mapAdjustment(row: SoilFinancialAdjustmentRow): SoilFinancialAdjustment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    soilWorkerId: row.soil_worker_id,
    adjustmentType: row.adjustment_type,
    adjustmentDate: row.adjustment_date,
    amount: Number(row.amount),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export async function createSoilFinancialAdjustment({
  factoryId,
  soilWorkerId,
  adjustmentType,
  adjustmentDate,
  amount,
  reason,
}: CreateSoilFinancialAdjustmentInput): Promise<CreatedSoilFinancialAdjustment> {
  assertReadInput({ factoryId, soilWorkerId });
  if (adjustmentType !== "ADDITION" && adjustmentType !== "DEDUCTION") {
    throw new Error("adjustmentType must be ADDITION or DEDUCTION.");
  }
  assertCanonicalAdjustmentDate(adjustmentDate);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive finite number.");
  }
  const normalizedReason = normalizeReason(reason);

  const { data, error } = await supabase.rpc(
    "create_soil_financial_adjustment",
    {
      p_factory_id: factoryId,
      p_soil_worker_id: soilWorkerId,
      p_adjustment_type: adjustmentType,
      p_adjustment_date: adjustmentDate,
      p_amount: amount,
      p_reason: normalizedReason,
    },
  );

  if (error) throw new SoilFinancialAdjustmentServiceError(error);
  const adjustment = data?.[0];
  if (!adjustment) {
    throw new Error("create_soil_financial_adjustment returned no adjustment.");
  }

  return {
    id: adjustment.adjustment_id,
    factoryId: adjustment.adjustment_factory_id,
    soilWorkerId: adjustment.adjustment_soil_worker_id,
    adjustmentType: adjustment.adjustment_type,
    adjustmentDate: adjustment.adjustment_date,
    amount: Number(adjustment.adjustment_amount),
    reason: adjustment.adjustment_reason,
    createdAt: adjustment.created_at,
    totalEarned: Number(adjustment.total_earned),
    totalAdditions: Number(adjustment.total_additions),
    totalDeductions: Number(adjustment.total_deductions),
    totalPaid: Number(adjustment.total_paid),
    availableBalance: Number(adjustment.available_balance),
  };
}

export async function listSoilFinancialAdjustments(
  input: SoilFinancialAdjustmentReadInput,
): Promise<SoilFinancialAdjustment[]> {
  assertReadInput(input);

  const { data, error } = await supabase
    .from("soil_financial_adjustments")
    .select(
      "id, factory_id, soil_worker_id, adjustment_type, adjustment_date, amount, reason, created_at",
    )
    .eq("factory_id", input.factoryId)
    .eq("soil_worker_id", input.soilWorkerId)
    .order("adjustment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new SoilFinancialAdjustmentServiceError(error);
  return (data ?? []).map(mapAdjustment);
}
