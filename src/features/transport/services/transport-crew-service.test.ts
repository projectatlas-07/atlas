import assert from "node:assert/strict";
import { mock, test } from "node:test";

type GroupRow = {
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
let listResponse: { data: GroupRow[] | null; error: DatabaseError | null };
let createResponse: { data: GroupRow | null; error: DatabaseError | null };
let updateResponse: { data: Array<{ id: string }> | null; error: DatabaseError | null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "transport_crews");
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
  activateTransportGroup,
  createTransportGroup,
  deactivateTransportGroup,
  listTransportGroups,
} = await import("./transport-crew-service.ts");

const group: GroupRow = {
  id: "crew-a",
  factory_id: "factory-a",
  name: "Morning carriers",
  is_active: true,
  created_at: "2026-08-18T09:00:00Z",
  updated_at: "2026-08-18T09:00:00Z",
};

function resetResponses() {
  calls.length = 0;
  listResponse = { data: [], error: null };
  createResponse = { data: group, error: null };
  updateResponse = { data: [{ id: group.id }], error: null };
}

test("maps any number of active and inactive Transport Groups without direction", async () => {
  resetResponses();
  listResponse.data = [
    group,
    { ...group, id: "crew-b", name: "Evening carriers", is_active: false },
    { ...group, id: "crew-c", name: "Reserve carriers" },
  ];

  const result = await listTransportGroups("factory-a");
  assert.deepEqual(result.map(({ name, isActive }) => ({ name, isActive })), [
    { name: "Morning carriers", isActive: true },
    { name: "Evening carriers", isActive: false },
    { name: "Reserve carriers", isActive: true },
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /work_direction|direction/i);
  assert.equal(calls.some((call) => call[0] === "eq" && call[1] === "is_active"), false);
});

test("creates a Transport Group from name only", async () => {
  resetResponses();

  await createTransportGroup({
    factoryId: "factory-a",
    name: "  Morning carriers  ",
  });
  assert.deepEqual(calls[1], ["insert", {
    factory_id: "factory-a",
    name: "Morning carriers",
  }]);

  calls.length = 0;
  await assert.rejects(
    () => createTransportGroup({
      factoryId: "factory-a",
      name: "   ",
    }),
    /Transport Group name is required/,
  );
  assert.deepEqual(calls, []);
});

test("activates and deactivates exactly one factory-scoped Transport Group", async () => {
  resetResponses();

  await deactivateTransportGroup({ factoryId: "factory-a", transportGroupId: "crew-a" });
  assert.deepEqual(calls.slice(1, 5), [
    ["update", { is_active: false }],
    ["eq", "id", "crew-a"],
    ["eq", "factory_id", "factory-a"],
    ["select", "id"],
  ]);

  calls.length = 0;
  await activateTransportGroup({ factoryId: "factory-a", transportGroupId: "crew-a" });
  assert.deepEqual(calls[1], ["update", { is_active: true }]);

  updateResponse = { data: [], error: null };
  await assert.rejects(
    () => deactivateTransportGroup({ factoryId: "factory-a", transportGroupId: "missing" }),
    /was not updated/,
  );

  updateResponse = { data: [{ id: "a" }, { id: "b" }], error: null };
  await assert.rejects(
    () => activateTransportGroup({ factoryId: "factory-a", transportGroupId: "crew-a" }),
    /more than one Transport Group/,
  );
});
