import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { TransportCrewWageRate } from "../types.ts";

export type ListTransportCrewWageRatesInput = {
  factoryId: string;
  transportCrewId: string;
};

export type CreateTransportCrewWageRateInput = {
  factoryId: string;
  transportCrewId: string;
  effectiveFrom: string;
  ratePerPaya: number;
};

export type GetTransportCrewWageRateForDateInput = {
  factoryId: string;
  transportCrewId: string;
  workDate: string;
};

export type TransportCrewWageRateResolutionFailure = "missing" | "overlapping";

export class TransportCrewWageRateResolutionError extends Error {
  readonly failure: TransportCrewWageRateResolutionFailure;

  constructor(
    failure: TransportCrewWageRateResolutionFailure,
    message: string,
  ) {
    super(message);
    this.name = "TransportCrewWageRateResolutionError";
    this.failure = failure;
  }
}

type TransportCrewWageRateRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  rate_per_paya: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export class TransportCrewWageRateServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableRateErrorMessage(error));
    this.name = "TransportCrewWageRateServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableRateErrorMessage(error: PostgrestError): string {
  if (error.code === "23P01") {
    return "Transport crew wage-rate periods cannot overlap.";
  }

  if (error.code === "23503") {
    return "Transport crew does not belong to this factory.";
  }

  return error.message;
}

function mapTransportCrewWageRate(
  row: TransportCrewWageRateRow,
): TransportCrewWageRate {
  return {
    id: row.id,
    factoryId: row.factory_id,
    transportCrewId: row.transport_crew_id,
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

export async function listTransportCrewWageRates({
  factoryId,
  transportCrewId,
}: ListTransportCrewWageRatesInput): Promise<TransportCrewWageRate[]> {
  const { data, error } = await supabase
    .from("transport_crew_wage_rates")
    .select(
      "id, factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to, created_at",
    )
    .eq("factory_id", factoryId)
    .eq("transport_crew_id", transportCrewId)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new TransportCrewWageRateServiceError(error);
  return (data ?? []).map(mapTransportCrewWageRate);
}

export async function createTransportCrewWageRate({
  factoryId,
  transportCrewId,
  effectiveFrom,
  ratePerPaya,
}: CreateTransportCrewWageRateInput): Promise<TransportCrewWageRate> {
  const { data, error } = await supabase.rpc("create_transport_crew_wage_rate", {
    p_factory_id: factoryId,
    p_transport_crew_id: transportCrewId,
    p_effective_from: effectiveFrom,
    p_rate_per_paya: ratePerPaya,
  });

  if (error) throw new TransportCrewWageRateServiceError(error);
  if (!data) throw new Error("create_transport_crew_wage_rate returned no rate.");

  return mapTransportCrewWageRate(data);
}

export async function getTransportCrewWageRateForDate({
  factoryId,
  transportCrewId,
  workDate,
}: GetTransportCrewWageRateForDateInput): Promise<TransportCrewWageRate> {
  assertCanonicalWorkDate(workDate);

  const { data, error } = await supabase
    .from("transport_crew_wage_rates")
    .select(
      "id, factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to, created_at",
    )
    .eq("factory_id", factoryId)
    .eq("transport_crew_id", transportCrewId)
    .lte("effective_from", workDate)
    .or(`effective_to.is.null,effective_to.gte.${workDate}`)
    .limit(2);

  if (error) throw new TransportCrewWageRateServiceError(error);

  const applicableRates = (data ?? []).map(mapTransportCrewWageRate);

  if (applicableRates.length === 0) {
    throw new TransportCrewWageRateResolutionError(
      "missing",
      `No transport crew wage rate applies to crew ${transportCrewId} on ${workDate}.`,
    );
  }

  if (applicableRates.length > 1) {
    throw new TransportCrewWageRateResolutionError(
      "overlapping",
      `Overlapping transport crew wage rates apply to crew ${transportCrewId} on ${workDate}.`,
    );
  }

  return applicableRates[0];
}
