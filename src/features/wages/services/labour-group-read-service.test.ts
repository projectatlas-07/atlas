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

type QueryCall = [method: string, column?: string, value?: string | { ascending: boolean }];

const calls: QueryCall[] = [];
let response: { data: LabourGroupRow[] | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "labour_groups");
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            return column === "id" ? Promise.resolve(response) : this;
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourGroups } = await import("./labour-group-read-service.ts");

function setResponse(data: LabourGroupRow[] | null, error: { message: string } | null = null) {
  calls.length = 0;
  response = { data, error };
}

test("filters by factory, orders deterministically, maps schema fields, and returns active and inactive groups", async () => {
  setResponse([
    { id: "group-a", factory_id: "factory-a", name: "Alpha Team", member_names: "Asha, Ravi", member_count: 2, is_active: true, created_at: "2026-08-01T09:00:00Z" },
    { id: "group-b", factory_id: "factory-a", name: "Former Team", member_names: null, member_count: null, is_active: false, created_at: "2026-07-01T09:00:00Z" },
  ]);

  assert.deepEqual(await getLabourGroups("factory-a"), [
    { groupId: "group-a", factoryId: "factory-a", name: "Alpha Team", memberNames: "Asha, Ravi", memberCount: 2, isActive: true, createdAt: "2026-08-01T09:00:00Z" },
    { groupId: "group-b", factoryId: "factory-a", name: "Former Team", memberNames: null, memberCount: null, isActive: false, createdAt: "2026-07-01T09:00:00Z" },
  ]);
  assert.deepEqual(calls, [
    ["select", "id, factory_id, name, member_names, member_count, is_active, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["order", "name", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);
});

test("returns an empty list when the factory has no labour groups", async () => {
  setResponse([]);

  assert.deepEqual(await getLabourGroups("factory-a"), []);
});

test("surfaces Supabase errors", async () => {
  setResponse(null, { message: "Labour groups request failed." });

  await assert.rejects(() => getLabourGroups("factory-a"), /Labour groups request failed/);
});
