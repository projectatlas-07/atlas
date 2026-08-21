import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  EnsureStaffMonthlyEarningsResult,
  CreatedStaffSalaryDeduction,
  CreatedStaffWithdrawal,
  ResolvedStaffMonthlySalary,
  StaffCategory,
  StaffFinancialSummary,
  StaffMonthlyEarning,
  StaffMonthlySalaryRate,
  StaffMonthlySalarySource,
  StaffSalaryDeduction,
  StaffSalaryEligibilityPeriod,
  StaffWorker,
  StaffWithdrawal,
} from "../types.ts";

const CATEGORY_COLUMNS = "id, factory_id, name, is_active, created_at, updated_at";
const WORKER_COLUMNS =
  "id, factory_id, name, staff_category_id, is_active, created_at, updated_at";
const ELIGIBILITY_COLUMNS =
  "id, factory_id, staff_worker_id, effective_from_month, effective_to_month, first_month_custom_salary, created_at, updated_at";

type CategoryRow = {
  id: string; factory_id: string; name: string; is_active: boolean;
  created_at: string; updated_at: string;
};

type WorkerRow = CategoryRow & { staff_category_id: string };

type SalaryRateRow = {
  id: string; factory_id: string; staff_category_id: string | null;
  staff_worker_id: string | null; monthly_salary: number; effective_from: string;
  effective_to: string | null; created_at: string; updated_at: string;
};

type EligibilityRow = {
  id: string; factory_id: string; staff_worker_id: string;
  effective_from_month: string; effective_to_month: string | null;
  first_month_custom_salary: number | null; created_at: string; updated_at: string;
};

type MonthlyEarningRow = {
  id: string; factory_id: string; staff_worker_id: string; salary_month: string;
  credited_amount: number; salary_configuration_id: string;
  resolved_monthly_salary_snapshot: number;
  salary_source_snapshot: StaffMonthlySalarySource;
  credit_source: "NORMAL_SALARY" | "FIRST_MONTH_CUSTOM";
  staff_category_id_snapshot: string; created_at: string;
};

type WithdrawalRow = {
  id: string; factory_id: string; staff_worker_id: string;
  withdrawal_date: string; amount: number; created_at: string;
};

type DeductionRow = {
  id: string; factory_id: string; staff_worker_id: string;
  deduction_date: string; amount: number; reason: string | null; created_at: string;
};

export class StaffSalaryServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "StaffSalaryServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function mapCategory(row: CategoryRow): StaffCategory {
  return { id: row.id, factoryId: row.factory_id, name: row.name,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapWorker(row: WorkerRow): StaffWorker {
  return { id: row.id, factoryId: row.factory_id, name: row.name,
    staffCategoryId: row.staff_category_id, isActive: row.is_active,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapSalaryRate(row: SalaryRateRow): StaffMonthlySalaryRate {
  return { id: row.id, factoryId: row.factory_id,
    staffCategoryId: row.staff_category_id, staffWorkerId: row.staff_worker_id,
    monthlySalary: row.monthly_salary, effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapEligibility(row: EligibilityRow): StaffSalaryEligibilityPeriod {
  return { id: row.id, factoryId: row.factory_id, staffWorkerId: row.staff_worker_id,
    effectiveFromMonth: row.effective_from_month, effectiveToMonth: row.effective_to_month,
    firstMonthCustomSalary: row.first_month_custom_salary,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapMonthlyEarning(row: MonthlyEarningRow): StaffMonthlyEarning {
  return { id: row.id, factoryId: row.factory_id, staffWorkerId: row.staff_worker_id,
    salaryMonth: row.salary_month, creditedAmount: row.credited_amount,
    salaryConfigurationId: row.salary_configuration_id,
    resolvedMonthlySalarySnapshot: row.resolved_monthly_salary_snapshot,
    salarySourceSnapshot: row.salary_source_snapshot, creditSource: row.credit_source,
    staffCategoryIdSnapshot: row.staff_category_id_snapshot, createdAt: row.created_at };
}

function mapWithdrawal(row: WithdrawalRow): StaffWithdrawal {
  return { id: row.id, factoryId: row.factory_id, staffWorkerId: row.staff_worker_id,
    withdrawalDate: row.withdrawal_date, amount: row.amount, createdAt: row.created_at };
}

function mapDeduction(row: DeductionRow): StaffSalaryDeduction {
  return { id: row.id, factoryId: row.factory_id, staffWorkerId: row.staff_worker_id,
    deductionDate: row.deduction_date, amount: row.amount, reason: row.reason,
    createdAt: row.created_at };
}

function requireTrimmedName(name: string, label: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error(`${label} name is required.`);
  return trimmedName;
}

export async function listStaffCategories(factoryId: string): Promise<StaffCategory[]> {
  const { data, error } = await supabase.from("staff_categories").select(CATEGORY_COLUMNS)
    .eq("factory_id", factoryId).order("name", { ascending: true }).order("id", { ascending: true });
  if (error) throw new StaffSalaryServiceError(error);
  return (data ?? []).map(mapCategory);
}

export async function createStaffCategory(input: Readonly<{ factoryId: string; name: string }>): Promise<StaffCategory> {
  const { data, error } = await supabase.from("staff_categories")
    .insert({ factory_id: input.factoryId, name: requireTrimmedName(input.name, "Staff category") })
    .select(CATEGORY_COLUMNS).single();
  if (error) throw new StaffSalaryServiceError(error);
  if (!data) throw new Error("Staff category creation returned no row.");
  return mapCategory(data);
}

async function setCategoryActive(factoryId: string, staffCategoryId: string, isActive: boolean): Promise<void> {
  const { data, error } = await supabase.from("staff_categories").update({ is_active: isActive })
    .eq("id", staffCategoryId).eq("factory_id", factoryId).select("id");
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length !== 1) throw new Error("Staff category was not updated.");
}

export function activateStaffCategory(input: Readonly<{ factoryId: string; staffCategoryId: string }>): Promise<void> {
  return setCategoryActive(input.factoryId, input.staffCategoryId, true);
}

export function deactivateStaffCategory(input: Readonly<{ factoryId: string; staffCategoryId: string }>): Promise<void> {
  return setCategoryActive(input.factoryId, input.staffCategoryId, false);
}

export async function listStaffWorkers(factoryId: string): Promise<StaffWorker[]> {
  const { data, error } = await supabase.from("staff_workers").select(WORKER_COLUMNS)
    .eq("factory_id", factoryId).order("name", { ascending: true }).order("id", { ascending: true });
  if (error) throw new StaffSalaryServiceError(error);
  return (data ?? []).map(mapWorker);
}

export async function listStaffSalaryEligibilityPeriods(
  factoryId: string,
): Promise<StaffSalaryEligibilityPeriod[]> {
  const { data, error } = await supabase.from("staff_salary_eligibility_periods")
    .select(ELIGIBILITY_COLUMNS)
    .eq("factory_id", factoryId)
    .order("effective_from_month", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new StaffSalaryServiceError(error);
  return (data ?? []).map(mapEligibility);
}

export async function createStaffWorker(input: Readonly<{
  factoryId: string; name: string; staffCategoryId: string; salaryStartMonth: string;
  firstMonthCustomSalary?: number | null;
}>): Promise<StaffWorker> {
  const { data, error } = await supabase.rpc("create_staff_worker", {
    p_factory_id: input.factoryId,
    p_name: requireTrimmedName(input.name, "Staff worker"),
    p_staff_category_id: input.staffCategoryId,
    p_salary_start_month: input.salaryStartMonth,
    p_first_month_custom_salary: input.firstMonthCustomSalary ?? null,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data) throw new Error("Staff worker creation returned no row.");
  return mapWorker(data);
}

export async function activateStaffWorker(input: Readonly<{
  factoryId: string; staffWorkerId: string; salaryRestartMonth: string;
}>): Promise<void> {
  const { data, error } = await supabase.rpc("reactivate_staff_worker", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
    p_salary_restart_month: input.salaryRestartMonth,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data) throw new Error("Staff worker activation returned no row.");
}

export async function deactivateStaffWorker(input: Readonly<{
  factoryId: string; staffWorkerId: string; deactivationMonth: string;
}>): Promise<void> {
  const { data, error } = await supabase.rpc("deactivate_staff_worker", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
    p_deactivation_month: input.deactivationMonth,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data) throw new Error("Staff worker deactivation returned no row.");
}

export async function deleteStaffWorker(input: Readonly<{
  factoryId: string; staffWorkerId: string;
}>): Promise<void> {
  const { data, error } = await supabase.rpc("delete_staff_worker", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (data !== input.staffWorkerId) {
    throw new Error("Staff worker deletion did not return the deleted worker ID.");
  }
}

export async function createStaffCategoryMonthlySalary(input: Readonly<{
  factoryId: string; staffCategoryId: string; monthlySalary: number; effectiveFrom: string;
}>): Promise<StaffMonthlySalaryRate> {
  const { data, error } = await supabase.rpc("create_staff_category_monthly_salary", {
    p_factory_id: input.factoryId, p_staff_category_id: input.staffCategoryId,
    p_monthly_salary: input.monthlySalary, p_effective_from: input.effectiveFrom,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data) throw new Error("create_staff_category_monthly_salary returned no rate.");
  return mapSalaryRate(data);
}

export async function createStaffMonthlySalaryOverride(input: Readonly<{
  factoryId: string; staffWorkerId: string; monthlySalary: number; effectiveFrom: string;
}>): Promise<StaffMonthlySalaryRate> {
  const { data, error } = await supabase.rpc("create_staff_monthly_salary_override", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
    p_monthly_salary: input.monthlySalary, p_effective_from: input.effectiveFrom,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data) throw new Error("create_staff_monthly_salary_override returned no rate.");
  return mapSalaryRate(data);
}

export async function resolveStaffMonthlySalary(input: Readonly<{
  factoryId: string; staffWorkerId: string; effectiveDate: string;
}>): Promise<ResolvedStaffMonthlySalary> {
  const { data, error } = await supabase.rpc("resolve_staff_monthly_salary", {
    p_factory_id: input.factoryId, p_staff_id: input.staffWorkerId,
    p_effective_date: input.effectiveDate,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length !== 1) throw new Error("Staff salary resolution did not return exactly one rate.");
  const row = data[0];
  return { salaryConfigurationId: row.salary_configuration_id,
    monthlySalary: row.monthly_salary, source: row.source as StaffMonthlySalarySource,
    staffCategoryId: row.staff_category_id };
}

export async function getStaffCategoryMonthlySalaryForDate(input: Readonly<{
  factoryId: string; staffCategoryId: string; effectiveDate: string;
}>): Promise<StaffMonthlySalaryRate | null> {
  const { data, error } = await supabase.from("staff_monthly_salary_rates")
    .select("id, factory_id, staff_category_id, staff_worker_id, monthly_salary, effective_from, effective_to, created_at, updated_at")
    .eq("factory_id", input.factoryId)
    .eq("staff_category_id", input.staffCategoryId)
    .is("staff_worker_id", null)
    .lte("effective_from", input.effectiveDate)
    .or(`effective_to.is.null,effective_to.gte.${input.effectiveDate}`)
    .limit(2);
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length === 0) return null;
  if (data.length !== 1) throw new Error("Staff category salary resolution is ambiguous.");
  return mapSalaryRate(data[0]);
}

export async function ensureStaffMonthlyEarnings(input: Readonly<{
  factoryId: string; staffWorkerId: string; throughMonth: string;
}>): Promise<EnsureStaffMonthlyEarningsResult> {
  const { data, error } = await supabase.rpc("ensure_staff_monthly_earnings", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
    p_through_month: input.throughMonth,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length !== 1) {
    throw new Error("Staff monthly earning ensure did not return exactly one summary.");
  }
  return { earningsCreated: data[0].earnings_created,
    firstCreatedMonth: data[0].first_created_month,
    lastCreatedMonth: data[0].last_created_month };
}

export async function listStaffMonthlyEarnings(input: Readonly<{
  factoryId: string; staffWorkerId: string;
}>): Promise<StaffMonthlyEarning[]> {
  const { data, error } = await supabase.from("staff_monthly_earnings").select(
    "id, factory_id, staff_worker_id, salary_month, credited_amount, salary_configuration_id, resolved_monthly_salary_snapshot, salary_source_snapshot, credit_source, staff_category_id_snapshot, created_at",
  ).eq("factory_id", input.factoryId).eq("staff_worker_id", input.staffWorkerId)
    .order("salary_month", { ascending: false }).order("id", { ascending: false });
  if (error) throw new StaffSalaryServiceError(error);
  return (data ?? []).map(mapMonthlyEarning);
}

export async function getStaffFinancialSummary(input: Readonly<{
  factoryId: string; staffWorkerId: string;
}>): Promise<StaffFinancialSummary> {
  const { data, error } = await supabase.rpc("get_staff_financial_summary", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length !== 1) {
    throw new Error("Staff financial summary did not return exactly one row.");
  }
  return { totalEarnings: data[0].total_earnings,
    totalDeductions: data[0].total_deductions,
    totalWithdrawn: data[0].total_withdrawn,
    availableBalance: data[0].available_balance };
}

export async function listStaffWithdrawals(input: Readonly<{
  factoryId: string; staffWorkerId: string;
}>): Promise<StaffWithdrawal[]> {
  const { data, error } = await supabase.from("staff_withdrawals")
    .select("id, factory_id, staff_worker_id, withdrawal_date, amount, created_at")
    .eq("factory_id", input.factoryId).eq("staff_worker_id", input.staffWorkerId)
    .order("withdrawal_date", { ascending: false })
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw new StaffSalaryServiceError(error);
  return (data ?? []).map(mapWithdrawal);
}

export async function createStaffWithdrawal(input: Readonly<{
  factoryId: string; staffWorkerId: string; withdrawalDate: string; amount: number;
}>): Promise<CreatedStaffWithdrawal> {
  const { data, error } = await supabase.rpc("create_staff_withdrawal", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
    p_withdrawal_date: input.withdrawalDate, p_amount: input.amount,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length !== 1) {
    throw new Error("Staff withdrawal creation did not return exactly one row.");
  }
  const row = data[0];
  return {
    id: row.withdrawal_id, factoryId: row.withdrawal_factory_id,
    staffWorkerId: row.withdrawal_staff_worker_id,
    withdrawalDate: row.withdrawal_date, amount: row.withdrawal_amount,
    createdAt: row.created_at, totalEarnings: row.total_earnings,
    totalDeductions: row.total_deductions,
    totalWithdrawn: row.total_withdrawn, availableBalance: row.available_balance,
  };
}

export async function listStaffSalaryDeductions(input: Readonly<{
  factoryId: string; staffWorkerId: string;
}>): Promise<StaffSalaryDeduction[]> {
  const { data, error } = await supabase.from("staff_salary_deductions")
    .select("id, factory_id, staff_worker_id, deduction_date, amount, reason, created_at")
    .eq("factory_id", input.factoryId).eq("staff_worker_id", input.staffWorkerId)
    .order("deduction_date", { ascending: false })
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw new StaffSalaryServiceError(error);
  return (data ?? []).map(mapDeduction);
}

export async function createStaffSalaryDeduction(input: Readonly<{
  factoryId: string; staffWorkerId: string; deductionDate: string;
  amount: number; reason?: string | null;
}>): Promise<CreatedStaffSalaryDeduction> {
  const { data, error } = await supabase.rpc("create_staff_salary_deduction", {
    p_factory_id: input.factoryId, p_staff_worker_id: input.staffWorkerId,
    p_deduction_date: input.deductionDate, p_amount: input.amount,
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new StaffSalaryServiceError(error);
  if (!data || data.length !== 1) {
    throw new Error("Staff salary deduction creation did not return exactly one row.");
  }
  const row = data[0];
  return {
    id: row.deduction_id, factoryId: row.deduction_factory_id,
    staffWorkerId: row.deduction_staff_worker_id,
    deductionDate: row.deduction_date, amount: row.deduction_amount,
    reason: row.deduction_reason, createdAt: row.created_at,
    totalEarnings: row.total_earnings, totalDeductions: row.total_deductions,
    totalWithdrawn: row.total_withdrawn, availableBalance: row.available_balance,
  };
}
