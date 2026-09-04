import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { SalesDateRange, SalesRegisterEntry } from "../sales-register-model.ts";
import { getChallanPaymentState } from "./customer-payment-service.ts";
import { assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import { sumFiniteNumbers } from "../../../lib/numeric-total.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";

const SALES_REGISTER_SELECT = `
  id,
  challan_number,
  challan_date,
  customer_name_snapshot,
  challan_total,
  vehicle_number,
  status,
  challan_items (
    brick_particulars_snapshot,
    quantity,
    line_amount,
    line_position
  ),
  challan_flexible_lines (
    line_type,
    line_category,
    amount
  )
`;

type SalesRegisterRow = {
  id: string;
  challan_number: number | string;
  challan_date: string;
  customer_name_snapshot: string;
  challan_total: number | string;
  vehicle_number: string | null;
  status: "active" | "void";
  challan_items: Array<{
    brick_particulars_snapshot: string;
    quantity: number | string;
    line_amount: number | string;
    line_position: number;
  }> | null;
  challan_flexible_lines: Array<{
    line_type: "NOTE" | "EXTRA_CHARGE";
    line_category: "NON_FINANCIAL" | "OTHER_REVENUE";
    amount: number | string;
  }> | null;
};

export class SalesRegisterServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "SalesRegisterServiceError";
    this.code = error.code;
  }
}

export class SalesRegisterReconciliationError extends Error {
  readonly code = "SALES_REVENUE_MISMATCH";

  constructor(challanNumber: number | string) {
    super(`Sales Register revenue does not reconcile for Challan #${challanNumber}.`);
    this.name = "SalesRegisterReconciliationError";
  }
}

export async function getSalesTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  const data = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase
      .from("challans")
      .select("id, challan_total")
      .eq("factory_id", factoryId)
      .eq("status", "active")
      .gte("challan_date", dateFrom)
      .lte("challan_date", dateTo)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data: page, error } = await query;
    if (error) throw new SalesRegisterServiceError(error);
    return page ?? [];
  });
  return sumFiniteNumbers(
    data.map((challan) => challan.challan_total),
    "Sales total",
  );
}

export async function listSalesRegister(
  factoryId: string,
  range: SalesDateRange,
): Promise<SalesRegisterEntry[]> {
  if (!factoryId.trim()) throw new Error("factoryId is required.");
  if (!isCanonicalDate(range.fromDate) || !isCanonicalDate(range.toDate)) {
    throw new Error("Sales Register dates must use YYYY-MM-DD.");
  }
  if (range.fromDate > range.toDate) throw new Error("Sales Register start date must not be after end date.");

  const { data, error } = await supabase
    .from("challans")
    .select(SALES_REGISTER_SELECT)
    .eq("factory_id", factoryId)
    .gte("challan_date", range.fromDate)
    .lte("challan_date", range.toDate)
    .order("challan_date", { ascending: false })
    .order("challan_number", { ascending: false });

  if (error) throw new SalesRegisterServiceError(error);
  const entries = ((data ?? []) as unknown as SalesRegisterRow[]).map(mapRegisterRow);
  return Promise.all(entries.map(async (entry) => {
    if (entry.status === "void") return entry;
    const payment = await getChallanPaymentState(factoryId, entry.challanId);
    return {
      ...entry,
      paymentState: payment.paymentState,
      paidAmount: payment.totalPaid,
      outstandingAmount: payment.outstandingAmount,
    };
  }));
}

function mapRegisterRow(row: SalesRegisterRow): SalesRegisterEntry {
  const brickRevenuePaise = (row.challan_items ?? []).reduce(
    (total, item) => total + moneyToPaise(item.line_amount),
    0,
  );
  const otherRevenuePaise = (row.challan_flexible_lines ?? []).reduce(
    (total, line) => line.line_type === "EXTRA_CHARGE"
      && line.line_category === "OTHER_REVENUE"
      ? total + moneyToPaise(line.amount)
      : total,
    0,
  );
  const totalRevenuePaise = moneyToPaise(row.challan_total);
  if (brickRevenuePaise + otherRevenuePaise !== totalRevenuePaise) {
    throw new SalesRegisterReconciliationError(row.challan_number);
  }

  return {
    challanId: row.id,
    challanNumber: Number(row.challan_number),
    challanDate: row.challan_date,
    customerNameSnapshot: row.customer_name_snapshot,
    items: (row.challan_items ?? [])
      .map((item) => ({
        particularsSnapshot: item.brick_particulars_snapshot,
        quantity: Number(item.quantity),
        linePosition: item.line_position,
      }))
      .sort((left, right) => left.linePosition - right.linePosition),
    brickRevenue: brickRevenuePaise / 100,
    otherRevenue: otherRevenuePaise / 100,
    totalRevenue: totalRevenuePaise / 100,
    vehicleNumber: row.vehicle_number ?? "",
    status: row.status,
    paymentState: null,
    paidAmount: 0,
    outstandingAmount: 0,
  };
}

function moneyToPaise(value: number | string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Sales Register received an invalid authoritative revenue amount.");
  }
  return Math.round(amount * 100);
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
