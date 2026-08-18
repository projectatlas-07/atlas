import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  SaveTransportDailyEntryInput,
  SaveTransportDailyEntryResult,
  TransportDailyEntryWithAttendance,
} from "../types.ts";

export { listAssignedTransportWorkersForCrew } from "./transport-crew-assignment-service.ts";

export type GetTransportDailyEntryInput = {
  factoryId: string;
  transportCrewId: string;
  workDate: string;
};

type TransportDailyEntryReadRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  work_date: string;
  paya_quantity: number | string;
  attendance: Array<{
    transport_worker_id: string;
    transport_worker: {
      id: string;
      name: string;
      is_active: boolean;
    };
  }>;
};

export class TransportDailyEntryServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportDailyEntryServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function assertRequiredId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertCanonicalWorkDate(workDate: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDate);
  if (!match) throw new Error("workDate must be a valid YYYY-MM-DD date.");

  const date = new Date(`${workDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== workDate) {
    throw new Error("workDate must be a valid YYYY-MM-DD date.");
  }
}

function validateEntryIdentity({
  factoryId,
  transportCrewId,
  workDate,
}: GetTransportDailyEntryInput): void {
  assertRequiredId(factoryId, "factoryId");
  assertRequiredId(transportCrewId, "transportCrewId");
  assertCanonicalWorkDate(workDate);
}

export async function getTransportDailyEntry({
  factoryId,
  transportCrewId,
  workDate,
}: GetTransportDailyEntryInput): Promise<TransportDailyEntryWithAttendance | null> {
  validateEntryIdentity({ factoryId, transportCrewId, workDate });

  const { data, error } = await supabase
    .from("transport_daily_entries")
    .select(`
      id,
      factory_id,
      transport_crew_id,
      work_date,
      paya_quantity,
      attendance:transport_daily_attendance!transport_daily_attendance_parent_fkey(
        transport_worker_id,
        transport_worker:transport_workers!transport_daily_attendance_worker_factory_fkey(
          id,
          name,
          is_active
        )
      )
    `)
    .eq("factory_id", factoryId)
    .eq("transport_crew_id", transportCrewId)
    .eq("work_date", workDate)
    .maybeSingle();

  if (error) throw new TransportDailyEntryServiceError(error);
  if (!data) return null;

  const entry = data as unknown as TransportDailyEntryReadRow;
  const attendanceWorkers = entry.attendance
    .map((attendance) => ({
      transportWorkerId: attendance.transport_worker_id,
      transportWorkerName: attendance.transport_worker.name,
      transportWorkerIsActive: attendance.transport_worker.is_active,
    }))
    .sort((left, right) =>
      left.transportWorkerName.localeCompare(right.transportWorkerName, "en-IN")
      || left.transportWorkerId.localeCompare(right.transportWorkerId),
    );
  return {
    dailyEntryId: entry.id,
    factoryId: entry.factory_id,
    transportCrewId: entry.transport_crew_id,
    workDate: entry.work_date,
    payaQuantity: Number(entry.paya_quantity),
    attendanceWorkerIds: attendanceWorkers
      .map((attendance) => attendance.transportWorkerId)
      .sort((left, right) => left.localeCompare(right)),
    attendanceWorkers,
  };
}

export async function saveTransportDailyEntry({
  factoryId,
  transportCrewId,
  workDate,
  payaQuantity,
  transportWorkerIds,
}: SaveTransportDailyEntryInput): Promise<SaveTransportDailyEntryResult> {
  validateEntryIdentity({ factoryId, transportCrewId, workDate });

  if (!Number.isFinite(payaQuantity) || payaQuantity <= 0) {
    throw new Error("payaQuantity must be greater than zero.");
  }
  if (transportWorkerIds.length === 0) {
    throw new Error("At least one transport worker must be selected.");
  }
  if (transportWorkerIds.some((workerId) => !workerId.trim())) {
    throw new Error("transportWorkerIds cannot contain an empty worker ID.");
  }
  if (new Set(transportWorkerIds).size !== transportWorkerIds.length) {
    throw new Error("transportWorkerIds cannot contain duplicates.");
  }

  const { data, error } = await supabase.rpc("save_transport_daily_entry", {
    p_factory_id: factoryId,
    p_transport_crew_id: transportCrewId,
    p_work_date: workDate,
    p_paya_quantity: payaQuantity,
    p_transport_worker_ids: transportWorkerIds,
  });

  if (error) throw new TransportDailyEntryServiceError(error);

  const result = data?.[0];
  if (!result) throw new Error("save_transport_daily_entry returned no result.");

  return {
    dailyEntryId: result.daily_entry_id,
    attendanceCount: result.attendance_count,
    savedPayaQuantity: result.saved_paya_quantity,
  };
}
