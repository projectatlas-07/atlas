import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  SaveSoilDailyTrolleyEntriesInput,
  SoilDailyTrolleyEntry,
  SoilDailyTrolleyEntrySnapshot,
  SoilWorker,
} from "../types.ts";
import { listSoilWorkers } from "./soil-worker-rate-service.ts";

type SoilDailyTrolleyEntryRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  work_date: string;
  trolley_quantity: number | string;
  soil_worker_trolley_rate_id: string;
  rate_per_trolley_snapshot: number | string;
  base_amount_snapshot: number | string;
  created_at: string;
  updated_at: string;
};

type SoilDailyTrolleyEntryReadRow = SoilDailyTrolleyEntryRow & {
  soil_worker: {
    id: string;
    name: string;
    is_active: boolean;
  };
};

export class SoilDailyEntryServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableDailyEntryError(error));
    this.name = "SoilDailyEntryServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableDailyEntryError(error: PostgrestError): string {
  if (error.code === "P2A05") {
    return "This correction would make the worker's available balance negative. Resolve the financial balance in Office first.";
  }
  if (error.code === "P2A03") {
    return "An archived Soil worker cannot receive trolley entries. Restore the worker first.";
  }
  if (error.code === "P2605") {
    return "A Soil worker has no trolley rate for the selected work date.";
  }
  if (error.code === "P2602" || error.code === "23503") {
    return "A Soil worker does not belong to this factory.";
  }
  if (error.code === "22023" || error.code === "23514") {
    return "Check the selected date and trolley quantities.";
  }
  return error.message;
}

function assertRequiredId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertCanonicalWorkDate(workDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error("workDate must be a valid YYYY-MM-DD date.");
  }
  const date = new Date(`${workDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== workDate) {
    throw new Error("workDate must be a valid YYYY-MM-DD date.");
  }
}

function assertValidQuantity(quantity: number): void {
  const scaledQuantity = quantity * 1000;
  if (!Number.isFinite(quantity)
    || quantity <= 0
    || quantity >= 1_000_000_000
    || Math.abs(scaledQuantity - Math.round(scaledQuantity)) > 1e-7) {
    throw new Error(
      "trolleyQuantity must be positive, below 1000000000, and use at most three decimal places.",
    );
  }
}

function mapSnapshot(row: SoilDailyTrolleyEntryRow): SoilDailyTrolleyEntrySnapshot {
  return {
    id: row.id,
    factoryId: row.factory_id,
    soilWorkerId: row.soil_worker_id,
    workDate: row.work_date,
    trolleyQuantity: Number(row.trolley_quantity),
    soilWorkerTrolleyRateId: row.soil_worker_trolley_rate_id,
    ratePerTrolleySnapshot: Number(row.rate_per_trolley_snapshot),
    baseAmountSnapshot: Number(row.base_amount_snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listActiveSoilWorkers(factoryId: string): Promise<SoilWorker[]> {
  assertRequiredId(factoryId, "factoryId");
  return (await listSoilWorkers(factoryId)).filter((worker) => worker.isActive);
}

export async function listSoilDailyTrolleyEntries({
  factoryId,
  workDate,
}: Readonly<{ factoryId: string; workDate: string }>): Promise<SoilDailyTrolleyEntry[]> {
  assertRequiredId(factoryId, "factoryId");
  assertCanonicalWorkDate(workDate);

  const { data, error } = await supabase
    .from("soil_daily_trolley_entries")
    .select(`
      id,
      factory_id,
      soil_worker_id,
      work_date,
      trolley_quantity,
      soil_worker_trolley_rate_id,
      rate_per_trolley_snapshot,
      base_amount_snapshot,
      created_at,
      updated_at,
      soil_worker:soil_workers!soil_daily_trolley_entries_worker_factory_fkey(
        id,
        name,
        is_active
      )
    `)
    .eq("factory_id", factoryId)
    .eq("work_date", workDate)
    .order("soil_worker_id", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new SoilDailyEntryServiceError(error);

  return ((data ?? []) as unknown as SoilDailyTrolleyEntryReadRow[])
    .map((row) => ({
      ...mapSnapshot(row),
      soilWorkerName: row.soil_worker.name,
      soilWorkerIsActive: row.soil_worker.is_active,
    }))
    .sort((left, right) =>
      left.soilWorkerName.localeCompare(right.soilWorkerName, "en-IN")
      || left.soilWorkerId.localeCompare(right.soilWorkerId),
    );
}

export async function saveSoilDailyTrolleyEntries({
  factoryId,
  workDate,
  entries,
}: SaveSoilDailyTrolleyEntriesInput): Promise<SoilDailyTrolleyEntrySnapshot[]> {
  assertRequiredId(factoryId, "factoryId");
  assertCanonicalWorkDate(workDate);
  if (entries.length === 0) throw new Error("At least one Soil trolley entry is required.");

  const workerIds = new Set<string>();
  for (const entry of entries) {
    assertRequiredId(entry.soilWorkerId, "soilWorkerId");
    assertValidQuantity(entry.trolleyQuantity);
    if (workerIds.has(entry.soilWorkerId)) {
      throw new Error("Soil worker IDs cannot contain duplicates.");
    }
    workerIds.add(entry.soilWorkerId);
  }

  const { data, error } = await supabase.rpc("save_soil_daily_trolley_entries", {
    p_factory_id: factoryId,
    p_work_date: workDate,
    p_entries: entries.map((entry) => ({
      soil_worker_id: entry.soilWorkerId,
      trolley_quantity: entry.trolleyQuantity,
    })),
  });

  if (error) throw new SoilDailyEntryServiceError(error);
  if (!data || data.length !== entries.length) {
    throw new Error("save_soil_daily_trolley_entries returned an incomplete result.");
  }
  return data.map(mapSnapshot);
}
