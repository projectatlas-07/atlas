import assert from "node:assert/strict";
import { test } from "node:test";
import type { SoilDailyTrolleyEntry, SoilWorker } from "./types.ts";
import {
  SoilDailyEntryValidationError,
  applySavedSoilDailyEntries,
  buildSoilDailyEntrySaveInput,
  prepareSoilDailyEntryForm,
  soilDailyEntryErrorMessage,
  updateSoilDailyEntryQuantity,
  type SoilDailyEntryFormRow,
} from "./soil-daily-entry-model.ts";

const activeWorkers: SoilWorker[] = [
  {
    id: "worker-raju",
    factoryId: "factory-a",
    name: "Raju",
    isActive: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "worker-babu",
    factoryId: "factory-a",
    name: "Babu",
    isActive: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
];

function savedEntry(overrides: Partial<SoilDailyTrolleyEntry> = {}): SoilDailyTrolleyEntry {
  return {
    id: "entry-raju",
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    soilWorkerName: "Raju",
    soilWorkerIsActive: true,
    workDate: "2026-08-25",
    trolleyQuantity: 5,
    soilWorkerTrolleyRateId: "rate-raju",
    ratePerTrolleySnapshot: 200,
    baseAmountSnapshot: 1000,
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

test("prepares active workers with restored saved values in deterministic order", () => {
  assert.deepEqual(prepareSoilDailyEntryForm({
    activeWorkers,
    existingEntries: [savedEntry()],
  }), [
    {
      soilWorkerId: "worker-babu",
      soilWorkerName: "Babu",
      soilWorkerIsActive: true,
      quantityInput: "",
      isPreviouslyRecorded: false,
    },
    {
      soilWorkerId: "worker-raju",
      soilWorkerName: "Raju",
      soilWorkerIsActive: true,
      quantityInput: "5",
      isPreviouslyRecorded: true,
    },
  ]);
});

test("retains a previously recorded worker even when no longer active", () => {
  const rows = prepareSoilDailyEntryForm({
    activeWorkers: [activeWorkers[1]],
    existingEntries: [savedEntry({ soilWorkerIsActive: false })],
  });
  assert.deepEqual(rows.map((row) => [row.soilWorkerName, row.quantityInput]), [
    ["Babu", ""],
    ["Raju", "5"],
  ]);
  assert.equal(rows[1].isPreviouslyRecorded, true);
  assert.equal(rows[1].soilWorkerIsActive, false);
});

test("keeps archived historical rows read-only and out of active save batches", () => {
  const rows = prepareSoilDailyEntryForm({
    activeWorkers,
    existingEntries: [savedEntry({
      soilWorkerId: "worker-archived",
      soilWorkerName: "Archived Worker",
      soilWorkerIsActive: false,
    })],
  }).map((row) => row.soilWorkerId === activeWorkers[0].id
    ? { ...row, quantityInput: "2" }
    : row);

  assert.deepEqual(buildSoilDailyEntrySaveInput({
    factoryId: "factory-a",
    workDate: "2026-08-25",
    rows,
  }).entries, [{ soilWorkerId: activeWorkers[0].id, trolleyQuantity: 2 }]);

  assert.throws(() => buildSoilDailyEntrySaveInput({
    factoryId: "factory-a",
    workDate: "2026-08-25",
    rows: rows.filter((row) => !row.soilWorkerIsActive),
  }), /at least one Soil worker/);
});

test("builds one atomic batch while omitting blank new workers", () => {
  const rows = prepareSoilDailyEntryForm({ activeWorkers, existingEntries: [] });
  const editedRows = updateSoilDailyEntryQuantity(rows, "worker-raju", "5.25");

  assert.deepEqual(buildSoilDailyEntrySaveInput({
    factoryId: "factory-a",
    workDate: "2026-08-25",
    rows: editedRows,
  }), {
    factoryId: "factory-a",
    workDate: "2026-08-25",
    entries: [{ soilWorkerId: "worker-raju", trolleyQuantity: 5.25 }],
  });
});

test("treats zero like blank for a new worker while keeping positive rows", () => {
  const rows = prepareSoilDailyEntryForm({ activeWorkers, existingEntries: [] });
  const withZero = updateSoilDailyEntryQuantity(rows, "worker-babu", "0");
  const withPositive = updateSoilDailyEntryQuantity(withZero, "worker-raju", "2");
  assert.deepEqual(buildSoilDailyEntrySaveInput({
    factoryId: "factory-a",
    workDate: "2026-08-25",
    rows: withPositive,
  }).entries, [{ soilWorkerId: "worker-raju", trolleyQuantity: 2 }]);
});

test("rejects clearing an existing record instead of silently deleting it", () => {
  const rows = prepareSoilDailyEntryForm({
    activeWorkers,
    existingEntries: [savedEntry()],
  });
  const clearedRows = updateSoilDailyEntryQuantity(rows, "worker-raju", "");

  assert.throws(
    () => buildSoilDailyEntrySaveInput({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      rows: clearedRows,
    }),
    (error: unknown) => error instanceof SoilDailyEntryValidationError
      && error.soilWorkerId === "worker-raju"
      && /previously recorded/.test(error.message),
  );
});

test("rejects negative, malformed, and over-precision inputs", () => {
  const baseRow: SoilDailyEntryFormRow = {
    soilWorkerId: "worker-raju",
    soilWorkerName: "Raju",
    soilWorkerIsActive: true,
    quantityInput: "",
    isPreviouslyRecorded: false,
  };

  for (const invalidValue of ["-1", "abc", "1.2345", "1e3"]) {
    assert.throws(
      () => buildSoilDailyEntrySaveInput({
        factoryId: "factory-a",
        workDate: "2026-08-25",
        rows: [{ ...baseRow, quantityInput: invalidValue }],
      }),
      SoilDailyEntryValidationError,
    );
  }
});

test("requires at least one positive trolley quantity", () => {
  const rows = prepareSoilDailyEntryForm({ activeWorkers, existingEntries: [] });
  assert.throws(
    () => buildSoilDailyEntrySaveInput({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      rows,
    }),
    /at least one Soil worker/,
  );
});

test("applies authoritative saved values immediately and marks rows recorded", () => {
  const rows = prepareSoilDailyEntryForm({ activeWorkers, existingEntries: [] });
  const updated = applySavedSoilDailyEntries(rows, [
    { soilWorkerId: "worker-raju", trolleyQuantity: 5.5 },
  ]);
  const raju = updated.find((row) => row.soilWorkerId === "worker-raju");
  assert.equal(raju?.quantityInput, "5.5");
  assert.equal(raju?.isPreviouslyRecorded, true);
});

test("maps expected database and network failures to concise messages", () => {
  assert.equal(
    soilDailyEntryErrorMessage({ code: "P2605", message: "missing" }),
    "A worker has no trolley rate for this work date.",
  );
  assert.equal(
    soilDailyEntryErrorMessage({ code: "P2A03", message: "archived" }),
    "An archived Soil worker cannot receive trolley entries. Restore the worker first.",
  );
  assert.equal(
    soilDailyEntryErrorMessage({ code: "P2A05", message: "negative balance" }),
    "This correction would make the worker's available balance negative. Resolve the financial balance in Office first.",
  );
  assert.equal(
    soilDailyEntryErrorMessage({ code: "42501", message: "denied" }),
    "You do not have access to save Soil work for this factory.",
  );
  assert.equal(
    soilDailyEntryErrorMessage(new TypeError("Failed to fetch")),
    "Network problem. Check your connection and try again.",
  );
});
