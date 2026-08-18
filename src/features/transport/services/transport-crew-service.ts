import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { TransportCrew, TransportWorkDirection } from "../types.ts";

type TransportCrewRow = {
  id: string;
  factory_id: string;
  name: string;
  work_direction: TransportWorkDirection;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const transportWorkDirections: readonly TransportWorkDirection[] = [
  "FIELD_TO_KILN",
  "KILN_TO_FIELD",
];

export class TransportCrewServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportCrewServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function mapTransportCrew(row: TransportCrewRow): TransportCrew {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    workDirection: row.work_direction,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isTransportWorkDirection(value: string): value is TransportWorkDirection {
  return transportWorkDirections.includes(value as TransportWorkDirection);
}

export async function listTransportCrews(factoryId: string): Promise<TransportCrew[]> {
  const { data, error } = await supabase
    .from("transport_crews")
    .select("id, factory_id, name, work_direction, is_active, created_at, updated_at")
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new TransportCrewServiceError(error);
  return (data ?? []).map(mapTransportCrew);
}

export async function createTransportCrew({
  factoryId,
  name,
  workDirection,
}: Readonly<{
  factoryId: string;
  name: string;
  workDirection: TransportWorkDirection;
}>): Promise<TransportCrew> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Transport crew name is required.");
  if (!isTransportWorkDirection(workDirection)) {
    throw new Error("Transport work direction must be FIELD_TO_KILN or KILN_TO_FIELD.");
  }

  const { data, error } = await supabase
    .from("transport_crews")
    .insert({
      factory_id: factoryId,
      name: trimmedName,
      work_direction: workDirection,
    })
    .select("id, factory_id, name, work_direction, is_active, created_at, updated_at")
    .single();

  if (error) throw new TransportCrewServiceError(error);
  if (!data) throw new Error("Transport crew creation returned no row.");
  return mapTransportCrew(data);
}

async function setTransportCrewActive({
  factoryId,
  transportCrewId,
  isActive,
}: Readonly<{
  factoryId: string;
  transportCrewId: string;
  isActive: boolean;
}>): Promise<void> {
  const { data, error } = await supabase
    .from("transport_crews")
    .update({ is_active: isActive })
    .eq("id", transportCrewId)
    .eq("factory_id", factoryId)
    .select("id");

  if (error) throw new TransportCrewServiceError(error);
  if (!data || data.length === 0) throw new Error("Transport crew was not updated.");
  if (data.length !== 1) {
    throw new Error("Unexpected result: more than one transport crew was updated.");
  }
}

export async function activateTransportCrew(
  input: Readonly<{ factoryId: string; transportCrewId: string }>,
): Promise<void> {
  await setTransportCrewActive({ ...input, isActive: true });
}

export async function deactivateTransportCrew(
  input: Readonly<{ factoryId: string; transportCrewId: string }>,
): Promise<void> {
  await setTransportCrewActive({ ...input, isActive: false });
}
