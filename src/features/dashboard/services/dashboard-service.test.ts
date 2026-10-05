import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Call = [metric: string, ...args: string[]];

const calls: Call[] = [];
const values: Record<string, number> = {};
let rejectedMetric: string | null = null;
let rejectedCode: string | null = null;
let secondRejectedMetric: string | null = null;
let secondRejectedCode: string | null = null;

class MockCashBookServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function readMetric(metric: string, args: string[]): Promise<number> {
  calls.push([metric, ...args]);
  if (rejectedMetric === metric) return Promise.reject(new Error(`${metric} failed`));
  return Promise.resolve(values[metric] ?? 0);
}

function cashBookError(metric: string): Error | null {
  const code = rejectedMetric === metric
    ? rejectedCode
    : secondRejectedMetric === metric
      ? secondRejectedCode
      : null;
  if (rejectedMetric !== metric && secondRejectedMetric !== metric) return null;
  return code
    ? new MockCashBookServiceError(code, `${metric} failed`)
    : new Error(`${metric} failed`);
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
    CashBookServiceError: MockCashBookServiceError,
    getRangeTotals: async (...args: string[]) => {
      calls.push(["cashBookRange", ...args]);
      const error = cashBookError("cashBookRange");
      if (error) throw error;
      return {
        moneyIn: values.cashIn ?? 0,
        moneyOut: values.cashOut ?? 0,
      };
    },
    getBalanceAsOf: async (...args: string[]) => {
      calls.push(["cashBalance", ...args]);
      const error = cashBookError("cashBalance");
      if (error) throw error;
      return Promise.resolve(values.cashBalance ?? 0);
    },
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

const { getDashboardSnapshot, getOwnerDashboardSnapshot } = await import("./dashboard-service.ts");

const factoryId = "factory-a";
const dateFrom = "2026-08-01";
const dateTo = "2026-08-31";
const rangedArgs = [factoryId, dateFrom, dateTo];

function reset(): void {
  calls.length = 0;
  rejectedMetric = null;
  rejectedCode = null;
  secondRejectedMetric = null;
  secondRejectedCode = null;
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
      productionQuantity: 6,
      productionLabourPaid: 7,
      mudSupplyPaid: 8,
      chamberTransportPaid: 9,
      soilTrolleyPaid: 10,
      staffPaid: 11,
      vehicleDeliveryWagePaid: 12,
    },
    stocks: {
      currentCustomerOutstanding: 14,
    },
    cashBook: {
      status: "started",
      moneyIn: 4,
      moneyOut: 5,
      balance: 13,
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
  assert.deepEqual(Object.values(snapshot.flows), Array(10).fill(0));
  assert.deepEqual(Object.values(snapshot.stocks), [0]);
  assert.deepEqual(snapshot.cashBook, {
    status: "started",
    moneyIn: 0,
    moneyOut: 0,
    balance: 0,
  });
});

test("owner snapshot reuses the six-provider Today snapshot and adds only week-to-date Sales", async () => {
  reset();
  Object.assign(values, {
    sales: 200,
    productionQuantity: 30,
    mudSupplyPaid: 40,
  });

  const snapshot = await getOwnerDashboardSnapshot(
    factoryId,
    "2026-09-23",
    "2026-09-21",
  );

  assert.equal(snapshot.today.dateFrom, "2026-09-23");
  assert.equal(snapshot.today.dateTo, "2026-09-23");
  assert.equal(snapshot.today.flows.productionQuantity, 30);
  assert.equal(snapshot.today.flows.mudSupplyPaid, 40);
  assert.deepEqual(snapshot.thisWeekSales, {
    dateFrom: "2026-09-21",
    dateTo: "2026-09-23",
    amount: 200,
  });
  assert.deepEqual(calls.filter(([metric]) => metric === "sales"), [
    ["sales", factoryId, "2026-09-23", "2026-09-23"],
    ["sales", factoryId, "2026-09-21", "2026-09-23"],
  ]);
  for (const providerMetric of [
    "productionLabourPaid",
    "mudSupplyPaid",
    "chamberTransportPaid",
    "soilTrolleyPaid",
    "staffPaid",
    "vehicleDeliveryWagePaid",
  ]) {
    assert.deepEqual(calls.filter(([metric]) => metric === providerMetric), [
      [providerMetric, factoryId, "2026-09-23", "2026-09-23"],
    ]);
  }
});

test("owner snapshot rejects a reversed week before calling module services", async () => {
  reset();
  await assert.rejects(
    getOwnerDashboardSnapshot(factoryId, "2026-09-21", "2026-09-22"),
    /dateFrom must not be after dateTo/,
  );
  assert.deepEqual(calls, []);
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

test("treats Cash Book P3201 as a distinct not-started state while loading other metrics", async () => {
  reset();
  values.sales = 125;
  values.productionQuantity = 40;
  rejectedMetric = "cashBookRange";
  rejectedCode = "P3201";

  const snapshot = await getDashboardSnapshot(factoryId, dateFrom, dateTo);

  assert.deepEqual(snapshot.cashBook, { status: "not_started" });
  assert.equal(snapshot.flows.sales, 125);
  assert.equal(snapshot.flows.productionQuantity, 40);
  assert.ok(calls.some(([metric]) => metric === "currentCustomerOutstanding"));
});

test("does not swallow an unexpected Cash Book error", async () => {
  reset();
  rejectedMetric = "cashBookRange";
  rejectedCode = "42501";

  await assert.rejects(
    getDashboardSnapshot(factoryId, dateFrom, dateTo),
    (error: unknown) => error instanceof MockCashBookServiceError && error.code === "42501",
  );
});

test("does not let a concurrent P3201 hide another unexpected Cash Book error", async () => {
  reset();
  rejectedMetric = "cashBookRange";
  rejectedCode = "P3201";
  secondRejectedMetric = "cashBalance";
  secondRejectedCode = "42501";

  await assert.rejects(
    getDashboardSnapshot(factoryId, dateFrom, dateTo),
    (error: unknown) => error instanceof MockCashBookServiceError && error.code === "42501",
  );
});
