import type {
  VehicleWageAccountSummary,
  VehicleWagePayment,
} from "../sales/vehicle-wage-model.ts";
import { formatDateOnly } from "../../lib/formatting.ts";
import { isLocalDate } from "../../lib/local-date.ts";

export type VehicleWageLifecycleFilter = "all" | "active" | "archived";

export function filterVehicleWageOverviewAccounts(input: Readonly<{
  accounts: readonly VehicleWageAccountSummary[];
  lifecycle: VehicleWageLifecycleFilter;
  search: string;
}>): VehicleWageAccountSummary[] {
  const search = input.search.trim().toLocaleLowerCase("en-IN");
  return input.accounts.filter((account) => {
    if (input.lifecycle === "active" && !account.isActive) return false;
    if (input.lifecycle === "archived" && account.isActive) return false;
    return !search || account.vehicleNumber.toLocaleLowerCase("en-IN").includes(search);
  });
}

export function latestEffectiveVehicleWagePayment(
  payments: readonly VehicleWagePayment[],
): VehicleWagePayment | null {
  return payments.reduce<VehicleWagePayment | null>((latest, payment) => {
    if (payment.reversal) return latest;
    if (!latest) return payment;
    return payment.paymentDate > latest.paymentDate
      || (payment.paymentDate === latest.paymentDate && payment.createdAt > latest.createdAt)
      ? payment
      : latest;
  }, null);
}

export function formatVehicleWageLastPaid(
  paymentDate: string | null,
  localToday: string,
): string {
  if (!paymentDate) return "No payments yet";
  if (!isLocalDate(paymentDate) || !isLocalDate(localToday)) {
    return "Last paid date unavailable";
  }
  if (paymentDate > localToday) return `Last paid ${formatDateOnly(paymentDate)}`;

  const elapsedDays = toUtcDay(localToday) - toUtcDay(paymentDate);
  if (elapsedDays === 0) return "Paid today";
  if (elapsedDays === 1) return "Last paid 1 day ago";
  if (elapsedDays < 7) return `Last paid ${elapsedDays} days ago`;
  if (elapsedDays < 14) return "Last paid 1 week ago";
  if (elapsedDays < 30) return `Last paid ${Math.floor(elapsedDays / 7)} weeks ago`;
  if (elapsedDays < 60) return "Last paid 1 month ago";
  return `Last paid ${formatDateOnly(paymentDate)}`;
}

function toUtcDay(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
