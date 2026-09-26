import type { AssignTransportWorkerToGroupInput } from "@/features/transport/services/transport-crew-assignment-service";
import type { CreateTransportGroupWageRateInput } from "@/features/transport/services/transport-crew-wage-rate-service";
import type {
  TransportGroup,
  TransportGroupAssignment,
  TransportGroupWageRate,
} from "@/features/transport/types";

export function buildTransportWorkerCreateInput(
  factoryId: string,
  name: string,
): { factoryId: string; name: string } | null {
  const trimmedName = name.trim();
  return factoryId && trimmedName ? { factoryId, name: trimmedName } : null;
}

export function buildTransportGroupCreateInput({
  factoryId,
  name,
}: Readonly<{
  factoryId: string;
  name: string;
}>): {
  factoryId: string;
  name: string;
} | null {
  const trimmedName = name.trim();
  if (!factoryId || !trimmedName) {
    return null;
  }
  return { factoryId, name: trimmedName };
}

export function buildTransportAssignmentInput({
  factoryId,
  transportWorkerId,
  transportGroupId,
}: Readonly<{
  factoryId: string;
  transportWorkerId: string;
  transportGroupId: string;
}>): AssignTransportWorkerToGroupInput | null {
  if (!factoryId || !transportWorkerId || !transportGroupId) {
    return null;
  }
  return {
    factoryId,
    transportWorkerId,
    transportGroupId,
  };
}

export type TransportAssignmentListItem = {
  assignmentId: string;
  workerName: string;
  workerStatus: "Active" | "Inactive";
  groupName: string;
  groupStatus: "Active" | "Inactive";
};

export function buildTransportAssignmentListItem(
  assignment: TransportGroupAssignment,
): TransportAssignmentListItem {
  return {
    assignmentId: assignment.id,
    workerName: assignment.transportWorkerName,
    workerStatus: assignment.transportWorkerIsActive ? "Active" : "Inactive",
    groupName: assignment.transportGroupName,
    groupStatus: assignment.transportGroupIsActive ? "Active" : "Inactive",
  };
}

export type TransportRateFormState = {
  selectedGroupId: string;
  effectiveFrom: string;
  rateInput: string;
};

export function selectTransportRateGroup(
  state: TransportRateFormState,
  selectedGroupId: string,
): TransportRateFormState {
  return { ...state, selectedGroupId };
}

export function transportRateFormAfterSuccess(
  state: TransportRateFormState,
): TransportRateFormState {
  return { ...state, rateInput: "" };
}

export function getTransportRateRefreshQueryKeys(
  factoryId: string,
  transportGroupId: string,
  workDate: string,
): readonly [readonly string[], readonly string[]] {
  return [
    ["office-transport-group-wage-rates", factoryId, transportGroupId],
    ["office-transport-current-group-wage-rate", factoryId, transportGroupId, workDate],
  ];
}

export function buildTransportGroupWageRateInput({
  factoryId,
  selectedGroupId,
  effectiveFrom,
  rateInput,
}: Readonly<TransportRateFormState & { factoryId: string }>): CreateTransportGroupWageRateInput | null {
  const ratePerPaya = Number(rateInput);
  if (
    !factoryId
    || !selectedGroupId
    || !isCanonicalDate(effectiveFrom)
    || !rateInput.trim()
    || !Number.isFinite(ratePerPaya)
    || ratePerPaya <= 0
  ) {
    return null;
  }

  return {
    factoryId,
    transportGroupId: selectedGroupId,
    effectiveFrom,
    ratePerPaya,
  };
}

export function formatTransportRatePerPaya(rate: number): string {
  return `₹${rate.toLocaleString("en-IN", { maximumFractionDigits: 20 })} / paya`;
}

export function buildTransportRateHistoryItem(rate: TransportGroupWageRate): {
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

export function buildTransportRateGroupOption(group: TransportGroup): {
  id: string;
  label: string;
} {
  return {
    id: group.id,
    label: `${group.name}${group.isActive ? "" : " (Inactive)"}`,
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
    return "Transport Group wage-rate history is overlapping or ambiguous.";
  }
  if (/already starts|duplicate.*effective/i.test(message)) {
    return "A rate already starts on this effective date.";
  }
  if (/backdated/i.test(message)) {
    return "Backdated rates are not allowed; choose a date after the latest rate start.";
  }
  if (/does not belong to this factory/i.test(message)) {
    return "The selected Transport Group does not belong to this factory.";
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to manage transport rates for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
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
    return "The worker, Transport Group, and assignment must belong to the same factory.";
  }
  if (code === "23505") {
    if (/already assigned|transport_crew_assignments/i.test(`${message} ${details}`)) {
      return "This worker is already assigned to this Transport Group.";
    }
    return "A Transport Group with this name already exists.";
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to manage chamber transport for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf())
    && date.toISOString().slice(0, 10) === value;
}
