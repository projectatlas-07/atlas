import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  ChallanPaymentSummary,
  CreateCustomerPaymentInput,
  CreateCustomerPaymentWithMethodsInput,
  CustomerPayment,
  CustomerPaymentHeader,
  CustomerPaymentResult,
  CustomerPaymentAllocation,
  CustomerPaymentAllocationInput,
  CustomerPaymentMethod,
  CustomerPaymentMethodMode,
  CustomerOutstandingChallan,
  CustomerSalesSummary,
} from "../types.ts";
import { CustomerPaymentUnknownOutcomeError, isCustomerPaymentId, isNewCustomerPaymentMode } from "../types.ts";
import { assertFactoryId, assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import { sumFiniteNumbers, toFiniteNumber } from "../../../lib/numeric-total.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";

const PAYMENT_COLUMNS =
  "id, factory_id, customer_id, customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot, company_name_snapshot, company_business_description_snapshot, company_address_snapshot, company_mobile_snapshot, payment_date, amount, payment_mode, note, created_at";
const ALLOCATION_COLUMNS =
  "id, factory_id, payment_id, challan_id, allocated_amount, created_at";
const METHOD_COLUMNS = "factory_id, payment_id, mode, split_amount, created_at";
const REFERENCE_QUERY_BATCH_SIZE = 100;

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
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified" | "multiple";
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

type CustomerPaymentMethodRow = {
  factory_id: string;
  payment_id: string;
  mode: CustomerPaymentMethodMode;
  split_amount: number | string | null;
  created_at: string;
};

type ChallanReferenceRow = {
  id: string;
  challan_number: string | null;
  challan_date: string;
};

type OutstandingChallanRow = ChallanReferenceRow & {
  created_at: string;
  challan_total: number | string;
  status: "active" | "void";
  is_locked: boolean;
};

type OutstandingBrickLineRow = {
  id: string;
  challan_id: string;
  brick_particulars_snapshot: string;
  quantity: number | string;
  line_position: number;
};

type CurrentOutstandingRow = {
  id: string;
  challan_total: number | string;
};

type CurrentOutstandingAllocationRow = {
  id: string;
  challan_id: string;
  allocated_amount: number | string;
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
  if (error.code === "P3200") return "Choose a supported payment mode.";
  if (error.code === "P3201") return "Provide valid amounts for every payment method or for none of them.";
  if (error.code === "P3202") return "Payment method amounts must exactly equal the payment amount.";
  if (error.code === "P3203") return "The same payment mode cannot appear twice.";
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

function validatePaymentMethods(
  methods: CreateCustomerPaymentWithMethodsInput["methods"],
  paymentMinorUnits: number,
): void {
  if (methods.length === 0 || methods.length > 5) {
    throw new Error("A payment requires between 1 and 5 payment methods.");
  }

  const seenModes = new Set<string>();
  let suppliedAmountCount = 0;
  let suppliedAmountMinorUnits = 0;
  for (const method of methods) {
    requireNewPaymentMode(method.mode);
    if (seenModes.has(method.mode)) {
      throw new Error("The same payment mode cannot appear twice.");
    }
    seenModes.add(method.mode);
    if (method.splitAmount !== null && method.splitAmount !== undefined) {
      suppliedAmountCount += 1;
      suppliedAmountMinorUnits += toMinorUnits(method.splitAmount, "payment method amount");
    }
  }

  if (suppliedAmountCount !== 0 && suppliedAmountCount !== methods.length) {
    throw new Error("Provide amounts for every payment method or for none of them.");
  }
  if (suppliedAmountCount > 0 && suppliedAmountMinorUnits !== paymentMinorUnits) {
    throw new Error("Payment method amounts must exactly equal the payment amount.");
  }
}

function mapAllocation(
  row: CustomerPaymentAllocationRow,
  challanReferences: ReadonlyMap<
    string,
    Readonly<{ challanNumber: string | null; challanDate: string }>
  >,
): CustomerPaymentAllocation {
  const challanReference = challanReferences.get(row.challan_id);
  if (!challanReference) throw new Error("Payment allocation Challan was not found.");
  return {
    id: row.id,
    factoryId: row.factory_id,
    paymentId: row.payment_id,
    challanId: row.challan_id,
    challanNumber: challanReference.challanNumber,
    challanDate: challanReference.challanDate,
    allocatedAmount: Number(row.allocated_amount),
    createdAt: row.created_at,
  };
}

function mapPaymentHeader(row: CustomerPaymentRow): CustomerPaymentHeader {
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
  };
}

function mapPayment(
  row: CustomerPaymentRow,
  allocations: CustomerPaymentAllocation[],
  methods: CustomerPaymentMethod[],
): CustomerPayment {
  return {
    ...mapPaymentHeader(row),
    methods: methods.length > 0
      ? methods
      : row.payment_mode === "multiple"
        ? []
        : [{ mode: row.payment_mode, splitAmount: null }],
    allocations,
  };
}

async function hydratePayment(row: CustomerPaymentRow, requireMethods = false): Promise<CustomerPaymentResult> {
  const header = mapPaymentHeader(row);
  try {
    const [allocations, methodRows] = await Promise.all([
      listPaymentAllocations(row.factory_id, row.id),
      listPaymentMethods(row.factory_id, [row.id]),
    ]);
    if (allocations.length === 0 || ((requireMethods || row.payment_mode === "multiple") && methodRows.length === 0)) {
      throw new Error("Receipt children are unavailable.");
    }
    return { ...mapPayment(row, allocations, methodRows.map(mapPaymentMethod)), detailsStatus: "ready" };
  } catch {
    return { ...header, detailsStatus: "unavailable" };
  }
}

async function confirmedPayment(
  request: PromiseLike<{ data: CustomerPaymentRow | null; error: PostgrestError | null; status?: number }>,
  factoryId: string,
  customerId: string,
): Promise<CustomerPaymentResult> {
  let response;
  try {
    response = await request;
  } catch {
    throw new CustomerPaymentUnknownOutcomeError();
  }
  if (response.error) {
    if (response.status === 0 || !response.error.code) throw new CustomerPaymentUnknownOutcomeError();
    throw new CustomerPaymentServiceError(response.error);
  }
  const row = response.data;
  if (!row || !isCustomerPaymentId(row.id)
    || row.factory_id !== factoryId || row.customer_id !== customerId
    || !Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0) {
    throw new CustomerPaymentUnknownOutcomeError();
  }
  return hydratePayment(row, true);
}

export class CustomerPaymentNotFoundError extends Error {
  readonly code = "PAYMENT_NOT_FOUND";
  constructor() {
    super("Customer payment was not found.");
    this.name = "CustomerPaymentNotFoundError";
  }
}

function mapPaymentMethod(row: CustomerPaymentMethodRow): CustomerPaymentMethod {
  return {
    mode: row.mode,
    splitAmount: row.split_amount === null
      ? null
      : toFiniteNumber(row.split_amount, "Customer payment method split"),
  };
}

async function listPaymentMethods(
  factoryId: string,
  paymentIds: string[],
): Promise<CustomerPaymentMethodRow[]> {
  if (paymentIds.length === 0) return [];
  const methodBatches = await Promise.all(
    chunkIds(paymentIds).map(async (batchPaymentIds) => {
      const { data, error } = await supabase
        .from("customer_payment_methods")
        .select(METHOD_COLUMNS)
        .eq("factory_id", factoryId)
        .in("payment_id", batchPaymentIds)
        .order("payment_id", { ascending: true })
        .order("mode", { ascending: true });
      if (error) throw new CustomerPaymentServiceError(error);
      return (data ?? []) as CustomerPaymentMethodRow[];
    }),
  );
  return methodBatches.flat();
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
  return attachChallanReferences(factoryId, (data ?? []) as CustomerPaymentAllocationRow[]);
}

async function attachChallanReferences(
  factoryId: string,
  rows: CustomerPaymentAllocationRow[],
): Promise<CustomerPaymentAllocation[]> {
  if (rows.length === 0) return [];
  const challanIds = [...new Set(rows.map((row) => row.challan_id))];
  const challanReferenceBatches = await Promise.all(
    chunkIds(challanIds).map(async (challanIds) => {
      const { data, error } = await supabase
        .from("challans")
        .select("id, challan_number, challan_date")
        .eq("factory_id", factoryId)
        .in("id", challanIds);
      if (error) throw new CustomerPaymentServiceError(error);
      return (data ?? []) as ChallanReferenceRow[];
    }),
  );
  const challanReferences = new Map(
    challanReferenceBatches.flat().map((row) => [
      row.id,
      {
        challanNumber: row.challan_number === null ? null : String(row.challan_number),
        challanDate: row.challan_date,
      },
    ]),
  );
  return rows.map((row) => mapAllocation(row, challanReferences));
}

function chunkIds(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += REFERENCE_QUERY_BATCH_SIZE) {
    batches.push(ids.slice(index, index + REFERENCE_QUERY_BATCH_SIZE));
  }
  return batches;
}

function mapPaymentsWithAllocations(
  paymentRows: CustomerPaymentRow[],
  allocations: CustomerPaymentAllocation[],
  methodRows: CustomerPaymentMethodRow[],
): CustomerPayment[] {
  const allocationsByPayment = new Map<string, CustomerPaymentAllocation[]>();
  for (const allocation of allocations) {
    const paymentAllocations = allocationsByPayment.get(allocation.paymentId) ?? [];
    paymentAllocations.push(allocation);
    allocationsByPayment.set(allocation.paymentId, paymentAllocations);
  }

  const methodsByPayment = new Map<string, CustomerPaymentMethod[]>();
  for (const methodRow of methodRows) {
    const paymentMethods = methodsByPayment.get(methodRow.payment_id) ?? [];
    paymentMethods.push(mapPaymentMethod(methodRow));
    methodsByPayment.set(methodRow.payment_id, paymentMethods);
  }

  return paymentRows.map((payment) => mapPayment(
    payment,
    allocationsByPayment.get(payment.id) ?? [],
    methodsByPayment.get(payment.id) ?? [],
  ));
}

function comparePaymentRowsNewestFirst(
  left: CustomerPaymentRow,
  right: CustomerPaymentRow,
): number {
  return right.payment_date.localeCompare(left.payment_date)
    || right.created_at.localeCompare(left.created_at)
    || right.id.localeCompare(left.id);
}

export async function createCustomerPayment(
  input: CreateCustomerPaymentInput,
): Promise<CustomerPaymentResult> {
  requireId(input.factoryId, "factoryId");
  requireId(input.customerId, "customerId");
  assertCanonicalPaymentDate(input.paymentDate);
  const paymentMinorUnits = toMinorUnits(input.amount, "amount");
  requireNewPaymentMode(input.paymentMode);
  validateAllocations(input.allocations, paymentMinorUnits);
  const note = normalizeNote(input.note);

  return confirmedPayment(supabase.rpc("create_customer_payment", {
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
  }), input.factoryId, input.customerId);
}

export async function createCustomerPaymentWithMethods(
  input: CreateCustomerPaymentWithMethodsInput,
): Promise<CustomerPaymentResult> {
  requireId(input.factoryId, "factoryId");
  requireId(input.customerId, "customerId");
  assertCanonicalPaymentDate(input.paymentDate);
  const paymentMinorUnits = toMinorUnits(input.amount, "amount");
  validatePaymentMethods(input.methods, paymentMinorUnits);
  validateAllocations(input.allocations, paymentMinorUnits);
  const note = normalizeNote(input.note);

  return confirmedPayment(supabase.rpc("create_customer_payment_with_methods", {
    p_factory_id: input.factoryId,
    p_customer_id: input.customerId,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_payment_methods: input.methods.map((method) => ({
      mode: method.mode,
      amount: method.splitAmount ?? null,
    })),
    p_note: note,
    p_allocations: input.allocations.map((allocation) => ({
      challan_id: allocation.challanId,
      amount: allocation.amount,
    })),
  }), input.factoryId, input.customerId);
}

export async function getPaymentsReceivedTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  const data = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase.from("customer_payments")
      .select("id, amount")
      .eq("factory_id", factoryId)
      .gte("payment_date", dateFrom)
      .lte("payment_date", dateTo)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data: page, error } = await query;
    if (error) throw new CustomerPaymentServiceError(error);
    return page ?? [];
  });
  return sumFiniteNumbers(
    data.map((payment) => payment.amount),
    "Payments Received total",
  );
}

export async function getCurrentCustomerOutstandingTotal(
  factoryId: string,
): Promise<number> {
  assertFactoryId(factoryId);
  const challans = await readAllKeysetPages<CurrentOutstandingRow>(async (afterId, pageSize) => {
    let query = supabase.from("challans")
      .select("id, challan_total")
      .eq("factory_id", factoryId)
      .eq("status", "active")
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new CustomerPaymentServiceError(error);
    return (data ?? []) as CurrentOutstandingRow[];
  });
  if (challans.length === 0) return 0;
  const activeChallanIds = new Set(challans.map((challan) => challan.id));
  const allocations = await readAllKeysetPages<CurrentOutstandingAllocationRow>(async (afterId, pageSize) => {
    let query = supabase.from("customer_payment_allocations")
      .select("id, challan_id, allocated_amount")
      .eq("factory_id", factoryId)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new CustomerPaymentServiceError(error);
    return (data ?? []) as CurrentOutstandingAllocationRow[];
  });
  const allocatedByChallanId = new Map<string, number>();
  for (const allocation of allocations) {
    if (!activeChallanIds.has(allocation.challan_id)) continue;
    const amount = toFiniteNumber(allocation.allocated_amount, "Customer Outstanding allocation");
    allocatedByChallanId.set(allocation.challan_id, (allocatedByChallanId.get(allocation.challan_id) ?? 0) + amount);
  }
  return challans.reduce((factoryTotal, challan) => {
    const saleTotal = toFiniteNumber(challan.challan_total, "Customer Outstanding sale total");
    const paidTotal = allocatedByChallanId.get(challan.id) ?? 0;
    if (paidTotal > saleTotal) {
      throw new Error("Customer Outstanding allocations exceed the authoritative Challan total.");
    }
    return factoryTotal + saleTotal - paidTotal;
  }, 0);
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
  const [{ data: allocationRows, error: allocationError }, methodRows] = await Promise.all([
    supabase
      .from("customer_payment_allocations")
      .select(ALLOCATION_COLUMNS)
      .eq("factory_id", factoryId)
      .in("payment_id", paymentIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    listPaymentMethods(factoryId, paymentIds),
  ]);

  if (allocationError) throw new CustomerPaymentServiceError(allocationError);
  const allocations = await attachChallanReferences(
    factoryId,
    (allocationRows ?? []) as CustomerPaymentAllocationRow[],
  );
  return mapPaymentsWithAllocations(paymentRows, allocations, methodRows);
}

export async function listFactoryCustomerPayments(
  factoryId: string,
): Promise<CustomerPayment[]> {
  assertFactoryId(factoryId);
  const paymentRows = await readAllKeysetPages<CustomerPaymentRow>(async (afterId, pageSize) => {
    let query = supabase
      .from("customer_payments")
      .select(PAYMENT_COLUMNS)
      .eq("factory_id", factoryId)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new CustomerPaymentServiceError(error);
    return (data ?? []) as CustomerPaymentRow[];
  });
  if (paymentRows.length === 0) return [];

  const paymentIds = new Set(paymentRows.map((payment) => payment.id));
  const [allocationRows, methodRows] = await Promise.all([
    readAllKeysetPages<CustomerPaymentAllocationRow>(
      async (afterId, pageSize) => {
        let query = supabase
          .from("customer_payment_allocations")
          .select(ALLOCATION_COLUMNS)
          .eq("factory_id", factoryId)
          .order("id", { ascending: true })
          .limit(pageSize);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        if (error) throw new CustomerPaymentServiceError(error);
        return (data ?? []) as CustomerPaymentAllocationRow[];
      },
    ),
    listPaymentMethods(factoryId, [...paymentIds]),
  ]);
  const relevantAllocationRows = allocationRows
    .filter((allocation) => paymentIds.has(allocation.payment_id))
    .sort((left, right) => left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id));
  const allocations = await attachChallanReferences(factoryId, relevantAllocationRows);
  return mapPaymentsWithAllocations(
    [...paymentRows].sort(comparePaymentRowsNewestFirst),
    allocations,
    methodRows,
  );
}

export async function getCustomerPayment(
  factoryId: string,
  paymentId: string,
): Promise<CustomerPaymentResult> {
  requireId(factoryId, "factoryId");
  requireId(paymentId, "paymentId");
  const { data, error } = await supabase
    .from("customer_payments")
    .select(PAYMENT_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("id", paymentId);
  if (error) throw new CustomerPaymentServiceError(error);
  const payment = (data?.[0] ?? null) as CustomerPaymentRow | null;
  if (!payment) throw new CustomerPaymentNotFoundError();
  return hydratePayment(payment);
}

export async function listCustomerOutstandingChallans(
  factoryId: string,
  customerId: string,
  dateRange?: Readonly<{ fromDate: string; toDate: string }>,
): Promise<CustomerOutstandingChallan[]> {
  requireId(factoryId, "factoryId");
  requireId(customerId, "customerId");
  if (dateRange) {
    assertInclusiveBusinessDateRange(factoryId, dateRange.fromDate, dateRange.toDate);
  }
  let query = supabase
    .from("challans")
    .select("id, challan_number, challan_date, created_at, challan_total, status, is_locked")
    .eq("factory_id", factoryId)
    .eq("customer_id", customerId)
    .eq("status", "active");
  if (dateRange) {
    query = query
      .gte("challan_date", dateRange.fromDate)
      .lte("challan_date", dateRange.toDate);
  }
  const { data, error } = await query
    .order("challan_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new CustomerPaymentServiceError(error);

  const rows = (data ?? []) as OutstandingChallanRow[];
  if (rows.length === 0) return [];
  const challanIds = rows.map((row) => row.id);
  const [states, itemResult] = await Promise.all([
    Promise.all(rows.map((row) => getChallanPaymentState(factoryId, row.id))),
    supabase
      .from("challan_items")
      .select("id, challan_id, brick_particulars_snapshot, quantity, line_position")
      .eq("factory_id", factoryId)
      .in("challan_id", challanIds)
      .order("line_position", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (itemResult.error) throw new CustomerPaymentServiceError(itemResult.error);

  const brickLinesByChallanId = new Map<string, CustomerOutstandingChallan["brickLines"]>();
  for (const item of (itemResult.data ?? []) as OutstandingBrickLineRow[]) {
    const quantity = toFiniteNumber(item.quantity, "Customer Challan brick quantity");
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("Customer Challan brick quantity must be a positive whole number.");
    }
    const brickLines = brickLinesByChallanId.get(item.challan_id) ?? [];
    brickLines.push({
      itemId: item.id,
      particularsSnapshot: item.brick_particulars_snapshot,
      quantity,
    });
    brickLinesByChallanId.set(item.challan_id, brickLines);
  }

  return rows.flatMap((row, index) => {
    const state = states[index];
    if (!state || state.challanStatus !== "active" || state.outstandingAmount <= 0) return [];
    return [{
      ...state,
      challanNumber: row.challan_number === null ? null : String(row.challan_number),
      challanDate: row.challan_date,
      createdAt: row.created_at,
      isLocked: row.is_locked,
      brickLines: brickLinesByChallanId.get(row.id) ?? [],
    }];
  });
}
