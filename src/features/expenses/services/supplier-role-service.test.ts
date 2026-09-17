import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ErrorRow = { message: string; code: string; details: null; hint: null };
type Response = { data: unknown; error: ErrorRow | null };
const calls: Array<[string, unknown]> = [];
const responses = new Map<string, Response>();

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: {
    supabase: {
      rpc(name: string, args: unknown) {
        calls.push([name, args]);
        return Promise.resolve(responses.get(name) ?? { data: [], error: null });
      },
    },
  },
});

const service = await import("./supplier-role-service.ts");
const supplier = {
  id: "supplier-a", factory_id: "factory-a", name: "ABC Traders",
  address: null, mobile: null,
  created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z",
};

function reset() {
  calls.length = 0;
  responses.clear();
}

test("lists only the requested factory-scoped supplier role", async () => {
  reset();
  responses.set("list_suppliers_by_role", { data: [supplier], error: null });
  assert.equal((await service.listSuppliersByRole("factory-a", "COAL_SELLER"))[0]?.id, "supplier-a");
  assert.deepEqual(calls[0], ["list_suppliers_by_role", {
    p_factory_id: "factory-a", p_role: "COAL_SELLER",
  }]);
});

test("Coal inline creation assigns COAL_SELLER", async () => {
  reset();
  responses.set("create_or_assign_supplier_role", { data: supplier, error: null });
  await service.createOrAssignSupplierRole({
    factoryId: "factory-a", role: "COAL_SELLER", name: " ABC   Traders ",
  });
  assert.deepEqual(calls[0], ["create_or_assign_supplier_role", {
    p_factory_id: "factory-a", p_role: "COAL_SELLER", p_name: "ABC Traders",
    p_address: null, p_mobile: null,
  }]);
});

test("Garage inline creation assigns GARAGE using the same RPC and identity", async () => {
  reset();
  responses.set("create_or_assign_supplier_role", { data: supplier, error: null });
  const saved = await service.createOrAssignSupplierRole({
    factoryId: "factory-a", role: "GARAGE", name: "ABC Traders",
  });
  assert.equal(saved.id, "supplier-a");
  assert.equal((calls[0]?.[1] as { p_role: string }).p_role, "GARAGE");
});

test("Fuel Pump creation assigns FUEL_PUMP through the same reusable supplier identity", async () => {
  reset();
  responses.set("create_or_assign_supplier_role", { data: supplier, error: null });
  const saved = await service.createOrAssignSupplierRole({
    factoryId: "factory-a", role: "FUEL_PUMP", name: "ABC Traders",
    address: "Pump Road",
  });
  assert.equal(saved.id, "supplier-a");
  assert.equal((calls[0]?.[1] as { p_role: string }).p_role, "FUEL_PUMP");
});

test("invalid roles and ambiguous duplicate-name errors fail clearly", async () => {
  await assert.rejects(() => service.listSuppliersByRole(
    "factory-a", "OTHER" as "GARAGE",
  ), /role is invalid/i);
  responses.set("list_suppliers_by_role", {
    data: null,
    error: { code: "P4404", message: "ambiguous", details: null, hint: null },
  });
  await assert.rejects(
    () => service.listSuppliersByRole("factory-a", "GARAGE"),
    /Multiple suppliers already use this name/,
  );
});
