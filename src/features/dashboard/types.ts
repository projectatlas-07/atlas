export interface DashboardFlowMetrics {
  sales: number;
  paymentsReceived: number;
  expenses: number;
  productionQuantity: number;
  productionLabourPaid: number;
  mudSupplyPaid: number;
  chamberTransportPaid: number;
  soilTrolleyPaid: number;
  staffPaid: number;
  vehicleDeliveryWagePaid: number;
}

export interface DashboardStockMetrics {
  currentCustomerOutstanding: number;
}

export type DashboardCashBookState =
  | {
      status: "started";
      moneyIn: number;
      moneyOut: number;
      balance: number;
    }
  | {
      status: "not_started";
    };

export interface DashboardSnapshot {
  dateFrom: string;
  dateTo: string;
  flows: DashboardFlowMetrics;
  stocks: DashboardStockMetrics;
  cashBook: DashboardCashBookState;
}

/** Read-only owner summary composed from the existing Dashboard snapshot and Sales service. */
export interface OwnerDashboardSnapshot {
  today: DashboardSnapshot;
  thisWeekSales: {
    dateFrom: string;
    dateTo: string;
    amount: number;
  };
}
