import type { StaffPayment, StaffWorker } from "@/features/staff/types";
import type { WageEarningsDateRange } from "../wages/wage-earnings-date-range.ts";
import { formatDateOnly } from "../../lib/formatting.ts";
import { isLocalDate } from "../../lib/local-date.ts";

export const STAFF_SECTION_HEADING = "Staff";

export type StaffWorkerLifecycleFilter = "all" | "active" | "archived";

export function filterStaffOverviewWorkers(input: Readonly<{
  workers: readonly StaffWorker[];
  categoryNames: ReadonlyMap<string, string>;
  lifecycle: StaffWorkerLifecycleFilter;
  search: string;
}>): StaffWorker[] {
  const search = input.search.trim().toLocaleLowerCase("en-IN");

  return input.workers.filter((worker) => {
    if (input.lifecycle === "active" && !worker.isActive) return false;
    if (input.lifecycle === "archived" && worker.isActive) return false;
    if (!search) return true;

    const categoryName = input.categoryNames.get(worker.staffCategoryId) ?? "";
    return `${worker.name} ${categoryName}`.toLocaleLowerCase("en-IN").includes(search);
  });
}

export function sumStaffPaymentsInRange(
  payments: readonly StaffPayment[],
  range: WageEarningsDateRange,
): number {
  return payments.reduce(
    (total, payment) => payment.paymentDate >= range.fromDate
      && payment.paymentDate <= range.toDate
      ? total + payment.amount
      : total,
    0,
  );
}

export function latestStaffPayment(
  payments: readonly StaffPayment[],
): StaffPayment | null {
  return payments.reduce<StaffPayment | null>((latest, payment) => {
    if (!latest) return payment;
    return payment.paymentDate > latest.paymentDate
      || (payment.paymentDate === latest.paymentDate && payment.createdAt > latest.createdAt)
      ? payment
      : latest;
  }, null);
}

export function formatStaffLastPaid(
  paymentDate: string | null,
  localToday: string,
): string {
  if (!paymentDate) return "No payments yet";
  if (!isLocalDate(paymentDate) || !isLocalDate(localToday)) {
    return "Last paid date unavailable";
  }
  if (paymentDate > localToday) {
    return `Last paid ${formatDateOnly(paymentDate)}`;
  }

  const elapsedDays = daysBetween(paymentDate, localToday);
  if (elapsedDays === 0) return "Paid today";
  if (elapsedDays === 1) return "Last paid 1 day ago";
  if (elapsedDays < 7) return `Last paid ${elapsedDays} days ago`;
  if (elapsedDays < 14) return "Last paid 1 week ago";
  if (elapsedDays < 30) return `Last paid ${Math.floor(elapsedDays / 7)} weeks ago`;
  if (elapsedDays < 60) return "Last paid 1 month ago";
  return `Last paid ${formatDateOnly(paymentDate)}`;
}

export function getStaffInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toLocaleUpperCase("en-IN") || "S";
}

export function buildStaffCategoryCreateInput(factoryId: string, name: string) {
  const trimmedName = name.trim();
  return factoryId && trimmedName ? { factoryId, name: trimmedName } : null;
}

export function buildStaffCategoryUpdateInput(
  factoryId: string,
  staffCategoryId: string,
  name: string,
) {
  const trimmedName = name.trim();
  return factoryId && staffCategoryId && trimmedName
    ? { factoryId, staffCategoryId, name: trimmedName }
    : null;
}

export function buildStaffWorkerCreateInput(input: Readonly<{
  factoryId: string;
  name: string;
  staffCategoryId: string;
  referenceSalary: string;
}>) {
  const name = input.name.trim();
  const referenceSalary = Number(input.referenceSalary);
  if (
    !input.factoryId || !name || !input.staffCategoryId
    || !input.referenceSalary.trim()
    || !Number.isFinite(referenceSalary) || referenceSalary <= 0
  ) return null;

  return {
    factoryId: input.factoryId,
    name,
    staffCategoryId: input.staffCategoryId,
    referenceSalary,
  };
}

export function buildStaffReferenceSalaryInput(input: Readonly<{
  factoryId: string;
  staffWorkerId: string;
  referenceSalary: string;
}>) {
  const referenceSalary = Number(input.referenceSalary);
  if (
    !input.factoryId || !input.staffWorkerId || !input.referenceSalary.trim()
    || !Number.isFinite(referenceSalary) || referenceSalary <= 0
  ) return null;

  return {
    factoryId: input.factoryId,
    staffWorkerId: input.staffWorkerId,
    referenceSalary,
  };
}

export function buildStaffPaymentInput(input: Readonly<{
  factoryId: string;
  staffWorkerId: string;
  paymentDate: string;
  amount: string;
  note: string;
}>) {
  const amount = Number(input.amount);
  if (
    !input.factoryId || !input.staffWorkerId || !isCanonicalDate(input.paymentDate)
    || !input.amount.trim() || !Number.isFinite(amount) || amount <= 0
  ) return null;

  return {
    factoryId: input.factoryId,
    staffWorkerId: input.staffWorkerId,
    paymentDate: input.paymentDate,
    amount,
    note: input.note.trim() || null,
  };
}

export function formatStaffMoney(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatStaffReferenceSalary(referenceSalary: number): string {
  return formatStaffMoney(referenceSalary);
}

export function formatStaffPaymentDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function insertStaffPaymentNewestFirst(
  payments: readonly StaffPayment[],
  payment: StaffPayment,
): StaffPayment[] {
  return [...payments.filter((item) => item.id !== payment.id), payment].sort(
    (left, right) => right.paymentDate.localeCompare(left.paymentDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id),
  );
}

export function splitStaffWorkers(workers: readonly StaffWorker[]): {
  active: StaffWorker[];
  archived: StaffWorker[];
} {
  return {
    active: workers.filter((worker) => worker.isActive),
    archived: workers.filter((worker) => !worker.isActive),
  };
}

export function staffOfficeErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  if (code === "23505") return "That Staff category name is already in use for this factory.";
  if (code === "P2540") {
    return "This Staff member has payment history and cannot be deleted. Archive them instead.";
  }
  if (code === "P2570") {
    return "This category is assigned to Staff members and cannot be deleted.";
  }
  if (code === "P2560") return "This Staff member is already archived.";
  if (code === "P2561") return "This Staff member is already active.";
  if (code === "P2562") return "Restore this Staff member before recording a new payment.";
  if (code === "22023" && /payment_date|future|current business date/i.test(message)) {
    return "Payment date cannot be in the future.";
  }
  if (code === "22023") return "Enter a positive amount and check the required fields.";
  if (code === "42501" || code === "401" || code === "P2502") {
    return "You do not have access to manage this Staff member.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.UTC(
    Number(fromDate.slice(0, 4)),
    Number(fromDate.slice(5, 7)) - 1,
    Number(fromDate.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toDate.slice(0, 4)),
    Number(toDate.slice(5, 7)) - 1,
    Number(toDate.slice(8, 10)),
  );
  return Math.floor((to - from) / 86_400_000);
}
