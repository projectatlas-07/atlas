import type {
  SaveSoilDailyTrolleyEntriesInput,
  SoilDailyTrolleyEntry,
  SoilWorker,
} from "./types.ts";

export type SoilDailyEntryFormRow = {
  soilWorkerId: string;
  soilWorkerName: string;
  soilWorkerIsActive: boolean;
  quantityInput: string;
  isPreviouslyRecorded: boolean;
};

export class SoilDailyEntryValidationError extends Error {
  readonly soilWorkerId: string | null;

  constructor(message: string, soilWorkerId: string | null = null) {
    super(message);
    this.name = "SoilDailyEntryValidationError";
    this.soilWorkerId = soilWorkerId;
  }
}

export function prepareSoilDailyEntryForm({
  activeWorkers,
  existingEntries,
}: Readonly<{
  activeWorkers: readonly SoilWorker[];
  existingEntries: readonly SoilDailyTrolleyEntry[];
}>): SoilDailyEntryFormRow[] {
  const existingByWorker = new Map(
    existingEntries.map((entry) => [entry.soilWorkerId, entry]),
  );
  const activeWorkerIds = new Set(activeWorkers.map((worker) => worker.id));

  return [
    ...activeWorkers.map((worker) => {
      const existingEntry = existingByWorker.get(worker.id);
      return {
        soilWorkerId: worker.id,
        soilWorkerName: worker.name,
        soilWorkerIsActive: worker.isActive,
        quantityInput: existingEntry ? String(existingEntry.trolleyQuantity) : "",
        isPreviouslyRecorded: Boolean(existingEntry),
      };
    }),
    ...existingEntries
      .filter((entry) => !activeWorkerIds.has(entry.soilWorkerId))
      .map((entry) => ({
        soilWorkerId: entry.soilWorkerId,
        soilWorkerName: entry.soilWorkerName,
        soilWorkerIsActive: entry.soilWorkerIsActive,
        quantityInput: String(entry.trolleyQuantity),
        isPreviouslyRecorded: true,
      })),
  ].sort((left, right) =>
    left.soilWorkerName.localeCompare(right.soilWorkerName, "en-IN")
    || left.soilWorkerId.localeCompare(right.soilWorkerId),
  );
}

export function updateSoilDailyEntryQuantity(
  rows: readonly SoilDailyEntryFormRow[],
  soilWorkerId: string,
  quantityInput: string,
): SoilDailyEntryFormRow[] {
  return rows.map((row) => row.soilWorkerId === soilWorkerId
    ? { ...row, quantityInput }
    : row);
}

function parseQuantity(row: SoilDailyEntryFormRow): number | null {
  const value = row.quantityInput.trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) {
    throw new SoilDailyEntryValidationError(
      `${row.soilWorkerName}: enter a positive quantity with at most three decimal places.`,
      row.soilWorkerId,
    );
  }

  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity >= 1_000_000_000) {
    throw new SoilDailyEntryValidationError(
      `${row.soilWorkerName}: enter a positive trolley quantity below 1000000000.`,
      row.soilWorkerId,
    );
  }
  return quantity;
}

export function buildSoilDailyEntrySaveInput({
  factoryId,
  workDate,
  rows,
}: Readonly<{
  factoryId: string;
  workDate: string;
  rows: readonly SoilDailyEntryFormRow[];
}>): SaveSoilDailyTrolleyEntriesInput {
  const entries = rows.flatMap((row) => {
    // Archived historical rows remain visible but are never resubmitted as
    // new work or corrections. T7 also enforces this boundary in PostgreSQL.
    if (!row.soilWorkerIsActive) return [];
    const quantity = parseQuantity(row);
    if (quantity === null || quantity === 0) {
      if (row.isPreviouslyRecorded) {
        throw new SoilDailyEntryValidationError(
          `${row.soilWorkerName} was previously recorded. Enter a positive quantity; clearing it does not delete the saved record.`,
          row.soilWorkerId,
        );
      }
      return [];
    }
    return [{ soilWorkerId: row.soilWorkerId, trolleyQuantity: quantity }];
  });

  if (entries.length === 0) {
    throw new SoilDailyEntryValidationError(
      "Enter a trolley quantity for at least one Soil worker.",
    );
  }
  return { factoryId, workDate, entries };
}

export function applySavedSoilDailyEntries(
  rows: readonly SoilDailyEntryFormRow[],
  savedEntries: readonly { soilWorkerId: string; trolleyQuantity: number }[],
): SoilDailyEntryFormRow[] {
  const savedByWorker = new Map(
    savedEntries.map((entry) => [entry.soilWorkerId, entry.trolleyQuantity]),
  );
  return rows.map((row) => {
    const savedQuantity = savedByWorker.get(row.soilWorkerId);
    return savedQuantity === undefined
      ? row
      : {
          ...row,
          quantityInput: String(savedQuantity),
          isPreviouslyRecorded: true,
        };
  });
}

export function soilDailyEntryErrorMessage(error: unknown): string {
  if (error instanceof SoilDailyEntryValidationError) return error.message;
  if (!error || typeof error !== "object") {
    return "Could not save Soil trolley entries. Please try again.";
  }

  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "P2A05") {
    return "This correction would make the worker's available balance negative. Resolve the financial balance in Office first.";
  }
  if (code === "P2A03") {
    return "An archived Soil worker cannot receive trolley entries. Restore the worker first.";
  }
  if (code === "P2605") return "A worker has no trolley rate for this work date.";
  if (code === "P2602" || code === "23503") {
    return "A selected Soil worker does not belong to this factory.";
  }
  if (code === "22023" || code === "23514") {
    return "Check the work date and trolley quantities.";
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to save Soil work for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || "Could not save Soil trolley entries. Please try again.";
}
