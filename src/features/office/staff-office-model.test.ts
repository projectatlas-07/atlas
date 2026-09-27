import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { StaffCategory, StaffPayment, StaffWorker } from "@/features/staff/types";
import {
  buildStaffCategoryCreateInput,
  buildStaffCategoryUpdateInput,
  buildStaffPaymentInput,
  buildStaffReferenceSalaryInput,
  buildStaffWorkerCreateInput,
  filterStaffOverviewWorkers,
  formatStaffLastPaid,
  formatStaffMoney,
  formatStaffPaymentDate,
  formatStaffReferenceSalary,
  getStaffInitials,
  insertStaffPaymentNewestFirst,
  latestStaffPayment,
  splitStaffWorkers,
  STAFF_SECTION_HEADING,
  staffOfficeErrorMessage,
  sumStaffPaymentsInRange,
} from "./staff-office-model.ts";

const sectionSource = readFileSync(
  new URL("./components/staff-office-section.tsx", import.meta.url),
  "utf8",
);
const managementDrawerSource = readFileSync(
  new URL("./components/staff-management-drawer.tsx", import.meta.url),
  "utf8",
);
const accountDrawerSource = readFileSync(
  new URL("./components/staff-account-payment-drawer.tsx", import.meta.url),
  "utf8",
);
const categoriesDrawerSource = readFileSync(
  new URL("./components/staff-categories-drawer.tsx", import.meta.url),
  "utf8",
);

function payment(
  id: string,
  paymentDate: string,
  amount: number,
  createdAt: string,
  note: string | null = null,
): StaffPayment {
  return {
    id,
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate,
    amount,
    note,
    createdAt,
  };
}

test("Staff overview remains integrated with focused filter and empty states", () => {
  const dashboardSource = readFileSync(
    new URL("./components/office-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(STAFF_SECTION_HEADING, "Staff");
  assert.match(dashboardSource, /<StaffOfficeSection factoryId=\{factoryId!\}/);
  assert.match(categoriesDrawerSource, /No Staff categories yet/);
  assert.match(sectionSource, /No Staff members yet/);
  assert.match(sectionSource, /No Staff members match these filters/);
  assert.match(sectionSource, /Filter Staff members/);
});

test("categories remain organizational and category creation trims names", () => {
  assert.deepEqual(buildStaffCategoryCreateInput("factory-a", "  Tractor Driver  "), {
    factoryId: "factory-a",
    name: "Tractor Driver",
  });
  assert.equal(buildStaffCategoryCreateInput("factory-a", "   "), null);
  assert.deepEqual(
    buildStaffCategoryUpdateInput("factory-a", "category-a", "  Tractor Driver  "),
    {
      factoryId: "factory-a",
      staffCategoryId: "category-a",
      name: "Tractor Driver",
    },
  );
  assert.equal(
    buildStaffCategoryUpdateInput("factory-a", "category-a", "   "),
    null,
  );
  assert.match(categoriesDrawerSource, /Categories organize Staff members by role/);
  assert.doesNotMatch(categoriesDrawerSource, /category monthly salary|category default|Set salary|Effective month/i);
  assert.doesNotMatch(categoriesDrawerSource, /category\.isActive|activeCategories|Archive Category|Reactivate Category/i);
});

test("category rename and delete update the shared Office category cache immediately", () => {
  assert.match(categoriesDrawerSource, /await updateStaffCategory\(input\)/);
  assert.match(
    categoriesDrawerSource,
    /setQueryData<StaffCategory\[]>[\s\S]*category\.id === updatedCategory\.id \? updatedCategory : category/,
  );
  assert.match(categoriesDrawerSource, /await deleteStaffCategory\(\{/);
  assert.match(
    categoriesDrawerSource,
    /setQueryData<StaffCategory\[]>[\s\S]*current\.filter\(\(item\) => item\.id !== category\.id\)/,
  );
  assert.match(categoriesDrawerSource, /setEditName\(category\.name\)/);
  assert.match(categoriesDrawerSource, /Confirm delete/);
  assert.match(
    sectionSource,
    /category=\{categories\.find\(\(category\) => category\.id === managementWorker\.staffCategoryId\) \?\? null\}/,
  );
  assert.match(sectionSource, /<StaffCategoriesDrawer[\s\S]*categories=\{categories\}[\s\S]*workers=\{workers\}/);
  assert.match(sectionSource, /<AddStaffDrawer[\s\S]*categories=\{categories\}/);
  assert.doesNotMatch(categoriesDrawerSource, /Archive Category|reassign/i);
});

test("Office Staff creation uses name, category, and individual reference salary only", () => {
  assert.deepEqual(buildStaffWorkerCreateInput({
    factoryId: "factory-a",
    name: "  Dholu  ",
    staffCategoryId: "driver-id",
    referenceSalary: "120000",
  }), {
    factoryId: "factory-a",
    name: "Dholu",
    staffCategoryId: "driver-id",
    referenceSalary: 120000,
  });
  assert.equal(buildStaffWorkerCreateInput({
    factoryId: "factory-a",
    name: "Dholu",
    staffCategoryId: "driver-id",
    referenceSalary: "0",
  }), null);
  assert.equal(buildStaffWorkerCreateInput({
    factoryId: "factory-a",
    name: "Dholu",
    staffCategoryId: "",
    referenceSalary: "120000",
  }), null);

  assert.match(sectionSource, /await createStaffWorker\(createInput\)/);
  assert.doesNotMatch(sectionSource, /salaryStartMonth|firstMonthCustomSalary|Salary start month|First-month salary/i);
});

test("required reference salary displays directly", () => {
  assert.equal(formatStaffReferenceSalary(120000), "₹1,20,000");
  assert.deepEqual(buildStaffReferenceSalaryInput({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    referenceSalary: "130000",
  }), {
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    referenceSalary: 130000,
  });
  assert.equal(buildStaffReferenceSalaryInput({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    referenceSalary: "-1",
  }), null);
  assert.match(managementDrawerSource, /await updateStaffReferenceSalary\(input\)/);
  assert.match(managementDrawerSource, /staffWorkersQueryKey\(factoryId\)/);
});

test("payment input accepts arbitrary positive amounts and normalizes optional notes", () => {
  assert.deepEqual(buildStaffPaymentInput({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-23",
    amount: "130000",
    note: "  Weekly payment  ",
  }), {
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-23",
    amount: 130000,
    note: "Weekly payment",
  });
  assert.equal(buildStaffPaymentInput({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-08-23",
    amount: "0",
    note: "",
  }), null);
  assert.equal(buildStaffPaymentInput({
    factoryId: "factory-a",
    staffWorkerId: "staff-a",
    paymentDate: "2026-02-30",
    amount: "1",
    note: "",
  }), null);
  assert.match(accountDrawerSource, /await recordStaffPayment\(input\)/);
  assert.match(accountDrawerSource, /Reference salary is informational only/);
});

test("payment cache insertion remains complete, deduplicated, and newest first", () => {
  const older = payment("payment-a", "2026-08-09", 3500, "2026-08-09T10:00:00Z");
  const newer = payment("payment-c", "2026-08-23", 3000, "2026-08-23T10:00:00Z");
  const middle = payment(
    "payment-b",
    "2026-08-16",
    2500,
    "2026-08-16T10:00:00Z",
    "Weekly payment",
  );
  assert.deepEqual(
    insertStaffPaymentNewestFirst([older, newer], middle).map((item) => item.id),
    ["payment-c", "payment-b", "payment-a"],
  );
  assert.equal(
    insertStaffPaymentNewestFirst([older, middle], { ...middle, amount: 2600 }).length,
    2,
  );
  assert.equal(formatStaffPaymentDate("2026-08-23"), "23 Aug 2026");
  assert.equal(formatStaffMoney(37500), "₹37,500");
});

test("Staff overview filters by lifecycle, name, and category without changing worker records", () => {
  const base: StaffWorker = {
    id: "staff-a",
    factoryId: "factory-a",
    name: "Asha Roy",
    staffCategoryId: "category-a",
    referenceSalary: 12000,
    isActive: true,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
  const archived = {
    ...base,
    id: "staff-b",
    name: "Bimal Sen",
    staffCategoryId: "category-b",
    isActive: false,
  };
  const categoryNames = new Map([
    ["category-a", "Office Assistant"],
    ["category-b", "Plant Supervisor"],
  ]);

  assert.deepEqual(filterStaffOverviewWorkers({
    workers: [base, archived],
    categoryNames,
    lifecycle: "active",
    search: "office",
  }).map((worker) => worker.id), ["staff-a"]);
  assert.deepEqual(filterStaffOverviewWorkers({
    workers: [base, archived],
    categoryNames,
    lifecycle: "archived",
    search: "bimal",
  }).map((worker) => worker.id), ["staff-b"]);
  assert.equal(getStaffInitials("Asha Roy"), "AR");
});

test("Staff overview period totals and Last paid use immutable payment ledger rows", () => {
  const payments = [
    payment("payment-a", "2026-08-31", 3000, "2026-08-31T10:00:00Z"),
    payment("payment-b", "2026-09-01", 2500, "2026-09-01T10:00:00Z"),
    payment("payment-c", "2026-09-15", 4000, "2026-09-15T10:00:00Z"),
    payment("payment-d", "2026-10-01", 1000, "2026-10-01T10:00:00Z"),
  ];

  assert.equal(sumStaffPaymentsInRange(payments, {
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
  }), 6500);
  assert.equal(latestStaffPayment(payments)?.id, "payment-d");
  assert.equal(formatStaffLastPaid("2026-09-24", "2026-09-27"), "Last paid 3 days ago");
  assert.equal(formatStaffLastPaid("2026-09-20", "2026-09-27"), "Last paid 1 week ago");
  assert.equal(formatStaffLastPaid(null, "2026-09-27"), "No payments yet");
});

test("Staff V2 overview shows ledger-paid values and keeps reference salary informational", () => {
  assert.match(sectionSource, /Paid \(\{periodLabel\}\)/);
  assert.match(sectionSource, /sumStaffPaymentsInRange/);
  assert.match(sectionSource, /listStaffPayments/);
  assert.match(sectionSource, /Reference salary is informational only; it does not create accrued salary or payable debt/);
  assert.doesNotMatch(sectionSource, /amount due|salary accrual|unpaid salary|payroll period/i);
});

test("S6 release flow preserves Staff identity while salary, category, lifecycle, and payments change", () => {
  const category: StaffCategory = {
    id: "category-a",
    factoryId: "factory-a",
    name: "Tractor Driver",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
  const staff: StaffWorker = {
    id: "staff-a",
    factoryId: "factory-a",
    name: "Staff A",
    staffCategoryId: category.id,
    referenceSalary: 120000,
    isActive: true,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };

  let history: StaffPayment[] = [];
  assert.equal(history.reduce((total, item) => total + item.amount, 0), 0);
  history = insertStaffPaymentNewestFirst(
    history,
    payment("payment-a", "2026-08-16", 3000, "2026-08-16T10:00:00Z"),
  );
  history = insertStaffPaymentNewestFirst(
    history,
    payment("payment-b", "2026-08-22", 2500, "2026-08-22T10:00:00Z"),
  );
  assert.deepEqual(history.map((item) => item.amount), [2500, 3000]);
  assert.equal(history.reduce((total, item) => total + item.amount, 0), 5500);

  const salaryChanged = { ...staff, referenceSalary: 130000 };
  const renamedCategory = { ...category, name: "Tractor Operator" };
  assert.equal(salaryChanged.id, staff.id);
  assert.equal(salaryChanged.staffCategoryId, renamedCategory.id);
  assert.equal(history.reduce((total, item) => total + item.amount, 0), 5500);

  const archived = { ...salaryChanged, isActive: false };
  assert.deepEqual(splitStaffWorkers([archived]), { active: [], archived: [archived] });
  const restored = { ...archived, isActive: true };
  history = insertStaffPaymentNewestFirst(
    history,
    payment("payment-c", "2026-08-23", 4000, "2026-08-23T10:00:00Z"),
  );
  assert.deepEqual(splitStaffWorkers([restored]), { active: [restored], archived: [] });
  assert.deepEqual(history.map((item) => item.amount), [4000, 2500, 3000]);
  assert.equal(history.reduce((total, item) => total + item.amount, 0), 9500);
});

test("Office reads authoritative payment history and refreshes payment caches immediately", () => {
  assert.match(accountDrawerSource, /listStaffPayments\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(accountDrawerSource, /recordStaffPayment\(input\)/);
  assert.match(accountDrawerSource, /setQueryData<StaffPaymentSummary>[\s\S]*totalPaid: recorded\.totalPaid/);
  assert.match(accountDrawerSource, /setQueryData<StaffPayment\[]>[\s\S]*insertStaffPaymentNewestFirst\(current, recorded\)/);
  assert.match(accountDrawerSource, /Payment history/);
  assert.match(accountDrawerSource, /payment\.note \?\?/);
  assert.match(accountDrawerSource, /Paid in period/);
});

test("Office uses only the authoritative Staff worker and payment services", () => {
  assert.match(sectionSource, /services\/staff-worker-service/);
  assert.match(sectionSource, /services\/staff-payment-service/);
  assert.match(managementDrawerSource, /services\/staff-worker-service/);
  assert.match(accountDrawerSource, /services\/staff-payment-service/);
  assert.doesNotMatch(sectionSource, /available balance|monthly earning/i);
});

test("Staff overview separates Active and Archived Staff and preserves lifecycle controls", () => {
  const base: StaffWorker = {
    id: "staff-a",
    factoryId: "factory-a",
    name: "Asha",
    staffCategoryId: "category-a",
    referenceSalary: 120000,
    isActive: true,
    createdAt: "2026-08-23T10:00:00Z",
    updatedAt: "2026-08-23T10:00:00Z",
  };
  const split = splitStaffWorkers([base, { ...base, id: "staff-b", isActive: false }]);
  assert.deepEqual(split.active.map((worker) => worker.id), ["staff-a"]);
  assert.deepEqual(split.archived.map((worker) => worker.id), ["staff-b"]);

  assert.match(sectionSource, /`Active \$\{formatIndianNumber\(activeCount\)\}`/);
  assert.match(sectionSource, /`Archived \$\{formatIndianNumber\(archivedCount\)\}`/);
  assert.match(managementDrawerSource, /await archiveStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(managementDrawerSource, /await restoreStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(managementDrawerSource, /await deleteStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(managementDrawerSource, /worker\.isActive &&/);
  assert.match(managementDrawerSource, /Confirm permanent delete/);
  assert.match(managementDrawerSource, /Payment history exists,[\s\S]*cannot be permanently deleted/);
  assert.doesNotMatch(managementDrawerSource, /Recycle Bin|Trash/i);
  assert.doesNotMatch(managementDrawerSource, /edit payment|delete payment/i);
  assert.doesNotMatch(managementDrawerSource, /Payment history<|Record payment/);
});

test("Staff request failures remain concise", () => {
  assert.match(
    staffOfficeErrorMessage({ code: "23505", message: "duplicate" }, "fallback"),
    /already in use/,
  );
  assert.equal(
    staffOfficeErrorMessage({ code: "22023", message: "payment_date cannot be later than the current business date" }, "fallback"),
    "Payment date cannot be in the future.",
  );
  assert.match(
    staffOfficeErrorMessage({ code: "42501", message: "denied" }, "fallback"),
    /do not have access/,
  );
  assert.match(
    staffOfficeErrorMessage({ code: "P2540", message: "blocked" }, "fallback"),
    /payment history.*archive/i,
  );
  assert.match(
    staffOfficeErrorMessage({ code: "P2562", message: "blocked" }, "fallback"),
    /Restore.*before recording/i,
  );
  assert.equal(
    staffOfficeErrorMessage({ code: "P2570", message: "blocked" }, "fallback"),
    "This category is assigned to Staff members and cannot be deleted.",
  );
  assert.match(
    staffOfficeErrorMessage({ message: "Failed to fetch" }, "fallback"),
    /Network problem/,
  );
});
