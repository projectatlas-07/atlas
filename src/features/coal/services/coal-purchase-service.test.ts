import assert from "node:assert/strict";
import { mock, test } from "node:test";

type ErrorRow = { message: string; code: string; details: null; hint: null };
type Response = { data: unknown; error: ErrorRow | null };
type Call = [string, unknown?, unknown?];
const calls: Call[] = [];
let tableResponse: Response = { data: [], error: null };
const rpcResponses = new Map<string, Response>();

function builder() {
  const chain = {
    select(value: string) { calls.push(["select", value]); return chain; },
    eq(column: string, value: string) { calls.push(["eq", column, value]); return chain; },
    order(column: string, options: unknown) { calls.push(["order", column, options]); return chain; },
    then(onFulfilled: (value: Response) => unknown) { return Promise.resolve(tableResponse).then(onFulfilled); },
  };
  return chain;
}

const fakeSupabase = {
  from(table: string) { calls.push(["from", table]); return builder(); },
  rpc(name: string, args: unknown) {
    calls.push(["rpc", name, args]);
    return Promise.resolve(rpcResponses.get(name) ?? { data: [], error: null });
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const service = await import("./coal-purchase-service.ts");

const detailRow = {
  id: "purchase-a",
  factory_id: "factory-a",
  purchase_date: "2026-09-10",
  seller_id: "seller-a",
  seller_name_snapshot: "Seller A",
  seller_address_snapshot: "Raniganj Road",
  seller_mobile_snapshot: "9000000000",
  coal_name_reference_id: "coal-a",
  coal_name_snapshot: "Steam Coal",
  source_reference_id: "source-a",
  source_location_snapshot: "Raniganj",
  coal_challan_number: "11",
  vehicle_number_snapshot: "WB58 A 1234",
  quantity: "10.500000",
  rate: "3000.000000",
  coal_amount: "31500.00",
  separate_freight_amount: "1000.00",
  final_total: "32500.00",
  status: "active",
  is_locked: true,
  total_paid: "12500.00",
  outstanding_amount: "20000.00",
  payment_state: "partially_paid",
  voided_at: null,
  created_at: "2026-09-14T10:00:00Z",
  updated_at: "2026-09-14T10:00:00Z",
};

function reset() {
  calls.length = 0;
  tableResponse = { data: [], error: null };
  rpcResponses.clear();
}

test("lists factory-scoped remembered Coal Names and Sources", async () => {
  reset();
  tableResponse.data = [{
    id: "coal-a", factory_id: "factory-a", kind: "coal_name",
    display_value: "Steam Coal", created_at: "2026-09-14T00:00:00Z",
  }];
  assert.deepEqual(await service.listCoalReferenceValues("factory-a"), [{
    id: "coal-a", factoryId: "factory-a", kind: "coal_name",
    value: "Steam Coal", createdAt: "2026-09-14T00:00:00Z",
  }]);
  assert.deepEqual(calls.slice(0, 3), [
    ["from", "coal_reference_values"],
    ["select", "id, factory_id, kind, display_value, created_at"],
    ["eq", "factory_id", "factory-a"],
  ]);
});

test("creates an idempotent remembered reference through its controlled RPC", async () => {
  reset();
  rpcResponses.set("create_coal_reference_value", { data: {
    id: "source-a", factory_id: "factory-a", kind: "source_location",
    display_value: "Raniganj", created_at: "2026-09-14T00:00:00Z",
  }, error: null });
  const saved = await service.createCoalReferenceValue("factory-a", "source_location", " Raniganj ");
  assert.equal(saved.value, "Raniganj");
  assert.deepEqual(calls[0], ["rpc", "create_coal_reference_value", {
    p_factory_id: "factory-a", p_kind: "source_location", p_display_value: "Raniganj",
  }]);
});

test("creates structured Coal Purchase with exactly two authoritative measurement inputs", async () => {
  reset();
  rpcResponses.set("create_coal_purchase", { data: [detailRow], error: null });
  const saved = await service.createCoalPurchase({
    factoryId: "factory-a",
    purchaseDate: "2026-09-10",
    sellerId: "seller-a",
    coalNameReferenceId: "coal-a",
    sourceReferenceId: "source-a",
    coalChallanNumber: " 11 ",
    vehicleNumber: "wb58 a 1234",
    quantity: 10.5,
    rate: 3000,
    coalAmount: null,
    separateFreightAmount: 1000,
    initialPaidAmount: 12500,
    initialPaymentMode: "cash",
  });
  assert.deepEqual({
    id: saved.id,
    challan: saved.coalChallanNumber,
    vehicle: saved.vehicleNumberSnapshot,
    coal: saved.coalAmount,
    freight: saved.separateFreightAmount,
    total: saved.finalTotal,
    paid: saved.totalPaid,
    due: saved.outstandingAmount,
  }, {
    id: "purchase-a", challan: "11", vehicle: "WB58 A 1234",
    coal: 31500, freight: 1000, total: 32500, paid: 12500, due: 20000,
  });
  const args = calls[0]?.[2] as Record<string, unknown>;
  assert.equal(args.p_quantity, 10.5);
  assert.equal(args.p_rate, 3000);
  assert.equal(args.p_coal_amount, null);
  assert.equal(args.p_initial_paid_amount, 12500);
});

test("list, correction, and void paths retain purchase UUID identity", async () => {
  reset();
  rpcResponses.set("list_coal_purchases", { data: [detailRow], error: null });
  rpcResponses.set("update_coal_purchase", { data: [detailRow], error: null });
  rpcResponses.set("void_coal_purchase", { data: [{ ...detailRow, status: "void", outstanding_amount: "0" }], error: null });
  assert.equal((await service.listCoalPurchases("factory-a"))[0]?.id, "purchase-a");
  await service.updateCoalPurchase({
    purchaseId: "purchase-a", factoryId: "factory-a", purchaseDate: "2026-09-10",
    sellerId: "seller-a", coalNameReferenceId: "coal-a", sourceReferenceId: "source-a",
    coalChallanNumber: "11", vehicleNumber: "WB58 A 1234", quantity: 10.5,
    rate: 3000, coalAmount: null, separateFreightAmount: 1000,
  });
  await service.voidCoalPurchase("factory-a", "purchase-a");
  const rpcCalls = calls.filter(([kind]) => kind === "rpc");
  assert.equal((rpcCalls[1]?.[2] as Record<string, unknown>).p_purchase_id, "purchase-a");
  assert.equal((rpcCalls[2]?.[2] as Record<string, unknown>).p_purchase_id, "purchase-a");
});

test("legacy single payment remains compatible and grouped history maps one payment with allocations", async () => {
  reset();
  rpcResponses.set("create_coal_payment", { data: { id: "payment-a" }, error: null });
  rpcResponses.set("list_coal_selective_payments", { data: [{
    payment_id: "payment-a", factory_id: "factory-a",
    seller_id: "seller-a", seller_name_snapshot: "Seller A", payment_date: "2026-09-15",
    allocation_count: "1", allocations: [{
      purchase_id: "purchase-a", purchase_date: "2026-09-10", coal_challan_number: "11",
      coal_name_snapshot: "Steam Coal", source_location_snapshot: "Raniganj",
      vehicle_number_snapshot: "WB58 A 1234", allocated_amount: "20000",
    }],
    amount: "20000", payment_mode: "upi", note: "Final", created_at: "2026-09-15T10:00:00Z",
  }], error: null });
  assert.equal(await service.createCoalPayment({
    factoryId: "factory-a", purchaseId: "purchase-a", paymentDate: "2026-09-15",
    amount: 20000, paymentMode: "upi", note: " Final ",
  }), "payment-a");
  assert.deepEqual((await service.listCoalPayments("factory-a", "seller-a"))[0], {
    id: "payment-a", factoryId: "factory-a",
    sellerId: "seller-a", sellerNameSnapshot: "Seller A", paymentDate: "2026-09-15",
    allocationCount: 1, allocations: [{
      purchaseId: "purchase-a", purchaseDate: "2026-09-10", coalChallanNumber: "11",
      coalNameSnapshot: "Steam Coal", sourceLocationSnapshot: "Raniganj",
      vehicleNumberSnapshot: "WB58 A 1234", allocatedAmount: 20000,
    }],
    amount: 20000, paymentMode: "upi", note: "Final", createdAt: "2026-09-15T10:00:00Z",
  });
});

test("creates one selective seller payment from exact explicit allocations", async () => {
  reset();
  rpcResponses.set("create_coal_selective_payment", { data: { id: "payment-b" }, error: null });
  assert.equal(await service.createCoalSelectivePayment({
    factoryId: "factory-a", sellerId: "seller-a", fromDate: "2026-09-01",
    toDate: "2026-09-30", paymentDate: "2026-09-30", paymentMode: "bank_transfer",
    note: " Settlement ", allocations: [
      { purchaseId: "purchase-a", amount: 800000 },
      { purchaseId: "purchase-c", amount: 500000 },
    ],
  }), "payment-b");
  assert.deepEqual(calls[0], ["rpc", "create_coal_selective_payment", {
    p_factory_id: "factory-a", p_seller_id: "seller-a",
    p_from_date: "2026-09-01", p_to_date: "2026-09-30",
    p_payment_date: "2026-09-30", p_payment_mode: "bank_transfer",
    p_note: "Settlement", p_allocations: [
      { purchase_id: "purchase-a", amount: 800000 },
      { purchase_id: "purchase-c", amount: 500000 },
    ],
  }]);
});

test("local validation rejects contradictory measurement triples and bad payments", async () => {
  reset();
  await assert.rejects(() => service.createCoalPurchase({
    factoryId: "factory-a", purchaseDate: "2026-09-10", sellerId: "seller-a",
    coalNameReferenceId: "coal-a", sourceReferenceId: "source-a",
    vehicleNumber: "WB58", quantity: 10, rate: 3000, coalAmount: 30000,
    separateFreightAmount: 0, initialPaidAmount: 0, initialPaymentMode: null,
  }), /exactly two/i);
  await assert.rejects(() => service.createCoalPayment({
    factoryId: "factory-a", purchaseId: "purchase-a", paymentDate: "bad",
    amount: 1, paymentMode: "cash",
  }), /valid payment date/i);
  assert.equal(calls.length, 0);
});

test("database security and overpayment errors stay understandable", async () => {
  reset();
  rpcResponses.set("list_coal_purchases", { data: null, error: {
    message: "denied", code: "42501", details: null, hint: null,
  } });
  await assert.rejects(() => service.listCoalPurchases("factory-b"), (error: unknown) =>
    error instanceof service.CoalPurchaseServiceError && error.code === "42501");
  rpcResponses.set("create_coal_payment", { data: null, error: {
    message: "too much", code: "P4105", details: null, hint: null,
  } });
  await assert.rejects(() => service.createCoalPayment({
    factoryId: "factory-a", purchaseId: "purchase-a", paymentDate: "2026-09-15",
    amount: 1, paymentMode: "cash",
  }), /cannot exceed/i);
});
