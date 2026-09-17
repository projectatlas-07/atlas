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
const {
  ProductionRateConfigurationError,
  setProductionLabourerOrigin,
  setProductionLabourerRates,
} = await import("./production-rate-configuration-service.ts");

function rateRow(id: string, labourerId: string) {
  return {
    id,
    factory_id: "factory-a",
    production_crew_id: null,
    labourer_id: labourerId,
    rate_per_1000_bricks: 825,
    effective_from: "2026-09-05",
    effective_to: null,
    created_at: "2026-09-15T10:00:00Z",
    updated_at: "2026-09-15T10:00:00Z",
  };
}

test("one labourer and multiple selected labourers use the same direct-rate RPC", async () => {
  calls.length = 0;
  response = { data: [rateRow("rate-a", "labourer-a")], error: null };
  const one = await setProductionLabourerRates({
    factoryId: "factory-a",
    labourerIds: ["labourer-a"],
    ratePer1000Bricks: 825,
    effectiveFrom: "2026-09-05",
  });
  assert.equal(one[0]?.labourerId, "labourer-a");

  response = { data: [rateRow("rate-a", "labourer-a"), rateRow("rate-b", "labourer-b")], error: null };
  const many = await setProductionLabourerRates({
    factoryId: "factory-a",
    labourerIds: ["labourer-a", "labourer-b"],
    ratePer1000Bricks: 825,
    effectiveFrom: "2026-09-05",
  });
  assert.equal(many.length, 2);
  assert.deepEqual(calls.map((call) => call[0]), ["set_production_labourer_rates", "set_production_labourer_rates"]);
  assert.deepEqual(calls[1]?.[1], {
    p_factory_id: "factory-a",
    p_labourer_ids: ["labourer-a", "labourer-b"],
    p_rate_per_1000_bricks: 825,
    p_effective_from: "2026-09-05",
  });
});

test("rejects empty, duplicate, non-positive, and malformed input before RPC", async () => {
  calls.length = 0;
  await assert.rejects(() => setProductionLabourerRates({ factoryId: "factory-a", labourerIds: [], ratePer1000Bricks: 800, effectiveFrom: "2026-09-15" }), /one or more distinct/);
  await assert.rejects(() => setProductionLabourerRates({ factoryId: "factory-a", labourerIds: ["a", "a"], ratePer1000Bricks: 800, effectiveFrom: "2026-09-15" }), /distinct/);
  await assert.rejects(() => setProductionLabourerRates({ factoryId: "factory-a", labourerIds: ["a"], ratePer1000Bricks: 0, effectiveFrom: "2026-09-15" }), /greater than zero/);
  await assert.rejects(() => setProductionLabourerRates({ factoryId: "factory-a", labourerIds: ["a"], ratePer1000Bricks: 800, effectiveFrom: "today" }), /Effective-from/);
  assert.deepEqual(calls, []);
});

test("preserves rate RPC error details", async () => {
  response = { data: null, error: { message: "A Production rate already starts on this date.", code: "P2408", details: "history preserved", hint: "Choose another date." } };
  await assert.rejects(
    () => setProductionLabourerRates({ factoryId: "factory-a", labourerIds: ["a"], ratePer1000Bricks: 800, effectiveFrom: "2026-09-15" }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionRateConfigurationError);
      assert.equal(error.code, "P2408");
      assert.equal(error.details, "history preserved");
      return true;
    },
  );
});

test("origin is optional, normalized by the database, and persists independently", async () => {
  calls.length = 0;
  response = { data: { production_origin_label: "Jharkhand" }, error: null };
  assert.equal(await setProductionLabourerOrigin({ factoryId: "factory-a", labourerId: "labourer-a", originLabel: " Jharkhand " }), "Jharkhand");
  assert.deepEqual(calls[0], ["set_production_labourer_origin", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_origin_label: " Jharkhand ",
  }]);

  response = { data: { production_origin_label: null }, error: null };
  assert.equal(await setProductionLabourerOrigin({ factoryId: "factory-a", labourerId: "labourer-a", originLabel: null }), null);
});
