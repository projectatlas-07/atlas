import { supabase } from "@/lib/supabase/client";

export type TodayProductionRow = {
  labourerId: string;
  labourerName: string;
  quantity: number;
};

export async function getTodaysProduction(factoryId: string, productionDate: string): Promise<TodayProductionRow[]> {
  const { data: productionEntries, error: productionError } = await supabase
    .from("production_entries")
    .select("labourer_id, quantity")
    .eq("factory_id", factoryId)
    .eq("production_date", productionDate);
  if (productionError) throw new Error(productionError.message);
  if (!productionEntries?.length) return [];

  const labourerIds = productionEntries.map((entry) => entry.labourer_id);
  const { data: labourers, error: labourersError } = await supabase
    .from("labourers")
    .select("id, name")
    .eq("factory_id", factoryId)
    .in("id", labourerIds);
  if (labourersError) throw new Error(labourersError.message);

  const labourerNamesById = new Map((labourers ?? []).map((labourer) => [labourer.id, labourer.name]));
  return productionEntries.map((entry) => ({
    labourerId: entry.labourer_id,
    labourerName: labourerNamesById.get(entry.labourer_id) ?? "Unknown labourer",
    quantity: entry.quantity,
  })).sort((left, right) => left.labourerName.localeCompare(right.labourerName, "en-IN"));
}
