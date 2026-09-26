import { supabase } from "../../../lib/supabase/client.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";

export type LabourerWithdrawalHistoryEntry = {
  withdrawalId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
};

export type LatestLabourerWithdrawal = LabourerWithdrawalHistoryEntry & {
  labourerId: string;
};

type LabourerWithdrawalRow = {
  id: string;
  labourer_id: string | null;
  withdrawal_date: string;
  amount: number;
  created_at: string;
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

export async function getLatestLabourerWithdrawalsForFactory(
  factoryId: string,
): Promise<LatestLabourerWithdrawal[]> {
  const rows = await readAllKeysetPages<LabourerWithdrawalRow>(async (afterId, pageSize) => {
    let query = supabase
      .from("withdrawals")
      .select("id, labourer_id, withdrawal_date, amount, created_at")
      .eq("factory_id", factoryId)
      .not("labourer_id", "is", null)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  });

  const latestByLabourer = new Map<string, LabourerWithdrawalRow>();
  for (const row of rows) {
    if (!row.labourer_id) continue;
    const current = latestByLabourer.get(row.labourer_id);
    if (!current || compareWithdrawalRecency(row, current) > 0) {
      latestByLabourer.set(row.labourer_id, row);
    }
  }

  return [...latestByLabourer.values()].map((withdrawal) => ({
    labourerId: withdrawal.labourer_id!,
    withdrawalId: withdrawal.id,
    withdrawalDate: withdrawal.withdrawal_date,
    amount: withdrawal.amount,
    createdAt: withdrawal.created_at,
  }));
}

function compareWithdrawalRecency(
  left: LabourerWithdrawalRow,
  right: LabourerWithdrawalRow,
): number {
  return left.withdrawal_date.localeCompare(right.withdrawal_date)
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id);
}
