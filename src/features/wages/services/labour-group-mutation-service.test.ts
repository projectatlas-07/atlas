import assert from "node:assert/strict";
import { mock, test } from "node:test";

type LabourGroupRow = {
  id: string;
  factory_id: string;
  name: string;
  member_names: string | null;
  member_count: number | null;
  is_active: boolean;
  created_at: string;
};

type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let createResponse: { data: LabourGroupRow | null; error: DatabaseError | null };
let updateResponse: { data: Array<{ id: string }> | null; error: DatabaseError | null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "labour_groups");
    calls.push(["from", table]);
    return {
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
const { LabourGroupMutationError, createLabourGroup, setLabourGroupActive } = await import("./labour-group-mutation-service.ts");

function resetResponses() {
  calls.length = 0;
  createResponse = {
    data: { id: "group-a", factory_id: "factory-a", name: "Mud Team", member_names: "Asha, Ravi", member_count: 8, is_active: true, created_at: "2026-08-09T09:00:00Z" },
    error: null,
  };
  updateResponse = { data: [{ id: "group-a" }], error: null };
}

test("creates a factory-scoped group using the schema default active status", async () => {
  resetResponses();

  assert.deepEqual(
    await createLabourGroup({ factoryId: "factory-a", name: "Mud Team", memberNames: "Asha, Ravi", memberCount: 8 }),
    { groupId: "group-a", factoryId: "factory-a", name: "Mud Team", memberNames: "Asha, Ravi", memberCount: 8, isActive: true, createdAt: "2026-08-09T09:00:00Z" },
  );
  assert.deepEqual(calls, [
    ["from", "labour_groups"],
    ["insert", { factory_id: "factory-a", name: "Mud Team", member_names: "Asha, Ravi", member_count: 8 }],
    ["select", "id, factory_id, name, member_names, member_count, is_active, created_at"],
    ["single"],
  ]);
});

test("deactivates exactly one group using ID and factory filters", async () => {
  resetResponses();

  await setLabourGroupActive({ factoryId: "factory-a", groupId: "group-a", isActive: false });
  assert.deepEqual(calls, [
    ["from", "labour_groups"],
    ["update", { is_active: false }],
    ["eq", "id", "group-a"],
    ["eq", "factory_id", "factory-a"],
    ["select", "id"],
  ]);
});

test("reactivates through the same factory-scoped service", async () => {
  resetResponses();

  await setLabourGroupActive({ factoryId: "factory-a", groupId: "group-a", isActive: true });
  assert.deepEqual(calls[1], ["update", { is_active: true }]);
});

test("treats a zero-row update as failure", async () => {
  resetResponses();
  updateResponse = { data: [], error: null };

  await assert.rejects(
    () => setLabourGroupActive({ factoryId: "factory-a", groupId: "missing-group", isActive: false }),
    /Labour group was not updated/,
  );
});

test("rejects a non-positive or non-integer member count before creating", async () => {
  resetResponses();

  await assert.rejects(
    () => createLabourGroup({ factoryId: "factory-a", name: "Mud Team", memberNames: null, memberCount: 0 }),
    /positive integer/,
  );
  await assert.rejects(
    () => createLabourGroup({ factoryId: "factory-a", name: "Mud Team", memberNames: null, memberCount: 1.5 }),
    /positive integer/,
  );
  assert.deepEqual(calls, []);
});

test("preserves create database error details", async () => {
  resetResponses();
  createResponse = {
    data: null,
    error: { message: "Create failed.", code: "42501", details: "RLS denied the row.", hint: null },
  };

  await assert.rejects(
    () => createLabourGroup({ factoryId: "factory-b", name: "Blocked", memberNames: null, memberCount: 8 }),
    (error: unknown) => {
      assert.ok(error instanceof LabourGroupMutationError);
      assert.equal(error.message, "Create failed.");
      assert.equal(error.code, "42501");
      assert.equal(error.details, "RLS denied the row.");
      return true;
    },
  );
});

test("preserves update database errors", async () => {
  resetResponses();
  updateResponse = {
    data: null,
    error: { message: "Update failed.", code: "42501", details: null, hint: "Check factory access." },
  };

  await assert.rejects(
    () => setLabourGroupActive({ factoryId: "factory-b", groupId: "group-a", isActive: false }),
    (error: unknown) => {
      assert.ok(error instanceof LabourGroupMutationError);
      assert.equal(error.message, "Update failed.");
      assert.equal(error.code, "42501");
      assert.equal(error.hint, "Check factory access.");
      return true;
    },
  );
});
