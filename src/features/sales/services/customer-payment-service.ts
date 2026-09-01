import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  ChallanPaymentSummary,
  CreateCustomerPaymentInput,
  CustomerPayment,
  CustomerPaymentAllocation,
  CustomerPaymentAllocationInput,
  CustomerOutstandingChallan,
  CustomerSalesSummary,
} from "../types.ts";
import { isNewCustomerPaymentMode } from "../types.ts";

const PAYMENT_COLUMNS =
  "id, factory_id, customer_id, customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot, company_name_snapshot, company_business_description_snapshot, company_address_snapshot, company_mobile_snapshot, payment_date, amount, payment_mode, note, created_at";
const ALLOCATION_COLUMNS =
  "id, factory_id, payment_id, challan_id, allocated_amount, created_at";

type CustomerPaymentRow = {
  id: string;
  factory_id: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_address_snapshot: string;
  customer_mobile_snapshot: string;
  company_name_snapshot: string;
  company_business_description_snapshot: string;
  company_address_snapshot: string;
  company_mobile_snapshot: string;
  payment_date: string;
  amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
  note: string | null;
  created_at: string;
};

type CustomerPaymentAllocationRow = {
  id: string;
  factory_id: string;
  payment_id: string;
  challan_id: string;
  allocated_amount: number | string;
  created_at: string;
};

type ChallanNumberRow = { id: string; challan_number: number | string };

type OutstandingChallanRow = ChallanNumberRow & {
  challan_date: string;
  challan_total: number | string;
  status: "active" | "void";
  is_locked: boolean;
};

export class CustomerPaymentServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableCustomerPaymentError(error));
    this.name = "CustomerPaymentServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableCustomerPaymentError(error: PostgrestError): string {
  if (error.code === "P3002") return "Customer does not belong to this factory.";
  if (error.code === "P3101") return "Allocations must exactly equal the payment amount.";
  if (error.code === "P3102") return "Challan does not belong to this factory.";
  if (error.code === "P3103") return "Challan does not belong to this customer.";
  if (error.code === "P3104") return "A void Challan cannot receive a payment.";
  if (error.code === "P3105") return "Allocation exceeds the Challan outstanding amount.";
  if (error.code === "P3106") return "Customer payment history is immutable.";
  if (error.code === "P3010") return "Complete the printable factory profile before recording a customer payment.";
  if (error.code === "22023" || error.code === "23514" || error.code === "23505") {
    return "Check the payment date, amount, note, and Challan allocations.";
  }
  return error.message;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertCanonicalPaymentDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("paymentDate must be a valid YYYY-MM-DD date.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("paymentDate must be a valid YYYY-MM-DD date.");
  }
}

function toMinorUnits(value: number, label: string): number {
  const scaled = value * 100;
  if (!Number.isFinite(value)
    || value <= 0
    || !Number.isSafeInteger(Math.round(scaled))
    || Math.abs(scaled - Math.round(scaled)) >= 1e-7) {
    throw new Error(`${label} must be positive and use at most two decimal places.`);
  }
  return Math.round(scaled);
}

function normalizeNote(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (normalized.length > 500) throw new Error("note must be at most 500 characters.");
  return normalized || null;
}

function requireNewPaymentMode(value: string): void {
  if (!isNewCustomerPaymentMode(value)) {
    throw new Error("Choose a supported payment mode.");
  }
}

function validateAllocations(
  allocations: CustomerPaymentAllocationInput[],
  paymentMinorUnits: number,
): void {
  if (allocations.length === 0 || allocations.length > 100) {
    throw new Error("A payment requires between 1 and 100 allocations.");
  }

  const seenChallanIds = new Set<string>();
  let allocationMinorUnits = 0;
  for (const allocation of allocations) {
    requireId(allocation.challanId, "challanId");
    if (seenChallanIds.has(allocation.challanId)) {
      throw new Error("The same Challan cannot appear twice in one payment.");
    }
    seenChallanIds.add(allocation.challanId);
    allocationMinorUnits += toMinorUnits(allocation.amount, "allocation amount");
  }

  if (allocationMinorUnits !== paymentMinorUnits) {
    throw new Error("Allocations must exactly equal the payment amount.");
  }
}

function mapAllocation(
  row: CustomerPaymentAllocationRow,
  challanNumbers: ReadonlyMap<string, number>,
): CustomerPaymentAllocation {
  const challanNumber = challanNumbers.get(row.challan_id);
  if (challanNumber === undefined) throw new Error("Payment allocation Challan was not found.");
  return {
    id: row.id,
    factoryId: row.factory_id,
    paymentId: row.payment_id,
    challanId: row.challan_id,
    challanNumber,
    allocatedAmount: Number(row.allocated_amount),
    createdAt: row.created_at,
  };
}

function mapPayment(
  row: CustomerPaymentRow,
  allocations: CustomerPaymentAllocation[],
): CustomerPayment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    customerId: row.customer_id,
    customerNameSnapshot: row.customer_name_snapshot,
    customerAddressSnapshot: row.customer_address_snapshot,
    customerMobileSnapshot: row.customer_mobile_snapshot,
    companyNameSnapshot: row.company_name_snapshot,
    companyBusinessDescriptionSnapshot: row.company_business_description_snapshot,
    companyAddressSnapshot: row.company_address_snapshot,
    companyMobileSnapshot: row.company_mobile_snapshot,
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    note: row.note,
    createdAt: row.created_at,
    allocations,
  };
}

async function listPaymentAllocations(
  factoryId: string,
  paymentId: string,
): Promise<CustomerPaymentAllocation[]> {
  const { data, error } = await supabase
    .from("customer_payment_allocations")
    .select(ALLOCATION_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new CustomerPaymentServiceError(error);
  return attachChallanNumbers(factoryId, (data ?? []) as CustomerPaymentAllocationRow[]);
}

async function attachChallanNumbers(
  factoryId: string,
  rows: CustomerPaymentAllocationRow[],
): Promise<CustomerPaymentAllocation[]> {
  if (rows.length === 0) return [];
  const challanIds = [...new Set(rows.map((row) => row.challan_id))];
  const { data, error } = await supabase
    .from("challans")
    .select("id, challan_number")
    .eq("factory_id", factoryId)
    .in("id", challanIds);
  if (error) throw new CustomerPaymentServiceError(error);
  const challanNumbers = new Map(
    ((data ?? []) as ChallanNumberRow[]).map((row) => [row.id, Number(row.challan_number)]),
  );
  return rows.map((row) => mapAllocation(row, challanNumbers));
}

export async function createCustomerPayment(
  input: CreateCustomerPaymentInput,
): Promise<CustomerPayment> {
  requireId(input.factoryId, "factoryId");
  requireId(input.customerId, "customerId");
  assertCanonicalPaymentDate(input.paymentDate);
  const paymentMinorUnits = toMinorUnits(input.amount, "amount");
  requireNewPaymentMode(input.paymentMode);
  validateAllocations(input.allocations, paymentMinorUnits);
  const note = normalizeNote(input.note);

  const { data, error } = await supabase.rpc("create_customer_payment", {
    p_factory_id: input.factoryId,
    p_customer_id: input.customerId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: note,
    p_allocations: input.allocations.map((allocation) => ({
      challan_id: allocation.challanId,
      amount: allocation.amount,
    })),
  });

  if (error) throw new CustomerPaymentServiceError(error);
  if (!data) throw new Error("create_customer_payment returned no payment.");
  const allocations = await listPaymentAllocations(input.factoryId, data.id);
  return mapPayment(data, allocations);
}

export async function getChallanPaymentState(
  factoryId: string,
  challanId: string,
): Promise<ChallanPaymentSummary> {
  requireId(factoryId, "factoryId");
  requireId(challanId, "challanId");
  const { data, error } = await supabase.rpc("get_challan_payment_state", {
    p_factory_id: factoryId,
    p_challan_id: challanId,
  });

  if (error) throw new CustomerPaymentServiceError(error);
  const state = data?.[0];
  if (!state) throw new Error("get_challan_payment_state returned no state.");
  return {
    challanId: state.challan_id,
    challanStatus: state.challan_status,
    saleTotal: Number(state.sale_total),
    totalPaid: Number(state.total_paid),
    outstandingAmount: Number(state.outstanding_amount),
    paymentState: state.payment_state,
  };
}

export async function getCustomerSalesSummary(
  factoryId: string,
  customerId: string,
): Promise<CustomerSalesSummary> {
  requireId(factoryId, "factoryId");
  requireId(customerId, "customerId");
  const { data, error } = await supabase.rpc("get_customer_sales_summary", {
    p_factory_id: factoryId,
    p_customer_id: customerId,
  });

  if (error) throw new CustomerPaymentServiceError(error);
  const summary = data?.[0];
  if (!summary) throw new Error("get_customer_sales_summary returned no summary.");
  return {
    customerId: summary.customer_id,
    totalActiveSales: Number(summary.total_active_sales),
    totalPaymentsAllocated: Number(summary.total_payments_allocated),
    totalOutstanding: Number(summary.total_outstanding),
  };
}

export async function listCustomerPayments(
  factoryId: string,
  customerId: string,
): Promise<CustomerPayment[]> {
  requireId(factoryId, "factoryId");
  requireId(customerId, "customerId");

  const { data: paymentRows, error: paymentError } = await supabase
    .from("customer_payments")
    .select(PAYMENT_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("customer_id", customerId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (paymentError) throw new CustomerPaymentServiceError(paymentError);
  if (!paymentRows?.length) return [];

  const paymentIds = paymentRows.map((payment) => payment.id);
  const { data: allocationRows, error: allocationError } = await supabase
    .from("customer_payment_allocations")
    .select(ALLOCATION_COLUMNS)
    .eq("factory_id", factoryId)
    .in("payment_id", paymentIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (allocationError) throw new CustomerPaymentServiceError(allocationError);
  const allocations = await attachChallanNumbers(
    factoryId,
    (allocationRows ?? []) as CustomerPaymentAllocationRow[],
  );
  const allocationsByPayment = new Map<string, CustomerPaymentAllocation[]>();
  for (const allocation of allocations) {
    const allocations = allocationsByPayment.get(allocation.paymentId) ?? [];
    allocations.push(allocation);
    allocationsByPayment.set(allocation.paymentId, allocations);
  }

  return paymentRows.map((payment) => mapPayment(
    payment,
    allocationsByPayment.get(payment.id) ?? [],
  ));
}

export async function getCustomerPayment(
  factoryId: string,
  paymentId: string,
): Promise<CustomerPayment> {
  requireId(factoryId, "factoryId");
  requireId(paymentId, "paymentId");
  const { data, error } = await supabase
    .from("customer_payments")
    .select(PAYMENT_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("id", paymentId);
  if (error) throw new CustomerPaymentServiceError(error);
  const payment = (data?.[0] ?? null) as CustomerPaymentRow | null;
  if (!payment) throw new Error("Customer payment was not found.");
  return mapPayment(payment, await listPaymentAllocations(factoryId, paymentId));
}

export async function listCustomerOutstandingChallans(
  factoryId: string,
  customerId: string,
): Promise<CustomerOutstandingChallan[]> {
  requireId(factoryId, "factoryId");
  requireId(customerId, "customerId");
  const { data, error } = await supabase
    .from("challans")
    .select("id, challan_number, challan_date, challan_total, status, is_locked")
    .eq("factory_id", factoryId)
    .eq("customer_id", customerId)
    .eq("status", "active")
    .order("challan_date", { ascending: true })
    .order("challan_number", { ascending: true });
  if (error) throw new CustomerPaymentServiceError(error);

  const rows = (data ?? []) as OutstandingChallanRow[];
  const states = await Promise.all(rows.map((row) => getChallanPaymentState(factoryId, row.id)));
  return rows.flatMap((row, index) => {
    const state = states[index];
    if (!state || state.challanStatus !== "active" || state.outstandingAmount <= 0) return [];
    return [{
      ...state,
      challanNumber: Number(row.challan_number),
      challanDate: row.challan_date,
      isLocked: row.is_locked,
    }];
  });
}
