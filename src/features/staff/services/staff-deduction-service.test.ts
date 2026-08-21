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
  createStaffSalaryDeduction,
  listStaffSalaryDeductions,
} = await import("./staff-salary-service.ts");

function reset() {
  calls.length = 0;
  rpcResponse = { data: null, error: null };
  listResponse = { data: [], error: null };
}

test("creates a manual deduction and maps the resulting financial summary", async () => {
  reset();
  rpcResponse.data = [{
    deduction_id: "deduction-a", deduction_factory_id: "factory-a",
    deduction_staff_worker_id: "staff-a", deduction_date: "2026-08-20",
    deduction_amount: 1500, deduction_reason: "Absent for several days",
    created_at: "2026-08-20T10:00:00Z", total_earnings: 20000,
    total_deductions: 1500, total_withdrawn: 0, available_balance: 18500,
  }];

  const deduction = await createStaffSalaryDeduction({
    factoryId: "factory-a", staffWorkerId: "staff-a", deductionDate: "2026-08-20",
    amount: 1500, reason: "  Absent for several days  ",
  });
  assert.equal(deduction.reason, "Absent for several days");
  assert.equal(deduction.totalDeductions, 1500);
  assert.equal(deduction.availableBalance, 18500);
  assert.deepEqual(calls, [["rpc", { functionName: "create_staff_salary_deduction", args: {
    p_factory_id: "factory-a", p_staff_worker_id: "staff-a",
    p_deduction_date: "2026-08-20", p_amount: 1500,
    p_reason: "Absent for several days",
  } }]]);
});

test("normalizes an empty optional reason to null", async () => {
  reset();
  rpcResponse.data = [{
    deduction_id: "deduction-a", deduction_factory_id: "factory-a",
    deduction_staff_worker_id: "staff-a", deduction_date: "2026-08-20",
    deduction_amount: 500, deduction_reason: null, created_at: "2026-08-20T10:00:00Z",
    total_earnings: 20000, total_deductions: 500,
    total_withdrawn: 0, available_balance: 19500,
  }];
  await createStaffSalaryDeduction({
    factoryId: "factory-a", staffWorkerId: "staff-a",
    deductionDate: "2026-08-20", amount: 500, reason: "   ",
  });
  assert.equal((calls[0][1] as { args: { p_reason: unknown } }).args.p_reason, null);
});

test("lists immutable deductions newest first", async () => {
  reset();
  listResponse.data = [{
    id: "deduction-a", factory_id: "factory-a", staff_worker_id: "staff-a",
    deduction_date: "2026-08-20", amount: 1500,
    reason: "Absent for several days", created_at: "2026-08-20T10:00:00Z",
  }];
  const deductions = await listStaffSalaryDeductions({
    factoryId: "factory-a", staffWorkerId: "staff-a",
  });
  assert.equal(deductions[0].amount, 1500);
  assert.equal(deductions[0].reason, "Absent for several days");
  assert.deepEqual(calls.slice(-3), [
    ["order", { column: "deduction_date", options: { ascending: false } }],
    ["order", { column: "created_at", options: { ascending: false } }],
    ["order", { column: "id", options: { ascending: false } }],
  ]);
});

test("preserves no-overdeduction database errors", async () => {
  reset();
  rpcResponse.error = {
    message: "Deduction amount 5001 exceeds available Staff balance 5000.",
    code: "P0001", details: "Available balance cannot become negative.", hint: null,
  };
  await assert.rejects(
    () => createStaffSalaryDeduction({
      factoryId: "factory-a", staffWorkerId: "staff-a",
      deductionDate: "2026-08-20", amount: 5001,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaffSalaryServiceError);
      assert.equal(error.code, "P0001");
      assert.equal(error.details, "Available balance cannot become negative.");
      return true;
    },
  );
});
