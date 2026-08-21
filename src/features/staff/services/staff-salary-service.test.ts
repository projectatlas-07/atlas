import assert from "node:assert/strict";
import { mock, test } from "node:test";

type DatabaseError = { message: string; code: string; details: string | null; hint: string | null };
type Row = Record<string, unknown>;

const calls: Array<[string, unknown?]> = [];
let insertResponse: { data: Row | null; error: DatabaseError | null };
let updateResponse: { data: Array<{ id: string }> | null; error: DatabaseError | null };
let rpcResponse: { data: Row | Row[] | string | null; error: DatabaseError | null };
let listResponse: { data: Row[] | null; error: DatabaseError | null };

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        let orderCount = 0;
        return {
          eq(column: string, value: string) { calls.push(["eq", { column, value }]); return this; },
          is(column: string, value: null) { calls.push(["is", { column, value }]); return this; },
          lte(column: string, value: string) { calls.push(["lte", { column, value }]); return this; },
          or(filters: string) { calls.push(["or", filters]); return this; },
          limit(count: number) { calls.push(["limit", count]); return Promise.resolve(listResponse); },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", { column, options }]);
            orderCount += 1;
            return orderCount === 2 ? Promise.resolve(listResponse) : this;
          },
        };
      },
      insert(payload: Row) {
        calls.push(["insert", payload]);
        return { select(columns: string) {
          calls.push(["select", columns]);
          return { single() { return Promise.resolve(insertResponse); } };
        } };
      },
      update(payload: Row) {
        calls.push(["update", payload]);
        return {
          eq(column: string, value: string) { calls.push(["eq", { column, value }]); return this; },
          select(columns: string) { calls.push(["select", columns]); return Promise.resolve(updateResponse); },
        };
      },
    };
  },
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", { functionName, args }]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const {
  StaffSalaryServiceError,
  activateStaffWorker,
  createStaffCategory,
  createStaffWorker,
  createStaffCategoryMonthlySalary,
  createStaffMonthlySalaryOverride,
  ensureStaffMonthlyEarnings,
  getStaffCategoryMonthlySalaryForDate,
  listStaffSalaryEligibilityPeriods,
  listStaffMonthlyEarnings,
  deactivateStaffWorker,
  deleteStaffWorker,
  resolveStaffMonthlySalary,
} = await import("./staff-salary-service.ts");

const categoryRow = {
  id: "category-a", factory_id: "factory-a", name: "Manager", is_active: true,
  created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
};
const workerRow = {
  ...categoryRow, id: "staff-a", name: "Asha", staff_category_id: "category-a",
};
const salaryRow = {
  id: "salary-a", factory_id: "factory-a", staff_category_id: "category-a",
  staff_worker_id: null, monthly_salary: 12000, effective_from: "2026-09-01",
  effective_to: null, created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
};
const eligibilityRow = {
  id: "eligibility-a", factory_id: "factory-a", staff_worker_id: "staff-a",
  effective_from_month: "2026-08-01", effective_to_month: null,
  first_month_custom_salary: 9000,
  created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
};

function reset() {
  calls.length = 0;
  insertResponse = { data: null, error: null };
  updateResponse = { data: [{ id: "staff-a" }], error: null };
  rpcResponse = { data: null, error: null };
  listResponse = { data: [], error: null };
}

test("creates trimmed Staff categories and workers in their separate tables", async () => {
  reset();
  insertResponse.data = categoryRow;
  const category = await createStaffCategory({ factoryId: "factory-a", name: "  Manager  " });
  assert.equal(category.name, "Manager");
  assert.deepEqual(calls[1], ["insert", { factory_id: "factory-a", name: "Manager" }]);

  calls.length = 0;
  rpcResponse.data = workerRow;
  const worker = await createStaffWorker({
    factoryId: "factory-a", name: " Asha ", staffCategoryId: "category-a",
    salaryStartMonth: "2026-08-01", firstMonthCustomSalary: 9000,
  });
  assert.equal(worker.staffCategoryId, "category-a");
  assert.deepEqual(calls, [["rpc", { functionName: "create_staff_worker", args: {
    p_factory_id: "factory-a", p_name: "Asha", p_staff_category_id: "category-a",
    p_salary_start_month: "2026-08-01", p_first_month_custom_salary: 9000,
  } }]]);

  await assert.rejects(
    () => createStaffWorker({
      factoryId: "factory-a", name: "  ", staffCategoryId: "category-a",
      salaryStartMonth: "2026-08-01",
    }),
    /name is required/,
  );
});

test("deactivates one factory-scoped Staff worker without deleting it", async () => {
  reset();
  rpcResponse.data = { ...workerRow, is_active: false };
  await deactivateStaffWorker({
    factoryId: "factory-a", staffWorkerId: "staff-a", deactivationMonth: "2026-10-01",
  });
  assert.deepEqual(calls, [["rpc", { functionName: "deactivate_staff_worker", args: {
    p_factory_id: "factory-a", p_staff_worker_id: "staff-a",
    p_deactivation_month: "2026-10-01",
  } }]]);
});

test("reactivation requires an explicit new salary eligibility month", async () => {
  reset();
  rpcResponse.data = workerRow;
  await activateStaffWorker({
    factoryId: "factory-a", staffWorkerId: "staff-a", salaryRestartMonth: "2026-12-01",
  });
  assert.deepEqual(calls, [["rpc", { functionName: "reactivate_staff_worker", args: {
    p_factory_id: "factory-a", p_staff_worker_id: "staff-a",
    p_salary_restart_month: "2026-12-01",
  } }]]);
});

test("lists salary eligibility periods used to choose each worker display month", async () => {
  reset();
  listResponse.data = [eligibilityRow];
  const periods = await listStaffSalaryEligibilityPeriods("factory-a");
  assert.deepEqual(periods[0], {
    id: "eligibility-a", factoryId: "factory-a", staffWorkerId: "staff-a",
    effectiveFromMonth: "2026-08-01", effectiveToMonth: null,
    firstMonthCustomSalary: 9000,
    createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:00Z",
  });
  assert.deepEqual(calls.slice(-3), [
    ["eq", { column: "factory_id", value: "factory-a" }],
    ["order", { column: "effective_from_month", options: { ascending: true } }],
    ["order", { column: "id", options: { ascending: true } }],
  ]);
});

test("deletes exactly one factory-scoped Staff UUID through the guarded RPC", async () => {
  reset();
  rpcResponse.data = "staff-a";
  await deleteStaffWorker({ factoryId: "factory-a", staffWorkerId: "staff-a" });
  assert.deepEqual(calls, [["rpc", { functionName: "delete_staff_worker", args: {
    p_factory_id: "factory-a", p_staff_worker_id: "staff-a",
  } }]]);
});

test("preserves the backend's financial-history deletion rejection", async () => {
  reset();
  rpcResponse.error = {
    code: "P2540",
    message: "This Staff member has salary history and cannot be deleted. Deactivate them instead.",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => deleteStaffWorker({ factoryId: "factory-a", staffWorkerId: "staff-a" }),
    (error: unknown) => {
      assert.ok(error instanceof StaffSalaryServiceError);
      assert.equal(error.code, "P2540");
      assert.match(error.message, /Deactivate them instead/);
      return true;
    },
  );
});

test("creates category and individual salary tracks through guarded RPCs", async () => {
  reset();
  rpcResponse.data = salaryRow;
  const categoryRate = await createStaffCategoryMonthlySalary({
    factoryId: "factory-a", staffCategoryId: "category-a",
    monthlySalary: 12000, effectiveFrom: "2026-09-01",
  });
  assert.equal(categoryRate.monthlySalary, 12000);
  assert.equal((calls[0][1] as { functionName: string }).functionName, "create_staff_category_monthly_salary");

  calls.length = 0;
  rpcResponse.data = { ...salaryRow, id: "override-a", staff_category_id: null, staff_worker_id: "staff-a" };
  const override = await createStaffMonthlySalaryOverride({
    factoryId: "factory-a", staffWorkerId: "staff-a",
    monthlySalary: 15000, effectiveFrom: "2026-09-01",
  });
  assert.equal(override.staffWorkerId, "staff-a");
  assert.equal((calls[0][1] as { functionName: string }).functionName, "create_staff_monthly_salary_override");
});

test("Tractor Driver August correction and display resolution both use August first", async () => {
  reset();
  rpcResponse.data = {
    ...salaryRow, id: "driver-rate", monthly_salary: 10500,
    effective_from: "2026-08-01",
  };
  const corrected = await createStaffCategoryMonthlySalary({
    factoryId: "factory-a", staffCategoryId: "driver-category",
    monthlySalary: 10500, effectiveFrom: "2026-08-01",
  });
  assert.equal(corrected.monthlySalary, 10500);
  assert.deepEqual(calls[0], ["rpc", { functionName: "create_staff_category_monthly_salary", args: {
    p_factory_id: "factory-a", p_staff_category_id: "driver-category",
    p_monthly_salary: 10500, p_effective_from: "2026-08-01",
  } }]);

  calls.length = 0;
  rpcResponse.data = [{
    salary_configuration_id: "driver-rate", monthly_salary: 10500,
    source: "CATEGORY_DEFAULT", staff_category_id: "driver-category",
  }];
  const resolved = await resolveStaffMonthlySalary({
    factoryId: "factory-a", staffWorkerId: "dholu-id", effectiveDate: "2026-08-01",
  });
  assert.equal(resolved.monthlySalary, 10500);
  assert.deepEqual(calls[0], ["rpc", { functionName: "resolve_staff_monthly_salary", args: {
    p_factory_id: "factory-a", p_staff_id: "dholu-id", p_effective_date: "2026-08-01",
  } }]);
});

test("worker creation preserves the missing start-month salary rejection", async () => {
  reset();
  rpcResponse.error = {
    code: "P2505",
    message: "Salary not set for the Staff start month. Configure the category salary for that month first.",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => createStaffWorker({
      factoryId: "factory-a", name: "Dholu", staffCategoryId: "driver-category",
      salaryStartMonth: "2026-08-01",
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaffSalaryServiceError);
      assert.equal(error.code, "P2505");
      return true;
    },
  );
});

test("maps the database resolver's explicit precedence result", async () => {
  reset();
  rpcResponse.data = [{
    salary_configuration_id: "override-a", monthly_salary: 15000,
    source: "STAFF_OVERRIDE", staff_category_id: "category-a",
  }];
  assert.deepEqual(await resolveStaffMonthlySalary({
    factoryId: "factory-a", staffWorkerId: "staff-a", effectiveDate: "2026-09-01",
  }), {
    salaryConfigurationId: "override-a", monthlySalary: 15000,
    source: "STAFF_OVERRIDE", staffCategoryId: "category-a",
  });
});

test("reads the current category default salary without resolving through a worker", async () => {
  reset();
  listResponse.data = [salaryRow];
  const rate = await getStaffCategoryMonthlySalaryForDate({
    factoryId: "factory-a", staffCategoryId: "category-a", effectiveDate: "2026-09-01",
  });
  assert.equal(rate?.monthlySalary, 12000);
  assert.deepEqual(calls.slice(-4), [
    ["is", { column: "staff_worker_id", value: null }],
    ["lte", { column: "effective_from", value: "2026-09-01" }],
    ["or", "effective_to.is.null,effective_to.gte.2026-09-01"],
    ["limit", 2],
  ]);
});

test("ensures missing monthly earnings through infrastructure RPC", async () => {
  reset();
  rpcResponse.data = [{
    earnings_created: 3, first_created_month: "2026-08-01", last_created_month: "2026-10-01",
  }];
  assert.deepEqual(await ensureStaffMonthlyEarnings({
    factoryId: "factory-a", staffWorkerId: "staff-a", throughMonth: "2026-10-01",
  }), {
    earningsCreated: 3, firstCreatedMonth: "2026-08-01", lastCreatedMonth: "2026-10-01",
  });
  assert.equal((calls[0][1] as { functionName: string }).functionName, "ensure_staff_monthly_earnings");
});

test("lists immutable earning snapshots newest first", async () => {
  reset();
  listResponse.data = [{
    id: "earning-a", factory_id: "factory-a", staff_worker_id: "staff-a",
    salary_month: "2026-08-01", credited_amount: 9000,
    salary_configuration_id: "salary-a", resolved_monthly_salary_snapshot: 12000,
    salary_source_snapshot: "CATEGORY_DEFAULT", credit_source: "FIRST_MONTH_CUSTOM",
    staff_category_id_snapshot: "category-a", created_at: "2026-08-20T10:00:00Z",
  }];
  const earnings = await listStaffMonthlyEarnings({
    factoryId: "factory-a", staffWorkerId: "staff-a",
  });
  assert.equal(earnings[0].creditedAmount, 9000);
  assert.equal(earnings[0].resolvedMonthlySalarySnapshot, 12000);
  assert.equal(earnings[0].creditSource, "FIRST_MONTH_CUSTOM");
  assert.deepEqual(calls.slice(-2), [
    ["order", { column: "salary_month", options: { ascending: false } }],
    ["order", { column: "id", options: { ascending: false } }],
  ]);
});
