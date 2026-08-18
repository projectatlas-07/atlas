import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

type Call = [method: string, value?: unknown, secondValue?: unknown];
const calls: Call[] = [];
let response: { data: unknown[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        return builder;
      },
      order(column: string, options: unknown) {
        calls.push(["order", column, options]);
        return builder;
      },
      then(resolve: (value: typeof response) => unknown) {
        return Promise.resolve(resolve(response));
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  TransportWeeklyEarningReadError,
  listTransportWeeklyEarningDetails,
  listTransportWeeklyEarnings,
} = await import("./transport-weekly-earning-read-service.ts");

function reset(data: unknown[] = []): void {
  calls.length = 0;
  response = { data, error: null };
}

test("weekly earnings map numbers, retain inactive workers, and sort deterministically", async () => {
  reset([
    {
      id: "earning-b",
      factory_id: "factory-a",
      transport_worker_id: "worker-b",
      week_start: "2026-08-03",
      total_amount: "300.5",
      created_at: "2026-08-10T00:00:00Z",
      transport_worker: { id: "worker-b", name: "Beena", is_active: false },
    },
    {
      id: "earning-a",
      factory_id: "factory-a",
      transport_worker_id: "worker-a",
      week_start: "2026-08-03",
      total_amount: "800",
      created_at: "2026-08-10T00:00:00Z",
      transport_worker: { id: "worker-a", name: "Asha", is_active: true },
    },
  ]);

  const earnings = await listTransportWeeklyEarnings({
    factoryId: "factory-a",
    weekStart: "2026-08-03",
  });

  assert.deepEqual(earnings.map((earning) => earning.transportWorkerName), ["Asha", "Beena"]);
  assert.equal(earnings[0].totalAmount, 800);
  assert.equal(earnings[1].totalAmount, 300.5);
  assert.equal(earnings[1].transportWorkerIsActive, false);
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "week_start", "2026-08-03"],
  ]);
});

test("daily details map immutable snapshots and retain two crews on one worker date", async () => {
  reset([
    detailRow({
      id: "detail-a",
      transport_crew_id: "crew-a",
      transport_daily_entry_id: "entry-a",
      rate_per_paya_snapshot: "500",
      daily_crew_pool_snapshot: "500",
      worker_daily_share_snapshot: "500",
      daily_entry: {
        transport_crew: { id: "crew-a", name: "Crew A", work_direction: "FIELD_TO_KILN" },
      },
    }),
    detailRow({
      id: "detail-b",
      transport_crew_id: "crew-b",
      transport_daily_entry_id: "entry-b",
      rate_per_paya_snapshot: "300",
      daily_crew_pool_snapshot: "300",
      worker_daily_share_snapshot: "300",
      daily_entry: {
        transport_crew: { id: "crew-b", name: "Crew B", work_direction: "KILN_TO_FIELD" },
      },
    }),
  ]);

  const details = await listTransportWeeklyEarningDetails({
    factoryId: "factory-a",
    weeklyEarningId: "earning-a",
  });

  assert.equal(details.length, 2);
  assert.ok(details.every((detail) => detail.workDate === "2026-08-04"));
  assert.deepEqual(details.map((detail) => detail.transportCrewId), ["crew-a", "crew-b"]);
  assert.deepEqual(details.map((detail) => detail.workerDailyShareSnapshot), [500, 300]);
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "transport_weekly_earning_id", "earning-a"],
  ]);
});

test("snapshot mapping does not recalculate inconsistent stored values", async () => {
  reset([detailRow({
    paya_quantity_snapshot: "7.25",
    rate_per_paya_snapshot: "901.5",
    attendance_count_snapshot: 3,
    daily_crew_pool_snapshot: "1234.56",
    worker_daily_share_snapshot: "411.52",
  })]);

  const [detail] = await listTransportWeeklyEarningDetails({
    factoryId: "factory-a",
    weeklyEarningId: "earning-a",
  });

  assert.equal(detail.payaQuantitySnapshot, 7.25);
  assert.equal(detail.ratePerPayaSnapshot, 901.5);
  assert.equal(detail.attendanceCountSnapshot, 3);
  assert.equal(detail.dailyCrewPoolSnapshot, 1234.56);
  assert.equal(detail.workerDailyShareSnapshot, 411.52);
});

test("read failures preserve Supabase metadata", async () => {
  reset();
  response = {
    data: null,
    error: {
      code: "42501",
      message: "Access denied.",
      details: "factory mapping missing",
      hint: null,
    },
  };

  await assert.rejects(
    listTransportWeeklyEarnings({ factoryId: "factory-b", weekStart: "2026-08-03" }),
    (error: unknown) => error instanceof TransportWeeklyEarningReadError
      && error.code === "42501"
      && error.details === "factory mapping missing",
  );
});

function detailRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "detail-a",
    factory_id: "factory-a",
    transport_weekly_earning_id: "earning-a",
    transport_worker_id: "worker-a",
    week_start: "2026-08-03",
    work_date: "2026-08-04",
    transport_crew_id: "crew-a",
    transport_daily_entry_id: "entry-a",
    transport_crew_wage_rate_id: "rate-a",
    rate_per_paya_snapshot: "500",
    paya_quantity_snapshot: "1",
    attendance_count_snapshot: 1,
    daily_crew_pool_snapshot: "500",
    worker_daily_share_snapshot: "500",
    created_at: "2026-08-10T00:00:00Z",
    daily_entry: {
      transport_crew: { id: "crew-a", name: "Crew A", work_direction: "FIELD_TO_KILN" },
    },
    ...overrides,
  };
}
