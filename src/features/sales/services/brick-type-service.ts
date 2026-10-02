import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

const BRICK_TYPE_COLUMNS =
  "id, factory_id, name, is_active, ever_used, created_at, updated_at";

type BrickTypeRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  ever_used: boolean;
  created_at: string;
  updated_at: string;
};

export type BrickType = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  everUsed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BrickTypeIdentity = Readonly<{
  factoryId: string;
  brickTypeId: string;
}>;

export class BrickTypeServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableBrickTypeError(error));
    this.name = "BrickTypeServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableBrickTypeError(error: PostgrestError): string {
  if (error.code === "23505") return "A Brick Type with this name already exists.";
  if (error.code === "P3400") return "Brick Type does not belong to this factory.";
  if (error.code === "P3401" || error.code === "P3402") {
    return "This Brick Type has been used in a Challan and cannot be deleted. Deactivate it instead.";
  }
  if (error.code === "P3403") return "Brick Type usage history cannot be changed.";
  return error.message;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function requireName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("Brick Type name is required.");
  return name;
}

function mapBrickType(row: BrickTypeRow): BrickType {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    isActive: row.is_active,
    everUsed: row.ever_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBrickTypes(factoryId: string): Promise<BrickType[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase
    .from("brick_types")
    .select(BRICK_TYPE_COLUMNS)
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new BrickTypeServiceError(error);
  return (data ?? []).map(mapBrickType);
}

export async function createBrickType(input: Readonly<{
  factoryId: string;
  name: string;
}>): Promise<BrickType> {
  requireId(input.factoryId, "factoryId");
  const { data, error } = await supabase.rpc("create_brick_type", {
    p_factory_id: input.factoryId,
    p_name: requireName(input.name),
  });

  if (error) throw new BrickTypeServiceError(error);
  if (!data) throw new Error("create_brick_type returned no Brick Type.");
  return mapBrickType(data);
}

export async function renameBrickType(input: BrickTypeIdentity & Readonly<{
  name: string;
}>): Promise<BrickType> {
  requireId(input.factoryId, "factoryId");
  requireId(input.brickTypeId, "brickTypeId");
  const { data, error } = await supabase.rpc("rename_brick_type", {
    p_factory_id: input.factoryId,
    p_brick_type_id: input.brickTypeId,
    p_name: requireName(input.name),
  });

  if (error) throw new BrickTypeServiceError(error);
  if (!data) throw new Error("rename_brick_type returned no Brick Type.");
  return mapBrickType(data);
}

async function setBrickTypeActive(
  input: BrickTypeIdentity,
  isActive: boolean,
): Promise<BrickType> {
  requireId(input.factoryId, "factoryId");
  requireId(input.brickTypeId, "brickTypeId");
  const { data, error } = await supabase.rpc("set_brick_type_active", {
    p_factory_id: input.factoryId,
    p_brick_type_id: input.brickTypeId,
    p_is_active: isActive,
  });

  if (error) throw new BrickTypeServiceError(error);
  if (!data) throw new Error("set_brick_type_active returned no Brick Type.");
  return mapBrickType(data);
}

export function deactivateBrickType(input: BrickTypeIdentity): Promise<BrickType> {
  return setBrickTypeActive(input, false);
}

export function reactivateBrickType(input: BrickTypeIdentity): Promise<BrickType> {
  return setBrickTypeActive(input, true);
}

export async function deleteUnusedBrickType(input: BrickTypeIdentity): Promise<void> {
  requireId(input.factoryId, "factoryId");
  requireId(input.brickTypeId, "brickTypeId");
  const { data, error } = await supabase.rpc("delete_unused_brick_type", {
    p_factory_id: input.factoryId,
    p_brick_type_id: input.brickTypeId,
  });

  if (error) throw new BrickTypeServiceError(error);
  if (data !== input.brickTypeId) {
    throw new Error("delete_unused_brick_type did not return the deleted Brick Type ID.");
  }
}
