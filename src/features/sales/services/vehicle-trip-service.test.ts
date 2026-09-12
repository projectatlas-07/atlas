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
      order(column: string, options: { ascending: boolean }) {
        calls.push(["order", column, options]);
        return builder;
      },
      limit(value: number) {
        calls.push(["limit", value]);
        return builder;
      },
      then(resolve: (value: Response) => unknown) {
        return Promise.resolve(resolve(response));
      },
    };
    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const { listVehicleTrips, VehicleTripServiceError } = await import(
  "./vehicle-trip-service.ts"
);

function reset(): void {
  calls.length = 0;
  response = { data: [], error: null };
}

test("one factory-scoped Challan read returns both Wage ON and Wage OFF trips", async () => {
  reset();
  response.data = [{
    id: "challan-off",
    challan_number: null,
    challan_date: "2026-09-10",
    created_at: "2026-09-10T09:00:00Z",
    vehicle_id: "vehicle-off",
    vehicle_number_snapshot: "HISTORICAL-OFF",
    customer_name_snapshot: "XYZ Bricks",
    customer_address_snapshot: "Kandi",
    delivery_wage_applicable_snapshot: false,
    trip_labour_wage: null,
  }, {
    id: "challan-on",
    challan_number: "A-39",
    challan_date: "2026-09-11",
    created_at: "2026-09-11T09:00:00Z",
    vehicle_id: "vehicle-on",
    vehicle_number_snapshot: "HISTORICAL-ON",
    customer_name_snapshot: "ABC Traders",
    customer_address_snapshot: "Berhampore",
    delivery_wage_applicable_snapshot: true,
    trip_labour_wage: "750.00",
  }];

  const trips = await listVehicleTrips("factory-a");
  assert.equal(trips.length, 2);
  assert.equal(trips[0]?.challanId, "challan-on");
  assert.equal(trips[0]?.customerNameSnapshot, "ABC Traders");
  assert.equal(trips[0]?.destinationSnapshot, "Berhampore");
  assert.equal(trips[1]?.challanNumber, null);
  assert.equal(trips[1]?.tripLabourWage, null);
  assert.deepEqual(calls.filter((call) => call[0] === "eq"), [
    ["eq", "factory_id", "factory-a"],
    ["eq", "status", "active"],
  ]);
  assert.equal(calls.filter((call) => call[0] === "from").length, 1);
});

test("trip existence never filters on wage applicability, wage amount, or a date range", async () => {
  reset();
  await listVehicleTrips("factory-a");
  assert.equal(calls.some((call) => call[0] === "eq"
    && call[1] === "delivery_wage_applicable_snapshot"), false);
  assert.equal(calls.some((call) => (call[0] === "gt" || call[0] === "not")
    && call[1] === "trip_labour_wage"), false);
  assert.equal(calls.some((call) => (call[0] === "gte" || call[0] === "lte")
    && call[1] === "challan_date"), false);
  assert.deepEqual(calls.filter((call) => call[0] === "not"), [
    ["not", "vehicle_id", "is", null],
    ["not", "vehicle_number_snapshot", "is", null],
  ]);
});

test("missing factory and database failures stop safely", async () => {
  reset();
  await assert.rejects(() => listVehicleTrips(""), /factoryId is required/);
  assert.equal(calls.length, 0);

  response.error = {
    message: "Trip history denied.",
    code: "42501",
    details: null,
    hint: null,
  };
  await assert.rejects(
    () => listVehicleTrips("factory-a"),
    (error: unknown) => error instanceof VehicleTripServiceError
      && error.code === "42501",
  );
});
