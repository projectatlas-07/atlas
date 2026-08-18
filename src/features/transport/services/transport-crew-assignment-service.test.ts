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
let response: { data: unknown; error: DatabaseError | null } = {
  data: [],
  error: null,
};

function queryBuilder() {
  const builder = {
    select(columns: string) {
      calls.push(["select", columns]);
      return builder;
    },
    insert(value: unknown) {
      calls.push(["insert", value]);
      return builder;
    },
    delete() {
      calls.push(["delete"]);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push(["eq", column, value]);
      return builder;
    },
    order(column: string, options: unknown) {
      calls.push(["order", column, options]);
      return builder;
    },
    single() {
      calls.push(["single"]);
      return Promise.resolve(response);
    },
    then(resolve: (value: typeof response) => unknown) {
      return Promise.resolve(resolve(response));
    },
  };
  return builder;
}

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return queryBuilder();
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  TransportCrewAssignmentServiceError,
  assignTransportWorkerToCrew,
  listAssignedTransportWorkersForCrew,
  listTransportCrewAssignments,
  unassignTransportWorkerFromCrew,
} = await import("./transport-crew-assignment-service.ts");

const assignmentRows = [
  {
    id: "assignment-b",
    factory_id: "factory-a",
    transport_worker_id: "worker-a",
    transport_crew_id: "crew-b",
    created_at: "2026-08-18T03:00:00Z",
    transport_worker: { id: "worker-a", name: "Asha", is_active: true },
    transport_crew: {
      id: "crew-b",
      name: "Kiln return",
      work_direction: "KILN_TO_FIELD",
      is_active: true,
    },
  },
  {
    id: "assignment-a",
    factory_id: "factory-a",
    transport_worker_id: "worker-a",
    transport_crew_id: "crew-a",
    created_at: "2026-08-18T02:00:00Z",
    transport_worker: { id: "worker-a", name: "Asha", is_active: true },
    transport_crew: {
      id: "crew-a",
      name: "Field carriers",
      work_direction: "FIELD_TO_KILN",
      is_active: false,
    },
  },
];

function reset(): void {
  calls.length = 0;
  response = { data: [], error: null };
}

test("one worker can have multiple deterministic crew assignments", async () => {
  reset();
  response.data = assignmentRows;

  const assignments = await listTransportCrewAssignments({ factoryId: "factory-a" });

  assert.deepEqual(assignments.map((assignment) => assignment.transportCrewId), [
    "crew-a",
    "crew-b",
  ]);
  assert.ok(assignments.every((assignment) => assignment.transportWorkerId === "worker-a"));
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
  ]);
});

test("assign sends only factory, worker, and crew with no membership dates", async () => {
  reset();
  response.data = assignmentRows[0];

  const result = await assignTransportWorkerToCrew({
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
    transportCrewId: "crew-b",
  });

  assert.equal(result.id, "assignment-b");
  assert.deepEqual(calls.find(([method]) => method === "insert"), ["insert", {
    factory_id: "factory-a",
    transport_worker_id: "worker-a",
    transport_crew_id: "crew-b",
  }]);
  assert.doesNotMatch(JSON.stringify(calls), /effective_from|effective_to/);
});

test("unassign is scoped by assignment and factory", async () => {
  reset();
  response.data = [assignmentRows[0]];

  assert.equal((await unassignTransportWorkerFromCrew({
    factoryId: "factory-a",
    assignmentId: "assignment-b",
  })).id, "assignment-b");
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "id", "assignment-b"],
    ["eq", "factory_id", "factory-a"],
  ]);
});

test("manager worker list is crew scoped and filters active workers", async () => {
  reset();
  response.data = [
    {
      transport_worker_id: "worker-b",
      transport_worker: { id: "worker-b", name: "Beena", is_active: true },
    },
    {
      transport_worker_id: "worker-a",
      transport_worker: { id: "worker-a", name: "Asha", is_active: true },
    },
  ];

  assert.deepEqual(await listAssignedTransportWorkersForCrew({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
  }), [
    {
      transportWorkerId: "worker-a",
      transportWorkerName: "Asha",
      transportWorkerIsActive: true,
    },
    {
      transportWorkerId: "worker-b",
      transportWorkerName: "Beena",
      transportWorkerIsActive: true,
    },
  ]);
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "transport_crew_id", "crew-a"],
    ["eq", "transport_worker.is_active", true],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /work_date|effective_/);
});

test("duplicate assignment has a focused typed error", async () => {
  reset();
  response = {
    data: null,
    error: {
      code: "23505",
      message: "duplicate key",
      details: "assignment exists",
      hint: null,
    },
  };

  await assert.rejects(
    assignTransportWorkerToCrew({
      factoryId: "factory-a",
      transportWorkerId: "worker-a",
      transportCrewId: "crew-a",
    }),
    (error: unknown) => {
      assert.ok(error instanceof TransportCrewAssignmentServiceError);
      assert.equal(error.code, "23505");
      assert.equal(error.details, "assignment exists");
      assert.match(error.message, /already assigned/);
      return true;
    },
  );
});

test("request errors preserve database metadata", async () => {
  reset();
  response = {
    data: null,
    error: {
      code: "08006",
      message: "Database unavailable.",
      details: "connection lost",
      hint: "retry",
    },
  };

  await assert.rejects(
    listTransportCrewAssignments({ factoryId: "factory-a" }),
    (error: unknown) => {
      assert.ok(error instanceof TransportCrewAssignmentServiceError);
      assert.equal(error.code, "08006");
      assert.equal(error.details, "connection lost");
      assert.equal(error.hint, "retry");
      return true;
    },
  );
});
