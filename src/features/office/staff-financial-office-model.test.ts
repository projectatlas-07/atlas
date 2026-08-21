import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type {
  CreatedStaffWithdrawal,
  StaffMonthlyEarning,
  StaffSalaryDeduction,
  StaffWithdrawal,
} from "@/features/staff/types";
import {
  buildStaffDeductionHistoryItem,
  buildStaffDeductionInput,
  buildStaffEarningHistoryItem,
  buildStaffWithdrawalHistoryItem,
  buildStaffWithdrawalInput,
  formatStaffMoney,
  staffDeductionsKey,
  staffEarningsKey,
  staffFinancialErrorMessage,
  staffFinancialSummaryKey,
  staffWithdrawalsKey,
  summaryFromFinancialMutation,
} from "./staff-financial-office-model.ts";

const earning: StaffMonthlyEarning = {
  id: "earning-a", factoryId: "factory-a", staffWorkerId: "staff-a",
  salaryMonth: "2026-08-01", creditedAmount: 20000,
  salaryConfigurationId: "rate-a", resolvedMonthlySalarySnapshot: 20000,
  salarySourceSnapshot: "CATEGORY_DEFAULT", creditSource: "NORMAL_SALARY",
  staffCategoryIdSnapshot: "category-a", createdAt: "2026-08-20T00:00:00Z",
};

test("financial summary preserves authoritative totals including zero balance", () => {
  const mutation: CreatedStaffWithdrawal = {
    id: "withdrawal-a", factoryId: "factory-a", staffWorkerId: "staff-a",
    withdrawalDate: "2026-08-20", amount: 18000, createdAt: "2026-08-20T00:00:00Z",
    totalEarnings: 20000, totalDeductions: 2000, totalWithdrawn: 18000, availableBalance: 0,
  };
  assert.deepEqual(summaryFromFinancialMutation(mutation), {
    totalEarnings: 20000, totalDeductions: 2000, totalWithdrawn: 18000, availableBalance: 0,
  });
  assert.equal(formatStaffMoney(0), "₹0");
});

test("partial and exact-full withdrawal amounts produce valid RPC inputs", () => {
  for (const amount of ["5000", "20000"]) {
    assert.deepEqual(buildStaffWithdrawalInput({
      factoryId: "factory-a", staffWorkerId: "staff-a", amount, withdrawalDate: "2026-08-20",
    }), {
      factoryId: "factory-a", staffWorkerId: "staff-a", amount: Number(amount), withdrawalDate: "2026-08-20",
    });
  }
  assert.equal(buildStaffWithdrawalInput({
    factoryId: "factory-a", staffWorkerId: "staff-a", amount: "0", withdrawalDate: "2026-08-20",
  }), null);
});

test("manual deduction accepts an optional trimmed reason", () => {
  assert.deepEqual(buildStaffDeductionInput({
    factoryId: "factory-a", staffWorkerId: "staff-a", amount: "1500",
    deductionDate: "2026-08-20", reason: "  Absent for several days  ",
  }), {
    factoryId: "factory-a", staffWorkerId: "staff-a", amount: 1500,
    deductionDate: "2026-08-20", reason: "Absent for several days",
  });
  assert.equal(buildStaffDeductionInput({
    factoryId: "factory-a", staffWorkerId: "staff-a", amount: "1500",
    deductionDate: "2026-08-20", reason: "   ",
  })?.reason, null);
});

test("earning history distinguishes every manager-facing salary source", () => {
  assert.equal(buildStaffEarningHistoryItem(earning).source, "Category default");
  assert.equal(buildStaffEarningHistoryItem({
    ...earning, id: "earning-b", salarySourceSnapshot: "STAFF_OVERRIDE",
  }).source, "Individual override");
  assert.deepEqual(buildStaffEarningHistoryItem({
    ...earning, id: "earning-c", creditedAmount: 9000,
    resolvedMonthlySalarySnapshot: 10500, creditSource: "FIRST_MONTH_CUSTOM",
  }), {
    id: "earning-c", month: "Aug 2026", amount: "₹9,000",
    source: "First month custom", normalSalary: "₹10,500",
  });
});

test("withdrawal and deduction histories expose stored immutable facts", () => {
  const withdrawal: StaffWithdrawal = {
    id: "withdrawal-a", factoryId: "factory-a", staffWorkerId: "staff-a",
    withdrawalDate: "2026-08-20", amount: 3000, createdAt: "2026-08-20T00:00:00Z",
  };
  const deduction: StaffSalaryDeduction = {
    id: "deduction-a", factoryId: "factory-a", staffWorkerId: "staff-a",
    deductionDate: "2026-08-19", amount: 1500, reason: "Absent",
    createdAt: "2026-08-19T00:00:00Z",
  };
  assert.deepEqual(buildStaffWithdrawalHistoryItem(withdrawal), {
    id: "withdrawal-a", date: "20 Aug 2026", amount: "₹3,000",
  });
  assert.deepEqual(buildStaffDeductionHistoryItem(deduction), {
    id: "deduction-a", date: "19 Aug 2026", amount: "₹1,500", reason: "Absent",
  });
});

test("financial refresh keys remain worker-scoped", () => {
  assert.deepEqual(staffFinancialSummaryKey("factory-a", "staff-a"), ["office-staff-financial-summary", "factory-a", "staff-a"]);
  assert.deepEqual(staffEarningsKey("factory-a", "staff-a"), ["office-staff-earnings", "factory-a", "staff-a"]);
  assert.deepEqual(staffWithdrawalsKey("factory-a", "staff-a"), ["office-staff-withdrawals", "factory-a", "staff-a"]);
  assert.deepEqual(staffDeductionsKey("factory-a", "staff-a"), ["office-staff-deductions", "factory-a", "staff-a"]);
});

test("overdraw, over-deduction, missing salary, and network failures are clear", () => {
  assert.match(staffFinancialErrorMessage({ message: "Withdrawal amount 10 exceeds available Staff balance 9." }, "fallback"), /cannot exceed/);
  assert.match(staffFinancialErrorMessage({ message: "Deduction amount 10 exceeds available Staff balance 9." }, "fallback"), /cannot exceed/);
  assert.match(staffFinancialErrorMessage({ code: "P2503", message: "missing" }, "fallback"), /Salary not set.*first day of an eligible month/);
  assert.match(staffFinancialErrorMessage({ message: "Failed to fetch" }, "fallback"), /Network problem/);
});

test("financial UI is compact, worker-specific, immutable, and prevents duplicate submits", () => {
  const source = readFileSync(new URL("./components/staff-financial-detail.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-expanded=\{isOpen\}/);
  assert.match(source, /\{worker\.name\}.*financials/s);
  for (const label of [
    "Available balance", "Total salary earned", "Total deducted", "Total withdrawn",
    "Record withdrawal", "Manual deduction", "Salary earnings", "Withdrawals",
    "Manual deductions",
  ]) assert.match(source, new RegExp(label));
  assert.match(source, /Inactive Staff.*existing balance and history remain available/);
  assert.match(source, /if \(savingAction\) return/);
  assert.match(source, /disabled=\{Boolean\(savingAction\)\}/);
  assert.match(source, /invalidateQueries[\s\S]*staffFinancialSummaryKey/);
  assert.match(source, /invalidateQueries[\s\S]*staffWithdrawalsKey/);
  assert.match(source, /invalidateQueries[\s\S]*staffDeductionsKey/);
  assert.doesNotMatch(source, />\s*(Edit|Delete)\s*</i);
  assert.doesNotMatch(source, /Generate Salary|Calculate Salary|attendance/i);
});
