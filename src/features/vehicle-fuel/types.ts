import type { NewCustomerPaymentMode } from "../sales/types.ts";

export type FuelType = "DIESEL" | "PETROL";
export type VehicleFuelStatus = "active" | "void";
export type VehicleFuelPaymentState = "unpaid" | "partially_paid" | "paid";

export type VehicleFuelRecord = {
  id: string;
  factoryId: string;
  fuelDate: string;
  fuelTime: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  pumpId: string;
  pumpNameSnapshot: string;
  pumpAddressSnapshot: string | null;
  pumpMobileSnapshot: string | null;
  fuelType: FuelType;
  litres: number;
  ratePerLitre: number;
  fuelAmount: number;
  status: VehicleFuelStatus;
  isLocked: boolean;
  totalPaid: number;
  outstandingAmount: number;
  paymentState: VehicleFuelPaymentState;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VehicleFuelMeasurementInput = {
  litres: number | null;
  ratePerLitre: number | null;
  fuelAmount: number | null;
};

export type CreateVehicleFuelInput = VehicleFuelMeasurementInput & {
  factoryId: string;
  fuelDate: string;
  fuelTime: string;
  vehicleId: string;
  pumpId: string;
  fuelType: FuelType;
  initialPaidAmount: number;
  initialPaymentMode: NewCustomerPaymentMode | null;
};

export type UpdateVehicleFuelInput = Omit<
  CreateVehicleFuelInput,
  "initialPaidAmount" | "initialPaymentMode"
> & { fuelRecordId: string };

export type VehicleFuelPayment = {
  id: string;
  factoryId: string;
  fuelRecordId: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  pumpId: string;
  pumpNameSnapshot: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
  createdAt: string;
};

export type CreateVehicleFuelPaymentInput = {
  factoryId: string;
  fuelRecordId: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
};

export type CreateVehicleFuelBatchPaymentInput = {
  factoryId: string;
  pumpId: string;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
};

export type VehicleFuelPaymentAllocation = {
  fuelRecordId: string;
  fuelDate: string;
  fuelTime: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  fuelType: FuelType;
  litres: number;
  allocatedAmount: number;
};

export type VehicleFuelBatchPayment = {
  id: string;
  factoryId: string;
  pumpId: string;
  pumpName: string;
  vehicleIds: string[];
  allocationCount: number;
  allocations: VehicleFuelPaymentAllocation[];
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note: string | null;
  createdAt: string;
};
