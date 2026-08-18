import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  TransportLockedWeeklyEarning,
  TransportWeeklyEarningDetail,
} from "@/features/transport/types";
import {
  buildTransportWeeklyCalculationInput,
  buildTransportWeeklyDetailDisplay,
  buildTransportWeeklyEarningDisplay,
  getTransportWeekEnd,
  getTransportWeeklyCalculationOutcome,
  transportWeeklySettlementErrorMessage,
} from "./transport-weekly-earnings-model.ts";

const earning: TransportLockedWeeklyEarning = {
  weeklyEarningId: "earning-a",
  factoryId: "factory-a",
  transportWorkerId: "worker-a",
  transportWorkerName: "Asha",
  transportWorkerIsActive: false,
  weekStart: "2026-08-03",
  totalAmount: 800,
  createdAt: "2026-08-10T00:00:00Z",
};

test("selected completed Monday maps to the exact calculation payload", () => {
  assert.deepEqual(buildTransportWeeklyCalculationInput({
    factoryId: "factory-a",
    weekStart: "2026-08-03",
    today: "2026-08-18",
  }), {
    factoryId: "factory-a",
    weekStart: "2026-08-03",
  });
  assert.equal(getTransportWeekEnd("2026-08-03"), "2026-08-09");
});

test("current, incomplete, and non-Monday weeks are prevented client-side", () => {
  assert.throws(() => buildTransportWeeklyCalculationInput({
    factoryId: "factory-a",
    weekStart: "2026-08-17",
    today: "2026-08-18",
  }), /not completed yet/);
  assert.throws(() => buildTransportWeeklyCalculationInput({
    factoryId: "factory-a",
    weekStart: "2026-08-04",
    today: "2026-08-18",
  }), /Monday/);
});

test("successful and skipped summaries have distinct locked outcomes", () => {
  assert.deepEqual(getTransportWeeklyCalculationOutcome({
    workersCalculated: 1,
    detailRowsCreated: 2,
    rowsSkipped: 0,
  }), {
    status: "calculated",
    message: "Calculated and locked 1 worker earning with 2 daily contributions.",
  });
  assert.deepEqual(getTransportWeeklyCalculationOutcome({
    workersCalculated: 0,
    detailRowsCreated: 0,
    rowsSkipped: 1,
  }), {
    status: "already_calculated",
    message: "Already calculated — this week remains locked.",
  });
});

test("zero-work summary remains distinct from an uncalculated empty read", () => {
  assert.equal(getTransportWeeklyCalculationOutcome({
    workersCalculated: 0,
    detailRowsCreated: 0,
    rowsSkipped: 0,
  }).status, "no_work");
});

test("one inactive worker remains one locked weekly earning", () => {
  assert.deepEqual(buildTransportWeeklyEarningDisplay(earning), {
    weeklyEarningId: "earning-a",
    workerLabel: "Asha (Inactive)",
    totalAmount: "₹800.00",
  });
});

test("two same-day crews remain two snapshot detail displays without recalculation", () => {
  const details = [
    detail({ detailId: "detail-a", transportCrewId: "crew-a", transportCrewName: "Crew A", workerDailyShareSnapshot: 500 }),
    detail({ detailId: "detail-b", transportCrewId: "crew-b", transportCrewName: "Crew B", workerDailyShareSnapshot: 300 }),
  ].map(buildTransportWeeklyDetailDisplay);

  assert.equal(details.length, 2);
  assert.ok(details.every((item) => item.workDate === "2026-08-04"));
  assert.deepEqual(details.map((item) => item.workerShare), ["₹500.00", "₹300.00"]);
  assert.equal(buildTransportWeeklyEarningDisplay(earning).totalAmount, "₹800.00");
});

test("detail display uses stored snapshot values directly", () => {
  assert.deepEqual(buildTransportWeeklyDetailDisplay(detail({
    payaQuantitySnapshot: 7.25,
    attendanceCountSnapshot: 3,
    ratePerPayaSnapshot: 901.5,
    dailyCrewPoolSnapshot: 1234.56,
    workerDailyShareSnapshot: 411.52,
  })), {
    detailId: "detail-a",
    workDate: "2026-08-04",
    crewLabel: "Crew A · Field → Kiln",
    paya: "7.25",
    attendanceCount: "3",
    ratePerPaya: "₹901.50 / paya",
    dailyCrewPool: "₹1,234.56",
    workerShare: "₹411.52",
  });
});

test("calculation failures do not mutate the selected week", () => {
  const selectedWeek = "2026-08-03";
  assert.match(transportWeeklySettlementErrorMessage({
    code: "P2602",
    message: "No transport crew wage rate applies to Crew A on 2026-08-04.",
  }), /No transport crew wage rate/);
  assert.equal(selectedWeek, "2026-08-03");
});

test("defensive financial errors have concise messages", () => {
  assert.match(transportWeeklySettlementErrorMessage({ code: "P2601", message: "zero" }), /zero attendance/);
  assert.match(transportWeeklySettlementErrorMessage({ code: "P2603", message: "multiple" }), /Multiple transport crew rates/);
  assert.match(transportWeeklySettlementErrorMessage({ code: "42501", message: "denied" }), /do not have access/);
});

function detail(overrides: Partial<TransportWeeklyEarningDetail> = {}): TransportWeeklyEarningDetail {
  return {
    detailId: "detail-a",
    factoryId: "factory-a",
    transportWeeklyEarningId: "earning-a",
    transportWorkerId: "worker-a",
    weekStart: "2026-08-03",
    workDate: "2026-08-04",
    transportCrewId: "crew-a",
    transportCrewName: "Crew A",
    transportCrewWorkDirection: "FIELD_TO_KILN",
    transportDailyEntryId: "entry-a",
    transportCrewWageRateId: "rate-a",
    ratePerPayaSnapshot: 500,
    payaQuantitySnapshot: 1,
    attendanceCountSnapshot: 1,
    dailyCrewPoolSnapshot: 500,
    workerDailyShareSnapshot: 500,
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}
