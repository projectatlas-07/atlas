import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;
type Call = [operation: string, source: string, columnOrArgs: unknown, value?: unknown];
type RpcResponse = { data: Row[] | Row | null; error: null };

const calls: Call[] = [];
const tables = new Map<string, Row[]>();
const cashBookDays = new Map<string, Row>();

function queryBuilder(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let orderColumn = "";
  let maximumRows = Number.POSITIVE_INFINITY;
  const query = {
    select(columns: string) {
      calls.push(["select", table, columns]);
      return query;
    },
    eq(column: string, value: unknown) {
      calls.push(["eq", table, column, value]);
      filters.push((row) => row[column] === value);
      return query;
    },
    not(column: string, operator: string, value: unknown) {
      calls.push(["not", table, column, `${operator}:${String(value)}`]);
      if (operator === "is" && value === null) filters.push((row) => row[column] !== null);
      return query;
    },
    is(column: string, value: unknown) {
      calls.push(["is", table, column, value]);
      filters.push((row) => row[column] === value);
      return query;
    },
    gte(column: string, value: string) {
      calls.push(["gte", table, column, value]);
      filters.push((row) => String(row[column]) >= value);
      return query;
    },
    lte(column: string, value: string) {
      calls.push(["lte", table, column, value]);
      filters.push((row) => String(row[column]) <= value);
      return query;
    },
    gt(column: string, value: string) {
      calls.push(["gt", table, column, value]);
      filters.push((row) => String(row[column]) > value);
      return query;
    },
    order(column: string) {
      calls.push(["order", table, column]);
      orderColumn = column;
      return query;
    },
    limit(value: number) {
      calls.push(["limit", table, value]);
      maximumRows = value;
      return query;
    },
    in(column: string, values: unknown[]) {
      calls.push(["in", table, column, values]);
      filters.push((row) => values.includes(row[column]));
      return query;
    },
    then(resolve: (response: RpcResponse) => unknown, reject: (reason: unknown) => unknown) {
      const data = (tables.get(table) ?? [])
        .map((row, index): Row => ({ ...row, id: row.id ?? `${table}-${String(index).padStart(6, "0")}` }))
        .filter((row) => filters.every((filter) => filter(row)))
        .sort((left, right) => orderColumn ? String(left[orderColumn]).localeCompare(String(right[orderColumn])) : 0)
        .slice(0, maximumRows);
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return query;
}

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table, null]);
    return queryBuilder(table);
  },
  rpc(functionName: string, args: Row) {
    calls.push(["rpc", functionName, args]);
    if (functionName === "get_cash_book_day_summary") {
      const row = cashBookDays.get(String(args.p_business_date));
      return Promise.resolve({ data: row ? [row] : [], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  },
};

await mock.module("../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const { getSalesTotal } = await import("./sales/services/sales-register-service.ts");
const {
  getCurrentCustomerOutstandingTotal,
  getPaymentsReceivedTotal,
} = await import("./sales/services/customer-payment-service.ts");
const { getRecordedExpenseTotal } = await import("./expenses/services/expense-service.ts");
const { getBalanceAsOf, getRangeTotals } = await import("./cash-book/services/cash-book-service.ts");
const { getProductionQuantityTotal } = await import("./production/services/production-read-service.ts");
const {
  getMudSupplyPaidTotal,
  getProductionLabourPaidTotal,
} = await import("./wages/services/paid-total-service.ts");
const { getChamberTransportPaidTotal } = await import("./transport/services/transport-worker-financial-service.ts");
const { getSoilPaidTotal } = await import("./soil/services/soil-payment-service.ts");
const { getStaffPaidTotal } = await import("./staff/services/staff-payment-service.ts");
const { getVehicleWagePaidTotal } = await import("./sales/services/vehicle-wage-service.ts");
const { compensationProviders } = await import("./compensation/providers.ts");

function reset(): void {
  calls.length = 0;
  tables.clear();
  cashBookDays.clear();
}

test("Sales uses persisted totals at both inclusive endpoints and excludes void or other-factory Challans", async () => {
  reset();
  tables.set("challans", [
    { factory_id: "factory-a", challan_date: "2026-08-01", status: "active", challan_total: "100", calculated_total: 999 },
    { factory_id: "factory-a", challan_date: "2026-08-31", status: "active", challan_total: "250", calculated_total: 999 },
    { factory_id: "factory-a", challan_date: "2026-08-15", status: "void", challan_total: "400" },
    { factory_id: "factory-a", challan_date: "2026-09-01", status: "active", challan_total: "500" },
    { factory_id: "factory-b", challan_date: "2026-08-20", status: "active", challan_total: "600" },
  ]);

  assert.equal(await getSalesTotal("factory-a", "2026-08-01", "2026-08-31"), 350);
  assert.deepEqual(calls[1], ["select", "challans", "id, challan_total"]);
  assert.equal(calls.some(([operation]) => operation === "rpc"), false);
  reset();
  assert.equal(await getSalesTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
});

test("Payments Received counts each immutable header once without reading allocations", async () => {
  reset();
  tables.set("customer_payments", [
    { id: "p1", factory_id: "factory-a", payment_date: "2026-08-01", amount: "100", allocations: [1, 2] },
    { id: "p2", factory_id: "factory-a", payment_date: "2026-08-31", amount: "200", allocations: [3] },
    { id: "p3", factory_id: "factory-b", payment_date: "2026-08-15", amount: "900" },
  ]);

  assert.equal(await getPaymentsReceivedTotal("factory-a", "2026-08-01", "2026-08-31"), 300);
  assert.equal(calls.some(([, source]) => source === "customer_payment_allocations"), false);
  reset();
  assert.equal(await getPaymentsReceivedTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
});

test("Recorded Expenses includes active purchases and expenses at both endpoints", async () => {
  reset();
  tables.set("expense_records", [
    { factory_id: "factory-a", business_date: "2026-08-01", status: "active", kind: "purchase", total_amount: "400" },
    { factory_id: "factory-a", business_date: "2026-08-31", status: "active", kind: "expense", total_amount: "60" },
    { factory_id: "factory-a", business_date: "2026-08-15", status: "void", kind: "expense", total_amount: "80" },
    { factory_id: "factory-b", business_date: "2026-08-20", status: "active", kind: "purchase", total_amount: "900" },
  ]);

  assert.equal(await getRecordedExpenseTotal("factory-a", "2026-08-01", "2026-08-31"), 460);
  reset();
  assert.equal(await getRecordedExpenseTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
});

test("Cash Book range loops over every inclusive day and accumulates authoritative summaries", async () => {
  reset();
  cashBookDays.set("2026-08-31", {
    business_date: "2026-08-31", opening_balance: "1000",
    total_money_in: "125", total_money_out: "20", closing_balance: "1105",
  });
  cashBookDays.set("2026-09-01", {
    business_date: "2026-09-01", opening_balance: "1105",
    total_money_in: "75", total_money_out: "90", closing_balance: "1090",
  });
  cashBookDays.set("2026-09-02", {
    business_date: "2026-09-02", opening_balance: "1090",
    total_money_in: "1200", total_money_out: "0", closing_balance: "2290",
  });

  assert.deepEqual(await getRangeTotals("factory-a", "2026-08-31", "2026-09-02"), {
    moneyIn: 1400,
    moneyOut: 110,
  });
  assert.deepEqual(
    calls.filter(([operation]) => operation === "rpc").map((call) => (call[2] as Row).p_business_date),
    ["2026-08-31", "2026-09-01", "2026-09-02"],
  );
});

test("Cash Book preserves zero-movement days, reversal Money In from the RPC, and authoritative closing balance", async () => {
  reset();
  cashBookDays.set("2026-09-03", {
    business_date: "2026-09-03", opening_balance: "500",
    total_money_in: "1200", total_money_out: "0", closing_balance: "1700",
  });
  assert.deepEqual(await getRangeTotals("factory-a", "2026-09-03", "2026-09-03"), {
    moneyIn: 1200,
    moneyOut: 0,
  });
  assert.equal(await getBalanceAsOf("factory-a", "2026-09-03"), 1700);
});

test("Production sums recorded quantities across inclusive dates with factory isolation", async () => {
  reset();
  tables.set("production_entries", [
    { factory_id: "factory-a", production_date: "2026-08-01", quantity: 1000 },
    { factory_id: "factory-a", production_date: "2026-08-31", quantity: 2500 },
    { factory_id: "factory-b", production_date: "2026-08-15", quantity: 9000 },
  ]);
  assert.equal(await getProductionQuantityTotal("factory-a", "2026-08-01", "2026-08-31"), 3500);
  reset();
  assert.equal(await getProductionQuantityTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
});

test("Production Labour and Mud Supply use mutually exclusive withdrawal discriminators", async () => {
  reset();
  tables.set("withdrawals", [
    { factory_id: "factory-a", withdrawal_date: "2026-08-01", labourer_id: "labourer-a", labour_group_id: null, amount: 100 },
    { factory_id: "factory-a", withdrawal_date: "2026-08-31", labourer_id: "labourer-b", labour_group_id: null, amount: 150 },
    { factory_id: "factory-a", withdrawal_date: "2026-08-01", labourer_id: null, labour_group_id: "group-a", amount: 300 },
    { factory_id: "factory-a", withdrawal_date: "2026-08-31", labourer_id: null, labour_group_id: "group-b", amount: 400 },
    { factory_id: "factory-b", withdrawal_date: "2026-08-15", labourer_id: "labourer-c", labour_group_id: null, amount: 900 },
  ]);
  assert.equal(await getProductionLabourPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 250);
  assert.equal(await getMudSupplyPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 700);
  reset();
  assert.equal(await getProductionLabourPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
  assert.equal(await getMudSupplyPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 0);
});

test("Chamber Transport sums only factory withdrawals across inclusive dates", async () => {
  reset();
  tables.set("transport_withdrawals", [
    { factory_id: "factory-a", withdrawal_date: "2026-08-01", amount: 90 },
    { factory_id: "factory-a", withdrawal_date: "2026-08-31", amount: 110 },
    { factory_id: "factory-b", withdrawal_date: "2026-08-15", amount: 800 },
  ]);
  assert.equal(await getChamberTransportPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 200);
});

test("Soil/Trolley reads actual payments only and never financial adjustments", async () => {
  reset();
  tables.set("soil_payments", [
    { factory_id: "factory-a", payment_date: "2026-08-01", amount: 40 },
    { factory_id: "factory-a", payment_date: "2026-08-31", amount: 60 },
    { factory_id: "factory-b", payment_date: "2026-08-15", amount: 700 },
  ]);
  tables.set("soil_financial_adjustments", [{ factory_id: "factory-a", adjustment_date: "2026-08-10", amount: 999 }]);
  assert.equal(await getSoilPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 100);
  assert.equal(calls.some(([, source]) => source === "soil_financial_adjustments"), false);
});

test("Staff reads actual immutable payments across inclusive dates with factory isolation", async () => {
  reset();
  tables.set("staff_payments", [
    { factory_id: "factory-a", payment_date: "2026-08-01", amount: 500 },
    { factory_id: "factory-a", payment_date: "2026-08-31", amount: 700 },
    { factory_id: "factory-b", payment_date: "2026-08-20", amount: 900 },
  ]);
  assert.equal(await getStaffPaidTotal("factory-a", "2026-08-01", "2026-08-31"), 1200);
});

async function vehiclePaidFor(
  payments: Row[],
  reversals: Row[],
  dateFrom = "2026-08-01",
  dateTo = "2026-08-31",
): Promise<number> {
  reset();
  tables.set("vehicle_wage_payments", payments);
  tables.set("vehicle_wage_payment_reversals", reversals);
  return getVehicleWagePaidTotal("factory-a", dateFrom, dateTo);
}

test("Vehicle Wage includes an in-range unreversed payment", async () => {
  assert.equal(await vehiclePaidFor(
    [
      { id: "p1", factory_id: "factory-a", payment_date: "2026-08-01", amount: 100 },
      { id: "p2", factory_id: "factory-b", payment_date: "2026-08-15", amount: 900 },
    ],
    [],
  ), 100);
});

test("Vehicle Wage excludes an in-range payment reversed later", async () => {
  assert.equal(await vehiclePaidFor(
    [{ id: "p1", factory_id: "factory-a", payment_date: "2026-08-15", amount: 100 }],
    [{ factory_id: "factory-a", payment_id: "p1", reversal_date: "2026-09-10" }],
  ), 0);
});

test("Vehicle Wage gives zero when a before-range payment is reversed inside the range", async () => {
  assert.equal(await vehiclePaidFor(
    [{ id: "p1", factory_id: "factory-a", payment_date: "2026-07-31", amount: 100 }],
    [{ factory_id: "factory-a", payment_id: "p1", reversal_date: "2026-08-10" }],
  ), 0);
});

test("Vehicle Wage gives zero when payment and reversal are both inside the range", async () => {
  assert.equal(await vehiclePaidFor(
    [{ id: "p1", factory_id: "factory-a", payment_date: "2026-08-01", amount: 100 }],
    [{ factory_id: "factory-a", payment_id: "p1", reversal_date: "2026-08-20" }],
  ), 0);
});

test("Current Customer Outstanding includes active Challans, subtracts allocations, and has no date contract", async () => {
  reset();
  tables.set("challans", [
    { id: "c1", factory_id: "factory-a", status: "active", challan_total: "1000" },
    { id: "c2", factory_id: "factory-a", status: "active", challan_total: "500" },
    { id: "c3", factory_id: "factory-a", status: "void", challan_total: "800" },
    { id: "c4", factory_id: "factory-b", status: "active", challan_total: "900" },
  ]);
  tables.set("customer_payment_allocations", [
    { factory_id: "factory-a", challan_id: "c1", allocated_amount: "300" },
    { factory_id: "factory-a", challan_id: "c3", allocated_amount: "100" },
    { factory_id: "factory-b", challan_id: "c4", allocated_amount: "200" },
  ]);

  assert.equal(await getCurrentCustomerOutstandingTotal("factory-a"), 1200);
  assert.equal(getCurrentCustomerOutstandingTotal.length, 1);
  assert.equal(calls.some(([operation]) => operation === "gte" || operation === "lte"), false);
});

test("D2 exports exactly six explicit typed providers without invoking composition", () => {
  assert.deepEqual(compensationProviders.map(({ id, displayName }) => ({ id, displayName })), [
    { id: "production-labour", displayName: "Production Labour" },
    { id: "mud-supply", displayName: "Mud Supply" },
    { id: "chamber-transport", displayName: "Chamber Transport" },
    { id: "soil-trolley", displayName: "Soil/Trolley" },
    { id: "staff", displayName: "Staff" },
    { id: "vehicle-delivery-wage", displayName: "Vehicle Delivery Wage" },
  ]);
});

test("D2 range contracts reject invalid or reversed business dates before querying", async () => {
  reset();
  await assert.rejects(() => getSalesTotal("factory-a", "2026-02-30", "2026-03-01"), /dateFrom/);
  await assert.rejects(() => getRangeTotals("factory-a", "2026-09-02", "2026-09-01"), /after dateTo/);
  assert.equal(calls.length, 0);
});
