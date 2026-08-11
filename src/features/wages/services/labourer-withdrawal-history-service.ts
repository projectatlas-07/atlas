import { supabase } from "../../../lib/supabase/client.ts";

export type LabourerWithdrawalHistoryEntry = {
  withdrawalId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
};

export async function getLabourerWithdrawalHistory(
  factoryId: string,
  labourerId: string,
): Promise<LabourerWithdrawalHistoryEntry[]> {
  const { data, error } = await supabase
    .from("withdrawals")
    .select("id, withdrawal_date, amount, created_at")
    .eq("factory_id", factoryId)
    .eq("labourer_id", labourerId)
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
