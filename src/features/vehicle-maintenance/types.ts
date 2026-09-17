import type { NewCustomerPaymentMode } from "../sales/types.ts";

export type VehicleMaintenanceStatus = "active" | "void";
export type VehicleMaintenancePaymentState = "unpaid" | "partially_paid" | "paid";

export type VehicleMaintenanceRecord = {
  id: string;
  factoryId: string;
  maintenanceDate: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  garageId: string;
  garageNameSnapshot: string;
  garageAddressSnapshot: string | null;
  garageMobileSnapshot: string | null;
  workDescription: string;
  totalAmount: number;
  status: VehicleMaintenanceStatus;
  isLocked: boolean;
  totalPaid: number;
  outstandingAmount: number;
  paymentState: VehicleMaintenancePaymentState;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VehicleMaintenancePayment = {
  id: string;
  factoryId: string;
  maintenanceId: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  garageId: string;
  garageNameSnapshot: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
  createdAt: string;
};

export type CreateVehicleMaintenanceInput = {
  factoryId: string;
  maintenanceDate: string;
  vehicleId: string;
  garageId: string;
  workDescription: string;
  totalAmount: number;
  initialPaidAmount: number;
  initialPaymentMode: NewCustomerPaymentMode | null;
};

export type UpdateVehicleMaintenanceInput = Omit<
  CreateVehicleMaintenanceInput,
  "initialPaidAmount" | "initialPaymentMode"
> & { maintenanceId: string };

export type CreateVehicleMaintenancePaymentInput = {
  factoryId: string;
  maintenanceId: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
};

export type CreateVehicleMaintenanceBatchPaymentInput = {
  factoryId: string;
  garageId: string;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
};

export type VehicleMaintenancePaymentAllocation = {
  maintenanceId: string;
  maintenanceDate: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  workDescription: string;
  allocatedAmount: number;
};

export type VehicleMaintenanceBatchPayment = {
  id: string;
  factoryId: string;
  garageId: string;
  garageNameSnapshot: string;
  vehicleIds: string[];
  allocationCount: number;
  allocations: VehicleMaintenancePaymentAllocation[];
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
  createdAt: string;
};
