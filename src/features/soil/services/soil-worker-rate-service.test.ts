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
let rpcResponse: { data: Row | string | null; error: DatabaseError | null } = {
  data: null,
  error: null,
};
let workerListResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};
let rateListResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        let orderCount = 0;
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            orderCount += 1;
            if (orderCount < 2) return this;
            return Promise.resolve(
              table === "soil_workers" ? workerListResponse : rateListResponse,
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
  SoilSupplyServiceError,
  archiveSoilWorker,
  createSoilWorker,
  createSoilWorkerTrolleyRate,
  deleteUnusedSoilWorker,
  listSoilWorkerTrolleyRates,
  listSoilWorkers,
  resolveSoilWorkerTrolleyRate,
  restoreSoilWorker,
} = await import("./soil-worker-rate-service.ts");

const workerRow = {
  id: "soil-worker-a",
  factory_id: "factory-a",
  name: "Raju Kumar",
  is_active: true,
  created_at: "2026-08-25T10:00:00Z",
  updated_at: "2026-08-25T10:00:00Z",
};

const oldRateRow = {
  id: "soil-rate-a",
  factory_id: "factory-a",
  soil_worker_id: "soil-worker-a",
  rate_per_trolley: 200,
  effective_from: "2026-08-01",
  effective_to: "2026-08-31",
  created_at: "2026-08-25T10:00:00Z",
};

const newRateRow = {
  ...oldRateRow,
  id: "soil-rate-b",
  rate_per_trolley: 220,
  effective_from: "2026-09-01",
  effective_to: null,
};

function reset(): void {
  calls.length = 0;
  rpcResponse = { data: null, error: null };
  workerListResponse = { data: [], error: null };
  rateListResponse = { data: [], error: null };
}

test("lists only Soil-owned workers in deterministic name order", async () => {
  reset();
  workerListResponse.data = [workerRow];

  assert.deepEqual(await listSoilWorkers("factory-a"), [{
    id: "soil-worker-a",
    factoryId: "factory-a",
    name: "Raju Kumar",
    isActive: true,
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z",
  }]);
  assert.deepEqual(calls, [
    ["from", "soil_workers"],
    ["select", "id, factory_id, name, is_active, created_at, updated_at"],
    ["eq", "factory_id", "factory-a"],
    ["order", "name", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);
});

test("creates a normalized Soil worker and initial rate atomically through one RPC", async () => {
  reset();
  rpcResponse.data = workerRow;

  const worker = await createSoilWorker({
    factoryId: "factory-a",
    name: "  Raju   Kumar  ",
    initialRatePerTrolley: 200,
    initialEffectiveFrom: "2026-08-01",
  });

  assert.equal(worker.name, "Raju Kumar");
  assert.deepEqual(calls, [[
    "rpc",
    "create_soil_worker_with_initial_trolley_rate",
    {
      p_factory_id: "factory-a",
      p_name: "Raju Kumar",
      p_initial_rate_per_trolley: 200,
      p_initial_effective_from: "2026-08-01",
    },
  ]]);
});

test("rejects blank names and malformed initial dates before making a request", async () => {
  reset();
  await assert.rejects(
    () => createSoilWorker({
      factoryId: "factory-a",
      name: "   ",
      initialRatePerTrolley: 200,
      initialEffectiveFrom: "2026-08-01",
    }),
    /Soil worker name is required/,
  );
  await assert.rejects(
    () => createSoilWorker({
      factoryId: "factory-a",
      name: "Raju",
      initialRatePerTrolley: 200,
      initialEffectiveFrom: "2026-02-30",
    }),
    /initialEffectiveFrom must be a valid YYYY-MM-DD date/,
  );
  assert.equal(calls.length, 0);
});

test("lists one worker's historical trolley rates newest first", async () => {
  reset();
  rateListResponse.data = [newRateRow, oldRateRow];

  const rates = await listSoilWorkerTrolleyRates({
    factoryId: "factory-a",
    soilWorkerId: "soil-worker-a",
  });

  assert.deepEqual(rates.map((rate) => rate.ratePerTrolley), [220, 200]);
  assert.deepEqual(calls.slice(-4), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "soil_worker_id", "soil-worker-a"],
    ["order", "effective_from", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("adds a later individual trolley rate only through its controlled RPC", async () => {
  reset();
  rpcResponse.data = newRateRow;

  const rate = await createSoilWorkerTrolleyRate({
    factoryId: "factory-a",
    soilWorkerId: "soil-worker-a",
    ratePerTrolley: 220,
    effectiveFrom: "2026-09-01",
  });

  assert.equal(rate.id, "soil-rate-b");
  assert.equal(rate.ratePerTrolley, 220);
  assert.deepEqual(calls, [["rpc", "create_soil_worker_trolley_rate", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "soil-worker-a",
    p_rate_per_trolley: 220,
    p_effective_from: "2026-09-01",
  }]]);
});

test("resolves the authoritative rate through the database RPC", async () => {
  reset();
  rpcResponse.data = oldRateRow;

  const rate = await resolveSoilWorkerTrolleyRate({
    factoryId: "factory-a",
    soilWorkerId: "soil-worker-a",
    workDate: "2026-08-25",
  });

  assert.equal(rate.ratePerTrolley, 200);
  assert.deepEqual(calls, [["rpc", "resolve_soil_worker_trolley_rate", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "soil-worker-a",
    p_work_date: "2026-08-25",
  }]]);
});

test("rejects malformed effective and work dates before database access", async () => {
  reset();
  await assert.rejects(
    () => createSoilWorkerTrolleyRate({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
      ratePerTrolley: 220,
      effectiveFrom: "01-09-2026",
    }),
    /effectiveFrom must be a valid YYYY-MM-DD date/,
  );
  await assert.rejects(
    () => resolveSoilWorkerTrolleyRate({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
      workDate: "2026-09-31",
    }),
    /workDate must be a valid YYYY-MM-DD date/,
  );
  assert.equal(calls.length, 0);
});

test("preserves typed factory and overlap database failures", async () => {
  reset();
  rpcResponse.error = {
    message: "effective_from must be later than the latest start",
    code: "P2603",
    details: "historical periods are append-only",
    hint: null,
  };

  await assert.rejects(
    () => createSoilWorkerTrolleyRate({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
      ratePerTrolley: 210,
      effectiveFrom: "2026-08-15",
    }),
    (error: unknown) => {
      assert.ok(error instanceof SoilSupplyServiceError);
      assert.equal(
        error.message,
        "Soil worker trolley-rate periods cannot overlap or start out of order.",
      );
      assert.equal(error.code, "P2603");
      assert.equal(error.details, "historical periods are append-only");
      return true;
    },
  );

  rpcResponse.error = {
    message: "Soil worker does not belong to this factory.",
    code: "P2602",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => resolveSoilWorkerTrolleyRate({
      factoryId: "factory-a",
      soilWorkerId: "factory-b-worker",
      workDate: "2026-08-25",
    }),
    (error: unknown) => error instanceof SoilSupplyServiceError
      && error.code === "P2602"
      && error.message === "Soil worker does not belong to this factory.",
  );
});

test("rejects successful RPC responses that contain no row", async () => {
  reset();
  await assert.rejects(
    () => createSoilWorker({
      factoryId: "factory-a",
      name: "Raju",
      initialRatePerTrolley: 200,
      initialEffectiveFrom: "2026-08-01",
    }),
    /returned no worker/,
  );
  await assert.rejects(
    () => createSoilWorkerTrolleyRate({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
      ratePerTrolley: 220,
      effectiveFrom: "2026-09-01",
    }),
    /returned no rate/,
  );
  await assert.rejects(
    () => resolveSoilWorkerTrolleyRate({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
      workDate: "2026-09-01",
    }),
    /returned no rate/,
  );
});

test("archives and restores one factory-scoped Soil worker through controlled RPCs", async () => {
  reset();
  rpcResponse.data = { ...workerRow, is_active: false };

  const archived = await archiveSoilWorker({
    factoryId: "factory-a",
    soilWorkerId: "soil-worker-a",
  });
  assert.equal(archived.isActive, false);
  assert.deepEqual(calls, [["rpc", "archive_soil_worker", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "soil-worker-a",
  }]]);

  reset();
  rpcResponse.data = workerRow;
  const restored = await restoreSoilWorker({
    factoryId: "factory-a",
    soilWorkerId: "soil-worker-a",
  });
  assert.equal(restored.isActive, true);
  assert.deepEqual(calls, [["rpc", "restore_soil_worker", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "soil-worker-a",
  }]]);
});

test("deletes an unused Soil worker only through the guarded RPC", async () => {
  reset();
  rpcResponse.data = "soil-worker-a";

  await deleteUnusedSoilWorker({
    factoryId: "factory-a",
    soilWorkerId: "soil-worker-a",
  });
  assert.deepEqual(calls, [["rpc", "delete_unused_soil_worker", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "soil-worker-a",
  }]]);

  reset();
  rpcResponse.data = "different-worker";
  await assert.rejects(
    () => deleteUnusedSoilWorker({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
    }),
    /did not return the deleted worker ID/,
  );
});

test("maps lifecycle state and delete-history failures clearly", async () => {
  reset();
  rpcResponse.error = {
    message: "historical records exist",
    code: "P2A04",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => deleteUnusedSoilWorker({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
    }),
    (error: unknown) => error instanceof SoilSupplyServiceError
      && error.code === "P2A04"
      && /cannot be deleted.*Archive/i.test(error.message),
  );

  rpcResponse.error = {
    message: "already archived",
    code: "P2A01",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => archiveSoilWorker({
      factoryId: "factory-a",
      soilWorkerId: "soil-worker-a",
    }),
    /already archived/,
  );
});
