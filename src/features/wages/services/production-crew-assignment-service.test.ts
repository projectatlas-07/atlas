import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ProductionCrewAssignmentRow = {
  id: string;
  factory_id: string;
  labourer_id: string;
  production_crew_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

type RpcArgs = Record<string, string>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

const calls: Array<[functionName: string, args: RpcArgs]> = [];
let response: {
  data: ProductionCrewAssignmentRow | null;
  error: DatabaseError | null;
};

const fakeSupabase = {
  rpc(functionName: string, args: RpcArgs) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  ProductionCrewAssignmentMutationError,
  assignLabourerToProductionCrew,
  endLabourerProductionCrewAssignment,
} = await import("./production-crew-assignment-service.ts");

function setResponse(
  data: ProductionCrewAssignmentRow | null,
  error: DatabaseError | null = null,
) {
  calls.length = 0;
  response = { data, error };
}

test("assigns or moves through the focused RPC and maps its result", async () => {
  setResponse({
    id: "assignment-b",
    factory_id: "factory-a",
    labourer_id: "labourer-a",
    production_crew_id: "crew-b",
    effective_from: "2026-08-15",
    effective_to: null,
    created_at: "2026-08-15T10:00:00Z",
    updated_at: "2026-08-15T10:00:00Z",
  });

  assert.deepEqual(
    await assignLabourerToProductionCrew({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      productionCrewId: "crew-b",
      effectiveFrom: "2026-08-15",
    }),
    {
      id: "assignment-b",
      factoryId: "factory-a",
      labourerId: "labourer-a",
      productionCrewId: "crew-b",
      effectiveFrom: "2026-08-15",
      effectiveTo: null,
      createdAt: "2026-08-15T10:00:00Z",
      updatedAt: "2026-08-15T10:00:00Z",
    },
  );
  assert.deepEqual(calls, [["assign_labourer_to_production_crew", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_production_crew_id: "crew-b",
    p_effective_from: "2026-08-15",
  }]]);
});

test("ends the open assignment through the focused RPC", async () => {
  setResponse({
    id: "assignment-b",
    factory_id: "factory-a",
    labourer_id: "labourer-a",
    production_crew_id: "crew-b",
    effective_from: "2026-08-15",
    effective_to: "2026-08-20",
    created_at: "2026-08-15T10:00:00Z",
    updated_at: "2026-08-20T10:00:00Z",
  });

  const result = await endLabourerProductionCrewAssignment({
    factoryId: "factory-a",
    labourerId: "labourer-a",
    effectiveTo: "2026-08-20",
  });

  assert.equal(result.effectiveTo, "2026-08-20");
  assert.deepEqual(calls, [["end_labourer_production_crew_assignment", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_effective_to: "2026-08-20",
  }]]);
});

test("preserves meaningful lifecycle RPC errors", async () => {
  setResponse(null, {
    message: "effective_from must be later than the latest assignment end (2026-08-20).",
    code: "P0001",
    details: "history-safe append",
    hint: "Choose a date after the closed assignment.",
  });

  await assert.rejects(
    () => assignLabourerToProductionCrew({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      productionCrewId: "crew-b",
      effectiveFrom: "2026-08-20",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionCrewAssignmentMutationError);
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "history-safe append");
      assert.equal(error.hint, "Choose a date after the closed assignment.");
      return true;
    },
  );
});

test("rejects missing assignment responses from either RPC", async () => {
  setResponse(null);

  await assert.rejects(
    () => assignLabourerToProductionCrew({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      productionCrewId: "crew-a",
      effectiveFrom: "2026-09-05",
    }),
    /assign_labourer_to_production_crew returned no assignment/,
  );

  await assert.rejects(
    () => endLabourerProductionCrewAssignment({
      factoryId: "factory-a",
      labourerId: "labourer-a",
      effectiveTo: "2026-08-20",
    }),
    /end_labourer_production_crew_assignment returned no assignment/,
  );
});
