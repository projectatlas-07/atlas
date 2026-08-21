import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };

const calls: Array<[string, unknown?]> = [];
let rpcResponse: { data: Row[] | null; error: DatabaseError | null };
let listResponse: { data: Row[] | null; error: DatabaseError | null };

const fakeSupabase = {
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", { functionName, args }]);
    return Promise.resolve(rpcResponse);
  },
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        let orderCount = 0;
        return {
          eq(column: string, value: string) {
            calls.push(["eq", { column, value }]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", { column, options }]);
            orderCount += 1;
            return orderCount === 3 ? Promise.resolve(listResponse) : this;
          },
        };
      },
    };
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const {
  StaffSalaryServiceError,
  createStaffWithdrawal,
  getStaffFinancialSummary,
  listStaffWithdrawals,
} = await import("./staff-salary-service.ts");

function reset() {
  calls.length = 0;
  rpcResponse = { data: null, error: null };
  listResponse = { data: [], error: null };
}

test("loads current Staff financial state through the automatic backend summary", async () => {
  reset();
  rpcResponse.data = [{
    total_earnings: 40000, total_deductions: 2000,
    total_withdrawn: 13000, available_balance: 25000,
  }];

  assert.deepEqual(await getStaffFinancialSummary({
    factoryId: "factory-a", staffWorkerId: "staff-a",
  }), {
    totalEarnings: 40000, totalDeductions: 2000,
    totalWithdrawn: 13000, availableBalance: 25000,
  });
  assert.deepEqual(calls, [["rpc", { functionName: "get_staff_financial_summary", args: {
    p_factory_id: "factory-a", p_staff_worker_id: "staff-a",
  } }]]);
});

test("creates a partial Staff withdrawal and maps the authoritative resulting balance", async () => {
  reset();
  rpcResponse.data = [{
    withdrawal_id: "withdrawal-a", withdrawal_factory_id: "factory-a",
    withdrawal_staff_worker_id: "staff-a", withdrawal_date: "2026-08-20",
    withdrawal_amount: 10000, created_at: "2026-08-20T10:00:00Z",
    total_earnings: 40000, total_deductions: 2000,
    total_withdrawn: 10000, available_balance: 28000,
  }];

  const withdrawal = await createStaffWithdrawal({
    factoryId: "factory-a", staffWorkerId: "staff-a",
    withdrawalDate: "2026-08-20", amount: 10000,
  });
  assert.equal(withdrawal.amount, 10000);
  assert.equal(withdrawal.totalDeductions, 2000);
  assert.equal(withdrawal.availableBalance, 28000);
  assert.deepEqual(calls, [["rpc", { functionName: "create_staff_withdrawal", args: {
    p_factory_id: "factory-a", p_staff_worker_id: "staff-a",
    p_withdrawal_date: "2026-08-20", p_amount: 10000,
  } }]]);
});

test("lists immutable Staff withdrawals newest first", async () => {
  reset();
  listResponse.data = [{
    id: "withdrawal-a", factory_id: "factory-a", staff_worker_id: "staff-a",
    withdrawal_date: "2026-08-20", amount: 3000, created_at: "2026-08-20T10:00:00Z",
  }];

  const withdrawals = await listStaffWithdrawals({
    factoryId: "factory-a", staffWorkerId: "staff-a",
  });
  assert.equal(withdrawals[0].amount, 3000);
  assert.deepEqual(calls.slice(-3), [
    ["order", { column: "withdrawal_date", options: { ascending: false } }],
    ["order", { column: "created_at", options: { ascending: false } }],
    ["order", { column: "id", options: { ascending: false } }],
  ]);
});

test("preserves no-overdraw database errors", async () => {
  reset();
  rpcResponse.error = {
    message: "Withdrawal amount 8001 exceeds available Staff balance 8000.",
    code: "P0001", details: "No advance salary is allowed.", hint: null,
  };

  await assert.rejects(
    () => createStaffWithdrawal({
      factoryId: "factory-a", staffWorkerId: "staff-a",
      withdrawalDate: "2026-08-20", amount: 8001,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaffSalaryServiceError);
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "No advance salary is allowed.");
      return true;
    },
  );
});
