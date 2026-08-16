import assert from "node:assert/strict";
import { mock, test } from "node:test";

type CrewRow = {
  id: string;
  factory_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  factory_id: string;
  labourer_id: string;
  production_crew_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let crewListResponse: { data: CrewRow[] | null; error: DatabaseError | null };
let assignmentListResponse: { data: AssignmentRow[] | null; error: DatabaseError | null };
let createResponse: { data: CrewRow | null; error: DatabaseError | null };
let updateResponse: { data: Array<{ id: string }> | null; error: DatabaseError | null };

function readBuilder(table: string) {
  let orderCount = 0;
  return {
    eq(column: string, value: string) {
      calls.push(["eq", column, value]);
      return this;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.push(["order", column, options]);
      orderCount += 1;
      if (orderCount === 2) {
        return Promise.resolve(table === "production_crews" ? crewListResponse : assignmentListResponse);
      }
      return this;
    },
  };
}

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return readBuilder(table);
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

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const {
  createProductionCrew,
  getCurrentProductionCrewAssignment,
  getProductionCrewAssignments,
  getProductionCrews,
  setProductionCrewActive,
} = await import("./production-crew-service.ts");

const activeCrew: CrewRow = {
  id: "crew-a",
  factory_id: "factory-a",
  name: "Alpha Crew",
  is_active: true,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-01T09:00:00Z",
};

function resetResponses() {
  calls.length = 0;
  crewListResponse = { data: [], error: null };
  assignmentListResponse = { data: [], error: null };
  createResponse = { data: activeCrew, error: null };
  updateResponse = { data: [{ id: activeCrew.id }], error: null };
}

test("lists and maps active and inactive factory crews", async () => {
  resetResponses();
  crewListResponse.data = [activeCrew, { ...activeCrew, id: "crew-b", name: "Former Crew", is_active: false }];

  assert.deepEqual(await getProductionCrews("factory-a"), [
    { id: "crew-a", factoryId: "factory-a", name: "Alpha Crew", isActive: true, createdAt: activeCrew.created_at, updatedAt: activeCrew.updated_at },
    { id: "crew-b", factoryId: "factory-a", name: "Former Crew", isActive: false, createdAt: activeCrew.created_at, updatedAt: activeCrew.updated_at },
  ]);
  assert.deepEqual(calls, [
    ["from", "production_crews"],
    ["select", "id, factory_id, name, is_active, created_at, updated_at"],
    ["eq", "factory_id", "factory-a"],
    ["order", "name", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);
});

test("creates a factory-scoped crew using the schema active default", async () => {
  resetResponses();

  assert.equal((await createProductionCrew({ factoryId: "factory-a", name: "Alpha Crew" })).isActive, true);
  assert.deepEqual(calls, [
    ["from", "production_crews"],
    ["insert", { factory_id: "factory-a", name: "Alpha Crew" }],
    ["select", "id, factory_id, name, is_active, created_at, updated_at"],
    ["single"],
  ]);
});

test("deactivates and reactivates exactly one factory-scoped crew", async () => {
  resetResponses();

  await setProductionCrewActive({ factoryId: "factory-a", crewId: "crew-a", isActive: false });
  assert.deepEqual(calls.slice(0, 6), [
    ["from", "production_crews"],
    ["update", { is_active: false }],
    ["eq", "id", "crew-a"],
    ["eq", "factory_id", "factory-a"],
    ["select", "id"],
  ]);

  calls.length = 0;
  await setProductionCrewActive({ factoryId: "factory-a", crewId: "crew-a", isActive: true });
  assert.deepEqual(calls[1], ["update", { is_active: true }]);
});

test("maps assignment history and selects only the period covering the requested date", async () => {
  resetResponses();
  assignmentListResponse.data = [
    { id: "old", factory_id: "factory-a", labourer_id: "labourer-a", production_crew_id: "crew-a", effective_from: "2026-07-01", effective_to: "2026-07-31", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-31T00:00:00Z" },
    { id: "current", factory_id: "factory-a", labourer_id: "labourer-a", production_crew_id: "crew-b", effective_from: "2026-08-01", effective_to: "2026-08-31", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-10T00:00:00Z" },
    { id: "future", factory_id: "factory-a", labourer_id: "labourer-a", production_crew_id: "crew-c", effective_from: "2026-09-01", effective_to: null, created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-10T00:00:00Z" },
    { id: "ended", factory_id: "factory-a", labourer_id: "labourer-b", production_crew_id: "crew-a", effective_from: "2026-07-01", effective_to: "2026-07-31", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-31T00:00:00Z" },
  ];

  const assignments = await getProductionCrewAssignments("factory-a");
  assert.equal(getCurrentProductionCrewAssignment(assignments, "labourer-a", "2026-08-16")?.id, "current");
  assert.equal(getCurrentProductionCrewAssignment(assignments, "labourer-a", "2026-07-31")?.id, "old");
  assert.equal(getCurrentProductionCrewAssignment(assignments, "labourer-a", "2026-09-01")?.id, "future");
  assert.equal(getCurrentProductionCrewAssignment(assignments, "labourer-b", "2026-08-16"), null);
});
