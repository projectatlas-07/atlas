import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import { isNewCustomerPaymentMode } from "../../sales/types.ts";
import type {
  CashBookDay,
  CashBookDaySummary,
  CashBookInitialization,
  CashBookManualEntry,
  CashBookMovement,
  CashBookRangeTotals,
  CreateCashBookManualEntryInput,
  InitializeCashBookInput,
} from "../types.ts";
import {
  assertBusinessDate,
  assertFactoryId,
  assertInclusiveBusinessDateRange,
  inclusiveBusinessDates,
} from "../../../lib/business-date-contract.ts";

type InitializationRow = {
  factory_id: string;
  start_date: string;
  opening_balance: number | string;
  created_at: string;
  created_by: string;
};

type ManualEntryRow = {
  id: string;
  factory_id: string;
  business_date: string;
  direction: "in" | "out";
  amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  party_details: string;
  note: string | null;
  status: "active" | "void";
  created_at: string;
  created_by: string;
  voided_at: string | null;
  voided_by: string | null;
};

type SummaryRow = {
  business_date: string;
  opening_balance: number | string;
  total_money_in: number | string;
  total_money_out: number | string;
  closing_balance: number | string;
};

type MovementRow = {
  source_type: "customer_payment" | "manual_cash_entry" | "expense_payment" | "vehicle_wage_payment" | "vehicle_wage_payment_reversal";
  source_id: string;
  business_date: string;
  direction: "in" | "out";
  amount: number | string;
  payment_mode: "cash" | "upi" | "bank_transfer" | "cheque" | "other" | "unspecified";
  counterparty: string;
  description: string;
  note: string | null;
  source_status: "active" | "void";
  created_at: string;
};

export class CashBookServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(readableCashBookError(error));
    this.name = "CashBookServiceError";
    this.code = error.code;
  }
}

function readableCashBookError(error: PostgrestError): string {
  if (error.code === "P3200") return "Choose a supported payment mode.";
  if (error.code === "P3201") return "Initialize the Cash Book first.";
  if (error.code === "P3202") return "Cash Book initialization is permanent and cannot be rewritten.";
  if (error.code === "P3203") return "Manual Cash Book entry was not found for this factory.";
  if (error.code === "P3204") return "Direction must be Money In or Money Out.";
  if (error.code === "P3205") return "This manual-entry request ID was already used for different data.";
  if (error.code === "P3206") return "Cash Book financial history is immutable.";
  return error.message;
}

export async function initializeCashBook(
  input: InitializeCashBookInput,
): Promise<CashBookInitialization> {
  requireId(input.factoryId, "factoryId");
  assertCanonicalDate(input.startDate, "startDate");
  assertMoney(input.openingBalance, "openingBalance", true);
  const { data, error } = await supabase.rpc("initialize_cash_book", {
    p_factory_id: input.factoryId,
    p_start_date: input.startDate,
    p_opening_balance: input.openingBalance,
  });
  if (error) throw new CashBookServiceError(error);
  if (!data) throw new Error("initialize_cash_book returned no initialization.");
  return mapInitialization(data);
}

export async function createCashBookManualEntry(
  input: CreateCashBookManualEntryInput,
): Promise<CashBookManualEntry> {
  requireId(input.factoryId, "factoryId");
  assertUuid(input.requestId, "requestId");
  assertCanonicalDate(input.businessDate, "businessDate");
  if (input.direction !== "in" && input.direction !== "out") {
    throw new Error("direction must be in or out.");
  }
  assertMoney(input.amount, "amount", false);
  if (!isNewCustomerPaymentMode(input.paymentMode)) {
    throw new Error("Choose a supported payment mode.");
  }
  const partyDetails = normalizeText(input.partyDetails, "partyDetails", 200, true);
  const note = normalizeText(input.note ?? "", "note", 500, false) || null;
  const { data, error } = await supabase.rpc("create_cash_book_manual_entry", {
    p_factory_id: input.factoryId,
    p_entry_id: input.requestId,
    p_business_date: input.businessDate,
    p_direction: input.direction,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_party_details: partyDetails,
    p_note: note,
  });
  if (error) throw new CashBookServiceError(error);
  if (!data) throw new Error("create_cash_book_manual_entry returned no entry.");
  return mapManualEntry(data);
}

export async function voidCashBookManualEntry(
  factoryId: string,
  entryId: string,
): Promise<CashBookManualEntry> {
  requireId(factoryId, "factoryId");
  assertUuid(entryId, "entryId");
  const { data, error } = await supabase.rpc("void_cash_book_manual_entry", {
    p_factory_id: factoryId,
    p_entry_id: entryId,
  });
  if (error) throw new CashBookServiceError(error);
  if (!data) throw new Error("void_cash_book_manual_entry returned no entry.");
  return mapManualEntry(data);
}

export async function getCashBookDay(
  factoryId: string,
  businessDate: string,
): Promise<CashBookDay> {
  requireId(factoryId, "factoryId");
  assertCanonicalDate(businessDate, "businessDate");
  const [summaryResult, movementsResult] = await Promise.all([
    loadCashBookDaySummary(factoryId, businessDate),
    supabase.rpc("list_cash_book_day_entries", {
      p_factory_id: factoryId,
      p_business_date: businessDate,
    }),
  ]);
  if (movementsResult.error) throw new CashBookServiceError(movementsResult.error);
  const movements = ((movementsResult.data ?? []) as MovementRow[]).map(mapMovement);
  return {
    summary: summaryResult,
    moneyIn: movements.filter((movement) => movement.direction === "in"),
    moneyOut: movements.filter((movement) => movement.direction === "out"),
  };
}

// D1/D2 performance finding — future Cash Book range-summary RPC candidate.
// V1 intentionally keeps the public contract stable while delegating every day
// to the existing authoritative day-summary RPC.
export async function getRangeTotals(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<CashBookRangeTotals> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  let moneyIn = 0;
  let moneyOut = 0;
  for (const businessDate of inclusiveBusinessDates(dateFrom, dateTo)) {
    const summary = await loadCashBookDaySummary(factoryId, businessDate);
    moneyIn += summary.totalMoneyIn;
    moneyOut += summary.totalMoneyOut;
  }
  return { moneyIn, moneyOut };
}

export async function getBalanceAsOf(
  factoryId: string,
  dateTo: string,
): Promise<number> {
  assertFactoryId(factoryId);
  assertBusinessDate(dateTo, "dateTo");
  return (await loadCashBookDaySummary(factoryId, dateTo)).closingBalance;
}

async function loadCashBookDaySummary(
  factoryId: string,
  businessDate: string,
): Promise<CashBookDaySummary> {
  const { data, error } = await supabase.rpc("get_cash_book_day_summary", {
    p_factory_id: factoryId,
    p_business_date: businessDate,
  });
  if (error) throw new CashBookServiceError(error);
  const summary = data?.[0] as SummaryRow | undefined;
  if (!summary) throw new Error("get_cash_book_day_summary returned no summary.");
  return mapSummary(summary);
}

function mapInitialization(row: InitializationRow): CashBookInitialization {
  return {
    factoryId: row.factory_id,
    startDate: row.start_date,
    openingBalance: Number(row.opening_balance),
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapManualEntry(row: ManualEntryRow): CashBookManualEntry {
  return {
    id: row.id,
    factoryId: row.factory_id,
    businessDate: row.business_date,
    direction: row.direction,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    partyDetails: row.party_details,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
  };
}

function mapSummary(row: SummaryRow): CashBookDaySummary {
  return {
    businessDate: row.business_date,
    openingBalance: Number(row.opening_balance),
    totalMoneyIn: Number(row.total_money_in),
    totalMoneyOut: Number(row.total_money_out),
    closingBalance: Number(row.closing_balance),
  };
}

function mapMovement(row: MovementRow): CashBookMovement {
  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    businessDate: row.business_date,
    direction: row.direction,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    counterparty: row.counterparty,
    description: row.description,
    note: row.note,
    sourceStatus: row.source_status,
    createdAt: row.created_at,
  };
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
}

function assertCanonicalDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid local calendar date.`);
  }
}

function assertMoney(value: number, label: string, allowZeroOrNegative: boolean): void {
  const paise = value * 100;
  if (!Number.isFinite(value)
    || (!allowZeroOrNegative && value <= 0)
    || !Number.isSafeInteger(Math.round(paise))
    || Math.abs(paise - Math.round(paise)) >= 1e-7) {
    throw new Error(`${label} must ${allowZeroOrNegative ? "be finite" : "be positive"} and use at most two decimal places.`);
  }
}

function normalizeText(value: string, label: string, maximum: number, required: boolean): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} ${required ? "is required and " : ""}must be at most ${maximum} characters.`);
  }
  return normalized;
}
