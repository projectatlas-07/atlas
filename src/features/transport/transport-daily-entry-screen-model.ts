import {
  getTransportDailyEntry,
  listAssignedTransportWorkersForCrew,
} from "./services/transport-daily-entry-service.ts";
import { listTransportCrews } from "./services/transport-crew-service.ts";
import type {
  SaveTransportDailyEntryInput,
  TransportAssignedWorker,
  TransportCrew,
  TransportDailyEntryWorkerChoice,
  TransportDailyEntryWithAttendance,
  TransportWorkDirection,
} from "./types.ts";

export type TransportDailyEntrySelectionState = {
  members: TransportDailyEntryWorkerChoice[];
  payaInput: string;
  selectedWorkerIds: Set<string>;
  existingDailyEntryId: string | null;
};

export async function loadActiveTransportCrews(
  factoryId: string,
): Promise<TransportCrew[]> {
  return (await listTransportCrews(factoryId)).filter((crew) => crew.isActive);
}

export async function loadTransportDailyEntrySelection({
  factoryId,
  transportCrewId,
  workDate,
}: Readonly<{
  factoryId: string;
  transportCrewId: string;
  workDate: string;
}>): Promise<TransportDailyEntrySelectionState> {
  const [members, existingEntry] = await Promise.all([
    listAssignedTransportWorkersForCrew({ factoryId, transportCrewId }),
    getTransportDailyEntry({ factoryId, transportCrewId, workDate }),
  ]);

  return prepareTransportDailyEntrySelection({ members, existingEntry });
}

export function prepareTransportDailyEntrySelection({
  members,
  existingEntry,
}: Readonly<{
  members: TransportAssignedWorker[];
  existingEntry: TransportDailyEntryWithAttendance | null;
}>): TransportDailyEntrySelectionState {
  const assignedWorkerIds = new Set(
    members.map((member) => member.transportWorkerId),
  );
  const workerChoices: TransportDailyEntryWorkerChoice[] = [
    ...members.map((member) => ({
      ...member,
      isPreviouslyRecorded: false,
    })),
    ...(existingEntry?.attendanceWorkers ?? [])
      .filter((worker) => !assignedWorkerIds.has(worker.transportWorkerId))
      .map((worker) => ({
        ...worker,
        isPreviouslyRecorded: true,
      })),
  ].sort((left, right) =>
    left.transportWorkerName.localeCompare(right.transportWorkerName, "en-IN")
    || left.transportWorkerId.localeCompare(right.transportWorkerId),
  );

  return {
    members: workerChoices,
    payaInput: existingEntry ? String(existingEntry.payaQuantity) : "",
    selectedWorkerIds: new Set(existingEntry?.attendanceWorkerIds ?? []),
    existingDailyEntryId: existingEntry?.dailyEntryId ?? null,
  };
}

export function selectAllTransportWorkers(
  members: readonly TransportDailyEntryWorkerChoice[],
): Set<string> {
  return new Set(members.map((member) => member.transportWorkerId));
}

export function toggleTransportWorkerSelection(
  selectedWorkerIds: ReadonlySet<string>,
  transportWorkerId: string,
): Set<string> {
  const next = new Set(selectedWorkerIds);
  if (next.has(transportWorkerId)) next.delete(transportWorkerId);
  else next.add(transportWorkerId);
  return next;
}

export function parseTransportPayaInput(value: string): number | null {
  if (!value.trim()) return null;
  const payaQuantity = Number(value);
  return Number.isFinite(payaQuantity) && payaQuantity > 0
    ? payaQuantity
    : null;
}

export function buildTransportDailyEntrySaveInput({
  factoryId,
  transportCrewId,
  workDate,
  payaInput,
  selectedWorkerIds,
}: Readonly<{
  factoryId: string;
  transportCrewId: string;
  workDate: string;
  payaInput: string;
  selectedWorkerIds: ReadonlySet<string>;
}>): SaveTransportDailyEntryInput | null {
  const payaQuantity = parseTransportPayaInput(payaInput);
  if (!factoryId || !transportCrewId || !payaQuantity || selectedWorkerIds.size === 0) {
    return null;
  }

  return {
    factoryId,
    transportCrewId,
    workDate,
    payaQuantity,
    transportWorkerIds: [...selectedWorkerIds].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function formatTransportWorkDirection(
  direction: TransportWorkDirection,
): string {
  return direction === "FIELD_TO_KILN" ? "Field → Kiln" : "Kiln → Field";
}

export function transportDailyEntryErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Could not complete the request. Please try again.";
  }

  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "23514") {
    return "New attendance workers must be active and assigned to this crew.";
  }
  if (code === "22023") {
    return "Check the work date, paya quantity, and selected workers.";
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to save transport work for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }

  return message || "Could not complete the request. Please try again.";
}
