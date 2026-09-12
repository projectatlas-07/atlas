import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let listResponse: { data: unknown[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};
let rpcResponse: {
  data: Array<{ total_earned: number | string }> | null;
  error: DatabaseError | null;
} = { data: null, error: null };

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        return builder;
      },
      gte(column: string, value: string) {
        calls.push(["gte", column, value]);
        return builder;
      },
      lte(column: string, value: string) {
        calls.push(["lte", column, value]);
        return builder;
      },
      limit(value: number) {
        calls.push(["limit", value]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return builder;
      },
      then(resolve: (value: typeof listResponse) => unknown) {
        return Promise.resolve(resolve(listResponse));
      },
    };
    return builder;
  },
  rpc(functionName: string, args: Record<string, string>) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  SoilEarningReadServiceError,
  getSoilTotalEarned,
  hasSoilEarningHistory,
  listSoilEarnings,
} = await import("./soil-earning-read-service.ts");

function earningRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "earning-base",
    factory_id: "factory-a",
    soil_worker_id: "worker-raju",
    soil_daily_trolley_entry_id: "daily-raju",
    work_date: "2026-08-25",
    event_type: "BASE",
    event_sequence: 1,
    amount: "1000",
    trolley_quantity_snapshot: "5",
    rate_per_trolley_snapshot: "200",
    previous_base_amount_snapshot: "0",
    source_base_amount_snapshot: "1000",
    created_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

function reset(): void {
  calls.length = 0;
  listResponse = { data: [], error: null };
  rpcResponse = { data: null, error: null };
}

test("reads immutable base and signed correction events from only the T3 ledger", async () => {
  reset();
  listResponse.data = [
    earningRow({
      id: "earning-down",
      event_type: "CORRECTION",
      event_sequence: 3,
      amount: "-400",
      trolley_quantity_snapshot: "4",
      previous_base_amount_snapshot: "1200",
      source_base_amount_snapshot: "800",
      created_at: "2026-08-25T12:00:00Z",
    }),
    earningRow({
      id: "earning-up",
      event_type: "CORRECTION",
      event_sequence: 2,
      amount: "200",
      trolley_quantity_snapshot: "6",
      previous_base_amount_snapshot: "1000",
      source_base_amount_snapshot: "1200",
      created_at: "2026-08-25T11:00:00Z",
    }),
    earningRow(),
  ];

  const earnings = await listSoilEarnings({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    range: { fromDate: "2026-08-25", toDate: "2026-08-25" },
  });

  assert.deepEqual(earnings.map((earning) => earning.amount), [-400, 200, 1000]);
  assert.equal(earnings[0].eventType, "CORRECTION");
  assert.equal(earnings[0].eventSequence, 3);
  assert.equal(earnings[0].previousBaseAmountSnapshot, 1200);
  assert.equal(earnings[0].sourceBaseAmountSnapshot, 800);
  assert.equal(earnings[0].ratePerTrolleySnapshot, 200);
  assert.equal(calls[0]?.[1], "soil_earnings");
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "soil_worker_id", "worker-raju"],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === "order"), [
    ["order", "work_date", { ascending: false }],
    ["order", "soil_daily_trolley_entry_id", { ascending: true }],
    ["order", "event_sequence", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === "gte" || method === "lte"), [
    ["gte", "work_date", "2026-08-25"],
    ["lte", "work_date", "2026-08-25"],
  ]);
});

test("includes both work_date boundaries regardless of created_at", async () => {
  reset();
  listResponse.data = [
    earningRow({
      id: "earning-to",
      work_date: "2026-09-19",
      amount: "600",
      created_at: "2000-01-01T00:00:00Z",
    }),
    earningRow({
      id: "earning-from",
      work_date: "2026-09-03",
      amount: "400",
      created_at: "2099-01-01T00:00:00Z",
    }),
  ];
  const earnings = await listSoilEarnings({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    range: { fromDate: "2026-09-03", toDate: "2026-09-19" },
  });
  assert.deepEqual(earnings.map((earning) => earning.workDate), [
    "2026-09-19",
    "2026-09-03",
  ]);
  assert.deepEqual(calls.filter(([method]) => method === "gte" || method === "lte"), [
    ["gte", "work_date", "2026-09-03"],
    ["lte", "work_date", "2026-09-19"],
  ]);
});

test("checks all-time earning existence without applying the reporting range", async () => {
  reset();
  listResponse.data = [{ id: "earning-old" }];
  assert.equal(await hasSoilEarningHistory({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
  }), true);
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "soil_worker_id", "worker-raju"],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === "limit"), [["limit", 1]]);
  assert.equal(calls.some(([method]) => method === "gte" || method === "lte"), false);
});

test("gets cumulative earned from the authoritative database aggregate RPC", async () => {
  reset();
  rpcResponse.data = [{ total_earned: "800" }];
  assert.equal(await getSoilTotalEarned({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
  }), 800);
  assert.deepEqual(calls, [["rpc", "get_soil_total_earned", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "worker-raju",
  }]]);
});

test("returns zero total exactly as supplied by the ledger aggregate", async () => {
  reset();
  rpcResponse.data = [{ total_earned: 0 }];
  assert.equal(await getSoilTotalEarned({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
  }), 0);
});

test("preserves factory-security errors for history and total reads", async () => {
  reset();
  listResponse.error = {
    message: "Access denied.",
    code: "42501",
    details: "factory mapping missing",
    hint: null,
  };
  await assert.rejects(
    () => listSoilEarnings({
      factoryId: "factory-b",
      soilWorkerId: "worker-b",
      range: { fromDate: "2026-08-25", toDate: "2026-08-25" },
    }),
    (error: unknown) => error instanceof SoilEarningReadServiceError
      && error.code === "42501"
      && error.details === "factory mapping missing",
  );

  reset();
  rpcResponse.error = {
    message: "Soil worker does not belong to this factory.",
    code: "P2602",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => getSoilTotalEarned({ factoryId: "factory-a", soilWorkerId: "worker-b" }),
    (error: unknown) => error instanceof SoilEarningReadServiceError
      && error.code === "P2602",
  );
});

test("validates required identities and missing aggregate results", async () => {
  reset();
  await assert.rejects(
    () => listSoilEarnings({
      factoryId: "",
      soilWorkerId: "worker-raju",
      range: { fromDate: "2026-08-25", toDate: "2026-08-25" },
    }),
    /factoryId is required/,
  );
  await assert.rejects(
    () => getSoilTotalEarned({ factoryId: "factory-a", soilWorkerId: " " }),
    /soilWorkerId is required/,
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    () => listSoilEarnings({
      factoryId: "factory-a",
      soilWorkerId: "worker-raju",
      range: { fromDate: "2026-08-26", toDate: "2026-08-25" },
    }),
    /valid inclusive range/,
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    () => getSoilTotalEarned({
      factoryId: "factory-a",
      soilWorkerId: "worker-raju",
    }),
    /returned no result/,
  );
});
