import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/staff-categories-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/staff-office-section.tsx", import.meta.url),
  "utf8",
);
const categoryMigration = readFileSync(
  new URL("../../../supabase/migrations/20260820000011_create_staff_category_management.sql", import.meta.url),
  "utf8",
);
const identityMigration = readFileSync(
  new URL("../../../supabase/migrations/20260820000000_create_staff_salary_foundation.sql", import.meta.url),
  "utf8",
);

test("Manage categories opens as the focused responsive V2 drawer", () => {
  assert.match(officeSection, /<StaffCategoriesDrawer/);
  assert.doesNotMatch(officeSection, /function CategoryManagement/);
  assert.match(drawer, /fixed inset-0 z-50/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /id="staff-categories-title"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("drawer follows the supplied category hierarchy and complete state model", () => {
  for (const content of [
    "Staff categories",
    "Category name",
    "Add category",
    "Existing categories",
    "Save name",
    "Delete category",
    "Done",
  ]) assert.match(drawer, new RegExp(content));

  assert.match(drawer, /Loading Staff categories/);
  assert.match(drawer, /Could not load Staff categories/);
  assert.match(drawer, /No Staff categories yet/);
  assert.match(drawer, /categories\.length\)} total/);
  assert.match(drawer, /assignedStaffCount/);
});

test("category CRUD uses only the existing authoritative services and shared cache", () => {
  for (const service of [
    "createStaffCategory",
    "updateStaffCategory",
    "deleteStaffCategory",
  ]) assert.match(drawer, new RegExp(service));
  assert.match(drawer, /buildStaffCategoryCreateInput/);
  assert.match(drawer, /buildStaffCategoryUpdateInput/);
  assert.match(drawer, /staffCategoriesQueryKey\(factoryId\)/);
  assert.match(drawer, /queryClient\.setQueryData<StaffCategory\[]>/);
  assert.match(drawer, /queryClient\.invalidateQueries/);
  assert.match(drawer, /if \(categoryAction\) return/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(/);
});

test("used-category deletion remains blocked in the UI and authoritative RPC", () => {
  assert.match(drawer, /assignedStaffCount\(category\.id\) > 0/);
  assert.match(drawer, /This category cannot be deleted/);
  assert.match(drawer, /Staff assignments are unavailable, so deletion is disabled/);
  assert.match(drawer, /await deleteStaffCategory\(\{ factoryId, staffCategoryId: category\.id \}\)/);
  assert.match(categoryMigration, /from public\.staff_workers/);
  assert.match(categoryMigration, /assigned to Staff members and cannot be deleted/);
  assert.match(categoryMigration, /using errcode = 'P2570'/);
  assert.match(categoryMigration, /for update/);
});

test("category mutations do not add reassignment or financial semantics", () => {
  assert.match(identityMigration, /new\.staff_category_id is distinct from old\.staff_category_id/);
  assert.match(officeSection, /<AddStaffDrawer[\s\S]*categories=\{categories\}/);
  assert.doesNotMatch(drawer, /updateStaffCategoryAssignment|reassign|Change Staff category/i);
  assert.doesNotMatch(drawer, /reference salary|amount due|payroll|accrual|payment form/i);
  assert.match(drawer, /do not determine salary, payments, attendance, or accounting rules/);
});

test("drawer uses Atlas V2 tokens and shared primitives", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /<(?:input|select)\b/);
  assert.doesNotMatch(drawer, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});
