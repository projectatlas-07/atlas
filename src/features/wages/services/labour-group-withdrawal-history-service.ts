import { supabase } from "../../../lib/supabase/client.ts";

export type LabourGroupWithdrawalHistoryEntry = {
  withdrawalId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
};

export async function getLabourGroupWithdrawalHistory(
  factoryId: string,
  labourGroupId: string,
): Promise<LabourGroupWithdrawalHistoryEntry[]> {
  const { data, error } = await supabase
    .from("withdrawals")
    .select("id, withdrawal_date, amount, created_at")
    .eq("factory_id", factoryId)
    .eq("labour_group_id", labourGroupId)
    .is("labourer_id", null)
    .order("withdrawal_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((withdrawal) => ({
    withdrawalId: withdrawal.id,
    withdrawalDate: withdrawal.withdrawal_date,
    amount: withdrawal.amount,
    createdAt: withdrawal.created_at,
  }));
}
