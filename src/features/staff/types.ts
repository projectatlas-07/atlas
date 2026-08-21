export type StaffCategory = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StaffWorker = {
  id: string;
  factoryId: string;
  name: string;
  staffCategoryId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StaffSalaryEligibilityPeriod = {
  id: string;
  factoryId: string;
  staffWorkerId: string;
  effectiveFromMonth: string;
  effectiveToMonth: string | null;
  firstMonthCustomSalary: number | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffMonthlySalaryRate = {
  id: string;
  factoryId: string;
  staffCategoryId: string | null;
  staffWorkerId: string | null;
  monthlySalary: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffMonthlySalarySource = "STAFF_OVERRIDE" | "CATEGORY_DEFAULT";

export type ResolvedStaffMonthlySalary = {
  salaryConfigurationId: string;
  monthlySalary: number;
  source: StaffMonthlySalarySource;
  staffCategoryId: string;
};

export type StaffMonthlyEarningCreditSource = "NORMAL_SALARY" | "FIRST_MONTH_CUSTOM";

export type StaffMonthlyEarning = {
  id: string;
  factoryId: string;
  staffWorkerId: string;
  salaryMonth: string;
  creditedAmount: number;
  salaryConfigurationId: string;
  resolvedMonthlySalarySnapshot: number;
  salarySourceSnapshot: StaffMonthlySalarySource;
  creditSource: StaffMonthlyEarningCreditSource;
  staffCategoryIdSnapshot: string;
  createdAt: string;
};

export type EnsureStaffMonthlyEarningsResult = {
  earningsCreated: number;
  firstCreatedMonth: string | null;
  lastCreatedMonth: string | null;
};

export type StaffFinancialSummary = {
  totalEarnings: number;
  totalDeductions: number;
  totalWithdrawn: number;
  availableBalance: number;
};

export type StaffWithdrawal = {
  id: string;
  factoryId: string;
  staffWorkerId: string;
  withdrawalDate: string;
  amount: number;
  createdAt: string;
};

export type CreatedStaffWithdrawal = StaffWithdrawal & StaffFinancialSummary;

export type StaffSalaryDeduction = {
  id: string;
  factoryId: string;
  staffWorkerId: string;
  deductionDate: string;
  amount: number;
  reason: string | null;
  createdAt: string;
};

export type CreatedStaffSalaryDeduction = StaffSalaryDeduction & StaffFinancialSummary;
