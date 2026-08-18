import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  TransportLockedWeeklyEarning,
  TransportWeeklyEarningDetail,
  TransportWorkDirection,
} from "../types.ts";

type TransportWeeklyEarningRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  week_start: string;
  total_amount: number | string;
  created_at: string;
  transport_worker: {
    id: string;
    name: string;
    is_active: boolean;
  };
};

type TransportWeeklyEarningDetailRow = {
  id: string;
  factory_id: string;
  transport_weekly_earning_id: string;
  transport_worker_id: string;
  week_start: string;
  work_date: string;
  transport_crew_id: string;
  transport_daily_entry_id: string;
  transport_crew_wage_rate_id: string;
  rate_per_paya_snapshot: number | string;
  paya_quantity_snapshot: number | string;
  attendance_count_snapshot: number;
  daily_crew_pool_snapshot: number | string;
  worker_daily_share_snapshot: number | string;
  created_at: string;
  daily_entry: {
    transport_crew: {
      id: string;
      name: string;
      work_direction: TransportWorkDirection;
    };
  };
};

export class TransportWeeklyEarningReadError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "TransportWeeklyEarningReadError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function listTransportWeeklyEarnings({
  factoryId,
  weekStart,
}: Readonly<{
  factoryId: string;
  weekStart: string;
}>): Promise<TransportLockedWeeklyEarning[]> {
  const { data, error } = await supabase
    .from("transport_weekly_earnings")
    .select(`
      id,
      factory_id,
      transport_worker_id,
      week_start,
      total_amount,
      created_at,
      transport_worker:transport_workers!transport_weekly_earnings_worker_factory_fkey(
        id,
        name,
        is_active
      )
    `)
    .eq("factory_id", factoryId)
    .eq("week_start", weekStart)
    .order("transport_worker_id", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new TransportWeeklyEarningReadError(error);

  return ((data ?? []) as unknown as TransportWeeklyEarningRow[])
    .map((row) => ({
      weeklyEarningId: row.id,
      factoryId: row.factory_id,
      transportWorkerId: row.transport_worker_id,
      transportWorkerName: row.transport_worker.name,
      transportWorkerIsActive: row.transport_worker.is_active,
      weekStart: row.week_start,
      totalAmount: Number(row.total_amount),
      createdAt: row.created_at,
    }))
    .sort((left, right) =>
      left.transportWorkerName.localeCompare(right.transportWorkerName, "en-IN")
      || left.transportWorkerId.localeCompare(right.transportWorkerId)
      || left.weeklyEarningId.localeCompare(right.weeklyEarningId),
    );
}

export async function listTransportWeeklyEarningDetails({
  factoryId,
  weeklyEarningId,
}: Readonly<{
  factoryId: string;
  weeklyEarningId: string;
}>): Promise<TransportWeeklyEarningDetail[]> {
  const { data, error } = await supabase
    .from("transport_weekly_earning_details")
    .select(`
      id,
      factory_id,
      transport_weekly_earning_id,
      transport_worker_id,
      week_start,
      work_date,
      transport_crew_id,
      transport_daily_entry_id,
      transport_crew_wage_rate_id,
      rate_per_paya_snapshot,
      paya_quantity_snapshot,
      attendance_count_snapshot,
      daily_crew_pool_snapshot,
      worker_daily_share_snapshot,
      created_at,
      daily_entry:transport_daily_entries!transport_weekly_earning_details_daily_entry_fkey(
        transport_crew:transport_crews!transport_daily_entries_crew_factory_fkey(
          id,
          name,
          work_direction
        )
      )
    `)
    .eq("factory_id", factoryId)
    .eq("transport_weekly_earning_id", weeklyEarningId)
    .order("work_date", { ascending: true })
    .order("transport_crew_id", { ascending: true })
    .order("transport_daily_entry_id", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new TransportWeeklyEarningReadError(error);

  return ((data ?? []) as unknown as TransportWeeklyEarningDetailRow[]).map((row) => ({
    detailId: row.id,
    factoryId: row.factory_id,
    transportWeeklyEarningId: row.transport_weekly_earning_id,
    transportWorkerId: row.transport_worker_id,
    weekStart: row.week_start,
    workDate: row.work_date,
    transportCrewId: row.transport_crew_id,
    transportCrewName: row.daily_entry.transport_crew.name,
    transportCrewWorkDirection: row.daily_entry.transport_crew.work_direction,
    transportDailyEntryId: row.transport_daily_entry_id,
    transportCrewWageRateId: row.transport_crew_wage_rate_id,
    ratePerPayaSnapshot: Number(row.rate_per_paya_snapshot),
    payaQuantitySnapshot: Number(row.paya_quantity_snapshot),
    attendanceCountSnapshot: row.attendance_count_snapshot,
    dailyCrewPoolSnapshot: Number(row.daily_crew_pool_snapshot),
    workerDailyShareSnapshot: Number(row.worker_daily_share_snapshot),
    createdAt: row.created_at,
  }));
}
