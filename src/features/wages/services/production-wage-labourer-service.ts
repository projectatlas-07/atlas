import { supabase } from "../../../lib/supabase/client.ts";
import { assertMondayWeekStart } from "./wage-rate-service.ts";

export type ProductionWageLabourer = {
  labourerId: string;
  quantity: number;
};

export async function getProductionWageLabourers({
  factoryId,
  weekStart,
}: {
  factoryId: string;
  weekStart: string;
}): Promise<ProductionWageLabourer[]> {
  assertMondayWeekStart(weekStart);

  const { data: productionEntries, error: productionError } = await supabase
    .from("production_entries")
    .select("labourer_id, quantity")
    .eq("factory_id", factoryId)
    .gte("production_date", weekStart)
    .lte("production_date", getSundayWeekEnd(weekStart));

  if (productionError) throw new Error(productionError.message);
  if (!productionEntries?.length) return [];

  const quantitiesByLabourerId = new Map<string, number>();

  for (const entry of productionEntries) {
    quantitiesByLabourerId.set(
      entry.labourer_id,
      (quantitiesByLabourerId.get(entry.labourer_id) ?? 0) + entry.quantity,
    );
  }

  return [...quantitiesByLabourerId]
    .map(([labourerId, quantity]) => ({ labourerId, quantity }))
    .sort((left, right) => left.labourerId.localeCompare(right.labourerId));
}

function getSundayWeekEnd(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const sunday = new Date(year, month - 1, day + 6);
  const sundayYear = sunday.getFullYear();
  const sundayMonth = String(sunday.getMonth() + 1).padStart(2, "0");
  const sundayDay = String(sunday.getDate()).padStart(2, "0");
  return `${sundayYear}-${sundayMonth}-${sundayDay}`;
}
