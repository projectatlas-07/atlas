import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

export type CalculateMudSupplyWagesInput = {
  factoryId: string;
  labourGroupId: string;
  weekStart: string;
};

export type MudSupplyWageCalculationSummary = {
  weeklyEarningId: string;
  groupsCalculated: number;
  rowsSkipped: number;
};

export class CalculateMudSupplyWagesError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CalculateMudSupplyWagesError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function calculateMudSupplyWages({
  factoryId,
  labourGroupId,
  weekStart,
}: CalculateMudSupplyWagesInput): Promise<MudSupplyWageCalculationSummary> {
  const { data, error } = await supabase.rpc("calculate_mud_supply_wages", {
    p_factory_id: factoryId,
    p_labour_group_id: labourGroupId,
    p_week_start: weekStart,
  });

  if (error) throw new CalculateMudSupplyWagesError(error);

  const summary = data?.[0];
  if (!summary) throw new Error("calculate_mud_supply_wages returned no summary.");

  return {
    weeklyEarningId: summary.weekly_earning_id,
    groupsCalculated: summary.groups_calculated,
    rowsSkipped: summary.rows_skipped,
  };
}
