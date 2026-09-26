import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type {
  TransportAssignedWorker,
  TransportGroup,
  TransportDailyEntryWithAttendance,
} from "./types.ts";

const serviceCalls: Array<[string, unknown]> = [];
let groups: TransportGroup[] = [];
let assignedWorkers: TransportAssignedWorker[] = [];
let existingEntry: TransportDailyEntryWithAttendance | null = null;

await mock.module("./services/transport-crew-service.ts", {
  namedExports: {
    async listTransportGroups(factoryId: string) {
      serviceCalls.push(["listTransportGroups", factoryId]);
      return groups;
    },
  },
});

await mock.module("./services/transport-daily-entry-service.ts", {
  namedExports: {
    async listAssignedTransportWorkersForGroup(input: unknown) {
      serviceCalls.push(["listAssignedTransportWorkersForGroup", input]);
      return assignedWorkers;
    },
    async getTransportDailyEntry(input: unknown) {
      serviceCalls.push(["getTransportDailyEntry", input]);
      return existingEntry;
    },
  },
});

const {
  buildTransportDailyEntrySaveInput,
  loadActiveTransportGroups,
  loadTransportDailyEntrySelection,
  parseTransportPayaInput,
  prepareTransportDailyEntrySelection,
  selectAllTransportWorkers,
  toggleTransportWorkerSelection,
  transportDailyEntryErrorMessage,
} = await import("./transport-daily-entry-screen-model.ts");

const activeGroup: TransportGroup = {
  id: "group-a",
  factoryId: "factory-a",
  name: "Morning carriers",
  isActive: true,
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z",
};

const activeAssignedWorker: TransportAssignedWorker = {
  transportWorkerId: "worker-a",
  transportWorkerName: "Asha",
  transportWorkerIsActive: true,
};

function savedEntry(
  attendanceWorkers: TransportDailyEntryWithAttendance["attendanceWorkers"],
): TransportDailyEntryWithAttendance {
  return {
    dailyEntryId: "entry-a",
    factoryId: "factory-a",
    transportGroupId: "group-a",
    workDate: "2026-08-18",
    payaQuantity: 6.5,
    attendanceWorkerIds: attendanceWorkers.map((worker) => worker.transportWorkerId),
    attendanceWorkers,
  };
}

function reset(): void {
  serviceCalls.length = 0;
  groups = [];
  assignedWorkers = [];
  existingEntry = null;
}

test("Transport Group loading returns only active groups", async () => {
  reset();
  groups = [activeGroup, { ...activeGroup, id: "group-old", isActive: false }];
  assert.deepEqual(await loadActiveTransportGroups("factory-a"), [activeGroup]);
});

test("work date scopes the entry but not current assignment eligibility", async () => {
  reset();
  assignedWorkers = [activeAssignedWorker];

  await loadTransportDailyEntrySelection({
    factoryId: "factory-a",
    transportGroupId: "group-a",
    workDate: "2026-08-18",
  });

  assert.deepEqual(serviceCalls, [
    ["listAssignedTransportWorkersForGroup", {
      factoryId: "factory-a",
      transportGroupId: "group-a",
    }],
    ["getTransportDailyEntry", {
      factoryId: "factory-a",
      transportGroupId: "group-a",
      workDate: "2026-08-18",
    }],
  ]);
});

test("the same worker is independently selectable in multiple assigned Transport Groups", async () => {
  reset();
  assignedWorkers = [activeAssignedWorker];
  const first = await loadTransportDailyEntrySelection({
    factoryId: "factory-a",
    transportGroupId: "group-a",
    workDate: "2026-08-18",
  });

  serviceCalls.length = 0;
  assignedWorkers = [activeAssignedWorker];
  const second = await loadTransportDailyEntrySelection({
    factoryId: "factory-a",
    transportGroupId: "group-b",
    workDate: "2026-08-18",
  });

  assert.equal(first.members[0].transportWorkerId, "worker-a");
  assert.equal(second.members[0].transportWorkerId, "worker-a");
  assert.equal(second.selectedWorkerIds.size, 0);
});

test("a new entry does not automatically select assigned workers", () => {
  const state = prepareTransportDailyEntrySelection({
    members: [activeAssignedWorker],
    existingEntry: null,
  });

  assert.equal(state.members[0].isPreviouslyRecorded, false);
  assert.equal(state.selectedWorkerIds.size, 0);
  assert.equal(state.payaInput, "");
});

test("inactive or unassigned saved attendance remains visible and selected", () => {
  const state = prepareTransportDailyEntrySelection({
    members: [activeAssignedWorker],
    existingEntry: savedEntry([{
      transportWorkerId: "worker-historical",
      transportWorkerName: "Beena",
      transportWorkerIsActive: false,
    }]),
  });

  assert.deepEqual(state.members, [
    { ...activeAssignedWorker, isPreviouslyRecorded: false },
    {
      transportWorkerId: "worker-historical",
      transportWorkerName: "Beena",
      transportWorkerIsActive: false,
      isPreviouslyRecorded: true,
    },
  ]);
  assert.deepEqual([...state.selectedWorkerIds], ["worker-historical"]);
  assert.equal(state.payaInput, "6.5");
});

test("saved active assigned attendance is restored without a historical label", () => {
  const state = prepareTransportDailyEntrySelection({
    members: [activeAssignedWorker],
    existingEntry: savedEntry([activeAssignedWorker]),
  });

  assert.deepEqual(state.members, [{
    ...activeAssignedWorker,
    isPreviouslyRecorded: false,
  }]);
  assert.deepEqual([...state.selectedWorkerIds], ["worker-a"]);
});

test("Select All and individual toggles update selection", () => {
  const choices = [{ ...activeAssignedWorker, isPreviouslyRecorded: false }];
  const selected = selectAllTransportWorkers(choices);
  assert.deepEqual([...selected], ["worker-a"]);
  assert.equal(toggleTransportWorkerSelection(selected, "worker-a").size, 0);
});

test("decimal paya and deterministic save payload remain unchanged", () => {
  assert.equal(parseTransportPayaInput("6.5"), 6.5);
  assert.equal(parseTransportPayaInput("0"), null);
  assert.deepEqual(buildTransportDailyEntrySaveInput({
    factoryId: "factory-a",
    transportGroupId: "group-a",
    workDate: "2026-08-18",
    payaInput: "6.5",
    selectedWorkerIds: new Set(["worker-b", "worker-a"]),
  }), {
    factoryId: "factory-a",
    transportGroupId: "group-a",
    workDate: "2026-08-18",
    payaQuantity: 6.5,
    transportWorkerIds: ["worker-a", "worker-b"],
  });
});

test("inactive or unassigned errors use current assignment language", () => {
  const message = transportDailyEntryErrorMessage({ code: "23514", message: "constraint" });
  assert.match(message, /active and assigned/);
  assert.doesNotMatch(message, /date|another Transport Group/);
});
