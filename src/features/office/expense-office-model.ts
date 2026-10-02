import type {
  CreateExpensePaymentInput,
  ExpensePayment,
  ExpenseRecord,
  ExpenseRecordInput,
  ExpenseRecordKind,
  ExpenseRecordPaymentState,
  SupplierInput,
} from "../expenses/types.ts";
import { isNewCustomerPaymentMode } from "../sales/types.ts";
import {
  resolveSalesDateRange,
  type SalesDatePreset,
  type SalesDateRange,
} from "../sales/sales-register-model.ts";
import { isLocalDate } from "../../lib/local-date.ts";

export const EXPENSE_SECTION_HEADING = "Expenses & Purchases";

export type ExpenseDatePreset = SalesDatePreset;
export type ExpenseKindFilter = "all" | ExpenseRecordKind;
export type ExpenseArchiveStateFilter = "all" | ExpenseRecord["paymentState"] | "void";

export type ExpenseArchiveFilters = {
  search: string;
  fromDate: string;
  toDate: string;
  kind: ExpenseKindFilter;
  counterparty: string;
  state: ExpenseArchiveStateFilter;
};

export type ExpensePaymentArchiveFilters = {
  search: string;
  fromDate: string;
  toDate: string;
  kind: ExpenseKindFilter;
  paymentMode: ExpensePayment["paymentMode"] | "";
};

export type ExpensePaymentAllocationReconciliation = {
  allocatedAmount: number;
  remainingAmount: number;
  reconciles: boolean;
};

export type ExpenseRecordForm = {
  kind: ExpenseRecordKind;
  businessDate: string;
  supplierId: string;
  counterpartyName: string;
  description: string;
  amount: string;
  referenceNote: string;
};

export type SupplierForm = {
  name: string;
  address: string;
  mobile: string;
};

export type ExpensePaymentForm = {
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
  allocations: Record<string, string>;
};

export type ExpensePaymentFormStatus = {
  paymentAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
  canSubmit: boolean;
  error: string;
};

export type ExpenseRegisterSummary = {
  totalPurchases: number;
  totalExpenses: number;
  totalPaid: number;
  totalOutstanding: number;
};

export type ExpenseRecordEligibility = {
  canEdit: boolean;
  canVoid: boolean;
  reason: "void" | "locked" | null;
};

export function emptyExpenseRecordForm(
  localToday: string,
  kind: ExpenseRecordKind = "purchase",
): ExpenseRecordForm {
  return {
    kind,
    businessDate: localToday,
    supplierId: "",
    counterpartyName: "",
    description: "",
    amount: "",
    referenceNote: "",
  };
}

export function expenseRecordFormFromSaved(record: ExpenseRecord): ExpenseRecordForm {
  return {
    kind: record.kind,
    businessDate: record.businessDate,
    supplierId: record.supplierId ?? "",
    counterpartyName: record.supplierId ? "" : record.counterpartyNameSnapshot,
    description: record.description,
    amount: formatEditableMoney(record.totalAmount),
    referenceNote: record.note ?? "",
  };
}

export function buildExpenseRecordInput(
  factoryId: string,
  form: ExpenseRecordForm,
): ExpenseRecordInput | null {
  const amount = parseMoney(form.amount);
  const supplierId = form.supplierId.trim() || null;
  const counterpartyName = normalizeText(form.counterpartyName);
  const description = normalizeText(form.description);
  const note = normalizeText(form.referenceNote);
  if (!factoryId.trim()
    || !isLocalDate(form.businessDate)
    || (form.kind !== "purchase" && form.kind !== "expense")
    || amount === null
    || !description
    || description.length > 300
    || (!supplierId && !counterpartyName)
    || counterpartyName.length > 200
    || note.length > 500) return null;
  return {
    factoryId,
    businessDate: form.businessDate,
    kind: form.kind,
    supplierId,
    counterpartyName: supplierId ? null : counterpartyName,
    description,
    totalAmount: amount,
    note: note || null,
  };
}

export function emptySupplierForm(): SupplierForm {
  return { name: "", address: "", mobile: "" };
}

export function buildSupplierInput(
  factoryId: string,
  form: SupplierForm,
): SupplierInput | null {
  const name = normalizeText(form.name);
  const address = normalizeText(form.address);
  const mobile = normalizeText(form.mobile);
  if (!factoryId.trim() || !name || name.length > 200
    || address.length > 500 || mobile.length > 50) return null;
  return { factoryId, name, address: address || null, mobile: mobile || null };
}

export function resolveExpenseDateRange(
  preset: ExpenseDatePreset,
  localToday: string,
  customFrom = "",
  customTo = "",
): SalesDateRange | null {
  return resolveSalesDateRange(preset, localToday, customFrom, customTo);
}

export function filterExpenseRecords(
  records: readonly ExpenseRecord[],
  range: SalesDateRange | null,
  kind: ExpenseKindFilter,
): ExpenseRecord[] {
  if (!range) return [];
  return records.filter((record) => record.businessDate >= range.fromDate
    && record.businessDate <= range.toDate
    && (kind === "all" || record.kind === kind));
}

export function filterExpenseArchiveRecords(
  records: readonly ExpenseRecord[],
  filters: ExpenseArchiveFilters,
): ExpenseRecord[] {
  const search = normalizeText(filters.search).toLocaleLowerCase("en-IN");
  const counterparty = normalizeText(filters.counterparty).toLocaleLowerCase("en-IN");
  const hasInvalidDates = (filters.fromDate !== "" && !isLocalDate(filters.fromDate))
    || (filters.toDate !== "" && !isLocalDate(filters.toDate))
    || (filters.fromDate !== "" && filters.toDate !== "" && filters.fromDate > filters.toDate);
  if (hasInvalidDates) return [];

  return records.filter((record) => {
    const matchesSearch = !search || [
      record.counterpartyNameSnapshot,
      record.description,
      record.note ?? "",
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(search));
    const matchesState = filters.state === "all"
      || (filters.state === "void"
        ? record.status === "void"
        : record.status === "active" && record.paymentState === filters.state);
    return (!filters.fromDate || record.businessDate >= filters.fromDate)
      && (!filters.toDate || record.businessDate <= filters.toDate)
      && (filters.kind === "all" || record.kind === filters.kind)
      && (!counterparty || record.counterpartyNameSnapshot.toLocaleLowerCase("en-IN") === counterparty)
      && matchesState
      && matchesSearch;
  });
}

export function summarizeExpenseRecords(
  records: readonly ExpenseRecord[],
): ExpenseRegisterSummary {
  let purchasePaise = 0;
  let expensePaise = 0;
  let paidPaise = 0;
  let outstandingPaise = 0;
  for (const record of records) {
    if (record.status === "void") continue;
    if (record.kind === "purchase") purchasePaise += toPaise(record.totalAmount);
    else expensePaise += toPaise(record.totalAmount);
    paidPaise += toPaise(record.totalPaid);
    outstandingPaise += toPaise(record.outstandingAmount);
  }
  return {
    totalPurchases: purchasePaise / 100,
    totalExpenses: expensePaise / 100,
    totalPaid: paidPaise / 100,
    totalOutstanding: outstandingPaise / 100,
  };
}

export function filterExpensePayments(
  payments: readonly ExpensePayment[],
  filters: ExpensePaymentArchiveFilters,
): ExpensePayment[] {
  const search = normalizeText(filters.search).toLocaleLowerCase("en-IN");
  const hasInvalidDates = (filters.fromDate !== "" && !isLocalDate(filters.fromDate))
    || (filters.toDate !== "" && !isLocalDate(filters.toDate))
    || (filters.fromDate !== "" && filters.toDate !== "" && filters.fromDate > filters.toDate);
  if (hasInvalidDates) return [];

  return payments.filter((payment) => {
    const matchesSearch = !search || [
      payment.note ?? "",
      ...payment.allocations.flatMap((allocation) => [
        allocation.counterpartyNameSnapshot,
        allocation.description,
      ]),
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(search));
    const matchesKind = filters.kind === "all"
      || payment.allocations.some((allocation) => allocation.expenseKind === filters.kind);
    return (!filters.fromDate || payment.paymentDate >= filters.fromDate)
      && (!filters.toDate || payment.paymentDate <= filters.toDate)
      && (!filters.paymentMode || payment.paymentMode === filters.paymentMode)
      && matchesKind
      && matchesSearch;
  });
}

export function getExpensePaymentAllocationReconciliation(
  payment: Pick<ExpensePayment, "amount" | "allocations">,
): ExpensePaymentAllocationReconciliation {
  const paymentPaise = toPaise(payment.amount);
  const allocatedPaise = payment.allocations.reduce(
    (total, allocation) => total + toPaise(allocation.allocatedAmount),
    0,
  );
  return {
    allocatedAmount: allocatedPaise / 100,
    remainingAmount: (paymentPaise - allocatedPaise) / 100,
    reconciles: paymentPaise === allocatedPaise,
  };
}

export function getExpenseRecordEligibility(
  record: Pick<ExpenseRecord, "status" | "isLocked" | "totalPaid">,
): ExpenseRecordEligibility {
  if (record.status === "void") {
    return { canEdit: false, canVoid: false, reason: "void" };
  }
  if (record.isLocked || record.totalPaid > 0) {
    return { canEdit: false, canVoid: false, reason: "locked" };
  }
  return { canEdit: true, canVoid: true, reason: null };
}

export function getExpensePaymentCandidates(
  records: readonly ExpenseRecord[],
): ExpenseRecord[] {
  return records.filter((record) => record.status === "active" && record.outstandingAmount > 0);
}

export function emptyExpensePaymentForm(localToday: string): ExpensePaymentForm {
  return { paymentDate: localToday, amount: "", paymentMode: "", note: "", allocations: {} };
}

export function setExpensePaymentAmount(
  form: ExpensePaymentForm,
  amount: string,
): ExpensePaymentForm {
  const selectedRecordIds = Object.keys(form.allocations);
  if (selectedRecordIds.length !== 1) return { ...form, amount };
  return {
    ...form,
    amount,
    allocations: { [selectedRecordIds[0]!]: amount },
  };
}

export function toggleExpensePaymentAllocation(
  form: ExpensePaymentForm,
  record: ExpenseRecord,
  selected: boolean,
): ExpensePaymentForm {
  const allocations = { ...form.allocations };
  if (selected) allocations[record.id] = formatEditableMoney(record.outstandingAmount);
  else delete allocations[record.id];
  return { ...form, amount: formatExpenseAllocationTotal(allocations), allocations };
}

export function setExpensePaymentAllocation(
  form: ExpensePaymentForm,
  expenseRecordId: string,
  amount: string,
): ExpensePaymentForm {
  if (!Object.prototype.hasOwnProperty.call(form.allocations, expenseRecordId)) return form;
  const allocations = { ...form.allocations, [expenseRecordId]: amount };
  return { ...form, amount: formatExpenseAllocationTotal(allocations), allocations };
}

export function getExpensePaymentFormStatus(
  form: ExpensePaymentForm,
  candidates: readonly ExpenseRecord[],
): ExpensePaymentFormStatus {
  const paymentPaise = parseMoneyToPaise(form.amount);
  const selected = Object.entries(form.allocations);
  let allocatedPaise = 0;
  let error = "";
  if (!isLocalDate(form.paymentDate)) error = "Choose a valid payment date.";
  else if (!isNewCustomerPaymentMode(form.paymentMode)) error = "Choose a payment mode.";
  else if (normalizeText(form.note).length > 500) error = "Reference / note must be at most 500 characters.";
  else if (paymentPaise === null) error = "Enter a payment amount greater than zero.";
  else if (selected.length === 0) error = "Select at least one Expense/Purchase.";

  const candidatesById = new Map(candidates.map((record) => [record.id, record]));
  for (const [recordId, rawAmount] of selected) {
    const record = candidatesById.get(recordId);
    const allocationPaise = parseMoneyToPaise(rawAmount);
    if (!record && !error) error = "A selected Expense/Purchase is no longer payable.";
    else if (allocationPaise === null && !error) {
      error = "Every selected record needs an allocation greater than zero.";
    } else if (record && allocationPaise !== null
      && allocationPaise > toPaise(record.outstandingAmount) && !error) {
      error = `Allocation for ${record.description} exceeds its outstanding amount.`;
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

export function buildExpensePaymentInput(
  factoryId: string,
  form: ExpensePaymentForm,
  candidates: readonly ExpenseRecord[],
): CreateExpensePaymentInput | null {
  if (!factoryId.trim()) return null;
  const status = getExpensePaymentFormStatus(form, candidates);
  if (!status.canSubmit) return null;
  return {
    factoryId,
    paymentDate: form.paymentDate,
    amount: status.paymentAmount,
    paymentMode: form.paymentMode as CreateExpensePaymentInput["paymentMode"],
    note: normalizeText(form.note) || null,
    allocations: Object.entries(form.allocations).map(([expenseRecordId, amount]) => ({
      expenseRecordId,
      amount: parseMoneyToPaise(amount)! / 100,
    })),
  };
}

export function applyExpensePaymentStates(
  records: readonly ExpenseRecord[],
  states: readonly ExpenseRecordPaymentState[],
): ExpenseRecord[] {
  const statesById = new Map(states.map((state) => [state.expenseRecordId, state]));
  return records.map((record) => {
    const state = statesById.get(record.id);
    return state ? {
      ...record,
      status: state.status,
      kind: state.kind,
      totalAmount: state.totalAmount,
      totalPaid: state.totalPaid,
      outstandingAmount: state.outstandingAmount,
      paymentState: state.paymentState,
      isLocked: state.isLocked,
    } : record;
  });
}

export function getPaymentsForExpenseRecord(
  payments: readonly ExpensePayment[],
  expenseRecordId: string,
): ExpensePayment[] {
  return payments.filter((payment) => payment.allocations.some(
    (allocation) => allocation.expenseRecordId === expenseRecordId,
  ));
}

export function expenseKindLabel(kind: ExpenseRecordKind): string {
  return kind === "purchase" ? "Purchase" : "Expense";
}

export function expensePaymentStateLabel(state: ExpenseRecord["paymentState"]): string {
  if (state === "partially_paid") return "Partial";
  if (state === "paid") return "Paid";
  return "Unpaid";
}

export function expenseOfficeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseMoney(value: string): number | null {
  const paise = parseMoneyToPaise(value);
  return paise === null ? null : paise / 100;
}

function parseMoneyToPaise(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const paise = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function toPaise(value: number): number {
  return Math.round(value * 100);
}

function formatEditableMoney(amount: number): string {
  return amount.toFixed(2).replace(/\.00$/, "");
}

function formatExpenseAllocationTotal(
  allocations: Readonly<Record<string, string>>,
): string {
  const values = Object.values(allocations);
  if (values.length === 0) return "";
  let totalPaise = 0;
  for (const value of values) {
    const paise = parseMoneyToPaise(value);
    if (paise === null) return "";
    totalPaise += paise;
    if (!Number.isSafeInteger(totalPaise)) return "";
  }
  return formatEditableMoney(totalPaise / 100);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
