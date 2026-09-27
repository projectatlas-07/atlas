import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/staff-management-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/staff-office-section.tsx", import.meta.url),
  "utf8",
);
const identityMigration = readFileSync(
  new URL("../../../supabase/migrations/20260820000000_create_staff_salary_foundation.sql", import.meta.url),
  "utf8",
);
const lifecycleMigration = readFileSync(
  new URL("../../../supabase/migrations/20260820000009_create_staff_archive_runtime.sql", import.meta.url),
  "utf8",
);

test("Staff management opens as the focused responsive V2 drawer", () => {
  assert.match(officeSection, /<StaffManagementDrawer/);
  assert.doesNotMatch(officeSection, /function WorkerCard/);
  assert.match(drawer, /fixed inset-0 z-50/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /id="staff-management-title"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("management contains only supported Staff responsibilities", () => {
  for (const responsibility of [
    "Staff details",
    "Reference salary",
    "Staff status",
    "Archive Staff member",
    "Restore Staff member",
    "Permanent deletion",
  ]) assert.match(drawer, new RegExp(responsibility));

  for (const service of [
    "updateStaffReferenceSalary",
    "archiveStaffWorker",
    "restoreStaffWorker",
    "deleteStaffWorker",
  ]) assert.match(drawer, new RegExp(service));

  assert.doesNotMatch(drawer, /recordStaffPayment|listStaffPayments|buildStaffPaymentInput/);
  assert.doesNotMatch(drawer, /Record payment|Recent payments|Payment history<|Paid in period/);
});

test("immutable Staff identity and category assignment are presented read-only", () => {
  assert.match(drawer, /Staff identity cannot be changed after creation/);
  assert.match(drawer, /Category assignment is fixed after Staff creation/);
  assert.match(identityMigration, /prevent_staff_worker_reassignment/);
  assert.match(identityMigration, /new\.staff_category_id is distinct from old\.staff_category_id/);
  assert.doesNotMatch(drawer, /updateStaffName|updateStaffCategoryAssignment|Change category/);
});

test("reference salary remains informational and service-backed", () => {
  assert.match(drawer, /buildStaffReferenceSalaryInput/);
  assert.match(drawer, /await updateStaffReferenceSalary\(input\)/);
  assert.match(drawer, /staffWorkersQueryKey\(factoryId\)/);
  assert.match(drawer, /informational only and does not represent an automatic payable or accrued debt/);
  assert.match(drawer, /does not change actual payments/);
  assert.doesNotMatch(drawer, /salary due|unpaid salary|accrued payroll|settlement balance|attendance/i);
});

test("lifecycle and guarded deletion preserve service and database authority", () => {
  assert.match(drawer, /await archiveStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(drawer, /await restoreStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(drawer, /await deleteStaffWorker\(\{ factoryId, staffWorkerId: worker\.id \}\)/);
  assert.match(drawer, /getStaffPaymentSummary/);
  assert.match(drawer, /const canDelete = worker\.isActive/);
  assert.match(drawer, /&& !hasPaymentHistory/);
  assert.match(drawer, /The database verifies this again before deleting/);
  assert.match(lifecycleMigration, /from public\.staff_payments/);
  assert.match(lifecycleMigration, /using errcode = 'P2540'/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(/);
});

test("drawer follows Atlas V2 tokens and shared primitives", () => {
  for (const primitive of ["Button", "Card", "Feedback", "FormField", "Input", "StatusPill"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.match(drawer, /STAFF_WORKER_LIFECYCLE_STATUS/);
  assert.doesNotMatch(drawer, /<(?:input|select)\b/);
  assert.doesNotMatch(drawer, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});
