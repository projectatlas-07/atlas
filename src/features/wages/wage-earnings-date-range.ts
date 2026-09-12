import { isLocalDate, shiftLocalDate } from "../../lib/local-date.ts";

export const DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week" as const;

export type WageEarningsDatePreset =
  | typeof DEFAULT_WAGE_EARNINGS_DATE_PRESET
  | "last_week"
  | "this_month"
  | "custom";

export type WageEarningsDateRange = {
  fromDate: string;
  toDate: string;
};

export function resolveWageEarningsDateRange(
  preset: WageEarningsDatePreset,
  localToday: string,
  customFrom = "",
  customTo = "",
): WageEarningsDateRange | null {
  if (!isLocalDate(localToday)) return null;
  if (preset === "custom") {
    if (!isLocalDate(customFrom)
      || !isLocalDate(customTo)
      || customFrom > customTo) return null;
    return { fromDate: customFrom, toDate: customTo };
  }

  const daysSinceMonday = (getLocalWeekday(localToday) + 6) % 7;
  if (preset === "this_week") {
    return shiftedRange(localToday, -daysSinceMonday, 6 - daysSinceMonday);
  }
  if (preset === "last_week") {
    return shiftedRange(localToday, -daysSinceMonday - 7, -daysSinceMonday - 1);
  }
  if (preset !== "this_month") return null;

  const firstOfMonth = `${localToday.slice(0, 7)}-01`;
  const firstOfNextMonth = nextMonthFirst(firstOfMonth);
  const lastOfMonth = shiftLocalDate(firstOfNextMonth, -1);
  return lastOfMonth ? { fromDate: firstOfMonth, toDate: lastOfMonth } : null;
}

export function getMondayWageWeekStart(localDate: string): string | null {
  if (!isLocalDate(localDate)) return null;
  const daysSinceMonday = (getLocalWeekday(localDate) + 6) % 7;
  return shiftLocalDate(localDate, -daysSinceMonday);
}

export function isWageEarningsDateRange(
  range: WageEarningsDateRange,
): boolean {
  return isLocalDate(range.fromDate)
    && isLocalDate(range.toDate)
    && range.fromDate <= range.toDate;
}

function shiftedRange(
  localToday: string,
  fromOffset: number,
  toOffset: number,
): WageEarningsDateRange | null {
  const fromDate = shiftLocalDate(localToday, fromOffset);
  const toDate = shiftLocalDate(localToday, toOffset);
  return fromDate && toDate ? { fromDate, toDate } : null;
}

function getLocalWeekday(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return new Date(year, month - 1, day, 12).getDay();
}

function nextMonthFirst(value: string): string {
  let year = Number(value.slice(0, 4));
  let month = Number(value.slice(5, 7)) + 1;
  if (month === 13) {
    year += 1;
    month = 1;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}
