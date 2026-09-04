import {
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
import type { DashboardSnapshot } from "../types.ts";

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
    cashBookRange,
    productionQuantity,
    productionLabourPaid,
    mudSupplyPaid,
    chamberTransportPaid,
    soilTrolleyPaid,
    staffPaid,
    vehicleDeliveryWagePaid,
    cashBalance,
    currentCustomerOutstanding,
  ] = await Promise.all([
    getSalesTotal(factoryId, dateFrom, dateTo),
    getPaymentsReceivedTotal(factoryId, dateFrom, dateTo),
    getRecordedExpenseTotal(factoryId, dateFrom, dateTo),
    getRangeTotals(factoryId, dateFrom, dateTo),
    getProductionQuantityTotal(factoryId, dateFrom, dateTo),
    productionLabourProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    mudSupplyProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    chamberTransportProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    soilTrolleyProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    staffProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    vehicleDeliveryWageProvider.getPaidTotal(factoryId, dateFrom, dateTo),
    getBalanceAsOf(factoryId, dateTo),
    getCurrentCustomerOutstandingTotal(factoryId),
  ]);

  return {
    dateFrom,
    dateTo,
    flows: {
      sales,
      paymentsReceived,
      expenses,
      cashIn: cashBookRange.moneyIn,
      cashOut: cashBookRange.moneyOut,
      productionQuantity,
      productionLabourPaid,
      mudSupplyPaid,
      chamberTransportPaid,
      soilTrolleyPaid,
      staffPaid,
      vehicleDeliveryWagePaid,
    },
    stocks: {
      cashBalance,
      currentCustomerOutstanding,
    },
  };
}
