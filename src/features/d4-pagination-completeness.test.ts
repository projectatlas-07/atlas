import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown> & { id: string };
type Request = { table: string; afterId: string | null; limit: number };

const tables = new Map<string, Row[]>();
const requests: Request[] = [];
let laterFailure: { table: string; requestNumber: number } | null = null;

function queryBuilder(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let afterId: string | null = null;
  let requestedLimit = Number.POSITIVE_INFINITY;
  const query = {
    select() { return query; },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    not(column: string, operator: string, value: unknown) {
      if (operator === "is" && value === null) filters.push((row) => row[column] !== null);
      return query;
    },
    is(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    gte(column: string, value: string) {
      filters.push((row) => String(row[column]) >= value);
      return query;
    },
    lte(column: string, value: string) {
      filters.push((row) => String(row[column]) <= value);
      return query;
    },
    gt(column: string, value: string) {
      assert.equal(column, "id");
      afterId = value;
      filters.push((row) => row.id > value);
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      assert.deepEqual([column, options], ["id", { ascending: true }]);
      return query;
    },
    limit(value: number) {
      requestedLimit = value;
      return query;
    },
    then(resolve: (result: { data: Row[] | null; error: unknown }) => unknown, reject: (reason: unknown) => unknown) {
      requests.push({ table, afterId, limit: requestedLimit });
      const tableRequestNumber = requests.filter((request) => request.table === table).length;
      if (laterFailure?.table === table && laterFailure.requestNumber === tableRequestNumber) {
        return Promise.resolve({
          data: null,
          error: { message: "later page failed", code: "D4_TEST", details: null, hint: null },
        }).then(resolve, reject);
      }
      const data = (tables.get(table) ?? [])
        .filter((row) => filters.every((filter) => filter(row)))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, Math.min(requestedLimit, 500));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return query;
}

await mock.module("../lib/supabase/client.ts", {
  namedExports: { supabase: { from: (table: string) => queryBuilder(table) } },
});

const { getSalesTotal } = await import("./sales/services/sales-register-service.ts");
const { getPaymentsReceivedTotal, getCurrentCustomerOutstandingTotal } =
  await import("./sales/services/customer-payment-service.ts");
const { getRecordedExpenseTotal } = await import("./expenses/services/expense-service.ts");
const { getProductionQuantityTotal } = await import("./production/services/production-read-service.ts");
const { getProductionLabourPaidTotal, getMudSupplyPaidTotal } =
  await import("./wages/services/paid-total-service.ts");
const { getChamberTransportPaidTotal } =
  await import("./transport/services/transport-worker-financial-service.ts");
const { getSoilPaidTotal } = await import("./soil/services/soil-payment-service.ts");
const { getStaffPaidTotal } = await import("./staff/services/staff-payment-service.ts");
const { getVehicleWagePaidTotal } = await import("./sales/services/vehicle-wage-service.ts");

const id = (prefix: string, index: number) => `${prefix}-${String(index).padStart(6, "0")}`;
const datedRows = (
  prefix: string,
  count: number,
  dateField: string,
  amountField: string,
  amount: number,
  extra: Record<string, unknown> = {},
): Row[] => Array.from({ length: count }, (_, index) => ({
  ...extra, id: id(prefix, index), factory_id: "factory-a", [dateField]: "2026-08-15", [amountField]: amount,
}));

function reset() {
  tables.clear();
  requests.length = 0;
  laterFailure = null;
}

test("Sales and payment headers include capped later pages", async () => {
  reset();
  const challans = datedRows("challan", 1001, "challan_date", "challan_total", 1, { status: "active" });
  challans[1000].challan_total = 7;
  tables.set("challans", challans);
  tables.set("customer_payments", datedRows("payment", 501, "payment_date", "amount", 2));

  assert.equal(await getSalesTotal("factory-a", "2026-08-01", "2026-08-31"), 1007);
  assert.equal(await getPaymentsReceivedTotal("factory-a", "2026-08-01", "2026-08-31"), 1002);
  assert.equal(requests.filter(({ table }) => table === "challans").length, 3);
  assert.equal(requests.filter(({ table }) => table === "customer_payments").length, 2);
});

test("Current Outstanding completes both active Challan and allocation sides", async () => {
  reset();
  tables.set("challans", datedRows("challan", 1001, "challan_date", "challan_total", 1, { status: "active" }));
  tables.set("customer_payment_allocations", Array.from({ length: 1001 }, (_, index) => ({
    id: id("allocation", index), factory_id: "factory-a", challan_id: id("challan", index), allocated_amount: 0.25,
  })));

  assert.equal(await getCurrentCustomerOutstandingTotal("factory-a"), 750.75);
  assert.equal(requests.filter(({ table }) => table === "challans").length, 3);
  assert.equal(requests.filter(({ table }) => table === "customer_payment_allocations").length, 3);
});

test("all other table-backed totals use complete full, partial, and multi-page reads", async () => {
  reset();
  tables.set("expense_records", datedRows("expense", 1001, "business_date", "total_amount", 3, { status: "active" }));
  tables.set("production_entries", datedRows("production", 1201, "production_date", "quantity", 4));
  tables.set("withdrawals", [
    ...datedRows("labour", 1001, "withdrawal_date", "amount", 5, { labourer_id: "worker", labour_group_id: null }),
    ...datedRows("mud", 501, "withdrawal_date", "amount", 6, { labourer_id: null, labour_group_id: "group" }),
  ]);
  tables.set("transport_withdrawals", datedRows("transport", 500, "withdrawal_date", "amount", 7));
  tables.set("soil_payments", datedRows("soil", 501, "payment_date", "amount", 8));
  tables.set("staff_payments", datedRows("staff", 500, "payment_date", "amount", 9));
  const args = ["factory-a", "2026-08-01", "2026-08-31"] as const;

  assert.equal(await getRecordedExpenseTotal(...args), 3003);
  assert.equal(await getProductionQuantityTotal(...args), 4804);
  assert.equal(await getProductionLabourPaidTotal(...args), 5005);
  assert.equal(await getMudSupplyPaidTotal(...args), 3006);
  assert.equal(await getChamberTransportPaidTotal(...args), 3500);
  assert.equal(await getSoilPaidTotal(...args), 4008);
  assert.equal(await getStaffPaidTotal(...args), 4500);
  assert.equal(requests.every(({ limit }) => limit === 500), true);
});

test("Vehicle Paid completes payments and factory-wide reversals outside the selected range", async () => {
  reset();
  tables.set("vehicle_wage_payments", datedRows("vehicle-payment", 1001, "payment_date", "amount", 10));
  const reversals = Array.from({ length: 1000 }, (_, index): Row => ({
    id: id("reversal", index), factory_id: "factory-a", payment_id: id("historical-payment", index),
  }));
  reversals.push({ id: id("reversal", 1000), factory_id: "factory-a", payment_id: id("vehicle-payment", 1000) });
  tables.set("vehicle_wage_payment_reversals", reversals);

  assert.equal(await getVehicleWagePaidTotal("factory-a", "2026-08-01", "2026-08-31"), 10000);
  assert.equal(requests.filter(({ table }) => table === "vehicle_wage_payments").length, 3);
  assert.equal(requests.filter(({ table }) => table === "vehicle_wage_payment_reversals").length, 3);
});

test("a later-page Supabase failure rejects instead of returning a partial total", async () => {
  reset();
  tables.set("production_entries", datedRows("production", 501, "production_date", "quantity", 4));
  laterFailure = { table: "production_entries", requestNumber: 2 };

  await assert.rejects(
    getProductionQuantityTotal("factory-a", "2026-08-01", "2026-08-31"),
    (error: unknown) => error instanceof Error && error.name === "ProductionReadServiceError"
      && error.message === "later page failed",
  );
  assert.equal(requests.filter(({ table }) => table === "production_entries").length, 2);
});

test("zero-row reads terminate after one request and return zero", async () => {
  reset();
  assert.equal(await getStaffPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
  assert.deepEqual(requests, [{ table: "staff_payments", afterId: null, limit: 500 }]);
});
