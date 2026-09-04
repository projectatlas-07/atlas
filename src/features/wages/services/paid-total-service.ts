import { assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import { sumFiniteNumbers } from "../../../lib/numeric-total.ts";
import { supabase } from "../../../lib/supabase/client.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";

async function getWithdrawalPaidTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
  kind: "production-labour" | "mud-supply",
): Promise<number> {
  const data = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase.from("withdrawals")
      .select("id, amount")
      .eq("factory_id", factoryId)
      .gte("withdrawal_date", dateFrom)
      .lte("withdrawal_date", dateTo)
      .order("id", { ascending: true })
      .limit(pageSize);
    query = kind === "production-labour"
      ? query.not("labourer_id", "is", null)
      : query.not("labour_group_id", "is", null).is("labourer_id", null);
    if (afterId) query = query.gt("id", afterId);
    const { data: page, error } = await query;
    if (error) throw new Error(error.message);
    return page ?? [];
  });
  return sumFiniteNumbers(data.map((withdrawal) => withdrawal.amount),
    kind === "production-labour" ? "Production Labour Paid total" : "Mud Supply Paid total");
}

export async function getProductionLabourPaidTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  return getWithdrawalPaidTotal(factoryId, dateFrom, dateTo, "production-labour");
}

export async function getMudSupplyPaidTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  return getWithdrawalPaidTotal(factoryId, dateFrom, dateTo, "mud-supply");
}
