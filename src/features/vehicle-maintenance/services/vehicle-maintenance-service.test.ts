import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ErrorRow = { message: string; code: string; details: null; hint: null };
type Response = { data: unknown; error: ErrorRow | null };
type Call = [string, unknown?];
const calls: Call[] = [];
const rpcResponses = new Map<string, Response>();

const fakeSupabase = {
  rpc(name: string, args: unknown) {
    calls.push([name, args]);
    return Promise.resolve(rpcResponses.get(name) ?? { data: [], error: null });
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const service = await import("./vehicle-maintenance-service.ts");

const detailRow = {
  id: "maintenance-a", factory_id: "factory-a", maintenance_date: "2026-09-10",
  vehicle_id: "vehicle-a", vehicle_number_snapshot: "WB58 A 1234",
  garage_id: "garage-a", garage_name_snapshot: "Rahman Garage",
  garage_address_snapshot: "Garage Road", garage_mobile_snapshot: "9000000000",
  work_description: "Rear tyre replacement", total_amount: "8000.00",
  status: "active", is_locked: true, total_paid: "5000.00",
  outstanding_amount: "3000.00", payment_state: "partially_paid",
  voided_at: null, created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
};

function reset() {
  calls.length = 0;
  rpcResponses.clear();
}

test("lists factory-scoped Vehicle Maintenance history", async () => {
  reset();
  rpcResponses.set("list_vehicle_maintenance_records", { data: [detailRow], error: null });
  const rows = await service.listVehicleMaintenanceRecords("factory-a", "vehicle-a", null);
  assert.equal(rows[0]?.vehicleNumberSnapshot, "WB58 A 1234");
  assert.equal(rows[0]?.garageNameSnapshot, "Rahman Garage");
  assert.deepEqual(calls[0], ["list_vehicle_maintenance_records", {
    p_factory_id: "factory-a", p_vehicle_id: "vehicle-a", p_garage_id: null,
  }]);
});

test("creates Maintenance and preserves stable Vehicle and Garage IDs", async () => {
  reset();
  rpcResponses.set("create_vehicle_maintenance", { data: [detailRow], error: null });
  const saved = await service.createVehicleMaintenance({
    factoryId: "factory-a", maintenanceDate: "2026-09-10",
    vehicleId: "vehicle-a", garageId: "garage-a",
    workDescription: "  Rear   tyre replacement ", totalAmount: 8000,
    initialPaidAmount: 5000, initialPaymentMode: "cash",
  });
  assert.equal(saved.id, "maintenance-a");
  assert.deepEqual(calls[0], ["create_vehicle_maintenance", {
    p_factory_id: "factory-a", p_maintenance_date: "2026-09-10",
    p_vehicle_id: "vehicle-a", p_garage_id: "garage-a",
    p_work_description: "Rear tyre replacement", p_total_amount: 8000,
    p_initial_paid_amount: 5000, p_initial_payment_mode: "cash",
  }]);
});

test("correction and void retain the internal Maintenance UUID", async () => {
  reset();
  rpcResponses.set("update_vehicle_maintenance", { data: [detailRow], error: null });
  await service.updateVehicleMaintenance({
    factoryId: "factory-a", maintenanceId: "maintenance-a",
    maintenanceDate: "2026-09-09", vehicleId: "vehicle-a", garageId: "garage-a",
    workDescription: "Rear tyre and tube", totalAmount: 8500,
  });
  rpcResponses.set("void_vehicle_maintenance", { data: [{ ...detailRow, status: "void" }], error: null });
  await service.voidVehicleMaintenance("factory-a", "maintenance-a");
  assert.equal(calls[0]?.[0], "update_vehicle_maintenance");
  assert.deepEqual(calls[1], ["void_vehicle_maintenance", {
    p_factory_id: "factory-a", p_maintenance_id: "maintenance-a",
  }]);
});

test("later Garage payment and payment history use dedicated shared-finance wrappers", async () => {
  reset();
  rpcResponses.set("create_vehicle_maintenance_payment", { data: { id: "payment-a" }, error: null });
  assert.equal(await service.createVehicleMaintenancePayment({
    factoryId: "factory-a", maintenanceId: "maintenance-a",
    paymentDate: "2026-09-12", amount: 3000,
    paymentMode: "upi", note: " Final payment ",
  }), "payment-a");
  rpcResponses.set("list_vehicle_maintenance_payments", { data: [{
    payment_id: "payment-a", factory_id: "factory-a", maintenance_id: "maintenance-a",
    vehicle_id: "vehicle-a", vehicle_number_snapshot: "WB58 A 1234",
    garage_id: "garage-a", garage_name_snapshot: "Rahman Garage",
    payment_date: "2026-09-12", amount: "3000.00", payment_mode: "upi",
    note: "Final payment", created_at: "2026-09-12T00:00:00Z",
  }], error: null });
  const payments = await service.listVehicleMaintenancePayments("factory-a");
  assert.equal(payments[0]?.amount, 3000);
  assert.equal(payments[0]?.vehicleId, "vehicle-a");
});

test("creates one Garage batch payment and maps one grouped history row", async () => {
  reset();
  rpcResponses.set("create_vehicle_maintenance_batch_payment", {
    data: { id: "batch-a" }, error: null,
  });
  assert.equal(await service.createVehicleMaintenanceBatchPayment({
    factoryId: "factory-a",
    garageId: "garage-a",
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
    paymentDate: "2026-09-30",
    amount: 10000,
    paymentMode: "bank_transfer",
    note: " September settlement ",
  }), "batch-a");
  assert.deepEqual(calls[0], ["create_vehicle_maintenance_batch_payment", {
    p_factory_id: "factory-a",
    p_garage_id: "garage-a",
    p_from_date: "2026-09-01",
    p_to_date: "2026-09-30",
    p_payment_date: "2026-09-30",
    p_amount: 10000,
    p_payment_mode: "bank_transfer",
    p_note: "September settlement",
  }]);

  rpcResponses.set("list_vehicle_maintenance_batch_payments", { data: [{
    payment_id: "batch-a", factory_id: "factory-a",
    garage_id: "garage-a", garage_name_snapshot: "Rahman Garage",
    vehicle_ids: ["vehicle-a", "vehicle-b"], allocation_count: "2",
    allocations: [{
      maintenance_id: "maintenance-a", maintenance_date: "2026-09-10",
      vehicle_id: "vehicle-a", vehicle_number_snapshot: "WB58 A 1234",
      work_description: "Rear tyre replacement", allocated_amount: "5000.00",
    }, {
      maintenance_id: "maintenance-b", maintenance_date: "2026-09-11",
      vehicle_id: "vehicle-b", vehicle_number_snapshot: "WB58 A 5678",
      work_description: "Brake repair", allocated_amount: "5000.00",
    }],
    payment_date: "2026-09-30", amount: "10000.00",
    payment_mode: "bank_transfer", note: "September settlement",
    created_at: "2026-09-30T10:00:00Z",
  }], error: null });
  const grouped = await service.listVehicleMaintenanceBatchPayments("factory-a", "garage-a");
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.allocationCount, 2);
  assert.equal(grouped[0]?.allocations[1]?.allocatedAmount, 5000);
  assert.deepEqual(calls[1], ["list_vehicle_maintenance_batch_payments", {
    p_factory_id: "factory-a", p_garage_id: "garage-a",
  }]);
});

test("local validation rejects invalid amounts, dates, and missing identities", async () => {
  await assert.rejects(() => service.createVehicleMaintenance({
    factoryId: "factory-a", maintenanceDate: "bad", vehicleId: "", garageId: "garage-a",
    workDescription: "Repair", totalAmount: -1, initialPaidAmount: 0, initialPaymentMode: null,
  }));
  await assert.rejects(() => service.createVehicleMaintenancePayment({
    factoryId: "factory-a", maintenanceId: "maintenance-a", paymentDate: "2026-09-12",
    amount: 0, paymentMode: "cash", note: null,
  }));
  await assert.rejects(() => service.createVehicleMaintenanceBatchPayment({
    factoryId: "factory-a", garageId: "garage-a",
    fromDate: "2026-09-30", toDate: "2026-09-01",
    paymentDate: "2026-09-30", amount: 1, paymentMode: "cash", note: null,
  }));
});

test("database lock, isolation, archive, and overpayment errors stay understandable", async () => {
  reset();
  for (const [code, message] of [
    ["P4302", "Archived Vehicles"], ["P4104", "financially locked"],
    ["P4105", "exceeds the outstanding"], ["P4310", "current outstanding Maintenance"],
    ["42501", "Denied"],
  ] as const) {
    rpcResponses.set("list_vehicle_maintenance_records", {
      data: null, error: { code, message: "Denied", details: null, hint: null },
    });
    await assert.rejects(
      () => service.listVehicleMaintenanceRecords("factory-a"),
      (error: Error) => error.message.includes(message),
    );
  }
});
