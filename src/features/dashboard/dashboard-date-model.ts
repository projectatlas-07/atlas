import { assertBusinessDate } from "../../lib/business-date-contract.ts";

export const ATLAS_BUSINESS_TIME_ZONE = "Asia/Kolkata";

export interface DashboardDateRange {
  dateFrom: string;
  dateTo: string;
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
