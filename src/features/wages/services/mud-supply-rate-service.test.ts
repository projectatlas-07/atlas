import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };
type RpcResponse = { data: unknown; error: DatabaseError | null };
const calls: Array<[string, Record<string, unknown>]> = [];
let response: RpcResponse = { data: null, error: null };

const fakeSupabase = {
  rpc(functionName: string, args: Record<string, unknown>) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { SetMudSupplyRateError, setMudSupplyRate } = await import("./mud-supply-rate-service.ts");

test("sets an effective-dated Mud rate through the dedicated RPC", async () => {
  calls.length = 0;
  response = {
    data: {
      id: "rate-a",
      factory_id: "factory-a",
      applies_to: "mud_supply",
      rate_per_1000_bricks: 45,
      effective_from: "2026-09-10",
      effective_to: "2026-09-14",
      created_at: "2026-09-15T10:00:00Z",
    },
    error: null,
  };

  const result = await setMudSupplyRate({
    factoryId: "factory-a",
    ratePer1000Bricks: 45,
    effectiveFrom: "2026-09-10",
  });

  assert.equal(result.id, "rate-a");
  assert.deepEqual(calls, [["set_mud_supply_rate", {
    p_factory_id: "factory-a",
    p_rate_per_1000_bricks: 45,
    p_effective_from: "2026-09-10",
  }]]);
});

test("rejects invalid inputs before calling the database", async () => {
  calls.length = 0;
  await assert.rejects(
    () => setMudSupplyRate({ factoryId: "", ratePer1000Bricks: 45, effectiveFrom: "2026-09-10" }),
    /Factory is required/,
  );
  await assert.rejects(
    () => setMudSupplyRate({ factoryId: "factory-a", ratePer1000Bricks: 0, effectiveFrom: "2026-09-10" }),
    /greater than zero/,
  );
  await assert.rejects(
    () => setMudSupplyRate({ factoryId: "factory-a", ratePer1000Bricks: 45, effectiveFrom: "2026-02-30" }),
    /valid date/,
  );
  assert.deepEqual(calls, []);
});

test("preserves database error details for a duplicate effective date", async () => {
  response = {
    data: null,
    error: {
      message: "A Mud rate already starts on 2026-09-10.",
      code: "P2601",
      details: "History preserved.",
      hint: "Choose another date.",
    },
  };

  await assert.rejects(
    () => setMudSupplyRate({ factoryId: "factory-a", ratePer1000Bricks: 45, effectiveFrom: "2026-09-10" }),
    (error: unknown) => {
      assert.ok(error instanceof SetMudSupplyRateError);
      assert.equal(error.code, "P2601");
      assert.equal(error.details, "History preserved.");
      return true;
    },
  );
});
