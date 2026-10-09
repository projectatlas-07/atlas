import type { PostgrestError } from "@supabase/supabase-js";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import { supabase } from "../../../lib/supabase/client.ts";
import type { TransportGroupWageRate } from "../types.ts";

export type ListTransportGroupWageRatesInput = {
  factoryId: string;
  transportGroupId: string;
};

export type CreateTransportGroupWageRateInput = {
  factoryId: string;
  transportGroupId: string;
  effectiveFrom: string;
  ratePerPaya: number;
};

export type GetTransportGroupWageRateForDateInput = {
  factoryId: string;
  transportGroupId: string;
  workDate: string;
};

export type TransportGroupWageRateResolutionFailure = "missing" | "overlapping";

export class TransportGroupWageRateResolutionError extends Error {
  readonly failure: TransportGroupWageRateResolutionFailure;

  constructor(
    failure: TransportGroupWageRateResolutionFailure,
    message: string,
  ) {
    super(message);
    this.name = "TransportGroupWageRateResolutionError";
    this.failure = failure;
  }
}

type TransportGroupWageRateRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  rate_per_paya: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export class TransportGroupWageRateServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableRateErrorMessage(error));
    this.name = "TransportGroupWageRateServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableRateErrorMessage(error: PostgrestError): string {
  if (error.code === "P2622"
    && error.message === "ATLAS_TRANSPORT_RATE_AFFECTS_FINALIZED_EARNINGS") {
    return ATLAS_UI_STRINGS.transport.rateAffectsFinalizedEarnings;
  }

  if (error.code === "23P01") {
    return "Transport Group wage-rate periods cannot overlap.";
  }

  if (error.code === "23503") {
    return "Transport Group does not belong to this factory.";
  }

  return error.message;
}

function mapTransportGroupWageRate(
  row: TransportGroupWageRateRow,
): TransportGroupWageRate {
  return {
    id: row.id,
    factoryId: row.factory_id,
    transportGroupId: row.transport_crew_id,
    ratePerPaya: row.rate_per_paya,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
  };
}

function assertCanonicalWorkDate(workDate: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDate);
  if (!match) throw new Error("workDate must be a valid YYYY-MM-DD date.");

  const date = new Date(`${workDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== workDate) {
    throw new Error("workDate must be a valid YYYY-MM-DD date.");
  }
}

export async function listTransportGroupWageRates({
  factoryId,
  transportGroupId,
}: ListTransportGroupWageRatesInput): Promise<TransportGroupWageRate[]> {
  const { data, error } = await supabase
    .from("transport_crew_wage_rates")
    .select(
      "id, factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to, created_at",
    )
    .eq("factory_id", factoryId)
    .eq("transport_crew_id", transportGroupId)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new TransportGroupWageRateServiceError(error);
  return (data ?? []).map(mapTransportGroupWageRate);
}

export async function createTransportGroupWageRate({
  factoryId,
  transportGroupId,
  effectiveFrom,
  ratePerPaya,
}: CreateTransportGroupWageRateInput): Promise<TransportGroupWageRate> {
  const { data, error } = await supabase.rpc("create_transport_crew_wage_rate", {
    p_factory_id: factoryId,
    p_transport_crew_id: transportGroupId,
    p_effective_from: effectiveFrom,
    p_rate_per_paya: ratePerPaya,
  });

  if (error) throw new TransportGroupWageRateServiceError(error);
  if (!data) throw new Error("create_transport_crew_wage_rate returned no rate.");

  return mapTransportGroupWageRate(data);
}

export async function getTransportGroupWageRateForDate({
  factoryId,
  transportGroupId,
  workDate,
}: GetTransportGroupWageRateForDateInput): Promise<TransportGroupWageRate> {
  assertCanonicalWorkDate(workDate);

  const { data, error } = await supabase
    .from("transport_crew_wage_rates")
    .select(
      "id, factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to, created_at",
    )
    .eq("factory_id", factoryId)
    .eq("transport_crew_id", transportGroupId)
    .lte("effective_from", workDate)
    .or(`effective_to.is.null,effective_to.gte.${workDate}`)
    .limit(2);

  if (error) throw new TransportGroupWageRateServiceError(error);

  const applicableRates = (data ?? []).map(mapTransportGroupWageRate);

  if (applicableRates.length === 0) {
    throw new TransportGroupWageRateResolutionError(
      "missing",
      `No Transport Group wage rate applies to group ${transportGroupId} on ${workDate}.`,
    );
  }

  if (applicableRates.length > 1) {
    throw new TransportGroupWageRateResolutionError(
      "overlapping",
      `Overlapping Transport Group wage rates apply to group ${transportGroupId} on ${workDate}.`,
    );
  }

  return applicableRates[0];
}
