import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  TransportDailyOperationsEntry,
  TransportWorkDirection,
} from "../types.ts";

type TransportDailyOperationsRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  work_date: string;
  paya_quantity: number | string;
  transport_crew: {
    id: string;
    name: string;
    work_direction: TransportWorkDirection;
  };
  attendance: Array<{
    transport_worker_id: string;
    transport_worker: {
      id: string;
      name: string;
      is_active: boolean;
    };
  }>;
};

export class TransportDailyOperationsReadError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportDailyOperationsReadError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function listTransportDailyOperations({
  factoryId,
  workDate,
}: Readonly<{
  factoryId: string;
  workDate: string;
}>): Promise<TransportDailyOperationsEntry[]> {
  const { data, error } = await supabase
    .from("transport_daily_entries")
    .select(`
      id,
      factory_id,
      transport_crew_id,
      work_date,
      paya_quantity,
      transport_crew:transport_crews!transport_daily_entries_crew_factory_fkey(
        id,
        name,
        work_direction
      ),
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
    .eq("work_date", workDate)
    .order("transport_crew_id", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new TransportDailyOperationsReadError(error);

  return ((data ?? []) as unknown as TransportDailyOperationsRow[])
    .map((entry) => {
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
        transportCrewName: entry.transport_crew.name,
        transportCrewWorkDirection: entry.transport_crew.work_direction,
        workDate: entry.work_date,
        payaQuantity: Number(entry.paya_quantity),
        attendanceCount: attendanceWorkers.length,
        attendanceWorkers,
      };
    })
    .sort((left, right) =>
      left.transportCrewName.localeCompare(right.transportCrewName, "en-IN")
      || left.transportCrewWorkDirection.localeCompare(right.transportCrewWorkDirection)
      || left.transportCrewId.localeCompare(right.transportCrewId)
      || left.dailyEntryId.localeCompare(right.dailyEntryId),
    );
}
