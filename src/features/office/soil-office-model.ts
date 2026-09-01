import type {
  CreatedSoilPayment,
  SoilEarning,
  SoilFinancialAdjustment,
  SoilFinancialAdjustmentType,
  SoilFinancialSummary,
  SoilPayment,
  SoilWorker,
  SoilWorkerTrolleyRate,
} from "@/features/soil/types";

export const SOIL_SECTION_HEADING = "Soil Supply";

export function splitSoilWorkers(workers: readonly SoilWorker[]): {
  active: SoilWorker[];
  archived: SoilWorker[];
} {
  return {
    active: workers.filter((worker) => worker.isActive),
    archived: workers.filter((worker) => !worker.isActive),
  };
}

export function canOfferUnusedSoilWorkerDelete(input: Readonly<{
  historiesLoaded: boolean;
  earningCount: number;
  paymentCount: number;
  adjustmentCount: number;
}>): boolean {
  return input.historiesLoaded
    && input.earningCount === 0
    && input.paymentCount === 0
    && input.adjustmentCount === 0;
}

export function buildSoilWorkerCreateInput(input: Readonly<{
  factoryId: string;
  name: string;
  initialRate: string;
  effectiveFrom: string;
}>) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const initialRatePerTrolley = Number(input.initialRate);
  if (
    !input.factoryId || !name || !input.initialRate.trim()
    || !Number.isFinite(initialRatePerTrolley) || initialRatePerTrolley <= 0
    || !isCanonicalDate(input.effectiveFrom)
  ) return null;

  return {
    factoryId: input.factoryId,
    name,
    initialRatePerTrolley,
    initialEffectiveFrom: input.effectiveFrom,
  };
}

export function buildSoilRateChangeInput(input: Readonly<{
  factoryId: string;
  soilWorkerId: string;
  rate: string;
  effectiveFrom: string;
}>) {
  const ratePerTrolley = Number(input.rate);
  if (
    !input.factoryId || !input.soilWorkerId || !input.rate.trim()
    || !Number.isFinite(ratePerTrolley) || ratePerTrolley <= 0
    || !isCanonicalDate(input.effectiveFrom)
  ) return null;

  return {
    factoryId: input.factoryId,
    soilWorkerId: input.soilWorkerId,
    ratePerTrolley,
    effectiveFrom: input.effectiveFrom,
  };
}

export function buildSoilPaymentInput(input: Readonly<{
  factoryId: string;
  soilWorkerId: string;
  paymentDate: string;
  amount: string;
  availableBalance: number;
}>) {
  const amount = Number(input.amount);
  if (
    !input.factoryId || !input.soilWorkerId || !input.amount.trim()
    || !Number.isFinite(amount) || amount <= 0
    || amount > input.availableBalance
    || !isCanonicalDate(input.paymentDate)
  ) return null;

  return {
    factoryId: input.factoryId,
    soilWorkerId: input.soilWorkerId,
    paymentDate: input.paymentDate,
    amount,
  };
}

export function buildSoilAdjustmentInput(input: Readonly<{
  factoryId: string;
  soilWorkerId: string;
  adjustmentType: SoilFinancialAdjustmentType | "";
  adjustmentDate: string;
  amount: string;
  reason: string;
  availableBalance: number;
}>) {
  const amount = Number(input.amount);
  const reason = input.reason.trim();
  if (
    !input.factoryId || !input.soilWorkerId
    || (input.adjustmentType !== "ADDITION" && input.adjustmentType !== "DEDUCTION")
    || !input.amount.trim() || !Number.isFinite(amount) || amount <= 0
    || (input.adjustmentType === "DEDUCTION" && amount > input.availableBalance)
    || !isCanonicalDate(input.adjustmentDate) || !reason
  ) return null;

  return {
    factoryId: input.factoryId,
    soilWorkerId: input.soilWorkerId,
    adjustmentType: input.adjustmentType,
    adjustmentDate: input.adjustmentDate,
    amount,
    reason,
  };
}

export function formatSoilMoney(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  })}`;
}

export function formatSoilDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatSoilQuantity(quantity: number): string {
  return quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function buildSoilEarningHistoryItem(earning: SoilEarning): {
  id: string;
  date: string;
  description: string;
  amount: string;
  isCorrection: boolean;
} {
  const quantityAndRate = `${formatSoilQuantity(earning.trolleyQuantitySnapshot)} trolleys × ${formatSoilMoney(earning.ratePerTrolleySnapshot)}`;
  return {
    id: earning.id,
    date: formatSoilDate(earning.workDate),
    description: earning.eventType === "BASE"
      ? quantityAndRate
      : `Correction → ${quantityAndRate}`,
    amount: `${earning.amount >= 0 ? "+" : "−"}${formatSoilMoney(Math.abs(earning.amount))}`,
    isCorrection: earning.eventType === "CORRECTION",
  };
}

export function insertSoilPaymentNewestFirst(
  payments: readonly SoilPayment[],
  payment: SoilPayment,
): SoilPayment[] {
  return [...payments.filter((item) => item.id !== payment.id), payment].sort(
    (left, right) => right.paymentDate.localeCompare(left.paymentDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id),
  );
}

export function insertSoilAdjustmentNewestFirst(
  adjustments: readonly SoilFinancialAdjustment[],
  adjustment: SoilFinancialAdjustment,
): SoilFinancialAdjustment[] {
  return [...adjustments.filter((item) => item.id !== adjustment.id), adjustment].sort(
    (left, right) => right.adjustmentDate.localeCompare(left.adjustmentDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id),
  );
}

export function insertSoilRateNewestFirst(
  rates: readonly SoilWorkerTrolleyRate[],
  rate: SoilWorkerTrolleyRate,
): SoilWorkerTrolleyRate[] {
  return [...rates.filter((item) => item.id !== rate.id), rate].sort(
    (left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)
      || right.id.localeCompare(left.id),
  );
}

export function mergeSoilPaymentSummary(
  current: SoilFinancialSummary | undefined,
  payment: CreatedSoilPayment,
): SoilFinancialSummary | undefined {
  if (!current) return undefined;
  return {
    ...current,
    totalEarned: payment.totalEarned,
    totalPaid: payment.totalPaid,
    availableBalance: payment.availableBalance,
  };
}

export function soilOfficeErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "P2802" || /payment.*available balance/i.test(message)) {
    return "Payment exceeds this worker's available balance.";
  }
  if (code === "P2902" || /deduction.*available balance/i.test(message)) {
    return "Deduction exceeds this worker's available balance.";
  }
  if (code === "23P01" || code === "P2603") {
    return "The new rate overlaps or starts before the current rate history allows.";
  }
  if (code === "P2602" || code === "42501") {
    return "You do not have access to this Soil worker.";
  }
  if (code === "P2A01") return "This Soil worker is already archived.";
  if (code === "P2A02") return "This Soil worker is already active.";
  if (code === "P2A03") {
    return "Archived Soil workers cannot receive trolley entries. Restore the worker first.";
  }
  if (code === "P2A04") {
    return "This Soil worker has historical records and cannot be deleted. Archive the worker instead.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

function isCanonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}
