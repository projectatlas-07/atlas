import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

export type AssignLabourerToProductionCrewInput = {
  factoryId: string;
  labourerId: string;
  productionCrewId: string;
  effectiveFrom: string;
};

export type EndLabourerProductionCrewAssignmentInput = {
  factoryId: string;
  labourerId: string;
  effectiveTo: string;
};

export type ProductionCrewAssignment = {
  id: string;
  factoryId: string;
  labourerId: string;
  productionCrewId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ProductionCrewAssignmentMutationError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "ProductionCrewAssignmentMutationError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

type ProductionCrewAssignmentRow = {
  id: string;
  factory_id: string;
  labourer_id: string;
  production_crew_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

function mapProductionCrewAssignment(
  row: ProductionCrewAssignmentRow,
): ProductionCrewAssignment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    labourerId: row.labourer_id,
    productionCrewId: row.production_crew_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function assignLabourerToProductionCrew({
  factoryId,
  labourerId,
  productionCrewId,
  effectiveFrom,
}: AssignLabourerToProductionCrewInput): Promise<ProductionCrewAssignment> {
  const { data, error } = await supabase.rpc("assign_labourer_to_production_crew", {
    p_factory_id: factoryId,
    p_labourer_id: labourerId,
    p_production_crew_id: productionCrewId,
    p_effective_from: effectiveFrom,
  });

  if (error) throw new ProductionCrewAssignmentMutationError(error);
  if (!data) throw new Error("assign_labourer_to_production_crew returned no assignment.");

  return mapProductionCrewAssignment(data);
}

export async function endLabourerProductionCrewAssignment({
  factoryId,
  labourerId,
  effectiveTo,
}: EndLabourerProductionCrewAssignmentInput): Promise<ProductionCrewAssignment> {
  const { data, error } = await supabase.rpc("end_labourer_production_crew_assignment", {
    p_factory_id: factoryId,
    p_labourer_id: labourerId,
    p_effective_to: effectiveTo,
  });

  if (error) throw new ProductionCrewAssignmentMutationError(error);
  if (!data) throw new Error("end_labourer_production_crew_assignment returned no assignment.");

  return mapProductionCrewAssignment(data);
}
