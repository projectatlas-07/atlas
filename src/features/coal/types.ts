import type { ExpensePaymentState, ExpenseRecordStatus } from "../expenses/types.ts";
import type { NewCustomerPaymentMode } from "../sales/types.ts";

export type CoalReferenceKind = "coal_name" | "source_location";

export type CoalReferenceValue = {
  id: string;
  factoryId: string;
  kind: CoalReferenceKind;
  value: string;
  createdAt: string;
};

export type CoalPurchase = {
  id: string;
  factoryId: string;
  purchaseDate: string;
  sellerId: string;
  sellerNameSnapshot: string;
  sellerAddressSnapshot: string | null;
  sellerMobileSnapshot: string | null;
  coalNameReferenceId: string;
  coalNameSnapshot: string;
  sourceReferenceId: string;
  sourceLocationSnapshot: string;
  coalChallanNumber: string | null;
  vehicleNumberSnapshot: string;
  quantity: number;
  rate: number;
  coalAmount: number;
  separateFreightAmount: number;
  finalTotal: number;
  status: ExpenseRecordStatus;
  isLocked: boolean;
  totalPaid: number;
  outstandingAmount: number;
  paymentState: ExpensePaymentState;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoalPurchaseMeasurementInput = {
  quantity: number | null;
  rate: number | null;
  coalAmount: number | null;
};

export type CreateCoalPurchaseInput = CoalPurchaseMeasurementInput & {
  factoryId: string;
  purchaseDate: string;
  sellerId: string;
  coalNameReferenceId: string;
  sourceReferenceId: string;
  coalChallanNumber?: string | null;
  vehicleNumber: string;
  separateFreightAmount: number;
  initialPaidAmount: number;
  initialPaymentMode?: NewCustomerPaymentMode | null;
};

export type UpdateCoalPurchaseInput = Omit<
  CreateCoalPurchaseInput,
  "initialPaidAmount" | "initialPaymentMode"
> & { purchaseId: string };

export type CoalPayment = {
  id: string;
  factoryId: string;
  sellerId: string;
  sellerNameSnapshot: string;
  allocationCount: number;
  allocations: CoalPaymentAllocation[];
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
  createdAt: string;
};

export type CoalPaymentAllocation = {
  purchaseId: string;
  purchaseDate: string;
  coalChallanNumber: string | null;
  coalNameSnapshot: string;
  sourceLocationSnapshot: string;
  vehicleNumberSnapshot: string;
  allocatedAmount: number;
};

export type CreateCoalPaymentInput = {
  factoryId: string;
  purchaseId: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note?: string | null;
};

export type CreateCoalSelectivePaymentInput = {
  factoryId: string;
  sellerId: string;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  paymentMode: NewCustomerPaymentMode;
  note?: string | null;
  allocations: Array<{ purchaseId: string; amount: number }>;
};
