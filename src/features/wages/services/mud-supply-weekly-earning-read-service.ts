import { supabase } from "../../../lib/supabase/client.ts";

export type MudSupplyWeeklyEarning = {
  id: string;
  labourGroupId: string;
  weekStart: string;
  quantityUsed: number;
  rateUsed: number;
  amount: number;
  calculatedAt: string;
};

export async function getMudSupplyWeeklyEarning({
  factoryId,
  weeklyEarningId,
  weekStart,
}: {
  factoryId: string;
  weeklyEarningId: string;
  weekStart: string;
}): Promise<MudSupplyWeeklyEarning> {
  const { data, error } = await supabase
    .from("weekly_earnings")
    .select("id, labour_group_id, week_start, quantity_used, rate_used, amount, calculated_at")
    .eq("factory_id", factoryId)
    .eq("id", weeklyEarningId)
    .eq("week_start", weekStart)
    .single();

  if (error) throw new Error(error.message);
  if (!data.labour_group_id) throw new Error("Stored earning is not a labour-group earning.");

  return {
    id: data.id,
    labourGroupId: data.labour_group_id,
    weekStart: data.week_start,
    quantityUsed: data.quantity_used,
    rateUsed: data.rate_used,
    amount: data.amount,
    calculatedAt: data.calculated_at,
  };
}
