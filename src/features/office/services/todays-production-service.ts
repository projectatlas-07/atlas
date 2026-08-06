import { supabase } from "@/lib/supabase/client";

export type TodayProductionRow = {
  labourerId: string;
  labourerName: string;
  brickTypeId: string;
  brickTypeName: string;
  quantity: number;
};

export async function getTodaysProduction(factoryId: string, productionDate: string): Promise<TodayProductionRow[]> {
  const { data: productionEntries, error: productionError } = await supabase
    .from("production_entries")
    .select("labourer_id, brick_type_id, quantity")
    .eq("factory_id", factoryId)
    .eq("production_date", productionDate);
  if (productionError) throw new Error(productionError.message);
  if (!productionEntries?.length) return [];

  const labourerIds = productionEntries.map((entry) => entry.labourer_id);
  const brickTypeIds = productionEntries.map((entry) => entry.brick_type_id);
  const [{ data: labourers, error: labourersError }, { data: brickTypes, error: brickTypesError }] = await Promise.all([
    supabase
      .from("labourers")
      .select("id, name")
      .eq("factory_id", factoryId)
      .in("id", labourerIds),
    supabase
      .from("brick_types")
      .select("id, name")
      .eq("factory_id", factoryId)
      .in("id", brickTypeIds),
  ]);
  if (labourersError) throw new Error(labourersError.message);
  if (brickTypesError) throw new Error(brickTypesError.message);

  const labourerNamesById = new Map((labourers ?? []).map((labourer) => [labourer.id, labourer.name]));
  const brickTypeNamesById = new Map((brickTypes ?? []).map((brickType) => [brickType.id, brickType.name]));
  return productionEntries.map((entry) => ({
    labourerId: entry.labourer_id,
    labourerName: labourerNamesById.get(entry.labourer_id) ?? "Unknown labourer",
    brickTypeId: entry.brick_type_id,
    brickTypeName: brickTypeNamesById.get(entry.brick_type_id) ?? "Unknown brick type",
    quantity: entry.quantity,
  })).sort((left, right) => left.labourerName.localeCompare(right.labourerName, "en-IN"));
}
