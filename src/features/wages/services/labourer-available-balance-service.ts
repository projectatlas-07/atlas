import { supabase } from "../../../lib/supabase/client.ts";
import { isLocalDate } from "../../../lib/local-date.ts";

export type LabourerAvailableBalance = {
  settledEarned: number;
  liveEarned: number;
  totalEarned: number;
  totalWithdrawn: number;
  availableBalance: number;
  latestSettlementCutoff: string | null;
};

export async function getLabourerAvailableBalance({
  factoryId,
  labourerId,
  asOfDate,
}: {
  factoryId: string;
  labourerId: string;
  asOfDate: string;
}): Promise<LabourerAvailableBalance> {
  if (!isLocalDate(asOfDate)) throw new Error("asOfDate must be a valid YYYY-MM-DD date.");

  const { data, error } = await supabase.rpc("get_production_labourer_account", {
    p_factory_id: factoryId,
    p_labourer_id: labourerId,
    p_as_of_date: asOfDate,
  });

  if (error) throw new Error(`Could not load Production account: ${error.message}`);

  const account = data?.[0];
  if (!account) throw new Error("get_production_labourer_account returned no account.");

  return {
    settledEarned: account.settled_earned,
    liveEarned: account.live_earned,
    totalEarned: account.total_earned,
    totalWithdrawn: account.total_withdrawn,
    availableBalance: account.available_balance,
    latestSettlementCutoff: account.latest_settlement_cutoff,
  };
}
