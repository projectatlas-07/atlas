import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { SoilWorker, SoilWorkerTrolleyRate } from "../types.ts";

const SOIL_WORKER_COLUMNS =
  "id, factory_id, name, is_active, created_at, updated_at";
const SOIL_RATE_COLUMNS =
  "id, factory_id, soil_worker_id, rate_per_trolley, effective_from, effective_to, created_at";

type SoilWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SoilWorkerTrolleyRateRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  rate_per_trolley: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export type CreateSoilWorkerInput = {
  factoryId: string;
  name: string;
  initialRatePerTrolley: number;
  initialEffectiveFrom: string;
};

export type SoilWorkerRateInput = {
  factoryId: string;
  soilWorkerId: string;
};

export type SoilWorkerLifecycleInput = SoilWorkerRateInput;

export type CreateSoilWorkerTrolleyRateInput = SoilWorkerRateInput & {
  ratePerTrolley: number;
  effectiveFrom: string;
};

export type ResolveSoilWorkerTrolleyRateInput = SoilWorkerRateInput & {
  workDate: string;
};

export class SoilSupplyServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableSoilErrorMessage(error));
    this.name = "SoilSupplyServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableSoilErrorMessage(error: PostgrestError): string {
  if (error.code === "23P01" || error.code === "P2603") {
    return "Soil worker trolley-rate periods cannot overlap or start out of order.";
  }
  if (error.code === "23503" || error.code === "P2602") {
    return "Soil worker does not belong to this factory.";
  }
  if (error.code === "P2A01") return "This Soil worker is already archived.";
  if (error.code === "P2A02") return "This Soil worker is already active.";
  if (error.code === "P2A03") {
    return "Archived Soil workers cannot receive trolley entries. Restore the worker first.";
  }
  if (error.code === "P2A04") {
    return "This Soil worker has historical records and cannot be deleted. Archive the worker instead.";
  }
  return error.message;
}

function mapSoilWorker(row: SoilWorkerRow): SoilWorker {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSoilRate(row: SoilWorkerTrolleyRateRow): SoilWorkerTrolleyRate {
  return {
    id: row.id,
    factoryId: row.factory_id,
    soilWorkerId: row.soil_worker_id,
    ratePerTrolley: row.rate_per_trolley,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
  };
}

function requireWorkerName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  if (!normalizedName) throw new Error("Soil worker name is required.");
  return normalizedName;
}

function assertCanonicalDate(value: string, fieldName: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }
}

export async function listSoilWorkers(factoryId: string): Promise<SoilWorker[]> {
  const { data, error } = await supabase
    .from("soil_workers")
    .select(SOIL_WORKER_COLUMNS)
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new SoilSupplyServiceError(error);
  return (data ?? []).map(mapSoilWorker);
}

export async function createSoilWorker({
  factoryId,
  name,
  initialRatePerTrolley,
  initialEffectiveFrom,
}: CreateSoilWorkerInput): Promise<SoilWorker> {
  assertCanonicalDate(initialEffectiveFrom, "initialEffectiveFrom");

  const { data, error } = await supabase.rpc(
    "create_soil_worker_with_initial_trolley_rate",
    {
      p_factory_id: factoryId,
      p_name: requireWorkerName(name),
      p_initial_rate_per_trolley: initialRatePerTrolley,
      p_initial_effective_from: initialEffectiveFrom,
    },
  );

  if (error) throw new SoilSupplyServiceError(error);
  if (!data) {
    throw new Error(
      "create_soil_worker_with_initial_trolley_rate returned no worker.",
    );
  }
  return mapSoilWorker(data);
}

export async function listSoilWorkerTrolleyRates({
  factoryId,
  soilWorkerId,
}: SoilWorkerRateInput): Promise<SoilWorkerTrolleyRate[]> {
  const { data, error } = await supabase
    .from("soil_worker_trolley_rates")
    .select(SOIL_RATE_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("soil_worker_id", soilWorkerId)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new SoilSupplyServiceError(error);
  return (data ?? []).map(mapSoilRate);
}

export async function createSoilWorkerTrolleyRate({
  factoryId,
  soilWorkerId,
  ratePerTrolley,
  effectiveFrom,
}: CreateSoilWorkerTrolleyRateInput): Promise<SoilWorkerTrolleyRate> {
  assertCanonicalDate(effectiveFrom, "effectiveFrom");

  const { data, error } = await supabase.rpc("create_soil_worker_trolley_rate", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
    p_rate_per_trolley: ratePerTrolley,
    p_effective_from: effectiveFrom,
  });

  if (error) throw new SoilSupplyServiceError(error);
  if (!data) throw new Error("create_soil_worker_trolley_rate returned no rate.");
  return mapSoilRate(data);
}

export async function resolveSoilWorkerTrolleyRate({
  factoryId,
  soilWorkerId,
  workDate,
}: ResolveSoilWorkerTrolleyRateInput): Promise<SoilWorkerTrolleyRate> {
  assertCanonicalDate(workDate, "workDate");

  const { data, error } = await supabase.rpc("resolve_soil_worker_trolley_rate", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
    p_work_date: workDate,
  });

  if (error) throw new SoilSupplyServiceError(error);
  if (!data) throw new Error("resolve_soil_worker_trolley_rate returned no rate.");
  return mapSoilRate(data);
}

export async function archiveSoilWorker({
  factoryId,
  soilWorkerId,
}: SoilWorkerLifecycleInput): Promise<SoilWorker> {
  const { data, error } = await supabase.rpc("archive_soil_worker", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
  });

  if (error) throw new SoilSupplyServiceError(error);
  if (!data) throw new Error("archive_soil_worker returned no worker.");
  return mapSoilWorker(data);
}

export async function restoreSoilWorker({
  factoryId,
  soilWorkerId,
}: SoilWorkerLifecycleInput): Promise<SoilWorker> {
  const { data, error } = await supabase.rpc("restore_soil_worker", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
  });

  if (error) throw new SoilSupplyServiceError(error);
  if (!data) throw new Error("restore_soil_worker returned no worker.");
  return mapSoilWorker(data);
}

export async function deleteUnusedSoilWorker({
  factoryId,
  soilWorkerId,
}: SoilWorkerLifecycleInput): Promise<void> {
  const { data, error } = await supabase.rpc("delete_unused_soil_worker", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
  });

  if (error) throw new SoilSupplyServiceError(error);
  if (data !== soilWorkerId) {
    throw new Error("delete_unused_soil_worker did not return the deleted worker ID.");
  }
}
