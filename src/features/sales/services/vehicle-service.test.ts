import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: Row | Row[] | null; error: DatabaseError | null };

const calls: unknown[][] = [];
let listResponse: Response = { data: [], error: null };
let rpcResponse: Response = { data: null, error: null };

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(["eq", column, value]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return column === "id" ? Promise.resolve(listResponse) : builder;
      },
    };
    return builder;
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
  VehicleServiceError,
  archiveVehicle,
  findOrCreateVehicle,
  listVehicles,
  restoreVehicle,
  setVehicleDeliveryWageTracking,
} = await import("./vehicle-service.ts");

const vehicleRow = {
  id: "vehicle-a",
  factory_id: "factory-a",
  vehicle_number: "WB 12 AB 1234",
  normalized_vehicle_number: "WB12AB1234",
  delivery_wage_tracking_enabled: true,
  is_active: true,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-01T08:00:00Z",
};

function reset(): void {
  calls.length = 0;
  listResponse = { data: [], error: null };
  rpcResponse = { data: null, error: null };
}

test("lists only active Vehicles by default and can include archived management rows", async () => {
  reset();
  listResponse.data = [vehicleRow];
  assert.equal((await listVehicles("factory-a"))[0]?.normalizedVehicleNumber, "WB12AB1234");
  assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "is_active", true],
  ]);

  reset();
  listResponse.data = [{ ...vehicleRow, is_active: false }];
  assert.equal((await listVehicles("factory-a", true))[0]?.isActive, false);
  assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
    ["eq", "factory_id", "factory-a"],
  ]);
});

test("inline creation normalizes display input and uses the concurrency-safe RPC", async () => {
  reset();
  rpcResponse.data = vehicleRow;
  const vehicle = await findOrCreateVehicle({
    factoryId: "factory-a",
    vehicleNumber: "  wb  12 ab 1234 ",
    deliveryWageTrackingEnabled: true,
  });
  assert.equal(vehicle.vehicleNumber, "WB 12 AB 1234");
  assert.deepEqual(calls, [["rpc", "find_or_create_vehicle", {
    p_factory_id: "factory-a",
    p_vehicle_number: "WB 12 AB 1234",
    p_delivery_wage_tracking_enabled: true,
  }]]);
  assert.equal(calls.some((call) => call[0] === "insert"), false);
});

test("tracking and archive lifecycle changes use only controlled factory-scoped RPCs", async () => {
  reset();
  rpcResponse.data = { ...vehicleRow, delivery_wage_tracking_enabled: false };
  assert.equal((await setVehicleDeliveryWageTracking({
    factoryId: "factory-a",
    vehicleId: "vehicle-a",
    enabled: false,
  })).deliveryWageTrackingEnabled, false);
  assert.deepEqual(calls[0], ["rpc", "set_vehicle_delivery_wage_tracking", {
    p_factory_id: "factory-a",
    p_vehicle_id: "vehicle-a",
    p_enabled: false,
  }]);

  reset();
  rpcResponse.data = { ...vehicleRow, is_active: false };
  assert.equal((await archiveVehicle("factory-a", "vehicle-a")).isActive, false);
  assert.equal(calls[0]?.[1], "archive_vehicle");

  reset();
  rpcResponse.data = vehicleRow;
  assert.equal((await restoreVehicle("factory-a", "vehicle-a")).isActive, true);
  assert.equal(calls[0]?.[1], "restore_vehicle");
});

test("invalid numbers stop locally and archived errors remain clear and typed", async () => {
  reset();
  await assert.rejects(
    () => findOrCreateVehicle({
      factoryId: "factory-a",
      vehicleNumber: "WB@1234",
      deliveryWageTrackingEnabled: false,
    }),
    /letters, numbers, spaces, or hyphens/,
  );
  assert.equal(calls.length, 0);

  rpcResponse.error = {
    message: "Archived.",
    code: "P3105",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => findOrCreateVehicle({
      factoryId: "factory-a",
      vehicleNumber: "WB12AB1234",
      deliveryWageTrackingEnabled: false,
    }),
    (error: unknown) => error instanceof VehicleServiceError
      && error.code === "P3105"
      && /archived/.test(error.message),
  );
});
