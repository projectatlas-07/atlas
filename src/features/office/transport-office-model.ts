import type { AssignTransportWorkerToCrewInput } from "@/features/transport/services/transport-crew-assignment-service";
import type { CreateTransportCrewWageRateInput } from "@/features/transport/services/transport-crew-wage-rate-service";
import type {
  TransportCrew,
  TransportCrewAssignment,
  TransportCrewWageRate,
  TransportWorkDirection,
} from "@/features/transport/types";

export function buildTransportWorkerCreateInput(
  factoryId: string,
  name: string,
): { factoryId: string; name: string } | null {
  const trimmedName = name.trim();
  return factoryId && trimmedName ? { factoryId, name: trimmedName } : null;
}

export function buildTransportCrewCreateInput({
  factoryId,
  name,
  workDirection,
}: Readonly<{
  factoryId: string;
  name: string;
  workDirection: string;
}>): {
  factoryId: string;
  name: string;
  workDirection: TransportWorkDirection;
} | null {
  const trimmedName = name.trim();
  if (!factoryId || !trimmedName || !isTransportWorkDirection(workDirection)) {
    return null;
  }
  return { factoryId, name: trimmedName, workDirection };
}

export function buildTransportAssignmentInput({
  factoryId,
  transportWorkerId,
  transportCrewId,
}: Readonly<{
  factoryId: string;
  transportWorkerId: string;
  transportCrewId: string;
}>): AssignTransportWorkerToCrewInput | null {
  if (!factoryId || !transportWorkerId || !transportCrewId) {
    return null;
  }
  return {
    factoryId,
    transportWorkerId,
    transportCrewId,
  };
}

export type TransportAssignmentListItem = {
  assignmentId: string;
  workerName: string;
  workerStatus: "Active" | "Inactive";
  crewName: string;
  crewDirection: string;
  crewStatus: "Active" | "Inactive";
};

export function buildTransportAssignmentListItem(
  assignment: TransportCrewAssignment,
): TransportAssignmentListItem {
  return {
    assignmentId: assignment.id,
    workerName: assignment.transportWorkerName,
    workerStatus: assignment.transportWorkerIsActive ? "Active" : "Inactive",
    crewName: assignment.transportCrewName,
    crewDirection: formatTransportDirection(assignment.transportCrewWorkDirection),
    crewStatus: assignment.transportCrewIsActive ? "Active" : "Inactive",
  };
}

export type TransportRateFormState = {
  selectedCrewId: string;
  effectiveFrom: string;
  rateInput: string;
};

export function selectTransportRateCrew(
  state: TransportRateFormState,
  selectedCrewId: string,
): TransportRateFormState {
  return { ...state, selectedCrewId };
}

export function transportRateFormAfterSuccess(
  state: TransportRateFormState,
): TransportRateFormState {
  return { ...state, rateInput: "" };
}

export function getTransportRateRefreshQueryKeys(
  factoryId: string,
  transportCrewId: string,
  workDate: string,
): readonly [readonly string[], readonly string[]] {
  return [
    ["office-transport-crew-wage-rates", factoryId, transportCrewId],
    ["office-transport-current-crew-wage-rate", factoryId, transportCrewId, workDate],
  ];
}

export function buildTransportCrewWageRateInput({
  factoryId,
  selectedCrewId,
  effectiveFrom,
  rateInput,
}: Readonly<TransportRateFormState & { factoryId: string }>): CreateTransportCrewWageRateInput | null {
  const ratePerPaya = Number(rateInput);
  if (
    !factoryId
    || !selectedCrewId
    || !isCanonicalDate(effectiveFrom)
    || !rateInput.trim()
    || !Number.isFinite(ratePerPaya)
    || ratePerPaya <= 0
  ) {
    return null;
  }

  return {
    factoryId,
    transportCrewId: selectedCrewId,
    effectiveFrom,
    ratePerPaya,
  };
}

export function formatTransportRatePerPaya(rate: number): string {
  return `₹${rate.toLocaleString("en-IN", { maximumFractionDigits: 20 })} / paya`;
}

export function buildTransportRateHistoryItem(rate: TransportCrewWageRate): {
  id: string;
  formattedRate: string;
  effectiveFrom: string;
  periodEndLabel: string;
} {
  return {
    id: rate.id,
    formattedRate: formatTransportRatePerPaya(rate.ratePerPaya),
    effectiveFrom: rate.effectiveFrom,
    periodEndLabel: rate.effectiveTo ?? "Current",
  };
}

export function buildTransportRateCrewOption(crew: TransportCrew): {
  id: string;
  label: string;
} {
  return {
    id: crew.id,
    label: `${crew.name}${crew.isActive ? "" : " (Inactive)"}`,
  };
}

export function transportRateOfficeErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "22023") {
    return "Rate must be positive and the effective date must be valid.";
  }
  if (code === "23P01" || /overlap|ambiguous|multiple.*rate/i.test(message)) {
    return "Transport crew wage-rate history is overlapping or ambiguous.";
  }
  if (/already starts|duplicate.*effective/i.test(message)) {
    return "A rate already starts on this effective date.";
  }
  if (/backdated/i.test(message)) {
    return "Backdated rates are not allowed; choose a date after the latest rate start.";
  }
  if (/does not belong to this factory/i.test(message)) {
    return "The selected transport crew does not belong to this factory.";
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to manage transport rates for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

export function formatTransportDirection(
  direction: TransportWorkDirection,
): string {
  return direction === "FIELD_TO_KILN" ? "Field → Kiln" : "Kiln → Field";
}

export function formatTransportActiveStatus(
  isActive: boolean,
): "Active" | "Inactive" {
  return isActive ? "Active" : "Inactive";
}

export function transportOfficeErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  const details = typeof failure.details === "string" ? failure.details : "";

  if (code === "23503") {
    return "The worker, crew, and assignment must belong to the same factory.";
  }
  if (code === "23505") {
    if (/already assigned|transport_crew_assignments/i.test(`${message} ${details}`)) {
      return "This worker is already assigned to this crew.";
    }
    return "A transport crew with this name already exists.";
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to manage chamber transport for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

function isTransportWorkDirection(
  value: string,
): value is TransportWorkDirection {
  return value === "FIELD_TO_KILN" || value === "KILN_TO_FIELD";
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf())
    && date.toISOString().slice(0, 10) === value;
}
