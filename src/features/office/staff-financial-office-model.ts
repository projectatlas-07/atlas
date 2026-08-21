import type {
  CreatedStaffSalaryDeduction,
  CreatedStaffWithdrawal,
  StaffFinancialSummary,
  StaffMonthlyEarning,
  StaffSalaryDeduction,
  StaffWithdrawal,
} from "@/features/staff/types";

export const staffFinancialSummaryKey = (factoryId: string, staffWorkerId: string) =>
  ["office-staff-financial-summary", factoryId, staffWorkerId] as const;
export const staffEarningsKey = (factoryId: string, staffWorkerId: string) =>
  ["office-staff-earnings", factoryId, staffWorkerId] as const;
export const staffWithdrawalsKey = (factoryId: string, staffWorkerId: string) =>
  ["office-staff-withdrawals", factoryId, staffWorkerId] as const;
export const staffDeductionsKey = (factoryId: string, staffWorkerId: string) =>
  ["office-staff-deductions", factoryId, staffWorkerId] as const;

export function buildStaffWithdrawalInput(input: Readonly<{
  factoryId: string;
  staffWorkerId: string;
  amount: string;
  withdrawalDate: string;
}>) {
  const amount = Number(input.amount);
  if (
    !input.factoryId || !input.staffWorkerId || !isCanonicalDate(input.withdrawalDate)
    || !input.amount.trim() || !Number.isFinite(amount) || amount <= 0
  ) return null;
  return { factoryId: input.factoryId, staffWorkerId: input.staffWorkerId, amount, withdrawalDate: input.withdrawalDate };
}

export function buildStaffDeductionInput(input: Readonly<{
  factoryId: string;
  staffWorkerId: string;
  amount: string;
  deductionDate: string;
  reason: string;
}>) {
  const amount = Number(input.amount);
  if (
    !input.factoryId || !input.staffWorkerId || !isCanonicalDate(input.deductionDate)
    || !input.amount.trim() || !Number.isFinite(amount) || amount <= 0
  ) return null;
  return {
    factoryId: input.factoryId,
    staffWorkerId: input.staffWorkerId,
    amount,
    deductionDate: input.deductionDate,
    reason: input.reason.trim() || null,
  };
}

export function summaryFromFinancialMutation(
  result: CreatedStaffWithdrawal | CreatedStaffSalaryDeduction,
): StaffFinancialSummary {
  return {
    totalEarnings: result.totalEarnings,
    totalDeductions: result.totalDeductions,
    totalWithdrawn: result.totalWithdrawn,
    availableBalance: result.availableBalance,
  };
}

export function formatStaffMoney(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function buildStaffEarningHistoryItem(earning: StaffMonthlyEarning) {
  const source = earning.creditSource === "FIRST_MONTH_CUSTOM"
    ? "First month custom"
    : earning.salarySourceSnapshot === "STAFF_OVERRIDE"
      ? "Individual override"
      : "Category default";
  return {
    id: earning.id,
    month: formatMonth(earning.salaryMonth),
    amount: formatStaffMoney(earning.creditedAmount),
    source,
    normalSalary: formatStaffMoney(earning.resolvedMonthlySalarySnapshot),
  };
}

export function buildStaffWithdrawalHistoryItem(withdrawal: StaffWithdrawal) {
  return {
    id: withdrawal.id,
    date: formatDate(withdrawal.withdrawalDate),
    amount: formatStaffMoney(withdrawal.amount),
  };
}

export function buildStaffDeductionHistoryItem(deduction: StaffSalaryDeduction) {
  return {
    id: deduction.id,
    date: formatDate(deduction.deductionDate),
    amount: formatStaffMoney(deduction.amount),
    reason: deduction.reason || "No reason recorded",
  };
}

export function staffFinancialErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  if (/withdrawal amount .* exceeds available/i.test(message)) {
    return "Withdrawal cannot exceed the available Staff balance.";
  }
  if (/deduction amount .* exceeds available/i.test(message)) {
    return "Manual deduction cannot exceed the available Staff balance.";
  }
  if (code === "P2521" || /financial history is overdrawn/i.test(message)) {
    return "Staff financial history is overdrawn. No new payment or deduction was recorded.";
  }
  if (code === "P2503" || /no monthly salary applies/i.test(message)) {
    return "Salary not set for the first day of an eligible month. Configure that month's category or individual salary first.";
  }
  if (code === "22023") return "Enter a positive amount and a valid date that is not in the future.";
  if (code === "42501" || code === "401") return "You do not have access to this Staff financial record.";
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

function formatMonth(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
