export interface DashboardFlowMetrics {
  sales: number;
  paymentsReceived: number;
  expenses: number;
  cashIn: number;
  cashOut: number;
  productionQuantity: number;
  productionLabourPaid: number;
  mudSupplyPaid: number;
  chamberTransportPaid: number;
  soilTrolleyPaid: number;
  staffPaid: number;
  vehicleDeliveryWagePaid: number;
}

export interface DashboardStockMetrics {
  cashBalance: number;
  currentCustomerOutstanding: number;
}

export interface DashboardSnapshot {
  dateFrom: string;
  dateTo: string;
  flows: DashboardFlowMetrics;
  stocks: DashboardStockMetrics;
}
