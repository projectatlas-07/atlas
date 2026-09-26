import { assertBusinessDate } from "../../lib/business-date-contract.ts";
import { shiftLocalDate } from "../../lib/local-date.ts";

export const ATLAS_BUSINESS_TIME_ZONE = "Asia/Kolkata";

export interface DashboardDateRange {
  dateFrom: string;
  dateTo: string;
}

export interface OwnerDashboardDateRanges {
  today: DashboardDateRange;
  thisWeek: DashboardDateRange;
}

export type DashboardDateMode = "today" | "single-date" | "range";

const businessDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: ATLAS_BUSINESS_TIME_ZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getAtlasBusinessDate(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    businessDateFormatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

export function getTodayDashboardRange(now?: Date): DashboardDateRange {
  return getSingleDateDashboardRange(getAtlasBusinessDate(now));
}

/** Returns Today and Monday-to-Today using the same explicit Kolkata business date. */
export function getOwnerDashboardDateRanges(now?: Date): OwnerDashboardDateRanges {
  const businessDate = getAtlasBusinessDate(now);
  const daysSinceMonday = (getBusinessDateWeekday(businessDate) + 6) % 7;
  const weekStart = shiftLocalDate(businessDate, -daysSinceMonday);
  if (!weekStart) throw new Error("Could not resolve the Dashboard week.");

  return {
    today: getSingleDateDashboardRange(businessDate),
    thisWeek: getCustomDashboardRange(weekStart, businessDate),
  };
}

export function getSingleDateDashboardRange(businessDate: string): DashboardDateRange {
  assertBusinessDate(businessDate, "businessDate");
  return { dateFrom: businessDate, dateTo: businessDate };
}

/** Both supplied business dates are included; neither endpoint is converted. */
export function getCustomDashboardRange(
  dateFrom: string,
  dateTo: string,
): DashboardDateRange {
  assertBusinessDate(dateFrom, "dateFrom");
  assertBusinessDate(dateTo, "dateTo");
  if (dateFrom > dateTo) throw new Error("dateFrom must not be after dateTo.");
  return { dateFrom, dateTo };
}

function getBusinessDateWeekday(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return new Date(year, month - 1, day, 12).getDay();
}
