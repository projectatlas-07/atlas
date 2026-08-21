import type {
  ResolvedStaffMonthlySalary,
  StaffCategory,
  StaffSalaryEligibilityPeriod,
  StaffWorker,
} from "@/features/staff/types";

export const STAFF_SECTION_HEADING = "Staff";

export function canonicalMonthStart(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (year < 1 || monthNumber < 1 || monthNumber > 12) return null;
  return `${month}-01`;
}

export function buildStaffCategoryCreateInput(factoryId: string, name: string) {
  const trimmedName = name.trim();
  return factoryId && trimmedName ? { factoryId, name: trimmedName } : null;
}

export function buildStaffWorkerCreateInput(input: Readonly<{
  factoryId: string;
  name: string;
  staffCategoryId: string;
  salaryStartMonth: string;
  firstMonthCustomSalary: string;
}>) {
  const name = input.name.trim();
  const salaryStartMonth = canonicalMonthStart(input.salaryStartMonth);
  const customInput = input.firstMonthCustomSalary.trim();
  const firstMonthCustomSalary = customInput ? Number(customInput) : null;
  if (
    !input.factoryId || !name || !input.staffCategoryId || !salaryStartMonth
    || (customInput && (!Number.isFinite(firstMonthCustomSalary) || firstMonthCustomSalary! <= 0))
  ) return null;
  return {
    factoryId: input.factoryId,
    name,
    staffCategoryId: input.staffCategoryId,
    salaryStartMonth,
    firstMonthCustomSalary,
  };
}

export function buildStaffSalaryInput(input: Readonly<{
  factoryId: string;
  targetId: string;
  amount: string;
  effectiveMonth: string;
}>) {
  const monthlySalary = Number(input.amount);
  const effectiveFrom = canonicalMonthStart(input.effectiveMonth);
  if (
    !input.factoryId || !input.targetId || !effectiveFrom
    || !input.amount.trim() || !Number.isFinite(monthlySalary) || monthlySalary <= 0
  ) return null;
  return { monthlySalary, effectiveFrom };
}

export type StaffCategorySalaryFormState = {
  amount: string;
  effectiveMonth: string;
};

export function getStaffCategorySalaryForm(
  forms: Readonly<Record<string, StaffCategorySalaryFormState>>,
  staffCategoryId: string,
  defaultMonth: string,
): StaffCategorySalaryFormState {
  return forms[staffCategoryId] ?? { amount: "", effectiveMonth: defaultMonth };
}

export function updateStaffCategorySalaryForm(
  forms: Readonly<Record<string, StaffCategorySalaryFormState>>,
  staffCategoryId: string,
  patch: Partial<StaffCategorySalaryFormState>,
  defaultMonth: string,
): Record<string, StaffCategorySalaryFormState> {
  return {
    ...forms,
    [staffCategoryId]: {
      ...getStaffCategorySalaryForm(forms, staffCategoryId, defaultMonth),
      ...patch,
    },
  };
}

export function getStaffSalaryDisplayMonth(
  staffWorkerId: string,
  eligibilityPeriods: readonly StaffSalaryEligibilityPeriod[],
  currentMonth: string,
): string | null {
  const workerPeriods = eligibilityPeriods.filter(
    (period) => period.staffWorkerId === staffWorkerId,
  );
  const currentPeriod = workerPeriods.find((period) =>
    period.effectiveFromMonth <= currentMonth
    && (period.effectiveToMonth === null || period.effectiveToMonth >= currentMonth));
  if (currentPeriod) return currentMonth;

  const futurePeriod = workerPeriods
    .filter((period) => period.effectiveFromMonth > currentMonth)
    .sort((left, right) => left.effectiveFromMonth.localeCompare(right.effectiveFromMonth))[0];
  if (futurePeriod) return futurePeriod.effectiveFromMonth;

  const latestPastPeriod = workerPeriods
    .filter((period) => period.effectiveToMonth !== null && period.effectiveToMonth < currentMonth)
    .sort((left, right) => right.effectiveToMonth!.localeCompare(left.effectiveToMonth!))[0];
  return latestPastPeriod?.effectiveToMonth ?? null;
}

export async function resolveStaffSalariesForDisplay(
  workers: readonly StaffWorker[],
  eligibilityPeriods: readonly StaffSalaryEligibilityPeriod[],
  currentMonth: string,
  resolver: (
    worker: StaffWorker,
    effectiveMonth: string,
  ) => Promise<ResolvedStaffMonthlySalary | null>,
): Promise<Record<string, ResolvedStaffMonthlySalary | null>> {
  const entries = await Promise.all(workers.map(async (worker) => {
    const effectiveMonth = getStaffSalaryDisplayMonth(
      worker.id, eligibilityPeriods, currentMonth,
    );
    return [
      worker.id,
      effectiveMonth ? await resolver(worker, effectiveMonth) : null,
    ] as const;
  }));
  return Object.fromEntries(entries);
}

export function buildStaffLifecycleInput(input: Readonly<{
  factoryId: string;
  staffWorkerId: string;
  month: string;
}>) {
  const monthStart = canonicalMonthStart(input.month);
  return input.factoryId && input.staffWorkerId && monthStart
    ? { factoryId: input.factoryId, staffWorkerId: input.staffWorkerId, monthStart }
    : null;
}

export function formatStaffMonthlySalary(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / month`;
}

export function describeResolvedStaffSalary(
  resolution: ResolvedStaffMonthlySalary | null,
  category: StaffCategory | undefined,
): { amount: string; source: string } {
  if (!resolution) return { amount: "Salary not set", source: "Add a category salary or individual override." };
  return {
    amount: formatStaffMonthlySalary(resolution.monthlySalary),
    source: resolution.source === "STAFF_OVERRIDE"
      ? "Individual override"
      : `${category?.name ?? "Category"} default`,
  };
}

export function staffOfficeErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  if (code === "23505") return "That Staff category name is already in use for this factory.";
  if (code === "P2540" || /salary history and cannot be deleted/i.test(message)) {
    return "This Staff member has salary history and cannot be deleted. Deactivate them instead.";
  }
  if (code === "P2505" || /salary not set for the Staff start month/i.test(message)) {
    return "Salary not set for this start month. Configure the category salary for that month first.";
  }
  if (code === "22023") return "Enter a positive salary and a valid effective date.";
  if (code === "23P01" || /overlap|ambiguous|multiple.*salary/i.test(message)) {
    return "The salary history overlaps or is ambiguous. Check its effective date.";
  }
  if (/boundary correction cannot change|correction cannot change.*amount/i.test(message)) {
    return "To repair an earlier salary start, keep the existing monthly amount unchanged.";
  }
  if (/correction would contradict immutable.*earnings/i.test(message)) {
    return "This salary start cannot be moved because salary for that month is already recorded.";
  }
  if (/already starts|duplicate.*effective/i.test(message)) {
    return "A salary already starts on this effective date.";
  }
  if (/effective_from must be later than the latest/i.test(message)) {
    return "Effective month must be later than the latest saved salary start.";
  }
  if (/backdated/i.test(message)) return "Backdated salary changes are not allowed.";
  if (code === "42501" || code === "401") return "You do not have access to manage Staff for this factory.";
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}
