import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

export type CreateProductionCrewWageRateInput = {
  factoryId: string;
  productionCrewId: string;
  ratePer1000Bricks: number;
  effectiveFrom: string;
};

export type CreateLabourerProductionWageRateOverrideInput = {
  factoryId: string;
  labourerId: string;
  ratePer1000Bricks: number;
  effectiveFrom: string;
};

export type CreatedProductionWageRate = {
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

export class CreateProductionWageRateError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CreateProductionWageRateError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

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

function mapProductionWageRate(row: ProductionWageRateRow): CreatedProductionWageRate {
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

export async function createProductionCrewWageRate({
  factoryId,
  productionCrewId,
  ratePer1000Bricks,
  effectiveFrom,
}: CreateProductionCrewWageRateInput): Promise<CreatedProductionWageRate> {
  const { data, error } = await supabase.rpc("create_production_crew_wage_rate", {
    p_factory_id: factoryId,
    p_production_crew_id: productionCrewId,
    p_rate_per_1000_bricks: ratePer1000Bricks,
    p_effective_from: effectiveFrom,
  });

  if (error) throw new CreateProductionWageRateError(error);
  if (!data) throw new Error("create_production_crew_wage_rate returned no rate.");

  return mapProductionWageRate(data);
}

export async function createLabourerProductionWageRateOverride({
  factoryId,
  labourerId,
  ratePer1000Bricks,
  effectiveFrom,
}: CreateLabourerProductionWageRateOverrideInput): Promise<CreatedProductionWageRate> {
  const { data, error } = await supabase.rpc("create_labourer_production_wage_rate_override", {
    p_factory_id: factoryId,
    p_labourer_id: labourerId,
    p_rate_per_1000_bricks: ratePer1000Bricks,
    p_effective_from: effectiveFrom,
  });

  if (error) throw new CreateProductionWageRateError(error);
  if (!data) throw new Error("create_labourer_production_wage_rate_override returned no rate.");

  return mapProductionWageRate(data);
}
