import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

export type CreateLabourGroupWithdrawalInput = {
  factoryId: string;
  labourGroupId: string;
  withdrawalDate: string;
  amount: number;
};

export type CreatedLabourGroupWithdrawal = {
  withdrawalId: string;
  factoryId: string;
  labourGroupId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
  availableBalance: number;
};

export class CreateLabourGroupWithdrawalError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CreateLabourGroupWithdrawalError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function createLabourGroupWithdrawal({
  factoryId,
  labourGroupId,
  withdrawalDate,
  amount,
}: CreateLabourGroupWithdrawalInput): Promise<CreatedLabourGroupWithdrawal> {
  const { data, error } = await supabase.rpc("create_labour_group_withdrawal", {
    p_factory_id: factoryId,
    p_labour_group_id: labourGroupId,
    p_withdrawal_date: withdrawalDate,
    p_amount: amount,
  });

  if (error) throw new CreateLabourGroupWithdrawalError(error);

  const withdrawal = data?.[0];
  if (!withdrawal) throw new Error("create_labour_group_withdrawal returned no withdrawal.");

  return {
    withdrawalId: withdrawal.withdrawal_id,
    factoryId: withdrawal.withdrawal_factory_id,
    labourGroupId: withdrawal.withdrawal_labour_group_id,
    withdrawalDate: withdrawal.withdrawal_date,
    amount: withdrawal.withdrawal_amount,
    createdAt: withdrawal.created_at,
    availableBalance: withdrawal.available_balance,
  };
}
