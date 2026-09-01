import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let workerListResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};
let dailyListResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};
let rpcResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: null, error: null,
};

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        let orderCount = 0;
        return {
          eq(column: string, value: string | boolean) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            orderCount += 1;
            if (orderCount < 2) return this;
            return Promise.resolve(
              table === "soil_workers" ? workerListResponse : dailyListResponse,
            );
          },
        };
      },
    };
  },
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  SoilDailyEntryServiceError,
  listActiveSoilWorkers,
  listSoilDailyTrolleyEntries,
  saveSoilDailyTrolleyEntries,
} = await import("./soil-daily-entry-service.ts");

const workerRows = [
  {
    id: "worker-babu",
    factory_id: "factory-a",
    name: "Babu",
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "worker-old",
    factory_id: "factory-a",
    name: "Old Worker",
    is_active: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
];

const dailyRow = {
  id: "entry-babu",
  factory_id: "factory-a",
  soil_worker_id: "worker-babu",
  work_date: "2026-08-25",
  trolley_quantity: "3.5",
  soil_worker_trolley_rate_id: "rate-babu",
  rate_per_trolley_snapshot: "180",
  base_amount_snapshot: "630",
  created_at: "2026-08-25T10:00:00Z",
  updated_at: "2026-08-25T10:00:00Z",
};

function reset(): void {
  calls.length = 0;
  workerListResponse = { data: [], error: null };
  dailyListResponse = { data: [], error: null };
  rpcResponse = { data: null, error: null };
}

test("lists active Soil workers through the T1 worker boundary", async () => {
  reset();
  workerListResponse.data = workerRows;
  const workers = await listActiveSoilWorkers("factory-a");
  assert.deepEqual(workers.map((worker) => worker.id), ["worker-babu"]);
  assert.deepEqual(calls.slice(0, 3), [
    ["from", "soil_workers"],
    ["select", "id, factory_id, name, is_active, created_at, updated_at"],
    ["eq", "factory_id", "factory-a"],
  ]);
});

test("loads saved daily entries for exactly one factory and date", async () => {
  reset();
  dailyListResponse.data = [{
    ...dailyRow,
    soil_worker: { id: "worker-babu", name: "Babu", is_active: true },
  }];

  assert.deepEqual(await listSoilDailyTrolleyEntries({
    factoryId: "factory-a",
    workDate: "2026-08-25",
  }), [{
    id: "entry-babu",
    factoryId: "factory-a",
    soilWorkerId: "worker-babu",
    soilWorkerName: "Babu",
    soilWorkerIsActive: true,
    workDate: "2026-08-25",
    trolleyQuantity: 3.5,
    soilWorkerTrolleyRateId: "rate-babu",
    ratePerTrolleySnapshot: 180,
    baseAmountSnapshot: 630,
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z",
  }]);
  assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "work_date", "2026-08-25"],
  ]);
});

test("saves several worker quantities through one atomic RPC payload", async () => {
  reset();
  rpcResponse.data = [
    dailyRow,
    {
      ...dailyRow,
      id: "entry-raju",
      soil_worker_id: "worker-raju",
      trolley_quantity: 5,
      soil_worker_trolley_rate_id: "rate-raju",
      rate_per_trolley_snapshot: 200,
      base_amount_snapshot: 1000,
    },
  ];

  const result = await saveSoilDailyTrolleyEntries({
    factoryId: "factory-a",
    workDate: "2026-08-25",
    entries: [
      { soilWorkerId: "worker-babu", trolleyQuantity: 3.5 },
      { soilWorkerId: "worker-raju", trolleyQuantity: 5 },
    ],
  });

  assert.deepEqual(result.map((entry) => entry.baseAmountSnapshot), [630, 1000]);
  assert.deepEqual(calls, [["rpc", "save_soil_daily_trolley_entries", {
    p_factory_id: "factory-a",
    p_work_date: "2026-08-25",
    p_entries: [
      { soil_worker_id: "worker-babu", trolley_quantity: 3.5 },
      { soil_worker_id: "worker-raju", trolley_quantity: 5 },
    ],
  }]]);
});

test("rejects invalid dates, quantities, duplicate workers, and empty batches locally", async () => {
  reset();
  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-02-30",
      entries: [{ soilWorkerId: "worker-babu", trolleyQuantity: 1 }],
    }),
    /workDate must be a valid/,
  );
  for (const trolleyQuantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.2345]) {
    await assert.rejects(
      () => saveSoilDailyTrolleyEntries({
        factoryId: "factory-a",
        workDate: "2026-08-25",
        entries: [{ soilWorkerId: "worker-babu", trolleyQuantity }],
      }),
      /trolleyQuantity must be positive/,
    );
  }
  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      entries: [
        { soilWorkerId: "worker-babu", trolleyQuantity: 1 },
        { soilWorkerId: "worker-babu", trolleyQuantity: 2 },
      ],
    }),
    /cannot contain duplicates/,
  );
  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      entries: [],
    }),
    /At least one Soil trolley entry/,
  );
  assert.equal(calls.length, 0);
});

test("preserves typed missing-rate and cross-factory failures", async () => {
  reset();
  rpcResponse.error = {
    message: "No Soil trolley rate applies.",
    code: "P2605",
    details: "worker-raju on 2026-08-25",
    hint: null,
  };

  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      entries: [{ soilWorkerId: "worker-raju", trolleyQuantity: 5 }],
    }),
    (error: unknown) => error instanceof SoilDailyEntryServiceError
      && error.code === "P2605"
      && error.message === "A Soil worker has no trolley rate for the selected work date."
      && error.details === "worker-raju on 2026-08-25",
  );

  rpcResponse.error = {
    message: "One or more Soil workers do not belong to this factory.",
    code: "P2602",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      entries: [{ soilWorkerId: "worker-b", trolleyQuantity: 1 }],
    }),
    (error: unknown) => error instanceof SoilDailyEntryServiceError
      && error.code === "P2602",
  );

  rpcResponse.error = {
    message: "Correction would make balance negative.",
    code: "P2A05",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      entries: [{ soilWorkerId: "worker-raju", trolleyQuantity: 1 }],
    }),
    (error: unknown) => error instanceof SoilDailyEntryServiceError
      && error.code === "P2A05"
      && /available balance negative/i.test(error.message),
  );
});

test("rejects an incomplete RPC result instead of accepting a partial batch", async () => {
  reset();
  rpcResponse.data = [dailyRow];
  await assert.rejects(
    () => saveSoilDailyTrolleyEntries({
      factoryId: "factory-a",
      workDate: "2026-08-25",
      entries: [
        { soilWorkerId: "worker-babu", trolleyQuantity: 3.5 },
        { soilWorkerId: "worker-raju", trolleyQuantity: 5 },
      ],
    }),
    /returned an incomplete result/,
  );
});
