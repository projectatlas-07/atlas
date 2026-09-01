import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

const calls: unknown[][] = [];
let rpcResponse: { data: Row | string | null; error: DatabaseError | null } = {
  data: null,
  error: null,
};
let listResponse: { data: Row[] | null; error: DatabaseError | null } = {
  data: [],
  error: null,
};
let insertResponse: { data: Row | null; error: DatabaseError | null } = {
  data: null,
  error: null,
};

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    return {
      select(columns: string) {
        calls.push(["select", columns]);
        let orderCount = 0;
        return {
          eq(column: string, value: string) {
            calls.push(["eq", column, value]);
            return this;
          },
          order(column: string, options: { ascending: boolean }) {
            calls.push(["order", column, options]);
            orderCount += 1;
            return orderCount === 2 ? Promise.resolve(listResponse) : this;
          },
        };
      },
      insert(payload: Row) {
        calls.push(["insert", payload]);
        return {
          select(columns: string) {
            calls.push(["select", columns]);
            return { single: () => Promise.resolve(insertResponse) };
          },
        };
      },
    };
  },
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    return Promise.resolve(rpcResponse);
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  StaffWorkerServiceError,
  archiveStaffWorker,
  createStaffCategory,
  createStaffWorker,
  deleteStaffCategory,
  deleteStaffWorker,
  listStaffCategories,
  listStaffWorkers,
  restoreStaffWorker,
  updateStaffCategory,
  updateStaffReferenceSalary,
} = await import("./staff-worker-service.ts");

const workerRow = {
  id: "staff-a",
  factory_id: "factory-a",
  name: "Asha",
  staff_category_id: "category-a",
  reference_salary: 120000,
  is_active: true,
  created_at: "2026-08-23T10:00:00Z",
  updated_at: "2026-08-23T10:00:00Z",
};

function reset(): void {
  calls.length = 0;
  rpcResponse = { data: null, error: null };
  listResponse = { data: [], error: null };
  insertResponse = { data: null, error: null };
}

test("lists Staff categories and workers through the authoritative service", async () => {
  reset();
  listResponse.data = [{
    id: "category-a",
    factory_id: "factory-a",
    name: "Manager",
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:00Z",
  }];
  assert.equal((await listStaffCategories("factory-a"))[0].name, "Manager");
  assert.deepEqual(calls.slice(-3), [
    ["eq", "factory_id", "factory-a"],
    ["order", "name", { ascending: true }],
    ["order", "id", { ascending: true }],
  ]);

  reset();
  listResponse.data = [workerRow];
  assert.equal((await listStaffWorkers("factory-a"))[0].referenceSalary, 120000);
});

test("creates a trimmed organizational Staff category", async () => {
  reset();
  insertResponse.data = {
    id: "category-a",
    factory_id: "factory-a",
    name: "Manager",
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:00Z",
  };
  assert.equal((await createStaffCategory({
    factoryId: "factory-a",
    name: "  Manager  ",
  })).name, "Manager");
  assert.deepEqual(calls[1], ["insert", {
    factory_id: "factory-a",
    name: "Manager",
  }]);
  await assert.rejects(
    () => createStaffCategory({ factoryId: "factory-a", name: "  " }),
    /Staff category name is required/,
  );
});

test("renames a factory-scoped Staff category and trims its name", async () => {
  reset();
  rpcResponse.data = {
    id: "category-a",
    factory_id: "factory-a",
    name: "Tractor Driver",
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T11:00:00Z",
  };
  const category = await updateStaffCategory({
    factoryId: "factory-a",
    staffCategoryId: "category-a",
    name: "  Tractor Driver  ",
  });
  assert.equal(category.id, "category-a");
  assert.equal(category.name, "Tractor Driver");
  assert.deepEqual(calls, [["rpc", "update_staff_category", {
    p_factory_id: "factory-a",
    p_staff_category_id: "category-a",
    p_name: "Tractor Driver",
  }]]);

  reset();
  await assert.rejects(
    () => updateStaffCategory({
      factoryId: "factory-a",
      staffCategoryId: "category-a",
      name: "   ",
    }),
    /Staff category name is required/,
  );
  assert.equal(calls.length, 0);
});

test("deletes an unused category only through the guarded RPC", async () => {
  reset();
  rpcResponse.data = "category-a";
  await deleteStaffCategory({
    factoryId: "factory-a",
    staffCategoryId: "category-a",
  });
  assert.deepEqual(calls, [["rpc", "delete_staff_category", {
    p_factory_id: "factory-a",
    p_staff_category_id: "category-a",
  }]]);

  reset();
  rpcResponse.error = {
    message: "This category is assigned to Staff members and cannot be deleted.",
    code: "P2570",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => deleteStaffCategory({
      factoryId: "factory-a",
      staffCategoryId: "category-a",
    }),
    (error: unknown) => error instanceof StaffWorkerServiceError
      && error.code === "P2570",
  );
});

test("creates Staff from only name, category, and individual reference salary", async () => {
  reset();
  rpcResponse.data = workerRow;

  assert.deepEqual(await createStaffWorker({
    factoryId: "factory-a",
    name: "  Asha  ",
    staffCategoryId: "category-a",
    referenceSalary: 120000,
  }), {
    id: "staff-a",
    factoryId: "factory-a",
    name: "Asha",
    staffCategoryId: "category-a",
    referenceSalary: 120000,
    isActive: true,
    createdAt: "2026-08-23T10:00:00Z",
    updatedAt: "2026-08-23T10:00:00Z",
  });

  assert.deepEqual(calls, [["rpc", "create_staff_worker_with_reference_salary", {
    p_factory_id: "factory-a",
    p_name: "Asha",
    p_staff_category_id: "category-a",
    p_reference_salary: 120000,
  }]]);
});

test("updates only one factory-scoped Staff reference salary through its RPC", async () => {
  reset();
  rpcResponse.data = {
    ...workerRow,
    reference_salary: 130000,
    updated_at: "2026-08-23T11:00:00Z",
  };

  const worker = await updateStaffReferenceSalary({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    referenceSalary: 130000,
  });

  assert.equal(worker.referenceSalary, 130000);
  assert.deepEqual(calls, [["rpc", "update_staff_reference_salary", {
    p_factory_id: "factory-a",
    p_staff_worker_id: "staff-a",
    p_reference_salary: 130000,
  }]]);
});

test("preserves reference salary validation and factory isolation errors", async () => {
  reset();
  rpcResponse.error = {
    message: "reference_salary must be greater than zero.",
    code: "22023",
    details: "individual reference only",
    hint: null,
  };

  await assert.rejects(
    () => updateStaffReferenceSalary({
      factoryId: "factory-a",
      staffWorkerId: "staff-a",
      referenceSalary: 0,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StaffWorkerServiceError);
      assert.equal(error.code, "22023");
      assert.equal(error.details, "individual reference only");
      return true;
    },
  );

  rpcResponse.error = {
    message: "Staff worker does not belong to this factory.",
    code: "P2502",
    details: null,
    hint: null,
  };

  await assert.rejects(
    () => updateStaffReferenceSalary({
      factoryId: "factory-a",
      staffWorkerId: "staff-b",
      referenceSalary: 130000,
    }),
    (error: unknown) => error instanceof StaffWorkerServiceError
      && error.code === "P2502",
  );
});

test("rejects blank names and successful RPC responses without a worker", async () => {
  reset();

  await assert.rejects(
    () => createStaffWorker({
      factoryId: "factory-a",
      name: "   ",
      staffCategoryId: "category-a",
      referenceSalary: 120000,
    }),
    /Staff worker name is required/,
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    () => createStaffWorker({
      factoryId: "factory-a",
      name: "Asha",
      staffCategoryId: "category-a",
      referenceSalary: 120000,
    }),
    /create_staff_worker_with_reference_salary returned no worker/,
  );

  await assert.rejects(
    () => updateStaffReferenceSalary({
      factoryId: "factory-a",
      staffWorkerId: "staff-a",
      referenceSalary: 130000,
    }),
    /update_staff_reference_salary returned no worker/,
  );
});

test("archives and restores Staff through date-free factory-scoped RPCs", async () => {
  reset();
  rpcResponse.data = { ...workerRow, is_active: false };
  const archived = await archiveStaffWorker({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
  });
  assert.equal(archived.isActive, false);
  assert.deepEqual(calls, [["rpc", "archive_staff_worker", {
    p_factory_id: "factory-a",
    p_staff_worker_id: "staff-a",
  }]]);

  reset();
  rpcResponse.data = workerRow;
  const restored = await restoreStaffWorker({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
  });
  assert.equal(restored.isActive, true);
  assert.deepEqual(calls, [["rpc", "restore_staff_worker", {
    p_factory_id: "factory-a",
    p_staff_worker_id: "staff-a",
  }]]);
});

test("deletes only through the authoritative Staff worker RPC", async () => {
  reset();
  rpcResponse.data = "staff-a";
  await deleteStaffWorker({ factoryId: "factory-a", staffWorkerId: "staff-a" });
  assert.deepEqual(calls, [["rpc", "delete_staff_worker", {
    p_factory_id: "factory-a",
    p_staff_worker_id: "staff-a",
  }]]);

  reset();
  rpcResponse.error = {
    message: "This Staff member has payment history and cannot be deleted. Archive them instead.",
    code: "P2540",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => deleteStaffWorker({ factoryId: "factory-a", staffWorkerId: "staff-a" }),
    (error: unknown) => error instanceof StaffWorkerServiceError && error.code === "P2540",
  );
});
