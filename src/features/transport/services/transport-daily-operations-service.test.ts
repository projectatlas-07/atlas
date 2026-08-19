import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

type DailyRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  work_date: string;
  paya_quantity: number | string;
  transport_crew: {
    id: string;
    name: string;
    work_direction: "FIELD_TO_KILN" | "KILN_TO_FIELD";
  };
  attendance: Array<{
    transport_worker_id: string;
    transport_worker: { id: string; name: string; is_active: boolean };
  }>;
};

type Call = [method: string, value?: unknown, options?: unknown];
const calls: Call[] = [];
let response: { data: DailyRow[] | null; error: DatabaseError | null } = {
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
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return column === "id" ? Promise.resolve(response) : builder;
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  TransportDailyOperationsReadError,
  listTransportDailyOperations,
} = await import("./transport-daily-operations-service.ts");

function row({
  entryId,
  crewId,
  crewName,
  direction,
  paya,
  workers,
  factoryId = "factory-a",
  workDate = "2026-08-19",
}: Readonly<{
  entryId: string;
  crewId: string;
  crewName: string;
  direction: "FIELD_TO_KILN" | "KILN_TO_FIELD";
  paya: number | string;
  workers: Array<{ id: string; name: string; isActive: boolean }>;
  factoryId?: string;
  workDate?: string;
}>): DailyRow {
  return {
    id: entryId,
    factory_id: factoryId,
    transport_crew_id: crewId,
    work_date: workDate,
    paya_quantity: paya,
    transport_crew: { id: crewId, name: crewName, work_direction: direction },
    attendance: workers.map((worker) => ({
      transport_worker_id: worker.id,
      transport_worker: {
        id: worker.id,
        name: worker.name,
        is_active: worker.isActive,
      },
    })),
  };
}

function reset(): void {
  calls.length = 0;
  response = { data: [], error: null };
}

test("daily operations read is factory and work-date scoped", async () => {
  reset();
  await listTransportDailyOperations({ factoryId: "factory-a", workDate: "2026-08-19" });

  assert.equal(calls[0]?.[1], "transport_daily_entries");
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "work_date", "2026-08-19"],
  ]);
});

test("multiple crews map decimal paya, persisted attendance counts, and deterministic crew order", async () => {
  reset();
  response.data = [
    row({
      entryId: "entry-b",
      crewId: "crew-b",
      crewName: "Zeta Crew",
      direction: "KILN_TO_FIELD",
      paya: 4,
      workers: [{ id: "worker-shared", name: "Asha", isActive: true }],
    }),
    row({
      entryId: "entry-a",
      crewId: "crew-a",
      crewName: "Alpha Crew",
      direction: "FIELD_TO_KILN",
      paya: "6.5",
      workers: [
        { id: "worker-inactive", name: "Bina", isActive: false },
        { id: "worker-shared", name: "Asha", isActive: true },
      ],
    }),
  ];

  const result = await listTransportDailyOperations({
    factoryId: "factory-a",
    workDate: "2026-08-19",
  });

  assert.deepEqual(result.map((entry) => ({
    id: entry.dailyEntryId,
    crew: entry.transportCrewName,
    direction: entry.transportCrewWorkDirection,
    paya: entry.payaQuantity,
    attendanceCount: entry.attendanceCount,
  })), [
    { id: "entry-a", crew: "Alpha Crew", direction: "FIELD_TO_KILN", paya: 6.5, attendanceCount: 2 },
    { id: "entry-b", crew: "Zeta Crew", direction: "KILN_TO_FIELD", paya: 4, attendanceCount: 1 },
  ]);
  assert.deepEqual(result[0]?.attendanceWorkers, [
    { transportWorkerId: "worker-shared", transportWorkerName: "Asha", transportWorkerIsActive: true },
    { transportWorkerId: "worker-inactive", transportWorkerName: "Bina", transportWorkerIsActive: false },
  ]);
});

test("the same persisted worker remains visible once inside each crew record", async () => {
  reset();
  const shared = [{ id: "worker-shared", name: "Asha", isActive: false }];
  response.data = [
    row({ entryId: "entry-a", crewId: "crew-a", crewName: "Crew A", direction: "FIELD_TO_KILN", paya: 1, workers: shared }),
    row({ entryId: "entry-b", crewId: "crew-b", crewName: "Crew B", direction: "KILN_TO_FIELD", paya: 1, workers: shared }),
  ];

  const result = await listTransportDailyOperations({
    factoryId: "factory-a",
    workDate: "2026-08-19",
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((entry) => [
    entry.transportCrewId,
    entry.attendanceWorkers[0]?.transportWorkerId,
    entry.attendanceWorkers[0]?.transportWorkerIsActive,
  ]), [
    ["crew-a", "worker-shared", false],
    ["crew-b", "worker-shared", false],
  ]);
});

test("an empty date returns no fabricated crew rows", async () => {
  reset();
  assert.deepEqual(await listTransportDailyOperations({
    factoryId: "factory-a",
    workDate: "2026-08-19",
  }), []);
});

test("read failures preserve database metadata", async () => {
  reset();
  response = {
    data: null,
    error: {
      message: "Daily transport request failed.",
      code: "08006",
      details: "connection unavailable",
      hint: "Retry later.",
    },
  };

  await assert.rejects(
    () => listTransportDailyOperations({ factoryId: "factory-a", workDate: "2026-08-19" }),
    (error: unknown) => error instanceof TransportDailyOperationsReadError
      && error.code === "08006"
      && error.details === "connection unavailable"
      && error.hint === "Retry later.",
  );
});
