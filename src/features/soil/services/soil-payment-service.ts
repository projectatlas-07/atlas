import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  CreatedSoilPayment,
  SoilFinancialSummary,
  SoilPayment,
} from "../types.ts";

type SoilPaymentRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  payment_date: string;
  amount: number | string;
  created_at: string;
};

export type SoilPaymentReadInput = {
  factoryId: string;
  soilWorkerId: string;
};

export type CreateSoilPaymentInput = SoilPaymentReadInput & {
  paymentDate: string;
  amount: number;
};

export class SoilPaymentServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readablePaymentError(error));
    this.name = "SoilPaymentServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readablePaymentError(error: PostgrestError): string {
  if (error.code === "P2802") {
    return "Payment exceeds this Soil worker's available balance.";
  }
  if (error.code === "P2602" || error.code === "23503") {
    return "Soil worker does not belong to this factory.";
  }
  if (error.code === "22023" || error.code === "23514") {
    return "Check the payment date and amount.";
  }
  return error.message;
}

function assertRequiredId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertCanonicalPaymentDate(paymentDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new Error("paymentDate must be a valid YYYY-MM-DD date.");
  }
  const date = new Date(`${paymentDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== paymentDate) {
    throw new Error("paymentDate must be a valid YYYY-MM-DD date.");
  }
}

function assertPositiveFiniteAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive finite number.");
  }
}

function assertReadInput({ factoryId, soilWorkerId }: SoilPaymentReadInput): void {
  assertRequiredId(factoryId, "factoryId");
  assertRequiredId(soilWorkerId, "soilWorkerId");
}

function mapPayment(row: SoilPaymentRow): SoilPayment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    soilWorkerId: row.soil_worker_id,
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    createdAt: row.created_at,
  };
}

export async function createSoilPayment({
  factoryId,
  soilWorkerId,
  paymentDate,
  amount,
}: CreateSoilPaymentInput): Promise<CreatedSoilPayment> {
  assertReadInput({ factoryId, soilWorkerId });
  assertCanonicalPaymentDate(paymentDate);
  assertPositiveFiniteAmount(amount);

  const { data, error } = await supabase.rpc("create_soil_payment", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
    p_payment_date: paymentDate,
    p_amount: amount,
  });

  if (error) throw new SoilPaymentServiceError(error);
  const payment = data?.[0];
  if (!payment) throw new Error("create_soil_payment returned no payment.");

  return {
    id: payment.payment_id,
    factoryId: payment.payment_factory_id,
    soilWorkerId: payment.payment_soil_worker_id,
    paymentDate: payment.payment_date,
    amount: Number(payment.payment_amount),
    createdAt: payment.created_at,
    totalEarned: Number(payment.total_earned),
    totalPaid: Number(payment.total_paid),
    availableBalance: Number(payment.available_balance),
  };
}

export async function getSoilFinancialSummary(
  input: SoilPaymentReadInput,
): Promise<SoilFinancialSummary> {
  assertReadInput(input);

  const { data, error } = await supabase.rpc("get_soil_financial_summary", {
    p_factory_id: input.factoryId,
    p_soil_worker_id: input.soilWorkerId,
  });

  if (error) throw new SoilPaymentServiceError(error);
  const summary = data?.[0];
  if (!summary) throw new Error("get_soil_financial_summary returned no summary.");

  return {
    totalEarned: Number(summary.total_earned),
    totalAdditions: Number(summary.total_additions),
    totalDeductions: Number(summary.total_deductions),
    totalPaid: Number(summary.total_paid),
    availableBalance: Number(summary.available_balance),
  };
}

export async function listSoilPayments(
  input: SoilPaymentReadInput,
): Promise<SoilPayment[]> {
  assertReadInput(input);

  const { data, error } = await supabase
    .from("soil_payments")
    .select("id, factory_id, soil_worker_id, payment_date, amount, created_at")
    .eq("factory_id", input.factoryId)
    .eq("soil_worker_id", input.soilWorkerId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new SoilPaymentServiceError(error);
  return (data ?? []).map(mapPayment);
}
