import type {
  CashBookDirection,
  CashBookMovement,
  CreateCashBookManualEntryInput,
  InitializeCashBookInput,
} from "../cash-book/types.ts";
import { isNewCustomerPaymentMode } from "../sales/types.ts";
import { isLocalDate, shiftLocalDate } from "../../lib/local-date.ts";

export type CashBookInitializationForm = {
  startDate: string;
  openingBalance: string;
};

export type CashBookManualEntryForm = {
  businessDate: string;
  amount: string;
  paymentMode: string;
  partyDetails: string;
  note: string;
};

export function emptyCashBookInitializationForm(
  localToday: string,
): CashBookInitializationForm {
  return { startDate: localToday, openingBalance: "" };
}

export function emptyCashBookManualEntryForm(
  businessDate: string,
): CashBookManualEntryForm {
  return { businessDate, amount: "", paymentMode: "", partyDetails: "", note: "" };
}

export function buildCashBookInitializationInput(
  factoryId: string,
  form: CashBookInitializationForm,
): InitializeCashBookInput | null {
  const openingBalance = parseMoney(form.openingBalance, true);
  if (!factoryId.trim() || !isLocalDate(form.startDate) || openingBalance === null) return null;
  return { factoryId, startDate: form.startDate, openingBalance };
}

export function buildCashBookManualEntryInput(
  factoryId: string,
  requestId: string,
  direction: CashBookDirection,
  form: CashBookManualEntryForm,
): CreateCashBookManualEntryInput | null {
  const amount = parseMoney(form.amount, false);
  const partyDetails = normalizeText(form.partyDetails);
  const note = normalizeText(form.note);
  if (!factoryId.trim()
    || !isUuid(requestId)
    || !isLocalDate(form.businessDate)
    || amount === null
    || !isNewCustomerPaymentMode(form.paymentMode)
    || !partyDetails
    || partyDetails.length > 200
    || note.length > 500) return null;
  return {
    factoryId,
    requestId,
    businessDate: form.businessDate,
    direction,
    amount,
    paymentMode: form.paymentMode,
    partyDetails,
    note: note || null,
  };
}

export function getCashBookNavigationDate(
  action: "previous" | "today" | "next",
  selectedDate: string,
  localToday: string,
): string | null {
  if (!isLocalDate(selectedDate) || !isLocalDate(localToday)) return null;
  if (action === "today") return localToday;
  return shiftLocalDate(selectedDate, action === "previous" ? -1 : 1);
}

export function getCashBookReceiptHref(movement: CashBookMovement): string | null {
  return movement.sourceType === "customer_payment"
    ? `/office/payments/${movement.sourceId}`
    : null;
}

export function isCashBookInitializationRequired(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as Error & { code?: string }).code === "P3201";
}

export function cashBookOfficeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseMoney(value: string, allowZeroOrNegative: boolean): number | null {
  const normalized = value.trim();
  const pattern = allowZeroOrNegative
    ? /^-?\d+(?:\.\d{1,2})?$/
    : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(normalized)) return null;
  const amount = Number(normalized);
  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || (!allowZeroOrNegative && paise <= 0)) return null;
  return paise / 100;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
