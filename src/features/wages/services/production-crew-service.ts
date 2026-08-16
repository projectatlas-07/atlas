import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { ProductionCrewAssignment } from "./production-crew-assignment-service.ts";

export type ProductionCrew = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export class ProductionCrewMutationError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "ProductionCrewMutationError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

type ProductionCrewRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

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

function mapProductionCrew(row: ProductionCrewRow): ProductionCrew {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: ProductionCrewAssignmentRow): ProductionCrewAssignment {
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

export async function getProductionCrews(factoryId: string): Promise<ProductionCrew[]> {
  const { data, error } = await supabase
    .from("production_crews")
    .select("id, factory_id, name, is_active, created_at, updated_at")
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapProductionCrew);
}

export async function createProductionCrew({
  factoryId,
  name,
}: Readonly<{ factoryId: string; name: string }>): Promise<ProductionCrew> {
  const { data, error } = await supabase
    .from("production_crews")
    .insert({ factory_id: factoryId, name })
    .select("id, factory_id, name, is_active, created_at, updated_at")
    .single();

  if (error) throw new ProductionCrewMutationError(error);
  if (!data) throw new Error("Production crew creation returned no row.");
  return mapProductionCrew(data);
}

export async function setProductionCrewActive({
  factoryId,
  crewId,
  isActive,
}: Readonly<{ factoryId: string; crewId: string; isActive: boolean }>): Promise<void> {
  const { data, error } = await supabase
    .from("production_crews")
    .update({ is_active: isActive })
    .eq("id", crewId)
    .eq("factory_id", factoryId)
    .select("id");

  if (error) throw new ProductionCrewMutationError(error);
  if (!data || data.length !== 1) throw new Error("Production crew was not updated.");
}

export async function getProductionCrewAssignments(factoryId: string): Promise<ProductionCrewAssignment[]> {
  const { data, error } = await supabase
    .from("production_crew_assignments")
    .select("id, factory_id, labourer_id, production_crew_id, effective_from, effective_to, created_at, updated_at")
    .eq("factory_id", factoryId)
    .order("effective_from", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapAssignment);
}

export function getCurrentProductionCrewAssignment(
  assignments: readonly ProductionCrewAssignment[],
  labourerId: string,
  asOfDate: string,
): ProductionCrewAssignment | null {
  return assignments.find((assignment) =>
    assignment.labourerId === labourerId
    && assignment.effectiveFrom <= asOfDate
    && (assignment.effectiveTo === null || assignment.effectiveTo >= asOfDate),
  ) ?? null;
}
