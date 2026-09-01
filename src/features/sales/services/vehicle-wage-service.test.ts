import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};
type Response = { data: Row[] | null; error: DatabaseError | null };

const calls: unknown[][] = [];
let response: Response = { data: [], error: null };

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
      not(column: string, operator: string, value: unknown) {
        calls.push(["not", column, operator, value]);
        return builder;
      },
      gt(column: string, value: unknown) {
        calls.push(["gt", column, value]);
        return builder;
      },
      gte(column: string, value: unknown) {
        calls.push(["gte", column, value]);
        return builder;
      },
      lte(column: string, value: unknown) {
        calls.push(["lte", column, value]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return column === "challan_number" ? Promise.resolve(response) : builder;
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const { VehicleWageServiceError, listVehicleWageTrips } = await import(
  "./vehicle-wage-service.ts"
);

const activeTrip = {
  id: "challan-101",
  challan_number: 101,
  challan_date: "2026-09-01",
  vehicle_id: "vehicle-a",
  vehicle_number_snapshot: "WB12AB1234",
  delivery_wage_applicable_snapshot: true,
  trip_labour_wage: "750.00",
  status: "active",
};

function reset(): void {
  calls.length = 0;
  response = { data: [], error: null };
}

test("reads each eligible Challan once through the existing factory RLS path", async () => {
  reset();
  response.data = [activeTrip];
  const trips = await listVehicleWageTrips("factory-a", {
    fromDate: "2026-09-01",
    toDate: "2026-09-05",
  });
  assert.deepEqual(trips, [{
    challanId: "challan-101",
    challanNumber: 101,
    challanDate: "2026-09-01",
    vehicleId: "vehicle-a",
    vehicleNumberSnapshot: "WB12AB1234",
    tripLabourWage: 750,
  }]);
  assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "status", "active"],
    ["eq", "delivery_wage_applicable_snapshot", true],
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === "gte" || call[0] === "lte"), [
    ["gte", "challan_date", "2026-09-01"],
    ["lte", "challan_date", "2026-09-05"],
  ]);
  assert.equal(calls.some((call) => call[0] === "rpc"), false);
  assert.equal(calls.some((call) => call[0] === "join"), false);
});

test("financial filters exclude void, no-Vehicle, and no-wage sources before aggregation", async () => {
  reset();
  await listVehicleWageTrips("factory-a", {
    fromDate: "2026-09-12",
    toDate: "2026-09-12",
  });
  for (const expected of [
    ["not", "vehicle_id", "is", null],
    ["not", "vehicle_number_snapshot", "is", null],
    ["not", "trip_labour_wage", "is", null],
    ["gt", "trip_labour_wage", 0],
  ]) assert.deepEqual(calls.find((call) => JSON.stringify(call) === JSON.stringify(expected)), expected);
  assert.deepEqual(calls.find((call) => call[0] === "eq" && call[1] === "status"), [
    "eq", "status", "active",
  ]);
});

test("invalid ranges and missing factory IDs stop before any database request", async () => {
  reset();
  await assert.rejects(
    () => listVehicleWageTrips("factory-a", {
      fromDate: "2026-09-05",
      toDate: "2026-09-01",
    }),
    /valid inclusive range/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    () => listVehicleWageTrips("", {
      fromDate: "2026-09-01",
      toDate: "2026-09-05",
    }),
    /factoryId is required/,
  );
  assert.equal(calls.length, 0);
});

test("database failures remain typed and understandable", async () => {
  reset();
  response.error = {
    message: "Vehicle wage request failed.",
    code: "42501",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => listVehicleWageTrips("factory-a", {
      fromDate: "2026-09-01",
      toDate: "2026-09-05",
    }),
    (error: unknown) => error instanceof VehicleWageServiceError
      && error.code === "42501"
      && error.message === "Vehicle wage request failed.",
  );
});
