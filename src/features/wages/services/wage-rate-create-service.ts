import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { WageRateAppliesTo, WageRateHistory } from "./wage-rate-service";

export type CreateWageRateInput = {
  factoryId: string;
  appliesTo: WageRateAppliesTo;
  ratePer1000Bricks: number;
  effectiveFrom: string;
};

export class CreateWageRateError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "CreateWageRateError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function createWageRate({
  factoryId,
  appliesTo,
  ratePer1000Bricks,
  effectiveFrom,
}: CreateWageRateInput): Promise<WageRateHistory> {
  const { data, error } = await supabase.rpc("create_wage_rate", {
    p_factory_id: factoryId,
    p_applies_to: appliesTo,
    p_rate_per_1000_bricks: ratePer1000Bricks,
    p_effective_from: effectiveFrom,
  });

  if (error) throw new CreateWageRateError(error);
  if (!data) throw new Error("create_wage_rate returned no wage rate.");

  return data;
}
