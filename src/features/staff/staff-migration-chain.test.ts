import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = (name: string) => readFileSync(
  new URL(`../../../supabase/migrations/${name}`, import.meta.url),
  "utf8",
);

const foundation = migration("20260820000000_create_staff_salary_foundation.sql");
const entitlements = migration("20260820000001_create_staff_monthly_entitlements.sql");
const payments = migration("20260820000007_create_staff_payments.sql");
const referenceRuntime = migration(
  "20260820000008_create_staff_reference_salary_runtime.sql",
);
const archiveRuntime = migration(
  "20260820000009_create_staff_archive_runtime.sql",
);
const cleanup = migration(
  "20260820000010_remove_legacy_staff_salary_engine.sql",
);
const categoryManagement = migration(
  "20260820000011_create_staff_category_management.sql",
);
const categoryStateCleanup = migration(
  "20260820000012_finalize_staff_runtime_schema.sql",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_staff_runtime_final.sql", import.meta.url),
  "utf8",
);

const legacyTables = [
  "staff_monthly_salary_rates",
  "staff_salary_eligibility_periods",
  "staff_monthly_earnings",
  "staff_withdrawals",
  "staff_salary_deductions",
] as const;

const legacyFunctions = [
  "create_staff_category_monthly_salary",
  "create_staff_monthly_salary_override",
  "resolve_staff_monthly_salary",
  "ensure_staff_monthly_earnings",
  "get_staff_financial_summary",
  "create_staff_withdrawal",
  "create_staff_salary_deduction",
  "deactivate_staff_worker",
  "reactivate_staff_worker",
] as const;

test("historical Staff migrations remain intact before the replacement cutover", () => {
  assert.match(foundation, /create table public\.staff_monthly_salary_rates/i);
  assert.match(entitlements, /create table public\.staff_salary_eligibility_periods/i);
  assert.match(entitlements, /create table public\.staff_monthly_earnings/i);
  assert.match(entitlements, /create or replace function public\.create_staff_worker\s*\(/i);
  assert.match(entitlements, /create or replace function public\.deactivate_staff_worker/i);
  assert.match(entitlements, /create or replace function public\.reactivate_staff_worker/i);
});

test("S1 through S4 establish the authoritative replacement Staff runtime", () => {
  for (const pattern of [
    /add column reference_salary numeric/i,
    /create table public\.staff_payments/i,
    /Staff payments are immutable/i,
    /create or replace function public\.record_staff_payment/i,
    /create or replace function public\.get_staff_payment_summary/i,
  ]) assert.match(payments, pattern);

  for (const pattern of [
    /create or replace function public\.create_staff_worker_with_reference_salary/i,
    /create or replace function public\.update_staff_reference_salary/i,
  ]) assert.match(referenceRuntime, pattern);

  for (const pattern of [
    /create or replace function public\.archive_staff_worker/i,
    /create or replace function public\.restore_staff_worker/i,
    /Archived Staff members cannot receive new payments/i,
    /payment history and cannot be deleted\. Archive them instead/i,
  ]) assert.match(archiveRuntime, pattern);
});

test("S5 explicitly removes every legacy Staff table without CASCADE", () => {
  for (const table of legacyTables) {
    assert.match(cleanup, new RegExp(`drop table public\\.${table};`, "i"));
  }
  assert.doesNotMatch(cleanup, /\bcascade\b/i);

  const deductions = cleanup.indexOf("drop table public.staff_salary_deductions");
  const withdrawals = cleanup.indexOf("drop table public.staff_withdrawals");
  const earnings = cleanup.indexOf("drop table public.staff_monthly_earnings");
  const eligibility = cleanup.indexOf("drop table public.staff_salary_eligibility_periods");
  const rates = cleanup.indexOf("drop table public.staff_monthly_salary_rates");
  assert.ok(deductions >= 0 && withdrawals > deductions && earnings > withdrawals);
  assert.ok(eligibility > earnings && rates > eligibility);
});

test("S5 removes obsolete RPCs and their trigger-only helpers", () => {
  for (const functionName of legacyFunctions) {
    assert.match(cleanup, new RegExp(`drop function public\\.${functionName}\\(`, "i"));
  }
  assert.match(
    cleanup,
    /drop function public\.create_staff_worker\(uuid, text, uuid, date, numeric\)/i,
  );
  for (const helper of [
    "prevent_staff_monthly_earning_mutation",
    "prevent_staff_withdrawal_mutation",
    "prevent_staff_salary_deduction_mutation",
  ]) assert.match(cleanup, new RegExp(`drop function public\\.${helper}\\(\\);`, "i"));
});

test("S5 retains only the authoritative Staff domain and does not touch other wage systems", () => {
  for (const retained of [
    "staff_categories",
    "staff_workers",
    "staff_payments",
    "create_staff_worker_with_reference_salary",
    "update_staff_reference_salary",
    "record_staff_payment",
    "get_staff_payment_summary",
    "archive_staff_worker",
    "restore_staff_worker",
    "delete_staff_worker",
  ]) assert.doesNotMatch(cleanup, new RegExp(`drop (?:table|function) public\\.${retained}`, "i"));

  assert.doesNotMatch(
    cleanup,
    /public\.(?:production_|transport_|labourers|labour_groups|weekly_earnings|wage_rates)/i,
  );
});

test("S5.1 adds controlled category rename and concurrency-safe guarded deletion", () => {
  for (const pattern of [
    /create or replace function public\.update_staff_category\s*\(/i,
    /create or replace function public\.delete_staff_category\s*\(/i,
    /security definer[\s\S]*set search_path = pg_catalog, public/i,
    /normalized_name text := btrim\(p_name\)/i,
    /Staff category name is required/i,
    /from public\.staff_categories[\s\S]*for update/i,
    /from public\.staff_workers/i,
    /assigned to Staff members and cannot be deleted/i,
    /revoke update on public\.staff_categories from authenticated/i,
    /grant execute on function public\.update_staff_category\(uuid, uuid, text\)/i,
    /grant execute on function public\.delete_staff_category\(uuid, uuid\)/i,
  ]) assert.match(categoryManagement, pattern);

  assert.doesNotMatch(categoryManagement, /cascade|reassign|archive_staff_category/i);
  assert.doesNotMatch(
    categoryManagement,
    /public\.(?:production_|transport_|labourers|labour_groups|weekly_earnings|wage_rates)/i,
  );
});

test("S6 removes the obsolete category archive state without touching other systems", () => {
  assert.match(categoryStateCleanup, /every existing Staff worker needs a positive reference salary/i);
  assert.match(categoryStateCleanup, /alter column reference_salary set not null/i);
  assert.match(categoryStateCleanup, /drop index public\.staff_categories_factory_active_idx/i);
  assert.match(categoryStateCleanup, /alter table public\.staff_categories[\s\S]*drop column is_active/i);
  assert.match(categoryStateCleanup, /do not define salary or have an archive lifecycle/i);
  assert.doesNotMatch(categoryStateCleanup, /\bcascade\b/i);
  assert.doesNotMatch(
    categoryStateCleanup,
    /public\.(?:production_|transport_|labourers|labour_groups|weekly_earnings|wage_rates)/i,
  );
});

test("the single S6 verifier covers the exact release flow, schema, races, and isolation", () => {
  for (const pattern of [
    /Staff A is created with ₹1,20,000 reference salary and ₹0 Total Paid/i,
    /₹3,000 and ₹2,500 remain individually visible newest-first and Total Paid is ₹5,500/i,
    /reference salary changes to ₹1,30,000 without changing payments or Total Paid/i,
    /category rename preserves category UUID, Staff identity, salary, and payment history/i,
    /category used by active Staff cannot be deleted/i,
    /category referenced only by archived Staff cannot be deleted/i,
    /restore requires no date, creates no finance, and payments resume at ₹9,500 Total Paid/i,
    /paid Staff is protected and mistaken zero-payment Staff is permanently deleted/i,
    /an unused category can be deleted/i,
    /Factory A cannot view or mutate any Factory B Staff object/i,
    /every final Staff worker must own a reference salary/i,
    /all nine authoritative RPCs have safe definitions and locked-down grants/i,
    /payment UPDATE remains immutable even for a privileged writer/i,
    /payment, archive, restore, worker-delete, and category-delete races are serialized/i,
    /legacy Staff salary, entitlement, balance, withdrawal, and deduction engine is absent/i,
    /Production, Mud, and Chamber Transport architecture remains untouched/i,
    /Atlas Staff S6 final release verifier completed/i,
  ]) assert.match(verifier, pattern);
});
