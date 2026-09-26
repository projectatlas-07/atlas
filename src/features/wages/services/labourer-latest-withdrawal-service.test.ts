import assert from "node:assert/strict";
import { mock, test } from "node:test";

type WithdrawalRow = {
  id: string;
  labourer_id: string | null;
  withdrawal_date: string;
  amount: number;
  created_at: string;
};

const calls: unknown[][] = [];
let response: { data: WithdrawalRow[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "withdrawals");
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return this;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        return this;
      },
      not(column: string, operator: string, value: null) {
        calls.push(["not", column, operator, value]);
        return this;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return this;
      },
      limit(value: number) {
        calls.push(["limit", value]);
        return Promise.resolve(response);
      },
      gt(column: string, value: string) {
        calls.push(["gt", column, value]);
        return this;
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLatestLabourerWithdrawalsForFactory } = await import("./labourer-withdrawal-history-service.ts");

test("returns each worker's actual latest factory-scoped withdrawal", async () => {
  response = {
    data: [
      { id: "01", labourer_id: "worker-a", withdrawal_date: "2026-09-18", amount: 100, created_at: "2026-09-18T09:00:00Z" },
      { id: "02", labourer_id: "worker-b", withdrawal_date: "2026-09-20", amount: 200, created_at: "2026-09-20T09:00:00Z" },
      { id: "03", labourer_id: "worker-a", withdrawal_date: "2026-09-24", amount: 300, created_at: "2026-09-24T09:00:00Z" },
      { id: "04", labourer_id: null, withdrawal_date: "2026-09-24", amount: 999, created_at: "2026-09-24T10:00:00Z" },
    ],
    error: null,
  };

  assert.deepEqual(await getLatestLabourerWithdrawalsForFactory("factory-a"), [
    { labourerId: "worker-a", withdrawalId: "03", withdrawalDate: "2026-09-24", amount: 300, createdAt: "2026-09-24T09:00:00Z" },
    { labourerId: "worker-b", withdrawalId: "02", withdrawalDate: "2026-09-20", amount: 200, createdAt: "2026-09-20T09:00:00Z" },
  ]);
  assert.deepEqual(calls, [
    ["select", "id, labourer_id, withdrawal_date, amount, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["not", "labourer_id", "is", null],
    ["order", "id", { ascending: true }],
    ["limit", 500],
  ]);
});

test("surfaces latest-withdrawal read errors", async () => {
  calls.length = 0;
  response = { data: null, error: { message: "Latest payments unavailable." } };
  await assert.rejects(
    () => getLatestLabourerWithdrawalsForFactory("factory-a"),
    /Latest payments unavailable/,
  );
});
