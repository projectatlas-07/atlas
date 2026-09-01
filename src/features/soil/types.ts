export type SoilWorker = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SoilWorkerTrolleyRate = {
  id: string;
  factoryId: string;
  soilWorkerId: string;
  ratePerTrolley: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};

export type SoilDailyTrolleyEntrySnapshot = {
  id: string;
  factoryId: string;
  soilWorkerId: string;
  workDate: string;
  trolleyQuantity: number;
  soilWorkerTrolleyRateId: string;
  ratePerTrolleySnapshot: number;
  baseAmountSnapshot: number;
  createdAt: string;
  updatedAt: string;
};

export type SoilDailyTrolleyEntry = SoilDailyTrolleyEntrySnapshot & {
  soilWorkerName: string;
  soilWorkerIsActive: boolean;
};

export type SaveSoilDailyTrolleyQuantity = {
  soilWorkerId: string;
  trolleyQuantity: number;
};

export type SaveSoilDailyTrolleyEntriesInput = {
  factoryId: string;
  workDate: string;
  entries: SaveSoilDailyTrolleyQuantity[];
};

export type SoilEarningEventType = "BASE" | "CORRECTION";

export type SoilEarning = {
  id: string;
  factoryId: string;
  soilWorkerId: string;
  soilDailyTrolleyEntryId: string;
  workDate: string;
  eventType: SoilEarningEventType;
  eventSequence: number;
  amount: number;
  trolleyQuantitySnapshot: number;
  ratePerTrolleySnapshot: number;
  previousBaseAmountSnapshot: number;
  sourceBaseAmountSnapshot: number;
  createdAt: string;
};

export type SoilPayment = {
  id: string;
  factoryId: string;
  soilWorkerId: string;
  paymentDate: string;
  amount: number;
  createdAt: string;
};

export type SoilFinancialSummary = {
  totalEarned: number;
  totalAdditions: number;
  totalDeductions: number;
  totalPaid: number;
  availableBalance: number;
};

export type CreatedSoilPayment = SoilPayment & Pick<
  SoilFinancialSummary,
  "totalEarned" | "totalPaid" | "availableBalance"
>;

export type SoilFinancialAdjustmentType = "ADDITION" | "DEDUCTION";

export type SoilFinancialAdjustment = {
  id: string;
  factoryId: string;
  soilWorkerId: string;
  adjustmentType: SoilFinancialAdjustmentType;
  adjustmentDate: string;
  amount: number;
  reason: string;
  createdAt: string;
};

export type CreatedSoilFinancialAdjustment =
  SoilFinancialAdjustment & SoilFinancialSummary;
