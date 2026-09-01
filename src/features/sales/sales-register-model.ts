import type { ChallanPaymentState, ChallanStatus } from "@/features/sales/types";

export type SalesDatePreset = "today" | "yesterday" | "week" | "month" | "custom";

export type SalesDateRange = {
  fromDate: string;
  toDate: string;
};

export type SalesRegisterItem = {
  particularsSnapshot: string;
  quantity: number;
  linePosition: number;
};

export type SalesRegisterEntry = {
  challanId: string;
  challanNumber: number;
  challanDate: string;
  customerNameSnapshot: string;
  items: SalesRegisterItem[];
  brickRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  vehicleNumber: string;
  status: ChallanStatus;
  paymentState: ChallanPaymentState | null;
  paidAmount: number;
  outstandingAmount: number;
};

export type SalesRegisterSummary = {
  brickRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  activeChallans: number;
  totalBrickQuantity: number;
  voidChallans: number;
};

export function resolveSalesDateRange(
  preset: SalesDatePreset,
  localToday: string,
  customFrom = "",
  customTo = "",
): SalesDateRange | null {
  if (!isCanonicalDate(localToday)) return null;
  if (preset === "today") return { fromDate: localToday, toDate: localToday };
  if (preset === "yesterday") {
    const yesterday = previousCalendarDate(localToday);
    return { fromDate: yesterday, toDate: yesterday };
  }
  if (preset === "week") {
    const date = new Date(`${localToday}T00:00:00Z`);
    const weekday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
    return { fromDate: date.toISOString().slice(0, 10), toDate: localToday };
  }
  if (preset === "month") {
    return { fromDate: `${localToday.slice(0, 7)}-01`, toDate: localToday };
  }
  if (!isCanonicalDate(customFrom) || !isCanonicalDate(customTo) || customFrom > customTo) {
    return null;
  }
  return { fromDate: customFrom, toDate: customTo };
}

function previousCalendarDate(value: string): string {
  let year = Number(value.slice(0, 4));
  let month = Number(value.slice(5, 7));
  let day = Number(value.slice(8, 10));
  if (day > 1) return formatCalendarDate(year, month, day - 1);
  if (month > 1) month -= 1;
  else {
    year -= 1;
    month = 12;
  }
  day = daysInMonth(year, month);
  return formatCalendarDate(year, month, day);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getChallanBrickQuantity(entry: SalesRegisterEntry): number {
  return entry.items.reduce((total, item) => total + item.quantity, 0);
}

export function getSalesRegisterPaymentLabel(entry: SalesRegisterEntry): string {
  if (entry.status === "void" || entry.paymentState === null) return "—";
  if (entry.paymentState === "partially_paid") return "Partial";
  if (entry.paymentState === "paid") return "Paid";
  return "Unpaid";
}

export function summarizeSalesRegister(
  entries: readonly SalesRegisterEntry[],
): SalesRegisterSummary {
  let brickRevenuePaise = 0;
  let otherRevenuePaise = 0;
  let totalRevenuePaise = 0;
  let activeChallans = 0;
  let totalBrickQuantity = 0;
  let voidChallans = 0;

  for (const entry of entries) {
    if (entry.status === "void") {
      voidChallans += 1;
      continue;
    }
    activeChallans += 1;
    brickRevenuePaise += Math.round(entry.brickRevenue * 100);
    otherRevenuePaise += Math.round(entry.otherRevenue * 100);
    totalRevenuePaise += Math.round(entry.totalRevenue * 100);
    totalBrickQuantity += getChallanBrickQuantity(entry);
  }

  return {
    brickRevenue: brickRevenuePaise / 100,
    otherRevenue: otherRevenuePaise / 100,
    totalRevenue: totalRevenuePaise / 100,
    activeChallans,
    totalBrickQuantity,
    voidChallans,
  };
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
