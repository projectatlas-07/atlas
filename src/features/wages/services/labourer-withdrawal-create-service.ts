import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { isLocalDate, shiftLocalDate } from "../../../lib/local-date.ts";

export type CreateLabourerWithdrawalInput = {
  factoryId: string;
  labourerId: string;
  withdrawalDate: string;
  settlementCutoff: string;
  amount: number;
};

export type CreatedLabourerWithdrawal = {
  withdrawalId: string;
  factoryId: string;
  labourerId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
  availableBalance: number;
  settlementId: string;
  settledThrough: string;
};

export class CreateLabourerWithdrawalError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CreateLabourerWithdrawalError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function createLabourerWithdrawal({
  factoryId,
  labourerId,
  withdrawalDate,
  settlementCutoff,
  amount,
}: CreateLabourerWithdrawalInput): Promise<CreatedLabourerWithdrawal> {
  if (!isLocalDate(withdrawalDate)) throw new Error("Choose a valid withdrawal date.");
  if (!isLocalDate(settlementCutoff)) throw new Error("Choose a valid settlement cutoff.");
  if (settlementCutoff > withdrawalDate) {
    throw new Error("Settlement cutoff cannot be after the withdrawal date.");
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");

  const { data, error } = await supabase.rpc("create_labourer_withdrawal", {
    p_factory_id: factoryId,
    p_labourer_id: labourerId,
    p_withdrawal_date: withdrawalDate,
    p_settlement_cutoff: settlementCutoff,
    p_amount: amount,
  });

  if (error) throw new CreateLabourerWithdrawalError(error);

  const withdrawal = data?.[0];
  if (!withdrawal) throw new Error("create_labourer_withdrawal returned no withdrawal.");

  return {
    withdrawalId: withdrawal.withdrawal_id,
    factoryId: withdrawal.withdrawal_factory_id,
    labourerId: withdrawal.withdrawal_labourer_id,
    withdrawalDate: withdrawal.withdrawal_date,
    amount: withdrawal.withdrawal_amount,
    createdAt: withdrawal.created_at,
    availableBalance: withdrawal.available_balance,
    settlementId: withdrawal.settlement_id,
    settledThrough: withdrawal.settled_through,
  };
}

export function getDefaultSettlementCutoff(
  withdrawalDate: string,
  latestSettlementCutoff: string | null,
): string {
  const previousDay = shiftLocalDate(withdrawalDate, -1);
  if (!previousDay) return "";
  if (latestSettlementCutoff && latestSettlementCutoff > previousDay) return latestSettlementCutoff;
  return previousDay;
}
