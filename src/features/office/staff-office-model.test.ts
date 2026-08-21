import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ResolvedStaffMonthlySalary, StaffCategory, StaffSalaryEligibilityPeriod, StaffWorker } from "@/features/staff/types";
import {
  buildStaffCategoryCreateInput,
  buildStaffLifecycleInput,
  buildStaffSalaryInput,
  buildStaffWorkerCreateInput,
  canonicalMonthStart,
  describeResolvedStaffSalary,
  getStaffCategorySalaryForm,
  getStaffSalaryDisplayMonth,
  resolveStaffSalariesForDisplay,
  STAFF_SECTION_HEADING,
  staffOfficeErrorMessage,
  updateStaffCategorySalaryForm,
} from "./staff-office-model.ts";

const category: StaffCategory = {
  id: "category-a", factoryId: "factory-a", name: "Driver", isActive: true,
  createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
};

function eligibility(staffWorkerId: string, from: string, to: string | null = null): StaffSalaryEligibilityPeriod {
  return {
    id: `eligibility-${staffWorkerId}-${from}`, factoryId: "factory-a", staffWorkerId,
    effectiveFromMonth: from, effectiveToMonth: to, firstMonthCustomSalary: null,
    createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
  };
}

test("Staff section is integrated into the Office dashboard", () => {
  const dashboardSource = readFileSync(new URL("./components/office-dashboard.tsx", import.meta.url), "utf8");
  const sectionSource = readFileSync(new URL("./components/staff-office-section.tsx", import.meta.url), "utf8");
  assert.equal(STAFF_SECTION_HEADING, "Staff");
  assert.match(dashboardSource, /<StaffOfficeSection factoryId=\{factoryId!\}/);
  assert.match(sectionSource, /No Staff categories yet/);
  assert.match(sectionSource, /No Staff members yet/);
});

test("category creation trims a user-defined name and rejects blanks", () => {
  assert.deepEqual(buildStaffCategoryCreateInput("factory-a", "  Driver  "), {
    factoryId: "factory-a", name: "Driver",
  });
  assert.equal(buildStaffCategoryCreateInput("factory-a", "   "), null);
});

test("Staff creation requires category and start month and supports a one-time custom amount", () => {
  assert.deepEqual(buildStaffWorkerCreateInput({
    factoryId: "factory-a", name: "  Asha  ", staffCategoryId: "category-a",
    salaryStartMonth: "2026-08", firstMonthCustomSalary: "9000",
  }), {
    factoryId: "factory-a", name: "Asha", staffCategoryId: "category-a",
    salaryStartMonth: "2026-08-01", firstMonthCustomSalary: 9000,
  });
  assert.equal(buildStaffWorkerCreateInput({
    factoryId: "factory-a", name: "Asha", staffCategoryId: "",
    salaryStartMonth: "2026-08", firstMonthCustomSalary: "",
  }), null);
  assert.equal(buildStaffWorkerCreateInput({
    factoryId: "factory-a", name: "Asha", staffCategoryId: "category-a",
    salaryStartMonth: "2026-08", firstMonthCustomSalary: "0",
  }), null);
});

test("salary setup and individual overrides normalize an effective month to its first day", () => {
  assert.deepEqual(buildStaffSalaryInput({
    factoryId: "factory-a", targetId: "category-a", amount: "20000", effectiveMonth: "2026-08",
  }), { monthlySalary: 20000, effectiveFrom: "2026-08-01" });
  assert.deepEqual(buildStaffSalaryInput({
    factoryId: "factory-a", targetId: "staff-a", amount: "22000", effectiveMonth: "2026-09",
  }), { monthlySalary: 22000, effectiveFrom: "2026-09-01" });
  assert.equal(buildStaffSalaryInput({
    factoryId: "factory-a", targetId: "staff-a", amount: "-1", effectiveMonth: "2026-08",
  }), null);
  assert.equal(buildStaffSalaryInput({
    factoryId: "factory-a", targetId: "staff-a", amount: "20000", effectiveMonth: "2026-13",
  }), null);
});

test("category salary forms stay isolated by category UUID across edits and reordering", () => {
  let forms = {};
  forms = updateStaffCategorySalaryForm(forms, "driver-id", {
    amount: "10500", effectiveMonth: "2026-08",
  }, "2026-08");
  forms = updateStaffCategorySalaryForm(forms, "fireman-id", {
    amount: "80000", effectiveMonth: "2026-09",
  }, "2026-08");
  forms = updateStaffCategorySalaryForm(forms, "fireman-id", { amount: "81000" }, "2026-08");

  const reorderedIds = ["fireman-id", "driver-id"];
  assert.deepEqual(reorderedIds.map((id) => getStaffCategorySalaryForm(forms, id, "2026-08")), [
    { amount: "81000", effectiveMonth: "2026-09" },
    { amount: "10500", effectiveMonth: "2026-08" },
  ]);
});

test("worker creation submits the exact selected category UUID and duplicate names remain independent", () => {
  const driver = buildStaffWorkerCreateInput({
    factoryId: "factory-a", name: "Golu", staffCategoryId: "driver-id",
    salaryStartMonth: "2026-08", firstMonthCustomSalary: "9000",
  });
  const fireman = buildStaffWorkerCreateInput({
    factoryId: "factory-a", name: "Jogo", staffCategoryId: "fireman-id",
    salaryStartMonth: "2026-08", firstMonthCustomSalary: "",
  });
  assert.equal(driver?.staffCategoryId, "driver-id");
  assert.equal(fireman?.staffCategoryId, "fireman-id");
  assert.notEqual(driver?.staffCategoryId, fireman?.staffCategoryId);
});

test("salary results remain keyed by worker UUID when duplicate names resolve in reverse order", async () => {
  const worker = (id: string, staffCategoryId: string): StaffWorker => ({
    id, factoryId: "factory-a", name: "Golu", staffCategoryId, isActive: true,
    createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
  });
  const workers = [worker("golu-1", "driver-id"), worker("golu-2", "driver-id"), worker("jogo-id", "fireman-id")];
  const pending = new Map<string, (value: ResolvedStaffMonthlySalary) => void>();
  const periods = workers.map((staffWorker) => eligibility(staffWorker.id, "2026-08-01"));
  const loading = resolveStaffSalariesForDisplay(workers, periods, "2026-08-01", (staffWorker, effectiveMonth) => new Promise((resolve) => {
    assert.equal(effectiveMonth, "2026-08-01");
    pending.set(staffWorker.id, resolve);
  }));
  pending.get("jogo-id")?.({ salaryConfigurationId: "fire-rate", monthlySalary: 80000, source: "CATEGORY_DEFAULT", staffCategoryId: "fireman-id" });
  pending.get("golu-2")?.({ salaryConfigurationId: "driver-rate", monthlySalary: 10500, source: "CATEGORY_DEFAULT", staffCategoryId: "driver-id" });
  pending.get("golu-1")?.({ salaryConfigurationId: "driver-rate", monthlySalary: 10500, source: "CATEGORY_DEFAULT", staffCategoryId: "driver-id" });

  const results = await loading;
  assert.ok(results["golu-1"]);
  assert.ok(results["golu-2"]);
  assert.ok(results["jogo-id"]);
  assert.equal(results["golu-1"]?.monthlySalary, 10500);
  assert.equal(results["golu-2"]?.monthlySalary, 10500);
  assert.equal(results["jogo-id"]?.monthlySalary, 80000);
  assert.equal(results["jogo-id"]?.staffCategoryId, "fireman-id");
});

test("August 20 card resolution uses August 1 while a future worker uses their start month", async () => {
  const worker = (id: string): StaffWorker => ({
    id, factoryId: "factory-a", name: id, staffCategoryId: category.id, isActive: true,
    createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
  });
  const workers = [worker("dholu-id"), worker("future-id")];
  const periods = [
    eligibility("dholu-id", "2026-08-01"),
    eligibility("future-id", "2026-09-01"),
  ];
  const resolvedDates: Record<string, string> = {};
  const results = await resolveStaffSalariesForDisplay(
    workers, periods, canonicalMonthStart("2026-08")!,
    async (staffWorker, effectiveMonth) => {
      resolvedDates[staffWorker.id] = effectiveMonth;
      return {
        salaryConfigurationId: `${staffWorker.id}-rate`, monthlySalary: 10500,
        source: "CATEGORY_DEFAULT", staffCategoryId: category.id,
      };
    },
  );
  assert.deepEqual(resolvedDates, {
    "dholu-id": "2026-08-01",
    "future-id": "2026-09-01",
  });
  assert.equal(results["dholu-id"]?.monthlySalary, 10500);
  assert.equal(getStaffSalaryDisplayMonth("dholu-id", periods, "2026-08-01"), "2026-08-01");
  assert.equal(getStaffSalaryDisplayMonth("future-id", periods, "2026-08-01"), "2026-09-01");
});

test("current salary displays its amount and understandable source", () => {
  const categoryResolution: ResolvedStaffMonthlySalary = {
    salaryConfigurationId: "rate-a", monthlySalary: 20000,
    source: "CATEGORY_DEFAULT", staffCategoryId: category.id,
  };
  assert.deepEqual(describeResolvedStaffSalary(categoryResolution, category), {
    amount: "₹20,000 / month", source: "Driver default",
  });
  assert.equal(describeResolvedStaffSalary({ ...categoryResolution, source: "STAFF_OVERRIDE" }, category).source, "Individual override");
  assert.match(describeResolvedStaffSalary(null, category).amount, /not set/i);
});

test("first-month custom entitlement never replaces the ongoing resolved salary", () => {
  const resolution: ResolvedStaffMonthlySalary = {
    salaryConfigurationId: "driver-rate", monthlySalary: 10500,
    source: "CATEGORY_DEFAULT", staffCategoryId: category.id,
  };
  const creation = buildStaffWorkerCreateInput({
    factoryId: "factory-a", name: "Golu", staffCategoryId: category.id,
    salaryStartMonth: "2026-08", firstMonthCustomSalary: "9000",
  });
  assert.equal(creation?.firstMonthCustomSalary, 9000);
  assert.equal(describeResolvedStaffSalary(resolution, { ...category, name: "Tractor Driver" }).amount, "₹10,500 / month");
});

test("deactivation and reactivation use explicit canonical months", () => {
  assert.equal(canonicalMonthStart("2026-08"), "2026-08-01");
  assert.equal(canonicalMonthStart("2026-13"), null);
  assert.deepEqual(buildStaffLifecycleInput({ factoryId: "factory-a", staffWorkerId: "staff-a", month: "2026-10" }), {
    factoryId: "factory-a", staffWorkerId: "staff-a", monthStart: "2026-10-01",
  });
});

test("Staff UI exposes no category-changing or manual salary materialization action", () => {
  const sectionSource = readFileSync(new URL("./components/staff-office-section.tsx", import.meta.url), "utf8");
  const financialSource = readFileSync(new URL("./components/staff-financial-detail.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sectionSource, /Change Category/i);
  assert.doesNotMatch(`${sectionSource}\n${financialSource}`, /Generate Salary/i);
  assert.doesNotMatch(`${sectionSource}\n${financialSource}`, /Calculate Salary/i);
  assert.doesNotMatch(`${sectionSource}\n${financialSource}`, /attendance/i);
  assert.doesNotMatch(sectionSource, /type="date"/i);
  assert.match(sectionSource, /type="month"/i);
  assert.match(sectionSource, /staffCategoryId: category\.id/);
  assert.match(sectionSource, /Current monthly salary/);
  assert.match(sectionSource, /effectiveDate: currentMonthStart/);
  assert.match(sectionSource, /effectiveDate: effectiveMonth/);
  assert.match(sectionSource, /key=\{worker\.id\}/);
  assert.match(sectionSource, /setStaffCategoryId\(""\)/);
});

test("Staff cards expose clear lifecycle actions and a UUID-scoped confirmed delete", () => {
  const sectionSource = readFileSync(new URL("./components/staff-office-section.tsx", import.meta.url), "utf8");
  assert.match(sectionSource, />\{worker\.isActive \? "Deactivate" : "Reactivate"\}</);
  assert.match(sectionSource, /Stops future salary while keeping the Staff member and all history/);
  assert.match(sectionSource, /Only for mistakenly created Staff with no salary or financial history/);
  assert.match(sectionSource, /isConfirmingDelete/);
  assert.match(sectionSource, /Confirm delete/);
  assert.match(sectionSource, /deleteStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(sectionSource, /queryKey: workersKey\(factoryId\)/);
});

test("duplicate and request failures have clear messages", () => {
  assert.match(staffOfficeErrorMessage({ code: "23505", message: "duplicate key" }, "fallback"), /already in use/);
  assert.equal(
    staffOfficeErrorMessage({ code: "P2540", message: "salary history" }, "fallback"),
    "This Staff member has salary history and cannot be deleted. Deactivate them instead.",
  );
  assert.match(
    staffOfficeErrorMessage({ code: "P2505", message: "Salary not set for the Staff start month." }, "fallback"),
    /Configure the category salary for that month first/,
  );
  assert.match(staffOfficeErrorMessage({ code: "22023", message: "bad amount" }, "fallback"), /positive salary/);
  assert.match(staffOfficeErrorMessage({ code: "P0001", message: "effective_from must be later than the latest category salary start" }, "fallback"), /Effective month/);
  assert.match(staffOfficeErrorMessage({ code: "P0001", message: "A salary boundary correction cannot change the existing monthly salary amount." }, "fallback"), /keep the existing monthly amount/i);
  assert.match(staffOfficeErrorMessage({ code: "P2511", message: "Category salary boundary correction would contradict immutable Staff monthly earnings." }, "fallback"), /already recorded/i);
  assert.equal(staffOfficeErrorMessage({ code: "08006", message: "Database unavailable." }, "fallback"), "Database unavailable.");
});
