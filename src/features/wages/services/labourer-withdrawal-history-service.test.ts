import assert from "node:assert/strict";
import { mock, test } from "node:test";

type WithdrawalRow = {
  id: string;
  withdrawal_date: string;
  amount: number;
  created_at: string;
};

type QueryCall = [method: string, column?: string, value?: string | { ascending: boolean }];

const calls: QueryCall[] = [];
let response: { data: WithdrawalRow[] | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, "withdrawals");
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            return column === "id" ? Promise.resolve(response) : this;
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourerWithdrawalHistory } = await import("./labourer-withdrawal-history-service.ts");

function setResponse(data: WithdrawalRow[] | null, error: { message: string } | null = null) {
  calls.length = 0;
  response = { data, error };
}

test("applies factory and labourer filters, deterministic ordering, and maps rows", async () => {
  setResponse([
    { id: "withdrawal-b", withdrawal_date: "2026-08-09", amount: 250.5, created_at: "2026-08-09T10:00:00Z" },
    { id: "withdrawal-a", withdrawal_date: "2026-08-02", amount: 100, created_at: "2026-08-02T10:00:00Z" },
  ]);

  assert.deepEqual(await getLabourerWithdrawalHistory("factory-a", "labourer-a"), [
    { withdrawalId: "withdrawal-b", withdrawalDate: "2026-08-09", amount: 250.5, createdAt: "2026-08-09T10:00:00Z" },
    { withdrawalId: "withdrawal-a", withdrawalDate: "2026-08-02", amount: 100, createdAt: "2026-08-02T10:00:00Z" },
  ]);
  assert.deepEqual(calls, [
    ["select", "id, withdrawal_date, amount, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "labourer_id", "labourer-a"],
    ["order", "withdrawal_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("returns an empty list when no withdrawals exist", async () => {
  setResponse([]);

  assert.deepEqual(await getLabourerWithdrawalHistory("factory-a", "labourer-a"), []);
});

test("surfaces Supabase errors", async () => {
  setResponse(null, { message: "Withdrawal history request failed." });

  await assert.rejects(
    () => getLabourerWithdrawalHistory("factory-a", "labourer-a"),
    /Withdrawal history request failed/,
  );
});
