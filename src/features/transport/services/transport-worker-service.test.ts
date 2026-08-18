import assert from "node:assert/strict";
import { mock, test } from "node:test";

type WorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let listResponse: { data: WorkerRow[] | null; error: DatabaseError | null };
let createResponse: { data: WorkerRow | null; error: DatabaseError | null };
let updateResponse: { data: Array<{ id: string }> | null; error: DatabaseError | null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "transport_workers");
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
            return orderCount === 2 ? Promise.resolve(listResponse) : this;
          },
        };
      },
      insert(payload: Record<string, unknown>) {
        calls.push(["insert", payload]);
        return {
          select(columns: string) {
            calls.push(["select", columns]);
            return {
              single() {
                calls.push(["single"]);
                return Promise.resolve(createResponse);
              },
            };
          },
        };
      },
      update(payload: Record<string, unknown>) {
        calls.push(["update", payload]);
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          select(columns: string) {
            calls.push(["select", columns]);
            return Promise.resolve(updateResponse);
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  TransportWorkerServiceError,
  activateTransportWorker,
  createTransportWorker,
  deactivateTransportWorker,
  listTransportWorkers,
} = await import("./transport-worker-service.ts");

const worker: WorkerRow = {
  id: "worker-a",
  factory_id: "factory-a",
  name: "Asha",
  is_active: true,
  created_at: "2026-08-18T09:00:00Z",
  updated_at: "2026-08-18T09:00:00Z",
};

function resetResponses() {
  calls.length = 0;
  listResponse = { data: [], error: null };
  createResponse = { data: worker, error: null };
  updateResponse = { data: [{ id: worker.id }], error: null };
}

test("lists and maps active and inactive transport workers", async () => {
  resetResponses();
  listResponse.data = [worker, { ...worker, id: "worker-b", name: "Former worker", is_active: false }];

  assert.deepEqual(await listTransportWorkers("factory-a"), [
    { id: "worker-a", factoryId: "factory-a", name: "Asha", isActive: true, createdAt: worker.created_at, updatedAt: worker.updated_at },
    { id: "worker-b", factoryId: "factory-a", name: "Former worker", isActive: false, createdAt: worker.created_at, updatedAt: worker.updated_at },
  ]);
  assert.deepEqual(calls, [
    ["from", "transport_workers"],
    ["select", "id, factory_id, name, is_active, created_at, updated_at"],
    ["eq", "factory_id", "factory-a"],
    ["order", "name", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);
});

test("trims worker names and relies on the database active default", async () => {
  resetResponses();

  await createTransportWorker({ factoryId: "factory-a", name: "  Asha  " });
  assert.deepEqual(calls[1], ["insert", { factory_id: "factory-a", name: "Asha" }]);

  calls.length = 0;
  await assert.rejects(
    () => createTransportWorker({ factoryId: "factory-a", name: "   " }),
    /name is required/,
  );
  assert.deepEqual(calls, []);
});

test("activates and deactivates exactly one factory-scoped worker", async () => {
  resetResponses();

  await deactivateTransportWorker({ factoryId: "factory-a", transportWorkerId: "worker-a" });
  assert.deepEqual(calls.slice(0, 5), [
    ["from", "transport_workers"],
    ["update", { is_active: false }],
    ["eq", "id", "worker-a"],
    ["eq", "factory_id", "factory-a"],
    ["select", "id"],
  ]);

  calls.length = 0;
  await activateTransportWorker({ factoryId: "factory-a", transportWorkerId: "worker-a" });
  assert.deepEqual(calls[1], ["update", { is_active: true }]);

  updateResponse = { data: [], error: null };
  await assert.rejects(
    () => deactivateTransportWorker({ factoryId: "factory-a", transportWorkerId: "missing" }),
    /was not updated/,
  );

  updateResponse = { data: [{ id: "a" }, { id: "b" }], error: null };
  await assert.rejects(
    () => activateTransportWorker({ factoryId: "factory-a", transportWorkerId: "worker-a" }),
    /more than one transport worker/,
  );
});

test("preserves worker database error details", async () => {
  resetResponses();
  updateResponse = {
    data: null,
    error: { message: "Access denied.", code: "42501", details: "RLS rejected row.", hint: null },
  };

  await assert.rejects(
    () => deactivateTransportWorker({ factoryId: "factory-b", transportWorkerId: "worker-a" }),
    (error: unknown) => {
      assert.ok(error instanceof TransportWorkerServiceError);
      assert.equal(error.code, "42501");
      assert.equal(error.details, "RLS rejected row.");
      return true;
    },
  );
});
