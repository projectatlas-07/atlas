import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import {
  isWageEarningsDateRange,
  type WageEarningsDateRange,
} from "../../wages/wage-earnings-date-range.ts";
import type { SoilEarning, SoilEarningEventType } from "../types.ts";

type SoilEarningRow = {
  id: string;
  factory_id: string;
  soil_worker_id: string;
  soil_daily_trolley_entry_id: string;
  work_date: string;
  event_type: SoilEarningEventType;
  event_sequence: number;
  amount: number | string;
  trolley_quantity_snapshot: number | string;
  rate_per_trolley_snapshot: number | string;
  previous_base_amount_snapshot: number | string;
  source_base_amount_snapshot: number | string;
  created_at: string;
};

export class SoilEarningReadServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "SoilEarningReadServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function assertRequiredId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

type SoilEarningReadIdentity = {
  factoryId: string;
  soilWorkerId: string;
};

function assertReadIdentity({
  factoryId,
  soilWorkerId,
}: SoilEarningReadIdentity): void {
  assertRequiredId(factoryId, "factoryId");
  assertRequiredId(soilWorkerId, "soilWorkerId");
}

function mapSoilEarning(row: SoilEarningRow): SoilEarning {
  return {
    id: row.id,
    factoryId: row.factory_id,
    soilWorkerId: row.soil_worker_id,
    soilDailyTrolleyEntryId: row.soil_daily_trolley_entry_id,
    workDate: row.work_date,
    eventType: row.event_type,
    eventSequence: row.event_sequence,
    amount: Number(row.amount),
    trolleyQuantitySnapshot: Number(row.trolley_quantity_snapshot),
    ratePerTrolleySnapshot: Number(row.rate_per_trolley_snapshot),
    previousBaseAmountSnapshot: Number(row.previous_base_amount_snapshot),
    sourceBaseAmountSnapshot: Number(row.source_base_amount_snapshot),
    createdAt: row.created_at,
  };
}

export async function listSoilEarnings({
  factoryId,
  soilWorkerId,
  range,
}: Readonly<SoilEarningReadIdentity & {
  range: WageEarningsDateRange;
}>): Promise<SoilEarning[]> {
  assertReadIdentity({ factoryId, soilWorkerId });
  if (!isWageEarningsDateRange(range)) {
    throw new Error("Soil wage dates must be a valid inclusive range.");
  }

  const { data, error } = await supabase
    .from("soil_earnings")
    .select(
      "id, factory_id, soil_worker_id, soil_daily_trolley_entry_id, work_date, event_type, event_sequence, amount, trolley_quantity_snapshot, rate_per_trolley_snapshot, previous_base_amount_snapshot, source_base_amount_snapshot, created_at",
    )
    .eq("factory_id", factoryId)
    .eq("soil_worker_id", soilWorkerId)
    .gte("work_date", range.fromDate)
    .lte("work_date", range.toDate)
    .order("work_date", { ascending: false })
    .order("soil_daily_trolley_entry_id", { ascending: true })
    .order("event_sequence", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new SoilEarningReadServiceError(error);
  return (data ?? []).map(mapSoilEarning);
}

export async function hasSoilEarningHistory(
  input: Readonly<SoilEarningReadIdentity>,
): Promise<boolean> {
  assertReadIdentity(input);
  const { data, error } = await supabase
    .from("soil_earnings")
    .select("id")
    .eq("factory_id", input.factoryId)
    .eq("soil_worker_id", input.soilWorkerId)
    .limit(1);
  if (error) throw new SoilEarningReadServiceError(error);
  return (data?.length ?? 0) > 0;
}

export async function getSoilTotalEarned({
  factoryId,
  soilWorkerId,
}: Readonly<{ factoryId: string; soilWorkerId: string }>): Promise<number> {
  assertReadIdentity({ factoryId, soilWorkerId });

  const { data, error } = await supabase.rpc("get_soil_total_earned", {
    p_factory_id: factoryId,
    p_soil_worker_id: soilWorkerId,
  });

  if (error) throw new SoilEarningReadServiceError(error);
  const result = data?.[0];
  if (!result) throw new Error("get_soil_total_earned returned no result.");
  return Number(result.total_earned);
}
