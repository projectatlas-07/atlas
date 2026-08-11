import assert from "node:assert/strict";
import { mock, test } from "node:test";

type QueryCall = [table: string, method: string, column?: string, value?: string];
type DatedAmount = { date: string; amount: number };

const calls: QueryCall[] = [];
let earningRows: DatedAmount[] = [];
let withdrawalRows: DatedAmount[] = [];
let earningsError: { message: string } | null = null;
let withdrawalsError: { message: string } | null = null;

const fakeSupabase = {
  from(table: "weekly_earnings" | "withdrawals") {
    return {
      select(columns: string) {
        calls.push([table, "select", columns]);
        return {
          eq(column: string, value: string) {
            calls.push([table, "eq", column, value]);
            return this;
          },
          lte(column: string, value: string) {
            calls.push([table, "lte", column, value]);
            const rows = table === "weekly_earnings" ? earningRows : withdrawalRows;
            const error = table === "weekly_earnings" ? earningsError : withdrawalsError;
            return Promise.resolve({
              data: error ? null : rows.filter((row) => row.date <= value).map((row) => ({ amount: row.amount })),
              error,
            });
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourerAvailableBalance } = await import("./labourer-available-balance-service.ts");

function setRows(earnings: DatedAmount[], withdrawals: DatedAmount[]) {
  calls.length = 0;
  earningRows = earnings;
  withdrawalRows = withdrawals;
  earningsError = null;
  withdrawalsError = null;
}

test("sums only locked earnings whose Sunday has ended by the supplied date", async () => {
  setRows(
    [
      { date: "2026-08-03", amount: 795 },
      { date: "2026-08-10", amount: 530 },
    ],
    [],
  );

  assert.deepEqual(
    await getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-08-09" }),
    { totalEarned: 795, totalWithdrawn: 0, availableBalance: 795 },
  );
  assert.deepEqual(calls, [
    ["weekly_earnings", "select", "amount"],
    ["weekly_earnings", "eq", "factory_id", "factory-a"],
    ["weekly_earnings", "eq", "labourer_id", "labourer-a"],
    ["weekly_earnings", "lte", "week_start", "2026-08-03"],
    ["withdrawals", "select", "amount"],
    ["withdrawals", "eq", "factory_id", "factory-a"],
    ["withdrawals", "eq", "labourer_id", "labourer-a"],
    ["withdrawals", "lte", "withdrawal_date", "2026-08-09"],
  ]);
});

test("subtracts withdrawals through the date and excludes future withdrawals", async () => {
  setRows(
    [{ date: "2026-08-03", amount: 1000 }],
    [
      { date: "2026-08-08", amount: 250 },
      { date: "2026-08-10", amount: 100 },
    ],
  );

  assert.deepEqual(
    await getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-08-09" }),
    { totalEarned: 1000, totalWithdrawn: 250, availableBalance: 750 },
  );
});

test("returns zero totals when no data exists", async () => {
  setRows([], []);

  assert.deepEqual(
    await getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-08-09" }),
    { totalEarned: 0, totalWithdrawn: 0, availableBalance: 0 },
  );
});

test("surfaces earnings and withdrawal request failures clearly", async () => {
  setRows([], []);
  earningsError = { message: "Earnings request failed." };
  await assert.rejects(
    () => getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-08-09" }),
    /Could not load locked earnings: Earnings request failed/,
  );

  setRows([], []);
  withdrawalsError = { message: "Withdrawals request failed." };
  await assert.rejects(
    () => getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-08-09" }),
    /Could not load withdrawals: Withdrawals request failed/,
  );
});

test("rejects invalid local calendar dates before querying", async () => {
  setRows([], []);

  await assert.rejects(
    () => getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-02-30" }),
    /asOfDate must be a valid YYYY-MM-DD date/,
  );
  assert.deepEqual(calls, []);
});
