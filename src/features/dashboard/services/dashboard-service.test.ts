import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Call = [metric: string, ...args: string[]];

const calls: Call[] = [];
const values: Record<string, number> = {};
let rejectedMetric: string | null = null;

function readMetric(metric: string, args: string[]): Promise<number> {
  calls.push([metric, ...args]);
  if (rejectedMetric === metric) return Promise.reject(new Error(`${metric} failed`));
  return Promise.resolve(values[metric] ?? 0);
}

function provider(metric: string) {
  return {
    id: metric,
    displayName: metric,
    getPaidTotal: (...args: string[]) => readMetric(metric, args),
  };
}

await mock.module("../../sales/services/sales-register-service.ts", {
  namedExports: {
    getSalesTotal: (...args: string[]) => readMetric("sales", args),
  },
});

await mock.module("../../sales/services/customer-payment-service.ts", {
  namedExports: {
    getPaymentsReceivedTotal: (...args: string[]) => readMetric("paymentsReceived", args),
    getCurrentCustomerOutstandingTotal: (...args: string[]) => readMetric("currentCustomerOutstanding", args),
  },
});

await mock.module("../../expenses/services/expense-service.ts", {
  namedExports: {
    getRecordedExpenseTotal: (...args: string[]) => readMetric("expenses", args),
  },
});

await mock.module("../../cash-book/services/cash-book-service.ts", {
  namedExports: {
    getRangeTotals: async (...args: string[]) => {
      calls.push(["cashBookRange", ...args]);
      if (rejectedMetric === "cashBookRange") throw new Error("cashBookRange failed");
      return {
        moneyIn: values.cashIn ?? 0,
        moneyOut: values.cashOut ?? 0,
      };
    },
    getBalanceAsOf: (...args: string[]) => readMetric("cashBalance", args),
  },
});

await mock.module("../../production/services/production-read-service.ts", {
  namedExports: {
    getProductionQuantityTotal: (...args: string[]) => readMetric("productionQuantity", args),
  },
});

await mock.module("../../compensation/providers.ts", {
  namedExports: {
    productionLabourProvider: provider("productionLabourPaid"),
    mudSupplyProvider: provider("mudSupplyPaid"),
    chamberTransportProvider: provider("chamberTransportPaid"),
    soilTrolleyProvider: provider("soilTrolleyPaid"),
    staffProvider: provider("staffPaid"),
    vehicleDeliveryWageProvider: provider("vehicleDeliveryWagePaid"),
  },
});

const { getDashboardSnapshot } = await import("./dashboard-service.ts");

const factoryId = "factory-a";
const dateFrom = "2026-08-01";
const dateTo = "2026-08-31";
const rangedArgs = [factoryId, dateFrom, dateTo];

function reset(): void {
  calls.length = 0;
  rejectedMetric = null;
  for (const key of Object.keys(values)) delete values[key];
}

test("maps all 14 metrics without reusing results and forwards each boundary's required dates", async () => {
  reset();
  Object.assign(values, {
    sales: 1,
    paymentsReceived: 2,
    expenses: 3,
    cashIn: 4,
    cashOut: 5,
    productionQuantity: 6,
    productionLabourPaid: 7,
    mudSupplyPaid: 8,
    chamberTransportPaid: 9,
    soilTrolleyPaid: 10,
    staffPaid: 11,
    vehicleDeliveryWagePaid: 12,
    cashBalance: 13,
    currentCustomerOutstanding: 14,
  });

  assert.deepEqual(await getDashboardSnapshot(factoryId, dateFrom, dateTo), {
    dateFrom,
    dateTo,
    flows: {
      sales: 1,
      paymentsReceived: 2,
      expenses: 3,
      cashIn: 4,
      cashOut: 5,
      productionQuantity: 6,
      productionLabourPaid: 7,
      mudSupplyPaid: 8,
      chamberTransportPaid: 9,
      soilTrolleyPaid: 10,
      staffPaid: 11,
      vehicleDeliveryWagePaid: 12,
    },
    stocks: {
      cashBalance: 13,
      currentCustomerOutstanding: 14,
    },
  });

  for (const metric of [
    "sales",
    "paymentsReceived",
    "expenses",
    "cashBookRange",
    "productionQuantity",
    "productionLabourPaid",
    "mudSupplyPaid",
    "chamberTransportPaid",
    "soilTrolleyPaid",
    "staffPaid",
    "vehicleDeliveryWagePaid",
  ]) {
    assert.deepEqual(calls.find(([calledMetric]) => calledMetric === metric), [metric, ...rangedArgs]);
  }
  assert.deepEqual(calls.find(([metric]) => metric === "cashBalance"), ["cashBalance", factoryId, dateTo]);
  assert.deepEqual(calls.find(([metric]) => metric === "currentCustomerOutstanding"), [
    "currentCustomerOutstanding",
    factoryId,
  ]);
});

test("preserves zero values", async () => {
  reset();

  const snapshot = await getDashboardSnapshot(factoryId, dateFrom, dateTo);
  assert.deepEqual(Object.values(snapshot.flows), Array(12).fill(0));
  assert.deepEqual(Object.values(snapshot.stocks), [0, 0]);
});

test("propagates a module contract error", async () => {
  reset();
  rejectedMetric = "sales";

  await assert.rejects(getDashboardSnapshot(factoryId, dateFrom, dateTo), /sales failed/);
});

test("propagates a compensation provider error", async () => {
  reset();
  rejectedMetric = "staffPaid";

  await assert.rejects(getDashboardSnapshot(factoryId, dateFrom, dateTo), /staffPaid failed/);
});
