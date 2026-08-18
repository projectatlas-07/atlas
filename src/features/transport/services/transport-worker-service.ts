import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { TransportWorker } from "../types.ts";

type TransportWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export class TransportWorkerServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportWorkerServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function mapTransportWorker(row: TransportWorkerRow): TransportWorker {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTransportWorkers(factoryId: string): Promise<TransportWorker[]> {
  const { data, error } = await supabase
    .from("transport_workers")
    .select("id, factory_id, name, is_active, created_at, updated_at")
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new TransportWorkerServiceError(error);
  return (data ?? []).map(mapTransportWorker);
}

export async function createTransportWorker({
  factoryId,
  name,
}: Readonly<{ factoryId: string; name: string }>): Promise<TransportWorker> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Transport worker name is required.");

  const { data, error } = await supabase
    .from("transport_workers")
    .insert({ factory_id: factoryId, name: trimmedName })
    .select("id, factory_id, name, is_active, created_at, updated_at")
    .single();

  if (error) throw new TransportWorkerServiceError(error);
  if (!data) throw new Error("Transport worker creation returned no row.");
  return mapTransportWorker(data);
}

async function setTransportWorkerActive({
  factoryId,
  transportWorkerId,
  isActive,
}: Readonly<{
  factoryId: string;
  transportWorkerId: string;
  isActive: boolean;
}>): Promise<void> {
  const { data, error } = await supabase
    .from("transport_workers")
    .update({ is_active: isActive })
    .eq("id", transportWorkerId)
    .eq("factory_id", factoryId)
    .select("id");

  if (error) throw new TransportWorkerServiceError(error);
  if (!data || data.length === 0) throw new Error("Transport worker was not updated.");
  if (data.length !== 1) {
    throw new Error("Unexpected result: more than one transport worker was updated.");
  }
}

export async function activateTransportWorker(
  input: Readonly<{ factoryId: string; transportWorkerId: string }>,
): Promise<void> {
  await setTransportWorkerActive({ ...input, isActive: true });
}

export async function deactivateTransportWorker(
  input: Readonly<{ factoryId: string; transportWorkerId: string }>,
): Promise<void> {
  await setTransportWorkerActive({ ...input, isActive: false });
}
