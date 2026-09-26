import {
  formatDateOnly,
  formatIndianCurrency,
  formatIndianNumber,
} from "../../lib/formatting.ts";
import type { OwnerDashboardSnapshot } from "./types.ts";

const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

export type DashboardSummary = {
  label: string;
  value: string;
  description: string;
  href: "#sales" | "#production" | "#purchases-expenses" | "#cash-book";
};

export type DashboardAttentionItem = {
  title: string;
  description: string;
  value?: string;
  href: "#sales" | "#production";
  linkLabel: string;
};

export function buildDashboardPresentation(snapshot: OwnerDashboardSnapshot) {
  const productionRecorded = snapshot.today.flows.productionQuantity > 0;
  const currentOutstanding = snapshot.today.stocks.currentCustomerOutstanding;
  const attention: DashboardAttentionItem[] = [];

  if (!productionRecorded) {
    attention.push({
      title: "Today’s production is not recorded",
      description: "No positive production entry exists for today.",
      href: "#production",
      linkLabel: "Open Production",
    });
  }

  if (currentOutstanding > 0) {
    attention.push({
      title: "Customer balance remains open",
      description: "This is the current unpaid customer balance, not an overdue calculation.",
      value: formatMoney(currentOutstanding),
      href: "#sales",
      linkLabel: "Open Customer Dues",
    });
  }

  const activity: DashboardSummary[] = [
    {
      label: "Payments received",
      value: formatMoney(snapshot.today.flows.paymentsReceived),
      description: "Customer payments received today.",
      href: "#sales",
    },
    {
      label: "Expenses",
      value: formatMoney(snapshot.today.flows.expenses),
      description: "Purchases and expenses recorded today.",
      href: "#purchases-expenses",
    },
    {
      label: "Cash In",
      value: formatMoney(snapshot.today.flows.cashIn),
      description: "All Cash Book Money In recorded today.",
      href: "#cash-book",
    },
    {
      label: "Cash Out",
      value: formatMoney(snapshot.today.flows.cashOut),
      description: "All Cash Book Money Out recorded today.",
      href: "#cash-book",
    },
  ];

  return {
    todayDateLabel: formatDateOnly(snapshot.today.dateTo),
    todaySales: {
      label: "Today’s Sales",
      value: formatMoney(snapshot.today.flows.sales),
      description: snapshot.today.flows.sales === 0
        ? "No active Challan value is recorded for today."
        : "Active Challan value dated today.",
      href: "#sales" as const,
    },
    todayProduction: productionRecorded
      ? {
          recorded: true as const,
          value: formatIndianNumber(snapshot.today.flows.productionQuantity),
          description: "Quantity from today’s production entries.",
          href: "#production" as const,
        }
      : {
          recorded: false as const,
          value: "Not recorded yet",
          description: "Record production in the existing daily workflow.",
          href: "#production" as const,
        },
    attention,
    thisWeekSales: {
      label: "This Week’s Sales",
      value: formatMoney(snapshot.thisWeekSales.amount),
      description: `${formatDateOnly(snapshot.thisWeekSales.dateFrom)} to ${formatDateOnly(snapshot.thisWeekSales.dateTo)}`,
      href: "#sales" as const,
    },
    currentPosition: [
      {
        label: "Cash balance",
        value: formatMoney(snapshot.today.stocks.cashBalance),
        description: `Balance as of ${formatDateOnly(snapshot.today.dateTo)}.`,
        href: "#cash-book" as const,
      },
      {
        label: "Customer outstanding",
        value: formatMoney(currentOutstanding),
        description: "Current unpaid customer balance.",
        href: "#sales" as const,
      },
    ],
    activity,
    hasRecordedActivity: [
      snapshot.today.flows.paymentsReceived,
      snapshot.today.flows.expenses,
      snapshot.today.flows.cashIn,
      snapshot.today.flows.cashOut,
    ].some((value) => value !== 0),
  };
}

function formatMoney(value: number) {
  return formatIndianCurrency(value, MONEY_WITH_PAISE);
}
