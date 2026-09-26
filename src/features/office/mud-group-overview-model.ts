import { formatDateOnly } from "../../lib/formatting.ts";
import { isLocalDate } from "../../lib/local-date.ts";

export function formatMudGroupLastPaid(
  paymentDate: string | null,
  localToday: string,
): string {
  if (paymentDate === null) return "No payments yet";
  if (!isLocalDate(paymentDate) || !isLocalDate(localToday)) {
    return "Payment date unavailable";
  }

  const dayDifference = toUtcDay(localToday) - toUtcDay(paymentDate);
  if (dayDifference === 0) return "Last paid today";
  if (dayDifference > 0 && dayDifference <= 5) {
    return `Last paid ${dayDifference} ${dayDifference === 1 ? "day" : "days"} ago`;
  }

  return `Last paid ${formatDateOnly(paymentDate)}`;
}

function toUtcDay(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
