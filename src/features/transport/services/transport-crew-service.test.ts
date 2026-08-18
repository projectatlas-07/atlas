import assert from "node:assert/strict";
import { mock, test } from "node:test";

type CrewRow = {
  id: string;
  factory_id: string;
  name: string;
  work_direction: "FIELD_TO_KILN" | "KILN_TO_FIELD";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let listResponse: { data: CrewRow[] | null; error: DatabaseError | null };
let createResponse: { data: CrewRow | null; error: DatabaseError | null };
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
  activateTransportCrew,
  createTransportCrew,
  deactivateTransportCrew,
  listTransportCrews,
} = await import("./transport-crew-service.ts");

const crew: CrewRow = {
  id: "crew-a",
  factory_id: "factory-a",
  name: "Field crew",
  work_direction: "FIELD_TO_KILN",
  is_active: true,
  created_at: "2026-08-18T09:00:00Z",
  updated_at: "2026-08-18T09:00:00Z",
};

function resetResponses() {
  calls.length = 0;
  listResponse = { data: [], error: null };
  createResponse = { data: crew, error: null };
  updateResponse = { data: [{ id: crew.id }], error: null };
}

test("maps active and inactive crews while preserving typed directions", async () => {
  resetResponses();
  listResponse.data = [
    crew,
    { ...crew, id: "crew-b", name: "Kiln crew", work_direction: "KILN_TO_FIELD", is_active: false },
  ];

  const result = await listTransportCrews("factory-a");
  assert.deepEqual(result.map(({ workDirection, isActive }) => ({ workDirection, isActive })), [
    { workDirection: "FIELD_TO_KILN", isActive: true },
    { workDirection: "KILN_TO_FIELD", isActive: false },
  ]);
  assert.equal(calls.some((call) => call[0] === "eq" && call[1] === "is_active"), false);
});

test("trims crew names and accepts only transport work directions", async () => {
  resetResponses();

  await createTransportCrew({
    factoryId: "factory-a",
    name: "  Field crew  ",
    workDirection: "FIELD_TO_KILN",
  });
  assert.deepEqual(calls[1], ["insert", {
    factory_id: "factory-a",
    name: "Field crew",
    work_direction: "FIELD_TO_KILN",
  }]);

  calls.length = 0;
  await assert.rejects(
    () => createTransportCrew({
      factoryId: "factory-a",
      name: "Crew",
      workDirection: "KACCHA" as "FIELD_TO_KILN",
    }),
    /FIELD_TO_KILN or KILN_TO_FIELD/,
  );
  assert.deepEqual(calls, []);
});

test("activates and deactivates exactly one factory-scoped crew", async () => {
  resetResponses();

  await deactivateTransportCrew({ factoryId: "factory-a", transportCrewId: "crew-a" });
  assert.deepEqual(calls.slice(1, 5), [
    ["update", { is_active: false }],
    ["eq", "id", "crew-a"],
    ["eq", "factory_id", "factory-a"],
    ["select", "id"],
  ]);

  calls.length = 0;
  await activateTransportCrew({ factoryId: "factory-a", transportCrewId: "crew-a" });
  assert.deepEqual(calls[1], ["update", { is_active: true }]);

  updateResponse = { data: [], error: null };
  await assert.rejects(
    () => deactivateTransportCrew({ factoryId: "factory-a", transportCrewId: "missing" }),
    /was not updated/,
  );

  updateResponse = { data: [{ id: "a" }, { id: "b" }], error: null };
  await assert.rejects(
    () => activateTransportCrew({ factoryId: "factory-a", transportCrewId: "crew-a" }),
    /more than one transport crew/,
  );
});
