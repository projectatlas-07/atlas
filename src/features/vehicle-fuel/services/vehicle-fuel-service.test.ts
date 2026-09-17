import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ErrorRow = { message: string; code: string; details: null; hint: null };
type Response = { data: unknown; error: ErrorRow | null };
const calls: Array<[string, unknown]> = [];
const responses = new Map<string, Response>();

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: { rpc(name: string, args: unknown) {
    calls.push([name, args]);
    return Promise.resolve(responses.get(name) ?? { data: [], error: null });
  } } },
});

const service = await import("./vehicle-fuel-service.ts");
const row = {
  id: "fuel-a", factory_id: "factory-a", fuel_date: "2026-09-14", fuel_time: "19:35:00",
  vehicle_id: "vehicle-a", vehicle_number_snapshot: "WB58 A 1234",
  pump_id: "pump-a", pump_name_snapshot: "Shell Pump Kolkata",
  pump_address_snapshot: "Main Road", pump_mobile_snapshot: null,
  fuel_type: "DIESEL", litres: "40.000000", rate_per_litre: "92.000000",
  fuel_amount: "3680.00", status: "active", is_locked: false,
  total_paid: "0.00", outstanding_amount: "3680.00", payment_state: "unpaid",
  voided_at: null, created_at: "2026-09-14T14:05:00Z", updated_at: "2026-09-14T14:05:00Z",
};

function reset() { calls.length = 0; responses.clear(); }

test("lists chronologically persisted Fuel history", async () => {
  reset(); responses.set("list_vehicle_fuel_records", { data: [row], error: null });
  const records = await service.listVehicleFuelRecords("factory-a", "vehicle-a", null);
  assert.equal(records[0]?.fuelTime, "19:35:00");
  assert.deepEqual(calls[0], ["list_vehicle_fuel_records", {
    p_factory_id: "factory-a", p_vehicle_id: "vehicle-a", p_pump_id: null,
  }]);
});

test("creates Fuel using exactly two authoritative measurements", async () => {
  reset(); responses.set("create_vehicle_fuel", { data: [row], error: null });
  const saved = await service.createVehicleFuel({
    factoryId: "factory-a", fuelDate: "2026-09-14", fuelTime: "19:35",
    vehicleId: "vehicle-a", pumpId: "pump-a", fuelType: "DIESEL",
    litres: 40, ratePerLitre: 92, fuelAmount: null,
    initialPaidAmount: 0, initialPaymentMode: null,
  });
  assert.equal(saved.vehicleNumberSnapshot, "WB58 A 1234");
  assert.equal((calls[0]?.[1] as { p_fuel_amount: null }).p_fuel_amount, null);
});

test("loads authoritative previous refuel before candidate chronology", async () => {
  reset(); responses.set("get_previous_vehicle_refuel", { data: [row], error: null });
  const previous = await service.getPreviousVehicleRefuel("factory-a", "vehicle-a", "2026-09-15", "08:00");
  assert.equal(previous?.id, "fuel-a");
  assert.equal(calls[0]?.[0], "get_previous_vehicle_refuel");
});

test("correction, void, later payment, and payment list use dedicated RPCs", async () => {
  reset(); responses.set("update_vehicle_fuel", { data: [row], error: null });
  await service.updateVehicleFuel({
    factoryId: "factory-a", fuelRecordId: "fuel-a", fuelDate: "2026-09-14",
    fuelTime: "19:35", vehicleId: "vehicle-a", pumpId: "pump-a", fuelType: "PETROL",
    litres: 40, ratePerLitre: 92, fuelAmount: null,
  });
  responses.set("void_vehicle_fuel", { data: [{ ...row, status: "void" }], error: null });
  await service.voidVehicleFuel("factory-a", "fuel-a");
  responses.set("create_vehicle_fuel_payment", { data: { id: "payment-a" }, error: null });
  await service.createVehicleFuelPayment({
    factoryId: "factory-a", fuelRecordId: "fuel-a", paymentDate: "2026-09-15",
    amount: 1000, paymentMode: "cash", note: null,
  });
  responses.set("list_vehicle_fuel_payments", { data: [], error: null });
  await service.listVehicleFuelPayments("factory-a");
  assert.deepEqual(calls.map((call) => call[0]), [
    "update_vehicle_fuel", "void_vehicle_fuel", "create_vehicle_fuel_payment", "list_vehicle_fuel_payments",
  ]);
});

test("database archive, role, financial lock, and overpayment errors remain clear", async () => {
  reset();
  for (const [code, message] of [
    ["P4502", "Archived Vehicles"], ["P4503", "Fuel Pump"],
    ["P4104", "financially locked"], ["P4105", "exceeds the outstanding"],
  ] as const) {
    responses.set("list_vehicle_fuel_records", { data: null, error: { code, message: "Denied", details: null, hint: null } });
    await assert.rejects(() => service.listVehicleFuelRecords("factory-a"), (error: Error) => error.message.includes(message));
  }
});

test("creates one authoritative batch Pump payment for an inclusive range", async () => {
  reset();
  responses.set("create_vehicle_fuel_batch_payment", { data: { id: "batch-a" }, error: null });
  assert.equal(await service.createVehicleFuelBatchPayment({
    factoryId: "factory-a", pumpId: "pump-a",
    fromDate: "2026-09-01", toDate: "2026-09-14",
    paymentDate: "2026-09-14", amount: 6000,
    paymentMode: "bank_transfer", note: " Period settlement ",
  }), "batch-a");
  assert.deepEqual(calls[0], ["create_vehicle_fuel_batch_payment", {
    p_factory_id: "factory-a", p_pump_id: "pump-a",
    p_from_date: "2026-09-01", p_to_date: "2026-09-14",
    p_payment_date: "2026-09-14", p_amount: 6000,
    p_payment_mode: "bank_transfer", p_note: "Period settlement",
  }]);
});

test("batch payment history maps one row per payment with allocation context", async () => {
  reset();
  responses.set("list_vehicle_fuel_batch_payments", { data: [{
    payment_id: "batch-a", factory_id: "factory-a", pump_id: "pump-a",
    pump_name: "Shell Pump", vehicle_ids: ["vehicle-a", "vehicle-b"],
    allocation_count: "3", allocations: [{
      fuel_record_id: "fuel-a", fuel_date: "2026-09-10", fuel_time: "07:30:00",
      vehicle_id: "vehicle-a", vehicle_number_snapshot: "WB58 A 1234",
      fuel_type: "DIESEL", litres: "20", allocated_amount: "2000",
    }, {
      fuel_record_id: "fuel-b", fuel_date: "2026-09-12", fuel_time: "08:30:00",
      vehicle_id: "vehicle-b", vehicle_number_snapshot: "WB58 A 5678",
      fuel_type: "DIESEL", litres: "30", allocated_amount: "3000",
    }, {
      fuel_record_id: "fuel-c", fuel_date: "2026-09-12", fuel_time: "09:30:00",
      vehicle_id: "vehicle-a", vehicle_number_snapshot: "WB58 A 1234",
      fuel_type: "DIESEL", litres: "40", allocated_amount: "1000",
    }], payment_date: "2026-09-14", amount: "6000",
    payment_mode: "cash", note: null, created_at: "2026-09-14T00:00:00Z",
  }], error: null });
  const payments = await service.listVehicleFuelBatchPayments("factory-a", "pump-a");
  assert.equal(payments[0]?.allocationCount, 3);
  assert.deepEqual(payments[0]?.vehicleIds, ["vehicle-a", "vehicle-b"]);
  assert.equal(payments[0]?.allocations[2]?.allocatedAmount, 1000);
  assert.equal(payments[0]?.allocations[0]?.vehicleNumberSnapshot, "WB58 A 1234");
});

test("batch service rejects invalid range and maps authoritative stale overpayment", async () => {
  await assert.rejects(() => service.createVehicleFuelBatchPayment({
    factoryId: "factory-a", pumpId: "pump-a",
    fromDate: "2026-09-15", toDate: "2026-09-14",
    paymentDate: "2026-09-14", amount: 1, paymentMode: "cash", note: null,
  }), /inclusive Fuel date range/);
  reset();
  responses.set("create_vehicle_fuel_batch_payment", {
    data: null, error: { code: "P4510", message: "stale", details: null, hint: null },
  });
  await assert.rejects(() => service.createVehicleFuelBatchPayment({
    factoryId: "factory-a", pumpId: "pump-a",
    fromDate: "2026-09-01", toDate: "2026-09-14",
    paymentDate: "2026-09-14", amount: 6000, paymentMode: "cash", note: null,
  }), /current outstanding Fuel dues/);
});
