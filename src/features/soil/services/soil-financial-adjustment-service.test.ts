import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Call = [method: string, value?: unknown, secondValue?: unknown];

const calls: Call[] = [];
let rpcResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};
let listResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [], error: null,
};

const fakeSupabase = {
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponse);
  },
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
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  SoilFinancialAdjustmentServiceError,
  createSoilFinancialAdjustment,
  listSoilFinancialAdjustments,
} = await import("./soil-financial-adjustment-service.ts");

function reset(): void {
  calls.length = 0;
  rpcResponse = { data: [], error: null };
  listResponse = { data: [], error: null };
}

function adjustmentResult(overrides: Row = {}): Row {
  return {
    adjustment_id: "adjustment-a",
    adjustment_factory_id: "factory-a",
    adjustment_soil_worker_id: "worker-raju",
    adjustment_type: "ADDITION",
    adjustment_date: "2026-08-28",
    adjustment_amount: "500",
    adjustment_reason: "Festival bonus",
    created_at: "2026-08-28T10:00:00Z",
    total_earned: "1000",
    total_additions: "500",
    total_deductions: "0",
    total_paid: "600",
    available_balance: "900",
    ...overrides,
  };
}

test("creates a normalized addition through only the controlled adjustment RPC", async () => {
  reset();
  rpcResponse.data = [adjustmentResult()];

  assert.deepEqual(await createSoilFinancialAdjustment({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    adjustmentType: "ADDITION",
    adjustmentDate: "2026-08-28",
    amount: 500,
    reason: "  Festival bonus  ",
  }), {
    id: "adjustment-a",
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    adjustmentType: "ADDITION",
    adjustmentDate: "2026-08-28",
    amount: 500,
    reason: "Festival bonus",
    createdAt: "2026-08-28T10:00:00Z",
    totalEarned: 1000,
    totalAdditions: 500,
    totalDeductions: 0,
    totalPaid: 600,
    availableBalance: 900,
  });
  assert.deepEqual(calls, [["rpc", "create_soil_financial_adjustment", {
    p_factory_id: "factory-a",
    p_soil_worker_id: "worker-raju",
    p_adjustment_type: "ADDITION",
    p_adjustment_date: "2026-08-28",
    p_amount: 500,
    p_reason: "Festival bonus",
  }]]);
});

test("maps a deduction and its authoritative updated summary", async () => {
  reset();
  rpcResponse.data = [adjustmentResult({
    adjustment_id: "adjustment-b",
    adjustment_type: "DEDUCTION",
    adjustment_amount: "300",
    adjustment_reason: "Absent part of day",
    total_deductions: "300",
    available_balance: "600",
  })];

  const adjustment = await createSoilFinancialAdjustment({
    factoryId: "factory-a",
    soilWorkerId: "worker-raju",
    adjustmentType: "DEDUCTION",
    adjustmentDate: "2026-08-28",
    amount: 300,
    reason: "Absent part of day",
  });
  assert.equal(adjustment.adjustmentType, "DEDUCTION");
  assert.equal(adjustment.totalDeductions, 300);
  assert.equal(adjustment.availableBalance, 600);
});

test("lists separate immutable adjustment history newest first", async () => {
  reset();
  listResponse.data = [{
    id: "adjustment-b",
    factory_id: "factory-a",
    soil_worker_id: "worker-raju",
    adjustment_type: "DEDUCTION",
    adjustment_date: "2026-08-29",
    amount: "300",
    reason: "Absent part of day",
    created_at: "2026-08-29T10:00:00Z",
  }, {
    id: "adjustment-a",
    factory_id: "factory-a",
    soil_worker_id: "worker-raju",
    adjustment_type: "ADDITION",
    adjustment_date: "2026-08-28",
    amount: "500",
    reason: "Festival bonus",
    created_at: "2026-08-28T10:00:00Z",
  }];

  const rows = await listSoilFinancialAdjustments({
    factoryId: "factory-a", soilWorkerId: "worker-raju",
  });
  assert.deepEqual(rows.map((row) => row.adjustmentType), ["DEDUCTION", "ADDITION"]);
  assert.equal(calls[0]?.[1], "soil_financial_adjustments");
  assert.deepEqual(calls.filter(([method]) => method === "order"), [
    ["order", "adjustment_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("rejects invalid adjustment inputs before database access", async () => {
  reset();
  await assert.rejects(
    () => createSoilFinancialAdjustment({
      factoryId: "", soilWorkerId: "worker", adjustmentType: "ADDITION",
      adjustmentDate: "2026-08-28", amount: 1, reason: "Reason",
    }),
    /factoryId is required/,
  );
  await assert.rejects(
    () => createSoilFinancialAdjustment({
      factoryId: "factory", soilWorkerId: "worker",
      adjustmentType: "OTHER" as "ADDITION",
      adjustmentDate: "2026-08-28", amount: 1, reason: "Reason",
    }),
    /ADDITION or DEDUCTION/,
  );
  await assert.rejects(
    () => createSoilFinancialAdjustment({
      factoryId: "factory", soilWorkerId: "worker", adjustmentType: "ADDITION",
      adjustmentDate: "2026-02-30", amount: 1, reason: "Reason",
    }),
    /valid YYYY-MM-DD date/,
  );
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => createSoilFinancialAdjustment({
        factoryId: "factory", soilWorkerId: "worker", adjustmentType: "ADDITION",
        adjustmentDate: "2026-08-28", amount, reason: "Reason",
      }),
      /positive finite number/,
    );
  }
  await assert.rejects(
    () => createSoilFinancialAdjustment({
      factoryId: "factory", soilWorkerId: "worker", adjustmentType: "ADDITION",
      adjustmentDate: "2026-08-28", amount: 1, reason: "  ",
    }),
    /reason is required/,
  );
  assert.equal(calls.length, 0);
});

test("preserves deduction-balance and factory-security errors", async () => {
  reset();
  rpcResponse.error = {
    message: "Deduction exceeds available balance.",
    code: "P2902",
    details: "authoritative database balance",
    hint: null,
  };
  await assert.rejects(
    () => createSoilFinancialAdjustment({
      factoryId: "factory-a", soilWorkerId: "worker-raju",
      adjustmentType: "DEDUCTION", adjustmentDate: "2026-08-28",
      amount: 1001, reason: "Correction",
    }),
    (error: unknown) => error instanceof SoilFinancialAdjustmentServiceError
      && error.code === "P2902"
      && error.message.includes("available balance"),
  );

  reset();
  listResponse.error = {
    message: "Access denied.", code: "42501", details: null, hint: null,
  };
  await assert.rejects(
    () => listSoilFinancialAdjustments({
      factoryId: "factory-b", soilWorkerId: "worker-b",
    }),
    (error: unknown) => error instanceof SoilFinancialAdjustmentServiceError
      && error.code === "42501",
  );
});

test("rejects a successful adjustment RPC response without a result row", async () => {
  reset();
  await assert.rejects(
    () => createSoilFinancialAdjustment({
      factoryId: "factory-a", soilWorkerId: "worker-raju",
      adjustmentType: "ADDITION", adjustmentDate: "2026-08-28",
      amount: 1, reason: "Reason",
    }),
    /returned no adjustment/,
  );
});
