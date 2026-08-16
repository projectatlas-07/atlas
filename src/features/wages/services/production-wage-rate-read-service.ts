import { supabase } from "../../../lib/supabase/client.ts";

export type ProductionWageRate = {
  id: string;
  factoryId: string;
  productionCrewId: string | null;
  labourerId: string | null;
  ratePer1000Bricks: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductionWageRateRow = {
  id: string;
  factory_id: string;
  production_crew_id: string | null;
  labourer_id: string | null;
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

function mapProductionWageRate(row: ProductionWageRateRow): ProductionWageRate {
  return {
    id: row.id,
    factoryId: row.factory_id,
    productionCrewId: row.production_crew_id,
    labourerId: row.labourer_id,
    ratePer1000Bricks: row.rate_per_1000_bricks,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProductionWageRatesForFactory(factoryId: string): Promise<ProductionWageRate[]> {
  const { data, error } = await supabase
    .from("production_wage_rates")
    .select("id, factory_id, production_crew_id, labourer_id, rate_per_1000_bricks, effective_from, effective_to, created_at, updated_at")
    .eq("factory_id", factoryId)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapProductionWageRate);
}

function appliesOnDate(rate: ProductionWageRate, asOfDate: string) {
  return rate.effectiveFrom <= asOfDate
    && (rate.effectiveTo === null || rate.effectiveTo >= asOfDate);
}

export function getCurrentCrewProductionWageRate(
  rates: readonly ProductionWageRate[],
  productionCrewId: string,
  asOfDate: string,
): ProductionWageRate | null {
  return rates.find((rate) =>
    rate.productionCrewId === productionCrewId
    && rate.labourerId === null
    && appliesOnDate(rate, asOfDate),
  ) ?? null;
}

export function getCurrentLabourerProductionWageRateOverride(
  rates: readonly ProductionWageRate[],
  labourerId: string,
  asOfDate: string,
): ProductionWageRate | null {
  return rates.find((rate) =>
    rate.labourerId === labourerId
    && rate.productionCrewId === null
    && appliesOnDate(rate, asOfDate),
  ) ?? null;
}
