import { formatSalesMoney } from "../office/sales-office-model.ts";
import type { DashboardSnapshot } from "./types.ts";

type DashboardMetricCard = {
  label: string;
  value: string;
  helperText?: string;
};

export function buildDashboardPresentation(snapshot: DashboardSnapshot): {
  periodLabel: string;
  businessActivity: DashboardMetricCard[];
  currentPosition: DashboardMetricCard[];
} {
  return {
    periodLabel: `Selected period: ${snapshot.dateFrom} to ${snapshot.dateTo}`,
    businessActivity: [
      {
        label: "Sales",
        value: formatSalesMoney(snapshot.flows.sales),
        helperText: "Current Challan totals for this period. Correcting an unlocked Challan later can change past Sales.",
      },
      {
        label: "Payments Received",
        value: formatSalesMoney(snapshot.flows.paymentsReceived),
        helperText: "Customer payments received in this period. Cash In includes all Cash Book Money In.",
      },
      {
        label: "Expenses",
        value: formatSalesMoney(snapshot.flows.expenses),
        helperText: "Purchases and expenses recorded in this period. Cash Out shows actual Cash Book Money Out.",
      },
      { label: "Cash In", value: formatSalesMoney(snapshot.flows.cashIn) },
      { label: "Cash Out", value: formatSalesMoney(snapshot.flows.cashOut) },
      { label: "Production Quantity", value: formatDashboardQuantity(snapshot.flows.productionQuantity) },
      { label: "Production Labour Paid", value: formatSalesMoney(snapshot.flows.productionLabourPaid) },
      { label: "Mud Supply Paid", value: formatSalesMoney(snapshot.flows.mudSupplyPaid) },
      { label: "Chamber Transport Paid", value: formatSalesMoney(snapshot.flows.chamberTransportPaid) },
      { label: "Soil/Trolley Paid", value: formatSalesMoney(snapshot.flows.soilTrolleyPaid) },
      { label: "Staff Paid", value: formatSalesMoney(snapshot.flows.staffPaid) },
      { label: "Vehicle Delivery Wage Paid", value: formatSalesMoney(snapshot.flows.vehicleDeliveryWagePaid) },
    ],
    currentPosition: [
      { label: "Cash Balance", value: formatSalesMoney(snapshot.stocks.cashBalance) },
      {
        label: "Customer Outstanding — Current",
        value: formatSalesMoney(snapshot.stocks.currentCustomerOutstanding),
        helperText: "Current unpaid customer balance, not a historical balance for this period.",
      },
    ],
  };
}

export function formatDashboardQuantity(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
