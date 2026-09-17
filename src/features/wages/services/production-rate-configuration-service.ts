import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { ProductionWageRate } from "./production-wage-rate-read-service.ts";

export type SetProductionLabourerRatesInput = {
  factoryId: string;
  labourerIds: readonly string[];
  ratePer1000Bricks: number;
  effectiveFrom: string;
};

export class ProductionRateConfigurationError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "ProductionRateConfigurationError";
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

function mapRate(row: ProductionWageRateRow): ProductionWageRate {
  return {
    id: row.id,
    factoryId: row.factory_id,
    productionCrewId: row.production_crew_id,
    labourerId: row.labourer_id,
    ratePer1000Bricks: Number(row.rate_per_1000_bricks),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function setProductionLabourerRates({
  factoryId,
  labourerIds,
  ratePer1000Bricks,
  effectiveFrom,
}: SetProductionLabourerRatesInput): Promise<ProductionWageRate[]> {
  const distinctLabourerIds = [...new Set(labourerIds)];
  if (!factoryId) throw new Error("Factory is required.");
  if (distinctLabourerIds.length === 0 || distinctLabourerIds.length !== labourerIds.length) {
    throw new Error("Choose one or more distinct labourers.");
  }
  if (!Number.isFinite(ratePer1000Bricks) || ratePer1000Bricks <= 0) {
    throw new Error("Rate per 1,000 bricks must be greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw new Error("Effective-from date is required.");
  }

  const { data, error } = await supabase.rpc("set_production_labourer_rates", {
    p_factory_id: factoryId,
    p_labourer_ids: distinctLabourerIds,
    p_rate_per_1000_bricks: ratePer1000Bricks,
    p_effective_from: effectiveFrom,
  });
  if (error) throw new ProductionRateConfigurationError(error);
  if (!data || data.length !== distinctLabourerIds.length) {
    throw new Error("Direct Production rate setting returned an incomplete result.");
  }
  return (data as ProductionWageRateRow[]).map(mapRate);
}

export async function setProductionLabourerOrigin({
  factoryId,
  labourerId,
  originLabel,
}: Readonly<{
  factoryId: string;
  labourerId: string;
  originLabel: string | null;
}>): Promise<string | null> {
  if (!factoryId || !labourerId) throw new Error("Factory and labourer are required.");
  const { data, error } = await supabase.rpc("set_production_labourer_origin", {
    p_factory_id: factoryId,
    p_labourer_id: labourerId,
    p_origin_label: originLabel,
  });
  if (error) throw new ProductionRateConfigurationError(error);
  if (!data) throw new Error("Production origin update returned no labourer.");
  return data.production_origin_label;
}
