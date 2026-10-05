import {
  CashBookServiceError,
  getBalanceAsOf,
  getRangeTotals,
} from "../../cash-book/services/cash-book-service.ts";
import {
  chamberTransportProvider,
  mudSupplyProvider,
  productionLabourProvider,
  soilTrolleyProvider,
  staffProvider,
  vehicleDeliveryWageProvider,
} from "../../compensation/providers.ts";
import { getRecordedExpenseTotal } from "../../expenses/services/expense-service.ts";
import { getProductionQuantityTotal } from "../../production/services/production-read-service.ts";
import {
  getCurrentCustomerOutstandingTotal,
  getPaymentsReceivedTotal,
} from "../../sales/services/customer-payment-service.ts";
import { getSalesTotal } from "../../sales/services/sales-register-service.ts";
import { assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import type {
  DashboardCashBookState,
  DashboardSnapshot,
  OwnerDashboardSnapshot,
} from "../types.ts";

export async function getOwnerDashboardSnapshot(
  factoryId: string,
  businessDate: string,
  weekStart: string,
): Promise<OwnerDashboardSnapshot> {
  assertInclusiveBusinessDateRange(factoryId, businessDate, businessDate);
  assertInclusiveBusinessDateRange(factoryId, weekStart, businessDate);

  const [today, thisWeekSalesAmount] = await Promise.all([
    getDashboardSnapshot(factoryId, businessDate, businessDate),
    getSalesTotal(factoryId, weekStart, businessDate),
  ]);

  return {
    today,
    thisWeekSales: {
      dateFrom: weekStart,
      dateTo: businessDate,
      amount: thisWeekSalesAmount,
    },
  };
}

export async function getDashboardSnapshot(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DashboardSnapshot> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);

  const [
    sales,
    paymentsReceived,
    expenses,
    cashBook,
    productionQuantity,
    productionLabourPaid,
    mudSupplyPaid,
    chamberTransportPaid,
    soilTrolleyPaid,
    staffPaid,
    vehicleDeliveryWagePaid,
    currentCustomerOutstanding,
  ] = await Promise.all([
    getSalesTotal(factoryId, dateFrom, dateTo),
    getPaymentsReceivedTotal(factoryId, dateFrom, dateTo),
    getRecordedExpenseTotal(factoryId, dateFrom, dateTo),
    getDashboardCashBookState(factoryId, dateFrom, dateTo),
    getProductionQuantityTotal(factoryId, dateFrom, dateTo),
    productionLabourProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    mudSupplyProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    chamberTransportProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    soilTrolleyProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    staffProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    vehicleDeliveryWageProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    getCurrentCustomerOutstandingTotal(factoryId),
  ]);

  return {
    dateFrom,
    dateTo,
    flows: {
      sales,
      paymentsReceived,
      expenses,
      productionQuantity,
      productionLabourPaid,
      mudSupplyPaid,
      chamberTransportPaid,
      soilTrolleyPaid,
      staffPaid,
      vehicleDeliveryWagePaid,
    },
    stocks: {
      currentCustomerOutstanding,
    },
    cashBook,
  };
}

async function getDashboardCashBookState(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DashboardCashBookState> {
  const [rangeResult, balanceResult] = await Promise.allSettled([
    getRangeTotals(factoryId, dateFrom, dateTo),
    getBalanceAsOf(factoryId, dateTo),
  ]);
  const results = [rangeResult, balanceResult];

  for (const result of results) {
    if (result.status === "rejected" && !isCashBookNotStartedError(result.reason)) {
      throw result.reason;
    }
  }

  if (rangeResult.status === "rejected" || balanceResult.status === "rejected") {
    return { status: "not_started" };
  }

  return {
    status: "started",
    moneyIn: rangeResult.value.moneyIn,
    moneyOut: rangeResult.value.moneyOut,
    balance: balanceResult.value,
  };
}

function isCashBookNotStartedError(error: unknown): boolean {
  return error instanceof CashBookServiceError && error.code === "P3201";
}
