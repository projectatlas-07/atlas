import type {
  ChallanHeader,
  ChallanPaymentState,
  CreateCustomerPaymentInput,
  CustomerOutstandingChallan,
  CustomerPayment,
} from "@/features/sales/types";
import { isNewCustomerPaymentMode } from "../sales/types.ts";

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
      error = `Allocation for Challan #${challan.challanNumber} exceeds its outstanding amount.`;
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

export function customerPaymentStateLabel(state: ChallanPaymentState): string {
  if (state === "partially_paid") return "Partial";
  if (state === "paid") return "Paid";
  return "Unpaid";
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
