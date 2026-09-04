import { isLocalDate } from "./local-date.ts";

export function assertFactoryId(factoryId: string): void {
  if (!factoryId.trim()) throw new Error("factoryId is required.");
}

export function assertBusinessDate(value: string, label: string): void {
  if (!isLocalDate(value)) {
    throw new Error(`${label} must be a valid YYYY-MM-DD business date.`);
  }
}

export function assertInclusiveBusinessDateRange(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): void {
  assertFactoryId(factoryId);
  assertBusinessDate(dateFrom, "dateFrom");
  assertBusinessDate(dateTo, "dateTo");
  if (dateFrom > dateTo) throw new Error("dateFrom must not be after dateTo.");
}

export function* inclusiveBusinessDates(
  dateFrom: string,
  dateTo: string,
): Generator<string> {
  let current = dateFrom;
  while (true) {
    yield current;
    if (current === dateTo) return;
    current = nextBusinessDate(current);
  }
}

function nextBusinessDate(value: string): string {
  let year = Number(value.slice(0, 4));
  let month = Number(value.slice(5, 7));
  let day = Number(value.slice(8, 10)) + 1;
  const monthLength = daysInMonth(year, month);
  if (day > monthLength) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
