import type { PostgrestError } from "@supabase/supabase-js";
import { getLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";
import { assertCompletedWageWeek } from "./completed-wage-week-validation.ts";

export type MudShadowComparisonStatus =
  | "PARITY_OK"
  | "EXPECTED_RATE_CHANGE_DIFFERENCE"
  | "UNEXPECTED_MISMATCH"
  | "CONFIGURATION_ERROR";

export type MudShadowWeeklyComparison = {
  weekStart: string;
  labourGroupId: string;
  legacyWeeklyEarningId: string;
  legacyEarning: number;
  newEngineEarning: number | null;
  difference: number | null;
  status: MudShadowComparisonStatus;
  detail: string;
};

type MudShadowWeeklyComparisonRow = {
  week_start: string;
  labour_group_id: string;
  legacy_weekly_earning_id: string;
  legacy_earning: number;
  new_engine_earning: number | null;
  difference: number | null;
  status: MudShadowComparisonStatus;
  detail: string;
};

export class MudShadowComparisonError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "MudShadowComparisonError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function getMudShadowWeeklyComparisons({
  factoryId,
  fromWeekStart,
  toWeekStart,
  today = getLocalDate(),
}: Readonly<{
  factoryId: string;
  fromWeekStart: string;
  toWeekStart: string;
  today?: string;
}>): Promise<MudShadowWeeklyComparison[]> {
  if (!factoryId) throw new Error("Factory is required.");
  assertCompletedWageWeek(fromWeekStart, today);
  assertCompletedWageWeek(toWeekStart, today);
  if (fromWeekStart > toWeekStart) {
    throw new Error("From week must not be after to week.");
  }

  const { data, error } = await supabase.rpc("get_mud_shadow_weekly_comparisons", {
    p_factory_id: factoryId,
    p_from_week_start: fromWeekStart,
    p_to_week_start: toWeekStart,
  });
  if (error) throw new MudShadowComparisonError(error);

  return ((data ?? []) as MudShadowWeeklyComparisonRow[]).map((row) => ({
    weekStart: row.week_start,
    labourGroupId: row.labour_group_id,
    legacyWeeklyEarningId: row.legacy_weekly_earning_id,
    legacyEarning: Number(row.legacy_earning),
    newEngineEarning: row.new_engine_earning === null ? null : Number(row.new_engine_earning),
    difference: row.difference === null ? null : Number(row.difference),
    status: row.status,
    detail: row.detail,
  }));
}
