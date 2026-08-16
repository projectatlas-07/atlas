import { supabase } from "../../../lib/supabase/client.ts";

export type LabourerEarningsHistoryEntry = {
  id: string;
  week_start: string;
  quantity_used: number;
  wage_rate_id: string | null;
  rate_used: number | null;
  amount: number;
  calculated_at: string;
};

export async function getLabourerEarningsHistory({
  factoryId,
  labourerId,
}: {
  factoryId: string;
  labourerId: string;
}): Promise<LabourerEarningsHistoryEntry[]> {
  const { data, error } = await supabase
    .from("weekly_earnings")
    .select("id, week_start, quantity_used, wage_rate_id, rate_used, amount, calculated_at")
    .eq("factory_id", factoryId)
    .eq("labourer_id", labourerId)
    .order("week_start", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
