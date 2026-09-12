import type {
  ChallanHeader,
  CreateCustomerPaymentInput,
  CustomerOutstandingChallan,
  CustomerPayment,
} from "@/features/sales/types";
import { isLocalDate, shiftLocalDate } from "../../lib/local-date.ts";
import { formatChallanLabel, isNewCustomerPaymentMode } from "../sales/types.ts";

export type CustomerPaymentForm = {
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
  allocations: Record<string, string>;
};

export type CustomerPaymentFormStatus = {
  paymentAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
  canSubmit: boolean;
  error: string;
};

export type CustomerDuesSortOrder = "newest" | "oldest";
export type CustomerDuesDatePreset = "all" | "today" | "yesterday" | "week" | "month" | "custom";

export type CustomerDuesDateRange = {
  fromDate: string;
  toDate: string;
};

export type CustomerDuesDateFilter = {
  range: CustomerDuesDateRange | null;
  error: string;
};

export function resolveCustomerDuesDateFilter(
  preset: CustomerDuesDatePreset,
  localToday: string,
  customFrom = "",
  customTo = "",
): CustomerDuesDateFilter {
  if (!isLocalDate(localToday)) {
    return { range: null, error: "Current local date is invalid." };
  }
  if (preset === "all") return { range: null, error: "" };
  if (preset === "today") {
    return { range: { fromDate: localToday, toDate: localToday }, error: "" };
  }
  if (preset === "yesterday") {
    const yesterday = shiftLocalDate(localToday, -1)!;
    return { range: { fromDate: yesterday, toDate: yesterday }, error: "" };
  }
  if (preset === "week") {
    const [year, month, day] = localToday.split("-").map(Number);
    const weekday = new Date(year!, month! - 1, day!, 12).getDay();
    const fromDate = shiftLocalDate(localToday, -((weekday + 6) % 7))!;
    return { range: { fromDate, toDate: shiftLocalDate(fromDate, 6)! }, error: "" };
  }
  if (preset === "month") {
    const [year, month] = localToday.split("-").map(Number);
    const nextMonthFirst = month === 12
      ? `${year! + 1}-01-01`
      : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
    return {
      range: {
        fromDate: `${localToday.slice(0, 7)}-01`,
        toDate: shiftLocalDate(nextMonthFirst, -1)!,
      },
      error: "",
    };
  }
  if (!customFrom || !customTo) {
    return { range: null, error: "Choose both From and To dates." };
  }
  if (!isLocalDate(customFrom) || !isLocalDate(customTo)) {
    return { range: null, error: "Choose valid From and To dates." };
  }
  if (customFrom > customTo) {
    return { range: null, error: "From date cannot be after To date." };
  }
  return { range: { fromDate: customFrom, toDate: customTo }, error: "" };
}

export function sortCustomerOutstandingChallans(
  challans: readonly CustomerOutstandingChallan[],
  sortOrder: CustomerDuesSortOrder,
): CustomerOutstandingChallan[] {
  const direction = sortOrder === "newest" ? -1 : 1;
  return [...challans].sort((left, right) => direction * (
    left.challanDate.localeCompare(right.challanDate)
      || left.createdAt.localeCompare(right.createdAt)
      || left.challanId.localeCompare(right.challanId)
  ));
}

export function clearCustomerPaymentAllocations(
  form: CustomerPaymentForm,
): CustomerPaymentForm {
  return Object.keys(form.allocations).length === 0
    ? form
    : { ...form, allocations: {} };
}

export function emptyCustomerPaymentForm(localToday: string): CustomerPaymentForm {
  return { paymentDate: localToday, amount: "", paymentMode: "", note: "", allocations: {} };
}

export function setPaymentAmount(
  form: CustomerPaymentForm,
  amount: string,
): CustomerPaymentForm {
  return { ...form, amount };
}

export function togglePaymentAllocation(
  form: CustomerPaymentForm,
  challanId: string,
  selected: boolean,
): CustomerPaymentForm {
  const allocations = { ...form.allocations };
  if (selected) allocations[challanId] = allocations[challanId] ?? "";
  else delete allocations[challanId];
  return { ...form, allocations };
}

export function fillOutstandingAllocation(
  form: CustomerPaymentForm,
  challan: CustomerOutstandingChallan,
): CustomerPaymentForm {
  return {
    ...form,
    allocations: {
      ...form.allocations,
      [challan.challanId]: formatEditableMoney(challan.outstandingAmount),
    },
  };
}

export function getCustomerPaymentFormStatus(
  form: CustomerPaymentForm,
  challans: readonly CustomerOutstandingChallan[],
): CustomerPaymentFormStatus {
  const paymentPaise = parseMoneyToPaise(form.amount);
  const selected = Object.entries(form.allocations);
  let allocatedPaise = 0;
  let error = "";

  if (!isCanonicalDate(form.paymentDate)) error = "Choose a valid payment date.";
  else if (!isNewCustomerPaymentMode(form.paymentMode)) error = "Choose a payment mode.";
  else if (paymentPaise === null) error = "Enter a payment amount greater than zero.";
  else if (selected.length === 0) error = "Select at least one Challan to allocate this payment.";

  const challansById = new Map(challans.map((challan) => [challan.challanId, challan]));
  for (const [challanId, rawAmount] of selected) {
    const challan = challansById.get(challanId);
    const allocationPaise = parseMoneyToPaise(rawAmount);
    if (!challan && !error) error = "A selected Challan is no longer available.";
    else if (allocationPaise === null && !error) error = "Every selected Challan needs an allocation greater than zero.";
    else if (challan && allocationPaise !== null
      && allocationPaise > Math.round(challan.outstandingAmount * 100) && !error) {
      error = `Allocation for ${formatChallanLabel(challan.challanNumber)} exceeds its outstanding amount.`;
    }
    if (allocationPaise !== null) allocatedPaise += allocationPaise;
  }

  const safePaymentPaise = paymentPaise ?? 0;
  const remainingPaise = safePaymentPaise - allocatedPaise;
  if (!error && remainingPaise !== 0) {
    error = remainingPaise > 0
      ? "Allocate the full payment amount before saving."
      : "Allocated amount cannot exceed the payment amount.";
  }

  return {
    paymentAmount: safePaymentPaise / 100,
    allocatedAmount: allocatedPaise / 100,
    remainingAmount: remainingPaise / 100,
    canSubmit: !error && paymentPaise !== null && selected.length > 0,
    error,
  };
}

export function buildCustomerPaymentInput(
  factoryId: string,
  customerId: string,
  form: CustomerPaymentForm,
  challans: readonly CustomerOutstandingChallan[],
): CreateCustomerPaymentInput | null {
  if (!factoryId || !customerId) return null;
  const status = getCustomerPaymentFormStatus(form, challans);
  if (!status.canSubmit) return null;
  return {
    factoryId,
    customerId,
    paymentDate: form.paymentDate,
    amount: status.paymentAmount,
    paymentMode: form.paymentMode as CreateCustomerPaymentInput["paymentMode"],
    note: form.note,
    allocations: Object.entries(form.allocations).map(([challanId, amount]) => ({
      challanId,
      amount: parseMoneyToPaise(amount)! / 100,
    })),
  };
}

export function applyPaymentLocks(
  challans: readonly ChallanHeader[],
  payment: CustomerPayment,
): ChallanHeader[] {
  const affected = new Set(payment.allocations.map((allocation) => allocation.challanId));
  return challans.map((challan) => affected.has(challan.id) && !challan.isLocked
    ? { ...challan, isLocked: true }
    : challan);
}

function parseMoneyToPaise(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  const paise = Math.round(amount * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function formatEditableMoney(amount: number): string {
  return amount.toFixed(2).replace(/\.00$/, "");
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
