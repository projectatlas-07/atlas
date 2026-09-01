import type { NewCustomerPaymentMode } from "../sales/types.ts";

export type ExpenseRecordKind = "purchase" | "expense";
export type ExpenseRecordStatus = "active" | "void";
export type ExpensePaymentState = "unpaid" | "partially_paid" | "paid";

export type Supplier = {
  id: string;
  factoryId: string;
  name: string;
  address: string | null;
  mobile: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseRecord = {
  id: string;
  factoryId: string;
  businessDate: string;
  kind: ExpenseRecordKind;
  supplierId: string | null;
  counterpartyNameSnapshot: string;
  counterpartyAddressSnapshot: string | null;
  counterpartyMobileSnapshot: string | null;
  description: string;
  totalAmount: number;
  note: string | null;
  status: ExpenseRecordStatus;
  isLocked: boolean;
  totalPaid: number;
  outstandingAmount: number;
  paymentState: ExpensePaymentState;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpensePaymentAllocation = {
  id: string;
  factoryId: string;
  paymentId: string;
  expenseRecordId: string;
  expenseKind: ExpenseRecordKind;
  counterpartyNameSnapshot: string;
  description: string;
  allocatedAmount: number;
  createdAt: string;
};

export type ExpensePayment = {
  id: string;
  factoryId: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
  createdAt: string;
  allocations: ExpensePaymentAllocation[];
};

export type ExpenseRecordPaymentState = {
  expenseRecordId: string;
  status: ExpenseRecordStatus;
  kind: ExpenseRecordKind;
  totalAmount: number;
  totalPaid: number;
  outstandingAmount: number;
  paymentState: ExpensePaymentState;
  isLocked: boolean;
};

export type SupplierExpenseSummary = {
  supplierId: string;
  activeRecordCount: number;
  totalCost: number;
  totalPaid: number;
  totalOutstanding: number;
};

export type SupplierInput = {
  factoryId: string;
  name: string;
  address?: string | null;
  mobile?: string | null;
};

export type UpdateSupplierInput = SupplierInput & { supplierId: string };

export type ExpenseRecordInput = {
  factoryId: string;
  businessDate: string;
  kind: ExpenseRecordKind;
  supplierId?: string | null;
  counterpartyName?: string | null;
  description: string;
  totalAmount: number;
  note?: string | null;
};

export type UpdateExpenseRecordInput = ExpenseRecordInput & { expenseRecordId: string };

export type ExpensePaymentAllocationInput = {
  expenseRecordId: string;
  amount: number;
};

export type CreateExpensePaymentInput = {
  factoryId: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note?: string | null;
  allocations: ExpensePaymentAllocationInput[];
};
