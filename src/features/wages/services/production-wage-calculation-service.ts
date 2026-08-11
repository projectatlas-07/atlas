import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";

export type CalculateProductionWagesInput = {
  factoryId: string;
  weekStart: string;
};

export type ProductionWageCalculationSummary = {
  labourersCalculated: number;
  rowsSkipped: number;
};

export class CalculateProductionWagesError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CalculateProductionWagesError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function calculateProductionWages({
  factoryId,
  weekStart,
}: CalculateProductionWagesInput): Promise<ProductionWageCalculationSummary> {
  const { data, error } = await supabase.rpc("calculate_production_wages", {
    p_factory_id: factoryId,
    p_week_start: weekStart,
  });

  if (error) throw new CalculateProductionWagesError(error);

  const summary = data?.[0];
  if (!summary) throw new Error("calculate_production_wages returned no summary.");

  return {
    labourersCalculated: summary.labourers_calculated,
    rowsSkipped: summary.rows_skipped,
  };
}
