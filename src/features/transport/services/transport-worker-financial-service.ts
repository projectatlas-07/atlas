import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  CreatedTransportWorkerWithdrawal,
  TransportWorkerAvailableBalance,
  TransportWorkerWithdrawal,
} from "../types.ts";

export type GetTransportWorkerAvailableBalanceInput = {
  factoryId: string;
  transportWorkerId: string;
  asOfDate: string;
};

export type CreateTransportWorkerWithdrawalInput = {
  factoryId: string;
  transportWorkerId: string;
  withdrawalDate: string;
  amount: number;
};

export type ListTransportWorkerWithdrawalsInput = {
  factoryId: string;
  transportWorkerId: string;
};

export class TransportWorkerFinancialServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportWorkerFinancialServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function getTransportWorkerAvailableBalance({
  factoryId,
  transportWorkerId,
  asOfDate,
}: GetTransportWorkerAvailableBalanceInput): Promise<TransportWorkerAvailableBalance> {
  const { data, error } = await supabase.rpc(
    "get_transport_worker_available_balance",
    {
      p_factory_id: factoryId,
      p_transport_worker_id: transportWorkerId,
      p_as_of_date: asOfDate,
    },
  );

  if (error) throw new TransportWorkerFinancialServiceError(error);

  const balance = data?.[0];
  if (!balance) {
    throw new Error("get_transport_worker_available_balance returned no balance.");
  }

  return {
    totalEarned: balance.total_earned,
    totalWithdrawn: balance.total_withdrawn,
    availableBalance: balance.available_balance,
  };
}

export async function createTransportWorkerWithdrawal({
  factoryId,
  transportWorkerId,
  withdrawalDate,
  amount,
}: CreateTransportWorkerWithdrawalInput): Promise<CreatedTransportWorkerWithdrawal> {
  const { data, error } = await supabase.rpc(
    "create_transport_worker_withdrawal",
    {
      p_factory_id: factoryId,
      p_transport_worker_id: transportWorkerId,
      p_withdrawal_date: withdrawalDate,
      p_amount: amount,
    },
  );

  if (error) throw new TransportWorkerFinancialServiceError(error);

  const withdrawal = data?.[0];
  if (!withdrawal) {
    throw new Error("create_transport_worker_withdrawal returned no withdrawal.");
  }

  return {
    withdrawalId: withdrawal.withdrawal_id,
    factoryId: withdrawal.withdrawal_factory_id,
    transportWorkerId: withdrawal.withdrawal_transport_worker_id,
    withdrawalDate: withdrawal.withdrawal_date,
    amount: withdrawal.withdrawal_amount,
    createdAt: withdrawal.created_at,
    availableBalance: withdrawal.available_balance,
  };
}

export async function listTransportWorkerWithdrawals({
  factoryId,
  transportWorkerId,
}: ListTransportWorkerWithdrawalsInput): Promise<TransportWorkerWithdrawal[]> {
  const { data, error } = await supabase
    .from("transport_withdrawals")
    .select("id, factory_id, transport_worker_id, withdrawal_date, amount, created_at")
    .eq("factory_id", factoryId)
    .eq("transport_worker_id", transportWorkerId)
    .order("withdrawal_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new TransportWorkerFinancialServiceError(error);

  return (data ?? []).map((withdrawal) => ({
    withdrawalId: withdrawal.id,
    factoryId: withdrawal.factory_id,
    transportWorkerId: withdrawal.transport_worker_id,
    withdrawalDate: withdrawal.withdrawal_date,
    amount: withdrawal.amount,
    createdAt: withdrawal.created_at,
  }));
}
