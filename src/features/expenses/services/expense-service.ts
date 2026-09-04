import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { isLocalDate } from "../../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../../sales/types.ts";
import { assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import { sumFiniteNumbers } from "../../../lib/numeric-total.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";
import type {
  CreateExpensePaymentInput,
  ExpensePayment,
  ExpensePaymentAllocation,
  ExpenseRecord,
  ExpenseRecordInput,
  ExpenseRecordKind,
  ExpenseRecordPaymentState,
  ExpenseRecordStatus,
  ExpensePaymentState,
  Supplier,
  SupplierExpenseSummary,
  SupplierInput,
  UpdateExpenseRecordInput,
  UpdateSupplierInput,
} from "../types.ts";

const SUPPLIER_COLUMNS = "id, factory_id, name, address, mobile, created_at, updated_at";
const PAYMENT_COLUMNS = "id, factory_id, payment_date, amount, payment_mode, note, created_at";
const ALLOCATION_COLUMNS = "id, factory_id, payment_id, expense_record_id, allocated_amount, created_at";
const RECORD_REFERENCE_COLUMNS = "id, kind, counterparty_name_snapshot, description";

type SupplierRow = {
  id: string; factory_id: string; name: string; address: string | null;
  mobile: string | null; created_at: string; updated_at: string;
};

type ExpenseRecordRow = {
  expense_record_id: string;
  factory_id: string;
  business_date: string;
  kind: ExpenseRecordKind;
  supplier_id: string | null;
  counterparty_name_snapshot: string;
  counterparty_address_snapshot: string | null;
  counterparty_mobile_snapshot: string | null;
  description: string;
  total_amount: number | string;
  note: string | null;
  status: ExpenseRecordStatus;
  is_locked: boolean;
  total_paid: number | string;
  outstanding_amount: number | string;
  payment_state: ExpensePaymentState;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type BaseExpenseRecordRow = Omit<ExpenseRecordRow,
  "expense_record_id" | "total_paid" | "outstanding_amount" | "payment_state"
> & { id: string; factory_id: string; created_by: string; voided_by: string | null };

type ExpensePaymentRow = {
  id: string; factory_id: string; payment_date: string; amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note: string | null; created_at: string;
};

type ExpenseAllocationRow = {
  id: string; factory_id: string; payment_id: string; expense_record_id: string;
  allocated_amount: number | string; created_at: string;
};

type ExpenseReferenceRow = {
  id: string; kind: ExpenseRecordKind; counterparty_name_snapshot: string; description: string;
};

export class ExpenseServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableExpenseError(error));
    this.name = "ExpenseServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableExpenseError(error: PostgrestError): string {
  if (error.code === "P4002") return "Supplier does not belong to this factory.";
  if (error.code === "P4101") return "Allocations must exactly equal the payment amount.";
  if (error.code === "P4102") return "Expense/Purchase does not belong to this factory.";
  if (error.code === "P4103") return "A void Expense/Purchase cannot be changed or paid.";
  if (error.code === "P4104") return "A paid or partially-paid Expense/Purchase is financially locked.";
  if (error.code === "P4105") return "Allocation exceeds the Expense/Purchase outstanding amount.";
  if (error.code === "P4106") return "Expense payment history is immutable.";
  if (error.code === "P3200") return "Choose a supported payment mode.";
  if (error.code === "22023" || error.code === "23514" || error.code === "23505") {
    return "Check the date, amount, details, payment mode, and allocations.";
  }
  return error.message;
}

export async function listSuppliers(factoryId: string): Promise<Supplier[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase.from("suppliers")
    .select(SUPPLIER_COLUMNS)
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new ExpenseServiceError(error);
  return ((data ?? []) as SupplierRow[]).map(mapSupplier);
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  requireId(input.factoryId, "factoryId");
  const { name, address, mobile } = normalizeSupplier(input);
  const { data, error } = await supabase.rpc("create_supplier", {
    p_factory_id: input.factoryId,
    p_name: name,
    p_address: address,
    p_mobile: mobile,
  });
  if (error) throw new ExpenseServiceError(error);
  if (!data) throw new Error("create_supplier returned no supplier.");
  return mapSupplier(data);
}

export async function updateSupplier(input: UpdateSupplierInput): Promise<Supplier> {
  requireId(input.factoryId, "factoryId");
  requireId(input.supplierId, "supplierId");
  const { name, address, mobile } = normalizeSupplier(input);
  const { data, error } = await supabase.rpc("update_supplier", {
    p_factory_id: input.factoryId,
    p_supplier_id: input.supplierId,
    p_name: name,
    p_address: address,
    p_mobile: mobile,
  });
  if (error) throw new ExpenseServiceError(error);
  if (!data) throw new Error("update_supplier returned no supplier.");
  return mapSupplier(data);
}

export async function createExpenseRecord(input: ExpenseRecordInput): Promise<ExpenseRecord> {
  const normalized = validateExpenseRecordInput(input);
  const { data, error } = await supabase.rpc("create_expense_record", {
    p_factory_id: input.factoryId,
    p_business_date: input.businessDate,
    p_kind: input.kind,
    p_supplier_id: normalized.supplierId,
    p_counterparty_name: normalized.counterpartyName,
    p_description: normalized.description,
    p_total_amount: input.totalAmount,
    p_note: normalized.note,
  });
  if (error) throw new ExpenseServiceError(error);
  if (!data) throw new Error("create_expense_record returned no record.");
  return mapBaseExpenseRecord(data as BaseExpenseRecordRow);
}

export async function updateExpenseRecord(
  input: UpdateExpenseRecordInput,
): Promise<ExpenseRecord> {
  requireId(input.expenseRecordId, "expenseRecordId");
  const normalized = validateExpenseRecordInput(input);
  const { data, error } = await supabase.rpc("update_expense_record", {
    p_factory_id: input.factoryId,
    p_expense_record_id: input.expenseRecordId,
    p_business_date: input.businessDate,
    p_kind: input.kind,
    p_supplier_id: normalized.supplierId,
    p_counterparty_name: normalized.counterpartyName,
    p_description: normalized.description,
    p_total_amount: input.totalAmount,
    p_note: normalized.note,
  });
  if (error) throw new ExpenseServiceError(error);
  if (!data) throw new Error("update_expense_record returned no record.");
  return mapBaseExpenseRecord(data as BaseExpenseRecordRow);
}

export async function voidExpenseRecord(
  factoryId: string,
  expenseRecordId: string,
): Promise<ExpenseRecord> {
  requireId(factoryId, "factoryId");
  requireId(expenseRecordId, "expenseRecordId");
  const { data, error } = await supabase.rpc("void_expense_record", {
    p_factory_id: factoryId,
    p_expense_record_id: expenseRecordId,
  });
  if (error) throw new ExpenseServiceError(error);
  if (!data) throw new Error("void_expense_record returned no record.");
  return mapBaseExpenseRecord(data as BaseExpenseRecordRow);
}

export async function listExpenseRecords(
  factoryId: string,
  supplierId: string | null = null,
): Promise<ExpenseRecord[]> {
  requireId(factoryId, "factoryId");
  if (supplierId !== null) requireId(supplierId, "supplierId");
  const { data, error } = await supabase.rpc("list_expense_records", {
    p_factory_id: factoryId,
    p_supplier_id: supplierId,
  });
  if (error) throw new ExpenseServiceError(error);
  return ((data ?? []) as ExpenseRecordRow[]).map(mapExpenseRecord);
}

export async function getRecordedExpenseTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  const data = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase.from("expense_records")
      .select("id, total_amount")
      .eq("factory_id", factoryId)
      .eq("status", "active")
      .gte("business_date", dateFrom)
      .lte("business_date", dateTo)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data: page, error } = await query;
    if (error) throw new ExpenseServiceError(error);
    return page ?? [];
  });
  return sumFiniteNumbers(
    data.map((record) => record.total_amount),
    "Recorded Expense total",
  );
}

export async function getExpenseRecordPaymentState(
  factoryId: string,
  expenseRecordId: string,
): Promise<ExpenseRecordPaymentState> {
  requireId(factoryId, "factoryId");
  requireId(expenseRecordId, "expenseRecordId");
  const { data, error } = await supabase.rpc("get_expense_record_payment_state", {
    p_factory_id: factoryId,
    p_expense_record_id: expenseRecordId,
  });
  if (error) throw new ExpenseServiceError(error);
  const state = data?.[0];
  if (!state) throw new Error("get_expense_record_payment_state returned no state.");
  return {
    expenseRecordId: state.expense_record_id,
    status: state.status,
    kind: state.kind,
    totalAmount: Number(state.total_amount),
    totalPaid: Number(state.total_paid),
    outstandingAmount: Number(state.outstanding_amount),
    paymentState: state.payment_state,
    isLocked: state.is_locked,
  };
}

export async function getSupplierExpenseSummary(
  factoryId: string,
  supplierId: string,
): Promise<SupplierExpenseSummary> {
  requireId(factoryId, "factoryId");
  requireId(supplierId, "supplierId");
  const { data, error } = await supabase.rpc("get_supplier_expense_summary", {
    p_factory_id: factoryId,
    p_supplier_id: supplierId,
  });
  if (error) throw new ExpenseServiceError(error);
  const summary = data?.[0];
  if (!summary) throw new Error("get_supplier_expense_summary returned no summary.");
  return {
    supplierId: summary.supplier_id,
    activeRecordCount: Number(summary.active_record_count),
    totalCost: Number(summary.total_cost),
    totalPaid: Number(summary.total_paid),
    totalOutstanding: Number(summary.total_outstanding),
  };
}

export async function createExpensePayment(
  input: CreateExpensePaymentInput,
): Promise<ExpensePayment> {
  requireId(input.factoryId, "factoryId");
  assertDate(input.paymentDate, "paymentDate");
  const paymentMinorUnits = toMinorUnits(input.amount, "amount");
  if (!isNewCustomerPaymentMode(input.paymentMode)) {
    throw new Error("Choose a supported payment mode.");
  }
  validateAllocations(input.allocations, paymentMinorUnits);
  const note = normalizeOptionalText(input.note, 500, "note");
  const { data, error } = await supabase.rpc("create_expense_payment", {
    p_factory_id: input.factoryId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: note,
    p_allocations: input.allocations.map((allocation) => ({
      expense_record_id: allocation.expenseRecordId,
      amount: allocation.amount,
    })),
  });
  if (error) throw new ExpenseServiceError(error);
  if (!data) throw new Error("create_expense_payment returned no payment.");
  try {
    return mapPayment(
      data as ExpensePaymentRow,
      await listPaymentAllocations(input.factoryId, data.id),
    );
  } catch {
    // The payment RPC has already committed. Return its authoritative header and let
    // the Office history refresh recover children without inviting a duplicate retry.
    return mapPayment(data as ExpensePaymentRow, []);
  }
}

export async function listExpensePayments(
  factoryId: string,
  expenseRecordId: string | null = null,
): Promise<ExpensePayment[]> {
  requireId(factoryId, "factoryId");
  if (expenseRecordId !== null) requireId(expenseRecordId, "expenseRecordId");

  let paymentIds: string[] | null = null;
  if (expenseRecordId) {
    const { data, error } = await supabase.from("expense_payment_allocations")
      .select("payment_id")
      .eq("factory_id", factoryId)
      .eq("expense_record_id", expenseRecordId);
    if (error) throw new ExpenseServiceError(error);
    paymentIds = [...new Set((data ?? []).map((row) => row.payment_id))];
    if (paymentIds.length === 0) return [];
  }

  let query = supabase.from("expense_payments")
    .select(PAYMENT_COLUMNS)
    .eq("factory_id", factoryId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (paymentIds) query = query.in("id", paymentIds);
  const { data, error } = await query;
  if (error) throw new ExpenseServiceError(error);
  const rows = (data ?? []) as ExpensePaymentRow[];
  if (rows.length === 0) return [];
  const allocations = await listAllocationsForPayments(factoryId, rows.map((row) => row.id));
  const byPayment = new Map<string, ExpensePaymentAllocation[]>();
  for (const allocation of allocations) {
    const group = byPayment.get(allocation.paymentId) ?? [];
    group.push(allocation);
    byPayment.set(allocation.paymentId, group);
  }
  return rows.map((row) => mapPayment(row, byPayment.get(row.id) ?? []));
}

async function listPaymentAllocations(
  factoryId: string,
  paymentId: string,
): Promise<ExpensePaymentAllocation[]> {
  return listAllocationsForPayments(factoryId, [paymentId]);
}

async function listAllocationsForPayments(
  factoryId: string,
  paymentIds: string[],
): Promise<ExpensePaymentAllocation[]> {
  const { data, error } = await supabase.from("expense_payment_allocations")
    .select(ALLOCATION_COLUMNS)
    .eq("factory_id", factoryId)
    .in("payment_id", paymentIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new ExpenseServiceError(error);
  const rows = (data ?? []) as ExpenseAllocationRow[];
  if (rows.length === 0) return [];
  const recordIds = [...new Set(rows.map((row) => row.expense_record_id))];
  const { data: records, error: recordError } = await supabase.from("expense_records")
    .select(RECORD_REFERENCE_COLUMNS)
    .eq("factory_id", factoryId)
    .in("id", recordIds);
  if (recordError) throw new ExpenseServiceError(recordError);
  const references = new Map(
    ((records ?? []) as ExpenseReferenceRow[]).map((row) => [row.id, row]),
  );
  return rows.map((row) => {
    const reference = references.get(row.expense_record_id);
    if (!reference) throw new Error("Expense payment allocation source was not found.");
    return {
      id: row.id,
      factoryId: row.factory_id,
      paymentId: row.payment_id,
      expenseRecordId: row.expense_record_id,
      expenseKind: reference.kind,
      counterpartyNameSnapshot: reference.counterparty_name_snapshot,
      description: reference.description,
      allocatedAmount: Number(row.allocated_amount),
      createdAt: row.created_at,
    };
  });
}

function validateExpenseRecordInput(input: ExpenseRecordInput) {
  requireId(input.factoryId, "factoryId");
  assertDate(input.businessDate, "businessDate");
  if (input.kind !== "purchase" && input.kind !== "expense") {
    throw new Error("kind must be purchase or expense.");
  }
  toMinorUnits(input.totalAmount, "totalAmount");
  const supplierId = input.supplierId?.trim() || null;
  const counterpartyName = normalizeOptionalText(input.counterpartyName, 200, "counterpartyName");
  if (!supplierId && !counterpartyName) {
    throw new Error("counterpartyName is required when supplierId is absent.");
  }
  const description = normalizeRequiredText(input.description, 300, "description");
  const note = normalizeOptionalText(input.note, 500, "note");
  return { supplierId, counterpartyName, description, note };
}

function validateAllocations(
  allocations: CreateExpensePaymentInput["allocations"],
  paymentMinorUnits: number,
): void {
  if (allocations.length === 0 || allocations.length > 100) {
    throw new Error("A payment requires between 1 and 100 allocations.");
  }
  const ids = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    requireId(allocation.expenseRecordId, "expenseRecordId");
    if (ids.has(allocation.expenseRecordId)) {
      throw new Error("The same Expense/Purchase cannot appear twice in one payment.");
    }
    ids.add(allocation.expenseRecordId);
    total += toMinorUnits(allocation.amount, "allocation amount");
  }
  if (total !== paymentMinorUnits) {
    throw new Error("Allocations must exactly equal the payment amount.");
  }
}

function normalizeSupplier(input: SupplierInput) {
  return {
    name: normalizeRequiredText(input.name, 200, "name"),
    address: normalizeOptionalText(input.address, 500, "address"),
    mobile: normalizeOptionalText(input.mobile, 50, "mobile"),
  };
}

function normalizeRequiredText(value: string, maximum: number, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is required and must be at most ${maximum} characters.`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maximum: number,
  label: string,
): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must be at most ${maximum} characters.`);
  }
  return normalized || null;
}

function assertDate(value: string, label: string): void {
  if (!isLocalDate(value)) throw new Error(`${label} must be a valid local calendar date.`);
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function toMinorUnits(value: number, label: string): number {
  const scaled = value * 100;
  if (!Number.isFinite(value) || value <= 0
    || !Number.isSafeInteger(Math.round(scaled))
    || Math.abs(scaled - Math.round(scaled)) >= 1e-7) {
    throw new Error(`${label} must be positive and use at most two decimal places.`);
  }
  return Math.round(scaled);
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id, factoryId: row.factory_id, name: row.name,
    address: row.address, mobile: row.mobile,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapBaseExpenseRecord(row: BaseExpenseRecordRow): ExpenseRecord {
  return mapExpenseRecord({
    ...row,
    expense_record_id: row.id,
    total_paid: 0,
    outstanding_amount: row.status === "active" ? row.total_amount : 0,
    payment_state: "unpaid",
  });
}

function mapExpenseRecord(row: ExpenseRecordRow): ExpenseRecord {
  return {
    id: row.expense_record_id,
    factoryId: row.factory_id,
    businessDate: row.business_date,
    kind: row.kind,
    supplierId: row.supplier_id,
    counterpartyNameSnapshot: row.counterparty_name_snapshot,
    counterpartyAddressSnapshot: row.counterparty_address_snapshot,
    counterpartyMobileSnapshot: row.counterparty_mobile_snapshot,
    description: row.description,
    totalAmount: Number(row.total_amount),
    note: row.note,
    status: row.status,
    isLocked: row.is_locked,
    totalPaid: Number(row.total_paid),
    outstandingAmount: Number(row.outstanding_amount),
    paymentState: row.payment_state,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row: ExpensePaymentRow, allocations: ExpensePaymentAllocation[]): ExpensePayment {
  return {
    id: row.id, factoryId: row.factory_id, paymentDate: row.payment_date,
    amount: Number(row.amount), paymentMode: row.payment_mode, note: row.note,
    createdAt: row.created_at, allocations,
  };
}
