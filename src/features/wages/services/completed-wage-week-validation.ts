import { assertMondayWeekStart } from "./wage-rate-service.ts";

export function assertCompletedWageWeek(weekStart: string, today: string): void {
  assertMondayWeekStart(weekStart);
  assertCanonicalLocalDate(today, "today");

  if (getSundayWeekEnd(weekStart) >= today) {
    throw new Error(`Week starting ${weekStart} is not completed yet.`);
  }
}

function getSundayWeekEnd(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const sunday = new Date(year, month - 1, day + 6);
  return formatLocalDate(sunday);
}

function assertCanonicalLocalDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(year, month - 1, day);

  if (formatLocalDate(date) !== value) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
