import { supabase } from "@/lib/supabase/client";
import type { WageRateHistory } from "./wage-rate-service";

export async function getWageRatesForFactory(factoryId: string): Promise<WageRateHistory[]> {
  const { data, error } = await supabase
    .from("wage_rates")
    .select("id, factory_id, applies_to, rate_per_1000_bricks, effective_from, effective_to, created_at")
    .eq("factory_id", factoryId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
