import assert from "node:assert/strict";
import { mock, test } from "node:test";

type QueryCall = [table: string, method: string, column?: string, value?: string | null];
type BalanceRow = {
  date: string;
  amount: number;
  factoryId: string;
  labourGroupId: string | null;
  labourerId: string | null;
};

const calls: QueryCall[] = [];
let earningRows: BalanceRow[] = [];
let withdrawalRows: BalanceRow[] = [];
let earningsError: { message: string } | null = null;
let withdrawalsError: { message: string } | null = null;

const fakeSupabase = {
  from(table: "weekly_earnings" | "withdrawals") {
    const filters = new Map<string, string | null>();
    return {
      select(columns: string) {
        calls.push([table, "select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push([table, "eq", column, value]);
            filters.set(column, value);
            return this;
          },
          is(column: string, value: null) {
            calls.push([table, "is", column, value]);
            filters.set(column, value);
            return this;
          },
          lte(column: string, value: string) {
            calls.push([table, "lte", column, value]);
            const rows = table === "weekly_earnings" ? earningRows : withdrawalRows;
            const error = table === "weekly_earnings" ? earningsError : withdrawalsError;
            return Promise.resolve({
              data: error ? null : rows
                .filter((row) => row.factoryId === filters.get("factory_id"))
                .filter((row) => row.labourGroupId === filters.get("labour_group_id"))
                .filter((row) => row.labourerId === filters.get("labourer_id"))
                .filter((row) => row.date <= value)
                .map((row) => ({ amount: row.amount })),
              error,
            });
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourGroupAvailableBalance } = await import("./labour-group-available-balance-service.ts");

function row(
  date: string,
  amount: number,
  factoryId = "factory-a",
  labourGroupId: string | null = "group-a",
  labourerId: string | null = null,
): BalanceRow {
  return { date, amount, factoryId, labourGroupId, labourerId };
}

function setRows(earnings: BalanceRow[], withdrawals: BalanceRow[]) {
  calls.length = 0;
  earningRows = earnings;
  withdrawalRows = withdrawals;
  earningsError = null;
  withdrawalsError = null;
}

test("aggregates only completed locked group earnings and group withdrawals through the as-of date", async () => {
  setRows(
    [
      row("2026-08-03", 23000.75),
      row("2026-08-10", 5000),
      row("2026-08-03", 999, "factory-b"),
      row("2026-08-03", 999, "factory-a", "group-b"),
      row("2026-08-03", 999, "factory-a", null, "labourer-a"),
    ],
    [
      row("2026-08-09", 1000.25),
      row("2026-08-10", 500),
      row("2026-08-09", 999, "factory-b"),
      row("2026-08-09", 999, "factory-a", "group-b"),
      row("2026-08-09", 999, "factory-a", null, "labourer-a"),
    ],
  );

  assert.deepEqual(
    await getLabourGroupAvailableBalance({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-08-09" }),
    { totalEarned: 23000.75, totalWithdrawn: 1000.25, availableBalance: 22000.5 },
  );
  assert.deepEqual(calls, [
    ["weekly_earnings", "select", "amount"],
    ["weekly_earnings", "eq", "factory_id", "factory-a"],
    ["weekly_earnings", "eq", "labour_group_id", "group-a"],
    ["weekly_earnings", "is", "labourer_id", null],
    ["weekly_earnings", "lte", "week_start", "2026-08-03"],
    ["withdrawals", "select", "amount"],
    ["withdrawals", "eq", "factory_id", "factory-a"],
    ["withdrawals", "eq", "labour_group_id", "group-a"],
    ["withdrawals", "is", "labourer_id", null],
    ["withdrawals", "lte", "withdrawal_date", "2026-08-09"],
  ]);
});

test("includes an earning exactly when its Sunday is the as-of date", async () => {
  setRows([row("2026-08-03", 23000)], []);

  assert.deepEqual(
    await getLabourGroupAvailableBalance({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-08-09" }),
    { totalEarned: 23000, totalWithdrawn: 0, availableBalance: 23000 },
  );
});

test("returns zero totals when no group data exists", async () => {
  setRows([], []);

  assert.deepEqual(
    await getLabourGroupAvailableBalance({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-08-09" }),
    { totalEarned: 0, totalWithdrawn: 0, availableBalance: 0 },
  );
});

test("surfaces earning and withdrawal request failures clearly", async () => {
  setRows([], []);
  earningsError = { message: "Earnings request failed." };
  await assert.rejects(
    () => getLabourGroupAvailableBalance({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-08-09" }),
    /Could not load locked group earnings: Earnings request failed/,
  );

  setRows([], []);
  withdrawalsError = { message: "Withdrawals request failed." };
  await assert.rejects(
    () => getLabourGroupAvailableBalance({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-08-09" }),
    /Could not load group withdrawals: Withdrawals request failed/,
  );
});

test("rejects invalid local calendar dates before querying", async () => {
  setRows([], []);

  await assert.rejects(
    () => getLabourGroupAvailableBalance({ factoryId: "factory-a", labourGroupId: "group-a", asOfDate: "2026-02-30" }),
    /asOfDate must be a valid YYYY-MM-DD date/,
  );
  assert.deepEqual(calls, []);
});
