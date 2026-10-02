import { isLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";

type MudAccountingMode = "LEGACY_WEEKLY" | "SHADOW" | "SETTLEMENT";

type ProductionSettlementCutoff = {
  labourer_id: string;
  settled_through: string;
};

export type BrickProductionLabourerEditability = {
  isLocked: boolean;
  settledThrough: string | null;
  lockSource: "mud" | "production" | null;
};

export type BrickProductionEditability = {
  mudSettlementCutoff: string | null;
  isMudLocked: boolean;
  labourers: Record<string, BrickProductionLabourerEditability>;
};

export function deriveBrickProductionEditability({
  businessDate,
  labourerIds,
  mudAccountingMode,
  mudSettlementCutoff,
  productionSettlements,
}: Readonly<{
  businessDate: string;
  labourerIds: readonly string[];
  mudAccountingMode: MudAccountingMode | null;
  mudSettlementCutoff: string | null;
  productionSettlements: readonly ProductionSettlementCutoff[];
}>): BrickProductionEditability {
  const activeMudCutoff = mudAccountingMode === "SETTLEMENT" ? mudSettlementCutoff : null;
  if (mudAccountingMode === "SETTLEMENT" && !activeMudCutoff) {
    throw new Error("Mud settlement accounting is missing its authoritative cutoff.");
  }

  const isMudLocked = activeMudCutoff !== null && businessDate <= activeMudCutoff;
  const productionCutoffByLabourer = new Map<string, string>();
  for (const settlement of productionSettlements) {
    const current = productionCutoffByLabourer.get(settlement.labourer_id);
    if (!current || settlement.settled_through > current) {
      productionCutoffByLabourer.set(settlement.labourer_id, settlement.settled_through);
    }
  }

  return {
    mudSettlementCutoff: activeMudCutoff,
    isMudLocked,
    labourers: Object.fromEntries(labourerIds.map((labourerId) => {
      const productionCutoff = productionCutoffByLabourer.get(labourerId) ?? null;
      if (isMudLocked) {
        return [labourerId, {
          isLocked: true,
          settledThrough: activeMudCutoff,
          lockSource: "mud" as const,
        }];
      }
      const isProductionLocked = productionCutoff !== null && businessDate <= productionCutoff;
      return [labourerId, {
        isLocked: isProductionLocked,
        settledThrough: isProductionLocked ? productionCutoff : null,
        lockSource: isProductionLocked ? "production" as const : null,
      }];
    })),
  };
}

export async function getBrickProductionEditability({
  factoryId,
  labourerIds,
  businessDate,
}: Readonly<{
  factoryId: string;
  labourerIds: readonly string[];
  businessDate: string;
}>): Promise<BrickProductionEditability> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!isLocalDate(businessDate)) throw new Error("Business date must be a valid date.");

  const { data: mudState, error: mudStateError } = await supabase
    .from("mud_accounting_states")
    .select("accounting_mode")
    .eq("factory_id", factoryId)
    .maybeSingle();
  if (mudStateError) throw new Error(`Could not read Mud settlement state: ${mudStateError.message}`);

  let mudSettlementCutoff: string | null = null;
  if (mudState?.accounting_mode === "SETTLEMENT") {
    const { data: mudSettlement, error: mudSettlementError } = await supabase
      .from("mud_factory_settlements")
      .select("settled_through")
      .eq("factory_id", factoryId)
      .order("settled_through", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mudSettlementError) {
      throw new Error(`Could not read Mud settlement cutoff: ${mudSettlementError.message}`);
    }
    mudSettlementCutoff = mudSettlement?.settled_through ?? null;
  }

  let productionSettlements: ProductionSettlementCutoff[] = [];
  if (labourerIds.length > 0) {
    const { data, error } = await supabase
      .from("production_earning_settlements")
      .select("labourer_id, settled_through")
      .eq("factory_id", factoryId)
      .in("labourer_id", [...labourerIds]);
    if (error) throw new Error(`Could not read Production settlement cutoffs: ${error.message}`);
    productionSettlements = data ?? [];
  }

  return deriveBrickProductionEditability({
    businessDate,
    labourerIds,
    mudAccountingMode: mudState?.accounting_mode ?? null,
    mudSettlementCutoff,
    productionSettlements,
  });
}
