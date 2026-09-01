import type {
  CustomerPaymentMode,
  NewCustomerPaymentMode,
} from "@/features/sales/types";

export type CashBookDirection = "in" | "out";
export type CashBookManualEntryStatus = "active" | "void";
export type CashBookSourceType =
  | "customer_payment"
  | "manual_cash_entry"
  | "expense_payment"
  | "vehicle_wage_payment"
  | "vehicle_wage_payment_reversal";

export type CashBookInitialization = {
  factoryId: string;
  startDate: string;
  openingBalance: number;
  createdAt: string;
  createdBy: string;
};

export type CashBookManualEntry = {
  id: string;
  factoryId: string;
  businessDate: string;
  direction: CashBookDirection;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  partyDetails: string;
  note: string | null;
  status: CashBookManualEntryStatus;
  createdAt: string;
  createdBy: string;
  voidedAt: string | null;
  voidedBy: string | null;
};

export type CashBookDaySummary = {
  businessDate: string;
  openingBalance: number;
  totalMoneyIn: number;
  totalMoneyOut: number;
  closingBalance: number;
};

export type CashBookMovement = {
  sourceType: CashBookSourceType;
  sourceId: string;
  businessDate: string;
  direction: CashBookDirection;
  amount: number;
  paymentMode: CustomerPaymentMode;
  counterparty: string;
  description: string;
  note: string | null;
  sourceStatus: CashBookManualEntryStatus;
  createdAt: string;
};

export type CashBookDay = {
  summary: CashBookDaySummary;
  moneyIn: CashBookMovement[];
  moneyOut: CashBookMovement[];
};

export type InitializeCashBookInput = {
  factoryId: string;
  startDate: string;
  openingBalance: number;
};

export type CreateCashBookManualEntryInput = {
  factoryId: string;
  requestId: string;
  businessDate: string;
  direction: CashBookDirection;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  partyDetails: string;
  note?: string | null;
};
