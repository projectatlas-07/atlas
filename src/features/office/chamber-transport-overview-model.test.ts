import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  TransportGroupAssignment,
  TransportWeeklyEarningDetail,
  TransportWorker,
} from "../transport/types.ts";
import {
  filterTransportOverviewWorkers,
  formatTransportWorkerLastPaid,
  groupTransportMembershipsByWorker,
  sumTransportEarningsByWorker,
} from "./chamber-transport-overview-model.ts";

const workers: TransportWorker[] = [
  worker("worker-a", "Anil", true),
  worker("worker-b", "Bikash", false),
];

test("one worker retains every Transport Group membership", () => {
  const memberships = groupTransportMembershipsByWorker([
    assignment("assignment-b", "worker-a", "group-b", "South Group", false),
    assignment("assignment-a", "worker-a", "group-a", "North Group", true),
    assignment("assignment-duplicate", "worker-a", "group-a", "North Group", true),
  ]);

  assert.deepEqual(memberships.get("worker-a"), [
    { id: "group-a", name: "North Group", isActive: true },
    { id: "group-b", name: "South Group", isActive: false },
  ]);
});

test("period earnings sum only authoritative locked worker-share snapshots", () => {
  const earnings = sumTransportEarningsByWorker([
    detail("worker-a", 411.52),
    detail("worker-a", 300),
    detail("worker-b", 125),
  ]);

  assert.equal(earnings.get("worker-a"), 711.52);
  assert.equal(earnings.get("worker-b"), 125);
});

test("lifecycle and contextual search include all matching group memberships", () => {
  const memberships = groupTransportMembershipsByWorker([
    assignment("assignment-a", "worker-a", "group-a", "North Group", true),
    assignment("assignment-b", "worker-b", "group-b", "South Group", true),
  ]);

  assert.deepEqual(filterTransportOverviewWorkers({
    workers,
    memberships,
    lifecycle: "active",
    search: "north",
  }).map((workerRow) => workerRow.id), ["worker-a"]);
  assert.deepEqual(filterTransportOverviewWorkers({
    workers,
    memberships,
    lifecycle: "inactive",
    search: "",
  }).map((workerRow) => workerRow.id), ["worker-b"]);
});

test("Last paid uses only real withdrawal dates", () => {
  assert.equal(formatTransportWorkerLastPaid("2026-09-26", "2026-09-26"), "Last paid today");
  assert.equal(formatTransportWorkerLastPaid("2026-09-25", "2026-09-26"), "Last paid 1 day ago");
  assert.equal(formatTransportWorkerLastPaid("2026-09-20", "2026-09-26"), "Last paid 20/09/2026");
  assert.equal(formatTransportWorkerLastPaid(null, "2026-09-26"), "No payments yet");
  assert.equal(formatTransportWorkerLastPaid("invalid", "2026-09-26"), "Payment date unavailable");
});

function worker(id: string, name: string, isActive: boolean): TransportWorker {
  return {
    id,
    factoryId: "factory-a",
    name,
    isActive,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

function assignment(
  id: string,
  workerId: string,
  groupId: string,
  groupName: string,
  groupIsActive: boolean,
): TransportGroupAssignment {
  return {
    id,
    factoryId: "factory-a",
    transportWorkerId: workerId,
    transportWorkerName: workers.find((workerRow) => workerRow.id === workerId)?.name ?? "Worker",
    transportWorkerIsActive: true,
    transportGroupId: groupId,
    transportGroupName: groupName,
    transportGroupIsActive: groupIsActive,
    createdAt: "2026-08-01T00:00:00Z",
  };
}

function detail(workerId: string, workerShare: number): TransportWeeklyEarningDetail {
  return {
    detailId: `${workerId}-${workerShare}`,
    factoryId: "factory-a",
    transportWeeklyEarningId: "earning-a",
    transportWorkerId: workerId,
    weekStart: "2026-08-03",
    workDate: "2026-08-04",
    transportGroupId: "group-a",
    transportGroupName: "North Group",
    transportDailyEntryId: "entry-a",
    transportGroupWageRateId: "rate-a",
    ratePerPayaSnapshot: 500,
    payaQuantitySnapshot: 1,
    attendanceCountSnapshot: 2,
    dailyGroupPoolSnapshot: 500,
    workerDailyShareSnapshot: workerShare,
    createdAt: "2026-08-10T00:00:00Z",
  };
}
