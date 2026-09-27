import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/add-staff-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/staff-office-section.tsx", import.meta.url),
  "utf8",
);
const creationMigration = readFileSync(
  new URL("../../../supabase/migrations/20260820000008_create_staff_reference_salary_runtime.sql", import.meta.url),
  "utf8",
);

test("Add Staff opens as the focused responsive V2 drawer", () => {
  assert.match(officeSection, /<AddStaffDrawer/);
  assert.doesNotMatch(officeSection, /function WorkerCreate/);
  assert.match(drawer, /fixed inset-0 z-50/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /id="add-staff-title"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /nameInputRef\.current\?\.focus\(\)/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("drawer contains only the three authoritative Staff creation fields", () => {
  for (const field of ["Staff name", "Category", "Reference salary"]) {
    assert.match(drawer, new RegExp(`label="${field}"`));
  }
  assert.match(drawer, /categories\.map\(\(category\) => <option/);
  assert.match(drawer, /Category is fixed after Staff creation/);
  assert.match(drawer, /Staff name and category cannot be changed after creation/);
  assert.doesNotMatch(drawer, /phone|email|address|employee id|joining date|notes|salary frequency/i);
});

test("existing required validation overrides the Stitch optional salary suggestion", () => {
  assert.equal((drawer.match(/^\s+required$/gm) ?? []).length, 3);
  assert.match(drawer, /Staff name is required/);
  assert.match(drawer, /Choose a Staff category/);
  assert.match(drawer, /Reference salary must be greater than zero/);
  assert.match(drawer, /Number\.isFinite\(numericReferenceSalary\)/);
  assert.match(creationMigration, /p_reference_salary is null or p_reference_salary <= 0/);
  assert.doesNotMatch(drawer, /Reference salary[\s\S]{0,80}Optional/);
});

test("creation uses the existing builder, service, and shared Staff cache", () => {
  assert.match(officeSection, /buildStaffWorkerCreateInput\(\{ factoryId, \.\.\.input \}\)/);
  assert.match(officeSection, /await createStaffWorker\(createInput\)/);
  assert.match(officeSection, /staffWorkersQueryKey\(factoryId\)/);
  assert.match(officeSection, /setQueryData<StaffWorker\[]>/);
  assert.match(officeSection, /invalidateQueries\(\{ queryKey: staffWorkersQueryKey\(factoryId\) \}\)/);
  assert.match(drawer, /const mutationError = await onCreate/);
  assert.match(drawer, /if \(mutationError\)/);
  assert.match(drawer, /onClose\(\)/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(/);
});

test("category selection stays connected to the shared category query", () => {
  assert.match(officeSection, /queryKey: staffCategoriesQueryKey\(factoryId\)/);
  assert.match(officeSection, /<AddStaffDrawer[\s\S]*categories=\{categories\}/);
  assert.match(officeSection, /categoriesLoading=\{categoriesQuery\.isLoading\}/);
  assert.match(officeSection, /categoriesError=\{categoriesQuery\.error\}/);
  assert.match(drawer, /Loading Staff categories/);
  assert.match(drawer, /Staff categories are unavailable/);
  assert.match(drawer, /Add a Staff category before creating a Staff member/);
  assert.match(drawer, /disabled=\{isSubmitting \|\| cannotCreate\}/);
});

test("reference salary stays informational and creates no payroll semantics", () => {
  assert.match(drawer, /Informational only\. It does not create accrued salary, payable debt, or automatic payroll/);
  assert.match(drawer, /Payments are recorded separately in Account &amp; payment/);
  assert.doesNotMatch(drawer, /salary due|unpaid salary|payroll period|payment settings|attendance/i);
  assert.doesNotMatch(drawer, /\/ month|weekly|monthly|salary frequency/i);
});

test("submission and dismissal remain safe during the creation request", () => {
  assert.match(drawer, /if \(isSubmitting\) return/);
  assert.match(drawer, /isSubmittingRef/);
  assert.match(drawer, /disabled=\{isSubmitting\}/);
  assert.match(drawer, /loading=\{isSubmitting\}/);
  assert.match(drawer, /loadingLabel="Adding Staff\.\.\."/);
});

test("drawer uses Atlas V2 tokens and shared primitives", () => {
  for (const primitive of ["Button", "Feedback", "FormField", "Input", "Select"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /<(?:input|select)\b/);
  assert.doesNotMatch(drawer, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});
