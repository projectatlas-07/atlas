export type FactoryPrintableProfile = {
  id: string;
  name: string;
  businessDescription: string;
  village: string;
  postOffice: string;
  policeStation: string;
  district: string;
  state: string;
  /** Legacy generic address retained during the structured-profile transition. */
  address: string;
  mobile: string;
  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id: string;
  factoryId: string;
  name: string;
  address: string;
  mobile: string;
  createdAt: string;
  updatedAt: string;
};

export type Vehicle = {
  id: string;
  factoryId: string;
  vehicleNumber: string;
  normalizedVehicleNumber: string;
  deliveryWageTrackingEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChallanStatus = "active" | "void";
export type ChallanNumber = string | null;

export function formatChallanLabel(challanNumber: ChallanNumber): string {
  return challanNumber ? `Challan ${challanNumber}` : "Challan";
}
export type ChallanPricingUnit = "PER_1000_BRICKS";
export type ChallanBrickPricingMode = "RATE" | "AMOUNT";
export type ChallanLineCategory =
  | "BRICK_REVENUE"
  | "OTHER_REVENUE"
  | "NON_FINANCIAL";
export type ChallanFlexibleLineType = "NOTE" | "EXTRA_CHARGE";

export type ChallanHeader = {
  id: string;
  factoryId: string;
  challanNumber: ChallanNumber;
  challanDate: string;
  customerId: string;
  customerNameSnapshot: string;
  customerAddressSnapshot: string;
  customerMobileSnapshot: string;
  companyNameSnapshot: string;
  companyBusinessDescriptionSnapshot: string;
  companyAddressSnapshot: string;
  companyMobileSnapshot: string;
  companyVillageSnapshot: string | null;
  companyPostOfficeSnapshot: string | null;
  companyPoliceStationSnapshot: string | null;
  companyDistrictSnapshot: string | null;
  companyStateSnapshot: string | null;
  vehicleId: string | null;
  vehicleNumberSnapshot: string | null;
  deliveryWageApplicableSnapshot: boolean;
  tripLabourWage: number | null;
  /** Legacy print/report compatibility mirror. */
  vehicleNumber: string;
  /** Legacy compatibility mirror; use tripLabourWage for C2 historical meaning. */
  tractorLabourRateSnapshot: number;
  challanTotal: number;
  status: ChallanStatus;
  isLocked: boolean;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChallanItem = {
  id: string;
  factoryId: string;
  challanId: string;
  brickTypeId: string;
  brickParticularsSnapshot: string;
  quantity: number;
  pricingMode?: ChallanBrickPricingMode;
  ratePer1000Bricks: number;
  pricingUnit: ChallanPricingUnit;
  /** Existing brick rows map to this common reporting category without a data migration. */
  lineCategory: "BRICK_REVENUE";
  lineAmount: number;
  linePosition: number;
  createdAt: string;
};

type ChallanFlexibleLineBase = {
  id: string;
  factoryId: string;
  challanId: string;
  orderIndex: number;
  particulars: string;
  createdAt: string;
};

export type ChallanNoteLine = ChallanFlexibleLineBase & {
  lineType: "NOTE";
  lineCategory: "NON_FINANCIAL";
  quantity: null;
  rate: null;
  amount: 0;
};

export type ChallanExtraChargeLine = ChallanFlexibleLineBase & {
  lineType: "EXTRA_CHARGE";
  lineCategory: "OTHER_REVENUE";
  quantity: number | null;
  rate: number | null;
  amount: number;
};

export type ChallanFlexibleLine = ChallanNoteLine | ChallanExtraChargeLine;

export type Challan = ChallanHeader & {
  items: ChallanItem[];
  flexibleLines: ChallanFlexibleLine[];
};

type ChallanItemInputBase = {
  brickTypeId: string;
  quantity: number;
};

export type ChallanItemInput = ChallanItemInputBase & ({
  pricingMode?: "RATE";
  ratePer1000Bricks: number;
  lineAmount?: never;
} | {
  pricingMode: "AMOUNT";
  /** Canonical decimal rupees; retained as text until Postgres casts it to numeric. */
  lineAmount: string;
  ratePer1000Bricks?: never;
});

export type ChallanNoteLineInput = {
  lineType: "NOTE";
  orderIndex: number;
  particulars: string;
};

export type ChallanExtraChargeDirectAmountInput = {
  lineType: "EXTRA_CHARGE";
  orderIndex: number;
  particulars: string;
  amount: number;
  quantity?: never;
  rate?: never;
};

export type ChallanExtraChargeCalculatedInput = {
  lineType: "EXTRA_CHARGE";
  orderIndex: number;
  particulars: string;
  quantity: number;
  rate: number;
  /** Optional cross-check only; the database always calculates quantity × rate. */
  amount?: number;
};

export type ChallanFlexibleLineInput =
  | ChallanNoteLineInput
  | ChallanExtraChargeDirectAmountInput
  | ChallanExtraChargeCalculatedInput;

export type CreateChallanInput = {
  factoryId: string;
  challanNumber?: ChallanNumber;
  challanDate: string;
  customerId: string;
  vehicleId: string | null;
  tripLabourWage: number | null;
  /** May be empty when final content contains at least one NOTE or EXTRA_CHARGE line. */
  items: ChallanItemInput[];
  /** Omitted on create means no flexible lines. */
  flexibleLines?: ChallanFlexibleLineInput[];
};

export type UpdateChallanInput = CreateChallanInput & {
  challanId: string;
  /** Omitted on update preserves the existing flexible-line collection; [] clears it. */
  flexibleLines?: ChallanFlexibleLineInput[];
};

export type CustomerPaymentAllocation = {
  id: string;
  factoryId: string;
  paymentId: string;
  challanId: string;
  challanNumber: ChallanNumber;
  allocatedAmount: number;
  createdAt: string;
};

export type CustomerPaymentMode =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "cheque"
  | "other"
  | "unspecified";

export type NewCustomerPaymentMode = Exclude<CustomerPaymentMode, "unspecified">;

export const NEW_CUSTOMER_PAYMENT_MODES: readonly NewCustomerPaymentMode[] = [
  "cash", "upi", "bank_transfer", "cheque", "other",
];

export function isNewCustomerPaymentMode(value: string): value is NewCustomerPaymentMode {
  return NEW_CUSTOMER_PAYMENT_MODES.some((mode) => mode === value);
}

export function formatCustomerPaymentMode(mode: CustomerPaymentMode): string {
  if (mode === "upi") return "UPI";
  if (mode === "bank_transfer") return "Bank Transfer";
  if (mode === "unspecified") return "Legacy / Unspecified";
  return `${mode.slice(0, 1).toUpperCase()}${mode.slice(1)}`;
}

export type CustomerPayment = {
  id: string;
  factoryId: string;
  customerId: string;
  customerNameSnapshot: string;
  customerAddressSnapshot: string;
  customerMobileSnapshot: string;
  companyNameSnapshot: string;
  companyBusinessDescriptionSnapshot: string;
  companyAddressSnapshot: string;
  companyMobileSnapshot: string;
  paymentDate: string;
  amount: number;
  paymentMode: CustomerPaymentMode;
  note: string | null;
  createdAt: string;
  allocations: CustomerPaymentAllocation[];
};

export type CustomerPaymentAllocationInput = {
  challanId: string;
  amount: number;
};

export type CreateCustomerPaymentInput = {
  factoryId: string;
  customerId: string;
  paymentDate: string;
  amount: number;
  paymentMode: NewCustomerPaymentMode;
  note?: string | null;
  allocations: CustomerPaymentAllocationInput[];
};

export type ChallanPaymentState = "unpaid" | "partially_paid" | "paid";

export type ChallanPaymentSummary = {
  challanId: string;
  challanStatus: ChallanStatus;
  saleTotal: number;
  totalPaid: number;
  outstandingAmount: number;
  paymentState: ChallanPaymentState;
};

export type CustomerSalesSummary = {
  customerId: string;
  totalActiveSales: number;
  totalPaymentsAllocated: number;
  totalOutstanding: number;
};

export type CustomerOutstandingBrickLine = {
  itemId: string;
  particularsSnapshot: string;
  quantity: number;
};

export type CustomerOutstandingChallan = ChallanPaymentSummary & {
  challanNumber: ChallanNumber;
  challanDate: string;
  createdAt: string;
  isLocked: boolean;
  brickLines: CustomerOutstandingBrickLine[];
};
