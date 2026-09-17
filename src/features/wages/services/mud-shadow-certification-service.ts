import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { MudShadowComparisonStatus } from "./mud-shadow-comparison-service.ts";

export type MudShadowCertificationStatus =
  | "READY"
  | "WAITING_FOR_COMPLETED_WEEK"
  | "CONFIGURATION_ERROR"
  | "UNEXPECTED_MISMATCH";

export type MudShadowCertification = {
  status: MudShadowCertificationStatus;
  certificationWeek: string | null;
  legacyEarning: number | null;
  newEngineEarning: number | null;
  difference: number | null;
  parityStatus: MudShadowComparisonStatus | null;
  reason: string;
};

type MudShadowCertificationRow = {
  certification_status: MudShadowCertificationStatus;
  certification_week: string | null;
  legacy_earning: number | null;
  new_engine_earning: number | null;
  difference: number | null;
  parity_status: MudShadowComparisonStatus | null;
  reason: string;
};

export class MudShadowCertificationError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "MudShadowCertificationError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function getMudShadowCertification(factoryId: string): Promise<MudShadowCertification> {
  if (!factoryId) throw new Error("Factory is required.");

  const { data, error } = await supabase.rpc("get_mud_shadow_certification_status", {
    p_factory_id: factoryId,
  });
  if (error) throw new MudShadowCertificationError(error);

  const row = (data as MudShadowCertificationRow[] | null)?.[0];
  if (!row) throw new Error("Mud SHADOW certification returned no status.");

  return {
    status: row.certification_status,
    certificationWeek: row.certification_week,
    legacyEarning: row.legacy_earning === null ? null : Number(row.legacy_earning),
    newEngineEarning: row.new_engine_earning === null ? null : Number(row.new_engine_earning),
    difference: row.difference === null ? null : Number(row.difference),
    parityStatus: row.parity_status,
    reason: row.reason,
  };
}
