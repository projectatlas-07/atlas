import type { PostgrestError } from "@supabase/supabase-js";
import { isLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";
import type { WageRateHistory } from "./wage-rate-service.ts";

export type SetMudSupplyRateInput = {
  factoryId: string;
  ratePer1000Bricks: number;
  effectiveFrom: string;
};

export class SetMudSupplyRateError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "SetMudSupplyRateError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function setMudSupplyRate({
  factoryId,
  ratePer1000Bricks,
  effectiveFrom,
}: SetMudSupplyRateInput): Promise<WageRateHistory> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!Number.isFinite(ratePer1000Bricks) || ratePer1000Bricks <= 0) {
    throw new Error("Rate per 1,000 bricks must be greater than zero.");
  }
  if (!isLocalDate(effectiveFrom)) {
    throw new Error("Effective-from date must be a valid date.");
  }

  const { data, error } = await supabase.rpc("set_mud_supply_rate", {
    p_factory_id: factoryId,
    p_rate_per_1000_bricks: ratePer1000Bricks,
    p_effective_from: effectiveFrom,
  });

  if (error) throw new SetMudSupplyRateError(error);
  if (!data) throw new Error("Mud rate setting returned no wage rate.");
  return data;
}
