import { supabase } from "../../../lib/supabase/client.ts";
import { assertMondayWeekStart } from "./wage-rate-service.ts";

export type LabourerWeeklyProductionInput = {
  factoryId: string;
  labourerId: string;
  weekStart: string;
};

export async function getLabourerWeeklyProduction({
  factoryId,
  labourerId,
  weekStart,
}: LabourerWeeklyProductionInput): Promise<number> {
  assertMondayWeekStart(weekStart);

  const { data, error } = await supabase
    .from("production_entries")
    .select("quantity")
    .eq("factory_id", factoryId)
    .eq("labourer_id", labourerId)
    .gte("production_date", weekStart)
    .lte("production_date", getSundayWeekEnd(weekStart));

  if (error) throw new Error(error.message);
  return (data ?? []).reduce((total, entry) => total + entry.quantity, 0);
}

function getSundayWeekEnd(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const sunday = new Date(year, month - 1, day + 6);
  const sundayYear = sunday.getFullYear();
  const sundayMonth = String(sunday.getMonth() + 1).padStart(2, "0");
  const sundayDay = String(sunday.getDate()).padStart(2, "0");
  return `${sundayYear}-${sundayMonth}-${sundayDay}`;
}
