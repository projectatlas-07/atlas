import assert from "node:assert/strict";
import { mock, test } from "node:test";

type SummaryRow = {
  workers_calculated: number;
  detail_rows_created: number;
  rows_skipped: number;
};

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

const calls: Array<[string, Record<string, string>]> = [];
let response: {
  data: SummaryRow[] | null;
  error: DatabaseError | null;
} = {
  data: [{ workers_calculated: 2, detail_rows_created: 3, rows_skipped: 0 }],
  error: null,
};

const fakeSupabase = {
  rpc(functionName: string, args: Record<string, string>) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  CalculateTransportWeeklyWagesError,
  calculateTransportWeeklyWages,
} = await import("./transport-weekly-wage-calculation-service.ts");

function setResponse(
  data: SummaryRow[] | null,
  error: DatabaseError | null = null,
): void {
  calls.length = 0;
  response = { data, error };
}

test("calls only the controlled weekly transport calculator and maps its summary", async () => {
  setResponse([{ workers_calculated: 2, detail_rows_created: 3, rows_skipped: 0 }]);

  assert.deepEqual(await calculateTransportWeeklyWages({
    factoryId: "factory-a",
    weekStart: "2026-08-03",
  }), {
    workersCalculated: 2,
    detailRowsCreated: 3,
    rowsSkipped: 0,
  });

  assert.deepEqual(calls, [["calculate_transport_weekly_wages", {
    p_factory_id: "factory-a",
    p_week_start: "2026-08-03",
  }]]);
});

test("maps an already-calculated week as an immutable skip", async () => {
  setResponse([{ workers_calculated: 0, detail_rows_created: 0, rows_skipped: 2 }]);

  assert.deepEqual(await calculateTransportWeeklyWages({
    factoryId: "factory-a",
    weekStart: "2026-08-03",
  }), {
    workersCalculated: 0,
    detailRowsCreated: 0,
    rowsSkipped: 2,
  });
});

test("preserves understandable financial RPC errors and database details", async () => {
  setResponse(null, {
    message: "No transport crew wage rate applies to crew crew-a on 2026-08-05.",
    code: "P2602",
    details: "exact work-date resolution",
    hint: "Create the missing crew rate.",
  });

  await assert.rejects(
    () => calculateTransportWeeklyWages({
      factoryId: "factory-a",
      weekStart: "2026-08-03",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CalculateTransportWeeklyWagesError);
      assert.equal(error.code, "P2602");
      assert.match(error.message, /No transport crew wage rate/);
      assert.equal(error.details, "exact work-date resolution");
      assert.equal(error.hint, "Create the missing crew rate.");
      return true;
    },
  );
});

test("rejects an RPC response without a calculation summary", async () => {
  setResponse([]);

  await assert.rejects(
    () => calculateTransportWeeklyWages({
      factoryId: "factory-a",
      weekStart: "2026-08-03",
    }),
    /calculate_transport_weekly_wages returned no summary/,
  );
});
