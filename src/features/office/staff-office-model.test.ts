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
  formatStaffMoney,
  formatStaffPaymentDate,
  formatStaffReferenceSalary,
  insertStaffPaymentNewestFirst,
  splitStaffWorkers,
  STAFF_SECTION_HEADING,
  staffOfficeErrorMessage,
} from "./staff-office-model.ts";

const sectionSource = readFileSync(
  new URL("./components/staff-office-section.tsx", import.meta.url),
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

test("S4 Staff section remains integrated with focused active and archived empty states", () => {
  const dashboardSource = readFileSync(
    new URL("./components/office-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(STAFF_SECTION_HEADING, "Staff");
  assert.match(dashboardSource, /<StaffOfficeSection factoryId=\{factoryId!\}/);
  assert.match(sectionSource, /No Staff categories yet/);
  assert.match(sectionSource, /No Staff members yet/);
  assert.match(sectionSource, /No archived Staff members/);
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
  assert.match(sectionSource, /Categories organize Staff by role/);
  assert.doesNotMatch(sectionSource, /category monthly salary|category default|Set salary|Effective month/i);
  assert.doesNotMatch(sectionSource, /category\.isActive|activeCategories|Archive Category|Reactivate Category/i);
});

test("category rename and delete update the shared Office category cache immediately", () => {
  assert.match(sectionSource, /await updateStaffCategory\(input\)/);
  assert.match(
    sectionSource,
    /setQueryData<StaffCategory\[]>[\s\S]*category\.id === updatedCategory\.id \? updatedCategory : category/,
  );
  assert.match(sectionSource, /await deleteStaffCategory\(\{/);
  assert.match(
    sectionSource,
    /setQueryData<StaffCategory\[]>[\s\S]*current\.filter\(\(item\) => item\.id !== category\.id\)/,
  );
  assert.match(sectionSource, /setEditName\(category\.name\)/);
  assert.match(sectionSource, /Confirm delete/);
  assert.match(
    sectionSource,
    /category=\{categories\.find\(\(category\) => category\.id === worker\.staffCategoryId\)\}/,
  );
  assert.ok((sectionSource.match(/categories=\{categoriesQuery\.data \?\? \[\]\}/g) ?? []).length >= 2);
  assert.doesNotMatch(sectionSource, /Archive Category|reassign/i);
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

  assert.match(sectionSource, /await createStaffWorker\(input\)/);
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
  assert.match(sectionSource, /await updateStaffReferenceSalary\(input\)/);
  assert.match(sectionSource, /setQueryData<StaffWorker\[]>\(workersKey\(factoryId\)/);
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
  assert.match(sectionSource, /await recordStaffPayment\(input\)/);
  assert.match(sectionSource, /Reference salary does not limit it/);
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

test("Office reads authoritative Total Paid and payment history and refreshes both immediately", () => {
  assert.match(sectionSource, /getStaffPaymentSummary\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(sectionSource, /listStaffPayments\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(sectionSource, /setQueryData<StaffPaymentSummary>[\s\S]*totalPaid: recorded\.totalPaid/);
  assert.match(sectionSource, /setQueryData<StaffPayment\[]>[\s\S]*insertStaffPaymentNewestFirst\(current, recorded\)/);
  assert.match(sectionSource, /Payment history/);
  assert.match(sectionSource, /\{payment\.note &&/);
  assert.match(sectionSource, /Total Paid:/);
});

test("Office uses only the authoritative Staff worker and payment services", () => {
  assert.match(sectionSource, /services\/staff-worker-service/);
  assert.match(sectionSource, /services\/staff-payment-service/);
  assert.doesNotMatch(sectionSource, /available balance|monthly earning/i);
});

test("S4 separates Active and Archived Staff and uses only the new lifecycle controls", () => {
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

  assert.match(sectionSource, /Active Staff/);
  assert.match(sectionSource, /Archived Staff/);
  assert.match(sectionSource, /await archiveStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(sectionSource, /await restoreStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(sectionSource, /await deleteStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(sectionSource, /worker\.isActive && <div className="space-y-5">/);
  assert.match(sectionSource, /Confirm delete/);
  assert.match(sectionSource, /Payment history exists; archive instead/);
  assert.doesNotMatch(sectionSource, /Recycle Bin|Trash/i);
  assert.doesNotMatch(sectionSource, /edit payment|delete payment/i);
  assert.match(sectionSource, /complete read-only payment history/i);
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
