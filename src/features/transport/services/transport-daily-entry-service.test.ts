import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DailyEntryRow = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  work_date: string;
  paya_quantity: number | string;
  attendance: Array<{
    transport_worker_id: string;
    transport_worker: { id: string; name: string; is_active: boolean };
  }>;
};

type SaveRow = {
  daily_entry_id: string;
  attendance_count: number;
  saved_paya_quantity: number;
};

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let readResponse: {
  data: DailyEntryRow | null;
  error: DatabaseError | null;
} = { data: null, error: null };
let saveResponse: {
  data: SaveRow[] | null;
  error: DatabaseError | null;
} = { data: [], error: null };

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
      maybeSingle() {
        calls.push(["maybeSingle"]);
        return Promise.resolve(readResponse);
      },
    };
    return builder;
  },
  rpc(functionName: string, args: Record<string, unknown>) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(saveResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const assignmentService = await import("./transport-crew-assignment-service.ts");
const {
  TransportDailyEntryServiceError,
  getTransportDailyEntry,
  listAssignedTransportWorkersForCrew,
  saveTransportDailyEntry,
} = await import("./transport-daily-entry-service.ts");

function reset(): void {
  calls.length = 0;
  readResponse = { data: null, error: null };
  saveResponse = { data: [], error: null };
}

const validSaveInput = {
  factoryId: "factory-a",
  transportCrewId: "crew-a",
  workDate: "2026-08-18",
  payaQuantity: 12.75,
  transportWorkerIds: ["worker-a", "worker-b"],
};

test("no existing daily entry returns null", async () => {
  reset();

  assert.equal(await getTransportDailyEntry({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    workDate: "2026-08-18",
  }), null);
});

test("existing entry maps numeric paya and exactly its saved attendance IDs", async () => {
  reset();
  readResponse.data = {
    id: "entry-a",
    factory_id: "factory-a",
    transport_crew_id: "crew-a",
    work_date: "2026-08-18",
    paya_quantity: "12.75",
    attendance: [
      {
        transport_worker_id: "worker-b",
        transport_worker: { id: "worker-b", name: "Beena", is_active: false },
      },
      {
        transport_worker_id: "worker-a",
        transport_worker: { id: "worker-a", name: "Asha", is_active: true },
      },
    ],
  };

  assert.deepEqual(await getTransportDailyEntry({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    workDate: "2026-08-18",
  }), {
    dailyEntryId: "entry-a",
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    workDate: "2026-08-18",
    payaQuantity: 12.75,
    attendanceWorkerIds: ["worker-a", "worker-b"],
    attendanceWorkers: [
      {
        transportWorkerId: "worker-a",
        transportWorkerName: "Asha",
        transportWorkerIsActive: true,
      },
      {
        transportWorkerId: "worker-b",
        transportWorkerName: "Beena",
        transportWorkerIsActive: false,
      },
    ],
  });
});

test("daily entry read remains factory, crew, and work-date scoped", async () => {
  reset();

  await getTransportDailyEntry({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    workDate: "2026-08-18",
  });

  assert.equal(calls[0][1], "transport_daily_entries");
  assert.match(String(calls[1][1]), /transport_daily_attendance/);
  assert.deepEqual(calls.slice(2), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "transport_crew_id", "crew-a"],
    ["eq", "work_date", "2026-08-18"],
    ["maybeSingle"],
  ]);
});

test("eligible worker loading is the current assignment resolver", () => {
  assert.equal(
    listAssignedTransportWorkersForCrew,
    assignmentService.listAssignedTransportWorkersForCrew,
  );
});

test("save calls only the authoritative RPC with the exact decimal payload", async () => {
  reset();
  saveResponse.data = [{
    daily_entry_id: "entry-a",
    attendance_count: 2,
    saved_paya_quantity: 12.75,
  }];

  assert.deepEqual(await saveTransportDailyEntry(validSaveInput), {
    dailyEntryId: "entry-a",
    attendanceCount: 2,
    savedPayaQuantity: 12.75,
  });
  assert.deepEqual(calls, [[
    "rpc",
    "save_transport_daily_entry",
    {
      p_factory_id: "factory-a",
      p_transport_crew_id: "crew-a",
      p_work_date: "2026-08-18",
      p_paya_quantity: 12.75,
      p_transport_worker_ids: ["worker-a", "worker-b"],
    },
  ]]);
});

test("empty attendance is rejected before calling Supabase", async () => {
  reset();

  await assert.rejects(
    () => saveTransportDailyEntry({
      ...validSaveInput,
      transportWorkerIds: [],
    }),
    /At least one transport worker must be selected/,
  );
  assert.deepEqual(calls, []);
});

test("duplicate attendance IDs are rejected before calling Supabase", async () => {
  reset();

  await assert.rejects(
    () => saveTransportDailyEntry({
      ...validSaveInput,
      transportWorkerIds: ["worker-a", "worker-a"],
    }),
    /cannot contain duplicates/,
  );
  assert.deepEqual(calls, []);
});

test("non-positive and non-finite paya are rejected before calling Supabase", async () => {
  for (const payaQuantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    reset();
    await assert.rejects(
      () => saveTransportDailyEntry({ ...validSaveInput, payaQuantity }),
      /payaQuantity must be greater than zero/,
    );
    assert.deepEqual(calls, []);
  }
});

test("required IDs and canonical work dates are validated before querying", async () => {
  reset();
  await assert.rejects(
    () => getTransportDailyEntry({
      factoryId: "",
      transportCrewId: "crew-a",
      workDate: "2026-08-18",
    }),
    /factoryId is required/,
  );
  await assert.rejects(
    () => getTransportDailyEntry({
      factoryId: "factory-a",
      transportCrewId: "",
      workDate: "2026-08-18",
    }),
    /transportCrewId is required/,
  );
  await assert.rejects(
    () => getTransportDailyEntry({
      factoryId: "factory-a",
      transportCrewId: "crew-a",
      workDate: "2026-02-30",
    }),
    /workDate must be a valid YYYY-MM-DD date/,
  );
  assert.deepEqual(calls, []);
});

test("RPC failures remain typed, understandable, and preserve metadata", async () => {
  reset();
  saveResponse = {
    data: null,
    error: {
      message: "One or more transport workers are inactive or not assigned to this crew.",
      code: "23514",
      details: "worker is not currently eligible",
      hint: "Choose an eligible worker.",
    },
  };

  await assert.rejects(
    () => saveTransportDailyEntry(validSaveInput),
    (error: unknown) => {
      assert.ok(error instanceof TransportDailyEntryServiceError);
      assert.equal(error.code, "23514");
      assert.equal(
        error.message,
        "One or more transport workers are inactive or not assigned to this crew.",
      );
      assert.equal(error.details, "worker is not currently eligible");
      assert.equal(error.hint, "Choose an eligible worker.");
      return true;
    },
  );
});

test("read request failures preserve Supabase metadata", async () => {
  reset();
  readResponse = {
    data: null,
    error: {
      message: "You do not have access to this factory.",
      code: "42501",
      details: "active mapping missing",
      hint: null,
    },
  };

  await assert.rejects(
    () => getTransportDailyEntry({
      factoryId: "factory-b",
      transportCrewId: "crew-b",
      workDate: "2026-08-18",
    }),
    (error: unknown) => error instanceof TransportDailyEntryServiceError
      && error.code === "42501"
      && error.details === "active mapping missing",
  );
});

test("a successful save response must contain one result row", async () => {
  reset();

  await assert.rejects(
    () => saveTransportDailyEntry(validSaveInput),
    /save_transport_daily_entry returned no result/,
  );
});
