import assert from "node:assert/strict";
import { mock, test } from "node:test";

type WithdrawalRow = {
  id: string;
  withdrawal_date: string;
  amount: number;
  created_at: string;
};

type QueryCall = [method: string, column?: string, value?: string | null | { ascending: boolean }];

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
          is(column: string, value: null) {
            calls.push(["is", column, value]);
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
const { getLabourGroupWithdrawalHistory } = await import("./labour-group-withdrawal-history-service.ts");

function setResponse(data: WithdrawalRow[] | null, error: { message: string } | null = null) {
  calls.length = 0;
  response = { data, error };
}

test("applies factory/group filters, excludes labourer rows, orders deterministically, and maps rows", async () => {
  setResponse([
    { id: "withdrawal-b", withdrawal_date: "2026-08-10", amount: 500.25, created_at: "2026-08-10T10:00:00Z" },
    { id: "withdrawal-a", withdrawal_date: "2026-08-03", amount: 250, created_at: "2026-08-03T10:00:00Z" },
  ]);

  assert.deepEqual(await getLabourGroupWithdrawalHistory("factory-a", "group-a"), [
    { withdrawalId: "withdrawal-b", withdrawalDate: "2026-08-10", amount: 500.25, createdAt: "2026-08-10T10:00:00Z" },
    { withdrawalId: "withdrawal-a", withdrawalDate: "2026-08-03", amount: 250, createdAt: "2026-08-03T10:00:00Z" },
  ]);
  assert.deepEqual(calls, [
    ["select", "id, withdrawal_date, amount, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "labour_group_id", "group-a"],
    ["is", "labourer_id", null],
    ["order", "withdrawal_date", { ascending: false }],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
});

test("returns an empty list when no group withdrawals exist", async () => {
  setResponse([]);

  assert.deepEqual(await getLabourGroupWithdrawalHistory("factory-a", "group-a"), []);
});

test("surfaces Supabase errors", async () => {
  setResponse(null, { message: "Group withdrawal history request failed." });

  await assert.rejects(
    () => getLabourGroupWithdrawalHistory("factory-a", "group-a"),
    /Group withdrawal history request failed/,
  );
});
