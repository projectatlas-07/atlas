import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  RecordedStaffPayment,
  StaffPayment,
  StaffPaymentSummary,
} from "../types.ts";

type PaymentRow = {
  id: string;
  factory_id: string;
  staff_worker_id: string;
  payment_date: string;
  amount: number;
  note: string | null;
  created_at: string;
};

export type RecordStaffPaymentInput = {
  factoryId: string;
  staffWorkerId: string;
  paymentDate: string;
  amount: number;
  note?: string | null;
};

export type StaffPaymentReadInput = {
  factoryId: string;
  staffWorkerId: string;
};

export class StaffPaymentServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "StaffPaymentServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function mapPayment(row: PaymentRow): StaffPayment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    staffWorkerId: row.staff_worker_id,
    paymentDate: row.payment_date,
    amount: row.amount,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function recordStaffPayment({
  factoryId,
  staffWorkerId,
  paymentDate,
  amount,
  note,
}: RecordStaffPaymentInput): Promise<RecordedStaffPayment> {
  const { data, error } = await supabase.rpc("record_staff_payment", {
    p_factory_id: factoryId,
    p_staff_worker_id: staffWorkerId,
    p_payment_date: paymentDate,
    p_amount: amount,
    p_note: note ?? null,
  });

  if (error) throw new StaffPaymentServiceError(error);

  const payment = data?.[0];
  if (!payment) throw new Error("record_staff_payment returned no payment.");

  return {
    id: payment.payment_id,
    factoryId: payment.payment_factory_id,
    staffWorkerId: payment.payment_staff_worker_id,
    paymentDate: payment.payment_date,
    amount: payment.payment_amount,
    note: payment.payment_note,
    createdAt: payment.created_at,
    totalPaid: payment.total_paid,
  };
}

export async function getStaffPaymentSummary({
  factoryId,
  staffWorkerId,
}: StaffPaymentReadInput): Promise<StaffPaymentSummary> {
  const { data, error } = await supabase.rpc("get_staff_payment_summary", {
    p_factory_id: factoryId,
    p_staff_worker_id: staffWorkerId,
  });

  if (error) throw new StaffPaymentServiceError(error);

  const summary = data?.[0];
  if (!summary) throw new Error("get_staff_payment_summary returned no summary.");

  return { totalPaid: summary.total_paid };
}

export async function listStaffPayments({
  factoryId,
  staffWorkerId,
}: StaffPaymentReadInput): Promise<StaffPayment[]> {
  const { data, error } = await supabase
    .from("staff_payments")
    .select("id, factory_id, staff_worker_id, payment_date, amount, note, created_at")
    .eq("factory_id", factoryId)
    .eq("staff_worker_id", staffWorkerId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new StaffPaymentServiceError(error);

  return (data ?? []).map(mapPayment);
}
