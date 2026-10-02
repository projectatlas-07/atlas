import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: Row | Row[] | string | null; error: DatabaseError | null };

const calls: unknown[][] = [];
let listResponse: Response = { data: [], error: null };
let rpcResponse: Response = { data: null, error: null };

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(["eq", column, value]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return column === "id" ? Promise.resolve(listResponse) : builder;
      },
    };
    return builder;
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
  BrickTypeServiceError,
  createBrickType,
  deactivateBrickType,
  deleteUnusedBrickType,
  listBrickTypes,
  reactivateBrickType,
  renameBrickType,
} = await import("./brick-type-service.ts");

const brickTypeRow = {
  id: "brick-a",
  factory_id: "factory-a",
  name: "Standard Brick",
  is_active: true,
  ever_used: false,
  created_at: "2026-10-02T08:00:00Z",
  updated_at: "2026-10-02T08:00:00Z",
};

function reset(): void {
  calls.length = 0;
  listResponse = { data: [], error: null };
  rpcResponse = { data: null, error: null };
}

test("lists factory Brick Types with durable lifecycle state", async () => {
  reset();
  listResponse.data = [brickTypeRow];

  assert.deepEqual((await listBrickTypes("factory-a"))[0], {
    id: "brick-a",
    factoryId: "factory-a",
    name: "Standard Brick",
    isActive: true,
    everUsed: false,
    createdAt: "2026-10-02T08:00:00Z",
    updatedAt: "2026-10-02T08:00:00Z",
  });
  assert.deepEqual(calls.slice(-3), [
    ["eq", "factory_id", "factory-a"],
    ["order", "name", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);
});

test("creates and renames through factory-scoped RPCs while preserving ID", async () => {
  reset();
  rpcResponse.data = brickTypeRow;
  const created = await createBrickType({ factoryId: "factory-a", name: "  Standard Brick  " });
  assert.equal(created.everUsed, false);
  assert.deepEqual(calls, [["rpc", "create_brick_type", {
    p_factory_id: "factory-a",
    p_name: "Standard Brick",
  }]]);

  reset();
  rpcResponse.data = { ...brickTypeRow, name: "Premium Brick" };
  const renamed = await renameBrickType({
    factoryId: "factory-a",
    brickTypeId: "brick-a",
    name: "  Premium Brick  ",
  });
  assert.equal(renamed.id, "brick-a");
  assert.equal(renamed.name, "Premium Brick");
  assert.deepEqual(calls, [["rpc", "rename_brick_type", {
    p_factory_id: "factory-a",
    p_brick_type_id: "brick-a",
    p_name: "Premium Brick",
  }]]);
});

test("deactivate and reactivate preserve identity and usage state", async () => {
  reset();
  rpcResponse.data = { ...brickTypeRow, is_active: false, ever_used: true };
  const inactive = await deactivateBrickType({ factoryId: "factory-a", brickTypeId: "brick-a" });
  assert.equal(inactive.id, "brick-a");
  assert.equal(inactive.isActive, false);
  assert.equal(inactive.everUsed, true);
  assert.deepEqual(calls, [["rpc", "set_brick_type_active", {
    p_factory_id: "factory-a",
    p_brick_type_id: "brick-a",
    p_is_active: false,
  }]]);

  reset();
  rpcResponse.data = { ...brickTypeRow, ever_used: true };
  assert.equal((await reactivateBrickType({
    factoryId: "factory-a",
    brickTypeId: "brick-a",
  })).isActive, true);
  assert.equal(calls[0]?.[1], "set_brick_type_active");
  assert.equal((calls[0]?.[2] as Row).p_is_active, true);
});

test("deletes only through the guarded RPC and maps used-state rejection", async () => {
  reset();
  rpcResponse.data = "brick-a";
  await deleteUnusedBrickType({ factoryId: "factory-a", brickTypeId: "brick-a" });
  assert.deepEqual(calls, [["rpc", "delete_unused_brick_type", {
    p_factory_id: "factory-a",
    p_brick_type_id: "brick-a",
  }]]);

  reset();
  rpcResponse.error = {
    message: "raw database message",
    code: "P3401",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => deleteUnusedBrickType({ factoryId: "factory-a", brickTypeId: "brick-a" }),
    (error: unknown) => error instanceof BrickTypeServiceError
      && error.code === "P3401"
      && /cannot be deleted.*Deactivate/i.test(error.message),
  );
});

test("rejects missing identity and names before any request", async () => {
  reset();
  await assert.rejects(
    () => createBrickType({ factoryId: "factory-a", name: "   " }),
    /Brick Type name is required/,
  );
  await assert.rejects(
    () => renameBrickType({ factoryId: "factory-a", brickTypeId: "", name: "Premium" }),
    /brickTypeId is required/,
  );
  assert.equal(calls.length, 0);
});
