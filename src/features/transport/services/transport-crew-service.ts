import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { TransportGroup } from "../types.ts";

type TransportGroupRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export class TransportGroupServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportGroupServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function mapTransportGroup(row: TransportGroupRow): TransportGroup {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTransportGroups(factoryId: string): Promise<TransportGroup[]> {
  const { data, error } = await supabase
    .from("transport_crews")
    .select("id, factory_id, name, is_active, created_at, updated_at")
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new TransportGroupServiceError(error);
  return (data ?? []).map(mapTransportGroup);
}

export async function createTransportGroup({
  factoryId,
  name,
}: Readonly<{
  factoryId: string;
  name: string;
}>): Promise<TransportGroup> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Transport Group name is required.");

  const { data, error } = await supabase
    .from("transport_crews")
    .insert({
      factory_id: factoryId,
      name: trimmedName,
    })
    .select("id, factory_id, name, is_active, created_at, updated_at")
    .single();

  if (error) throw new TransportGroupServiceError(error);
  if (!data) throw new Error("Transport Group creation returned no row.");
  return mapTransportGroup(data);
}

async function setTransportGroupActive({
  factoryId,
  transportGroupId,
  isActive,
}: Readonly<{
  factoryId: string;
  transportGroupId: string;
  isActive: boolean;
}>): Promise<void> {
  const { data, error } = await supabase
    .from("transport_crews")
    .update({ is_active: isActive })
    .eq("id", transportGroupId)
    .eq("factory_id", factoryId)
    .select("id");

  if (error) throw new TransportGroupServiceError(error);
  if (!data || data.length === 0) throw new Error("Transport Group was not updated.");
  if (data.length !== 1) {
    throw new Error("Unexpected result: more than one Transport Group was updated.");
  }
}

export async function activateTransportGroup(
  input: Readonly<{ factoryId: string; transportGroupId: string }>,
): Promise<void> {
  await setTransportGroupActive({ ...input, isActive: true });
}

export async function deactivateTransportGroup(
  input: Readonly<{ factoryId: string; transportGroupId: string }>,
): Promise<void> {
  await setTransportGroupActive({ ...input, isActive: false });
}
