import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

export type CalculateTransportWeeklyWagesInput = {
  factoryId: string;
  weekStart: string;
};

export type TransportWeeklyWageCalculationSummary = {
  workersCalculated: number;
  detailRowsCreated: number;
  rowsSkipped: number;
};

export class CalculateTransportWeeklyWagesError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CalculateTransportWeeklyWagesError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function calculateTransportWeeklyWages({
  factoryId,
  weekStart,
}: CalculateTransportWeeklyWagesInput): Promise<TransportWeeklyWageCalculationSummary> {
  const { data, error } = await supabase.rpc("calculate_transport_weekly_wages", {
    p_factory_id: factoryId,
    p_week_start: weekStart,
  });

  if (error) throw new CalculateTransportWeeklyWagesError(error);

  const summary = data?.[0];
  if (!summary) {
    throw new Error("calculate_transport_weekly_wages returned no summary.");
  }

  return {
    workersCalculated: summary.workers_calculated,
    detailRowsCreated: summary.detail_rows_created,
    rowsSkipped: summary.rows_skipped,
  };
}
