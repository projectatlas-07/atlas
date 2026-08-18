import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  rate_per_paya: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

type Call = [method: string, value?: unknown, secondValue?: unknown];
const calls: Call[] = [];
let listResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};
let rpcResponse: { data: Row | null; error: DatabaseError | null } = {
  data: null,
  error: null,
};

const fakeSupabase = {
  from(table: string) {
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
    };
  },
  rpc(functionName: string, args: Record<string, string | number>) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  TransportCrewWageRateServiceError,
  createTransportCrewWageRate,
  listTransportCrewWageRates,
} = await import("./transport-crew-wage-rate-service.ts");

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "rate-a",
    factory_id: "factory-a",
    transport_crew_id: "crew-a",
    rate_per_paya: 800,
    effective_from: "2026-08-01",
    effective_to: "2026-08-17",
    created_at: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

test("lists one crew's rates in deterministic newest-first order", async () => {
  calls.length = 0;
  listResponse = {
    data: [
      row({ id: "rate-b", rate_per_paya: 900, effective_from: "2026-08-18", effective_to: null }),
      row(),
    ],
    error: null,
  };

  assert.deepEqual(await listTransportCrewWageRates({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
  }), [
    {
      id: "rate-b",
      factoryId: "factory-a",
      transportCrewId: "crew-a",
      ratePerPaya: 900,
      effectiveFrom: "2026-08-18",
      effectiveTo: null,
      createdAt: "2026-08-01T09:00:00Z",
    },
    {
      id: "rate-a",
      factoryId: "factory-a",
      transportCrewId: "crew-a",
      ratePerPaya: 800,
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-17",
      createdAt: "2026-08-01T09:00:00Z",
    },
  ]);

  assert.deepEqual(calls, [
    ["from", "transport_crew_wage_rates"],
    ["select", "id, factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "transport_crew_id", "crew-a"],
    ["order", "effective_from", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("creates a rate through the controlled RPC and maps its result", async () => {
  calls.length = 0;
  rpcResponse = {
    data: row({
      id: "rate-b",
      rate_per_paya: 900.5,
      effective_from: "2026-08-18",
      effective_to: null,
    }),
    error: null,
  };

  const result = await createTransportCrewWageRate({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    ratePerPaya: 900.5,
  });

  assert.equal(result.id, "rate-b");
  assert.equal(result.ratePerPaya, 900.5);
  assert.equal(result.effectiveTo, null);
  assert.deepEqual(calls, [["rpc", "create_transport_crew_wage_rate", {
    p_factory_id: "factory-a",
    p_transport_crew_id: "crew-a",
    p_effective_from: "2026-08-18",
    p_rate_per_paya: 900.5,
  }]]);
});

test("preserves useful database errors and translates constraint failures", async () => {
  calls.length = 0;
  rpcResponse = {
    data: null,
    error: {
      message: "conflicting key value violates exclusion constraint",
      code: "23P01",
      details: "overlapping inclusive ranges",
      hint: null,
    },
  };

  await assert.rejects(
    () => createTransportCrewWageRate({
      factoryId: "factory-a",
      transportCrewId: "crew-a",
      effectiveFrom: "2026-08-10",
      ratePerPaya: 850,
    }),
    (error: unknown) => {
      assert.ok(error instanceof TransportCrewWageRateServiceError);
      assert.equal(error.message, "Transport crew wage-rate periods cannot overlap.");
      assert.equal(error.code, "23P01");
      assert.equal(error.details, "overlapping inclusive ranges");
      return true;
    },
  );
});

test("rejects an RPC response without a created rate", async () => {
  calls.length = 0;
  rpcResponse = { data: null, error: null };

  await assert.rejects(
    () => createTransportCrewWageRate({
      factoryId: "factory-a",
      transportCrewId: "crew-a",
      effectiveFrom: "2026-08-18",
      ratePerPaya: 900,
    }),
    /create_transport_crew_wage_rate returned no rate/,
  );
});
