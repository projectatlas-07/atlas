import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ProductionWageRateRow = {
  id: string;
  factory_id: string;
  production_crew_id: string | null;
  labourer_id: string | null;
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type RpcArgs = Record<string, string | number>;
type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };

const calls: Array<[functionName: string, args: RpcArgs]> = [];
let response: { data: ProductionWageRateRow | null; error: DatabaseError | null };

const fakeSupabase = {
  rpc(functionName: string, args: RpcArgs) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const {
  CreateProductionWageRateError,
  createLabourerProductionWageRateOverride,
  createProductionCrewWageRate,
} = await import("./production-wage-rate-create-service.ts");

function setResponse(
  data: ProductionWageRateRow | null,
  error: DatabaseError | null = null,
) {
  calls.length = 0;
  response = { data, error };
}

test("creates a crew rate through the focused RPC and maps its result", async () => {
  setResponse({
    id: "rate-a",
    factory_id: "factory-a",
    production_crew_id: "crew-a",
    labourer_id: null,
    rate_per_1000_bricks: 530,
    effective_from: "2026-08-15",
    effective_to: null,
    created_at: "2026-08-15T10:00:00Z",
    updated_at: "2026-08-15T10:00:00Z",
  });

  assert.deepEqual(
    await createProductionCrewWageRate({
      factoryId: "factory-a",
      productionCrewId: "crew-a",
      ratePer1000Bricks: 530,
      effectiveFrom: "2026-08-15",
    }),
    {
      id: "rate-a",
      factoryId: "factory-a",
      productionCrewId: "crew-a",
      labourerId: null,
      ratePer1000Bricks: 530,
      effectiveFrom: "2026-08-15",
      effectiveTo: null,
      createdAt: "2026-08-15T10:00:00Z",
      updatedAt: "2026-08-15T10:00:00Z",
    },
  );

  assert.deepEqual(calls, [["create_production_crew_wage_rate", {
    p_factory_id: "factory-a",
    p_production_crew_id: "crew-a",
    p_rate_per_1000_bricks: 530,
    p_effective_from: "2026-08-15",
  }]]);
});

test("creates a labourer override through its independent RPC", async () => {
  setResponse({
    id: "override-a",
    factory_id: "factory-a",
    production_crew_id: null,
    labourer_id: "labourer-a",
    rate_per_1000_bricks: 550,
    effective_from: "2026-08-20",
    effective_to: null,
    created_at: "2026-08-20T10:00:00Z",
    updated_at: "2026-08-20T10:00:00Z",
  });

  const result = await createLabourerProductionWageRateOverride({
    factoryId: "factory-a",
    labourerId: "labourer-a",
    ratePer1000Bricks: 550,
    effectiveFrom: "2026-08-20",
  });

  assert.equal(result.labourerId, "labourer-a");
  assert.equal(result.productionCrewId, null);
  assert.deepEqual(calls, [["create_labourer_production_wage_rate_override", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_rate_per_1000_bricks: 550,
    p_effective_from: "2026-08-20",
  }]]);
});

test("preserves meaningful RPC failure details", async () => {
  setResponse(null, {
    message: "effective_from must be later than the latest crew rate start (2026-08-15).",
    code: "P0001",
    details: "history-safe append",
    hint: "Choose a later effective date.",
  });

  await assert.rejects(
    () => createProductionCrewWageRate({
      factoryId: "factory-a",
      productionCrewId: "crew-a",
      ratePer1000Bricks: 530,
      effectiveFrom: "2026-08-10",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CreateProductionWageRateError);
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "history-safe append");
      assert.equal(error.hint, "Choose a later effective date.");
      return true;
    },
  );
});

test("rejects an RPC response without a created rate", async () => {
  setResponse(null);

  await assert.rejects(
    () => createLabourerProductionWageRateOverride({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      ratePer1000Bricks: 550,
      effectiveFrom: "2026-08-20",
    }),
    /create_labourer_production_wage_rate_override returned no rate/,
  );
});
