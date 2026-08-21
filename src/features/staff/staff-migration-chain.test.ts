import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = (name: string) => readFileSync(
  new URL(`../../../supabase/migrations/${name}`, import.meta.url),
  "utf8",
);
const verifier = (name: string) => readFileSync(
  new URL(`../../../supabase/${name}`, import.meta.url),
  "utf8",
);

const foundation = migration("20260820000000_create_staff_salary_foundation.sql");
const entitlements = migration("20260820000001_create_staff_monthly_entitlements.sql");
const withdrawals = migration("20260820000002_create_staff_withdrawals.sql");
const deductions = migration("20260820000003_create_staff_salary_deductions.sql");
const boundaryRepair = migration("20260820000004_repair_staff_salary_rate_boundaries.sql");
const workerDelete = migration("20260820000005_create_staff_worker_delete.sql");
const workerStartValidation = migration("20260820000006_validate_staff_worker_salary_start.sql");

test("S2 canonical migration owns every entitlement table and lifecycle RPC", () => {
  for (const pattern of [
    /create table public\.staff_salary_eligibility_periods/i,
    /create table public\.staff_monthly_earnings/i,
    /create or replace function public\.create_staff_worker\s*\(/i,
    /create or replace function public\.deactivate_staff_worker\s*\(/i,
    /create or replace function public\.reactivate_staff_worker\s*\(/i,
    /create or replace function public\.ensure_staff_monthly_earnings\s*\(/i,
  ]) assert.match(entitlements, pattern);

  assert.doesNotMatch(foundation, /create table public\.staff_(salary_eligibility_periods|monthly_earnings)/i);
  assert.doesNotMatch(withdrawals, /create table public\.staff_(salary_eligibility_periods|monthly_earnings)/i);
  assert.doesNotMatch(deductions, /create table public\.staff_(salary_eligibility_periods|monthly_earnings)/i);
});

test("S2 tables are created before functions that depend on them", () => {
  const eligibilityTable = entitlements.indexOf("create table public.staff_salary_eligibility_periods");
  const earningsTable = entitlements.indexOf("create table public.staff_monthly_earnings");
  const createWorker = entitlements.indexOf("create or replace function public.create_staff_worker");
  const ensureEarnings = entitlements.indexOf("create or replace function public.ensure_staff_monthly_earnings");
  assert.ok(eligibilityTable >= 0 && earningsTable > eligibilityTable);
  assert.ok(createWorker > earningsTable && ensureEarnings > createWorker);
});

test("S2 retains lifecycle, immutability, idempotency, and security guards", () => {
  for (const pattern of [
    /first_month_custom_salary > 0/i,
    /staff_salary_eligibility_periods_no_overlap/i,
    /unique \(factory_id, staff_worker_id, salary_month\)/i,
    /Staff monthly earnings are immutable/i,
    /salary_month = date_trunc\('month', salary_month\)::date/i,
    /generated\.salary_month::date = eligibility\.effective_from_month/i,
    /p_through_month > business_month/i,
    /pg_advisory_xact_lock/i,
    /not exists \([\s\S]*staff_monthly_earnings/i,
    /enable row level security/i,
    /revoke all on public\.staff_salary_eligibility_periods/i,
  ]) assert.match(entitlements, pattern);
});

test("S3 and S4 still consume the S2 earning source and shared worker lock", () => {
  for (const sql of [withdrawals, deductions]) {
    assert.match(sql, /public\.ensure_staff_monthly_earnings/i);
    assert.match(sql, /from public\.staff_monthly_earnings/i);
    assert.match(sql, /staff_salary_lifecycle:/i);
  }
  assert.match(withdrawals, /create or replace function public\.get_staff_financial_summary/i);
  assert.match(withdrawals, /create or replace function public\.create_staff_withdrawal/i);
  assert.match(deductions, /create or replace function public\.create_staff_salary_deduction/i);
});

test("legacy salary boundary repair is narrow, locked, and immutable-history aware", () => {
  for (const pattern of [
    /create or replace function public\.create_staff_category_monthly_salary\s*\(/i,
    /create or replace function public\.create_staff_monthly_salary_override\s*\(/i,
    /order by effective_from, id[\s\S]*p_monthly_salary <> correction_rate\.monthly_salary/i,
    /corrected category salary start would overlap/i,
    /staff_category_id_snapshot = p_staff_category_id/i,
    /staff override boundary correction would contradict immutable/i,
    /staff_salary_lifecycle:/i,
    /update public\.staff_monthly_salary_rates[\s\S]*set effective_from = p_effective_from/i,
  ]) assert.match(boundaryRepair, pattern);

  assert.doesNotMatch(boundaryRepair, /update public\.staff_monthly_earnings/i);
  assert.doesNotMatch(boundaryRepair, /delete from public\.staff_monthly_earnings/i);
});

test("Staff delete removes setup only after checking every immutable financial source", () => {
  for (const pattern of [
    /create or replace function public\.delete_staff_worker\s*\(/i,
    /staff_worker_monthly_salary:/i,
    /staff_salary_lifecycle:/i,
    /from public\.staff_monthly_earnings/i,
    /from public\.staff_withdrawals/i,
    /from public\.staff_salary_deductions/i,
    /delete from public\.staff_monthly_salary_rates/i,
    /delete from public\.staff_salary_eligibility_periods/i,
    /delete from public\.staff_workers/i,
    /cannot be deleted\. Deactivate them instead/i,
    /revoke all on function public\.delete_staff_worker\(uuid, uuid\) from anon/i,
  ]) assert.match(workerDelete, pattern);

  for (const protectedTable of [
    "staff_monthly_earnings", "staff_withdrawals", "staff_salary_deductions",
  ]) {
    assert.doesNotMatch(workerDelete, new RegExp(`delete from public\\.${protectedTable}`, "i"));
    assert.doesNotMatch(workerDelete, new RegExp(`update public\\.${protectedTable}`, "i"));
  }
});

test("Staff creation validates the exact start-month salary without touching finance logic", () => {
  for (const pattern of [
    /create or replace function public\.create_staff_worker\s*\(/i,
    /staff_category_monthly_salary:/i,
    /effective_from <= p_salary_start_month/i,
    /effective_to >= p_salary_start_month/i,
    /Salary not set for the Staff start month/i,
    /using errcode = 'P2505'/i,
  ]) assert.match(workerStartValidation, pattern);

  assert.doesNotMatch(workerStartValidation, /ensure_staff_monthly_earnings/i);
  assert.doesNotMatch(workerStartValidation, /insert into public\.staff_monthly_earnings/i);
  assert.doesNotMatch(workerStartValidation, /public\.staff_(withdrawals|salary_deductions)/i);
});

test("all Staff verifiers retain their milestone assertions", () => {
  const foundationVerifier = verifier("verify_staff_salary_foundation.sql");
  const entitlementVerifier = verifier("verify_staff_monthly_entitlements.sql");
  const withdrawalVerifier = verifier("verify_staff_withdrawals.sql");
  const deductionVerifier = verifier("verify_staff_salary_deductions.sql");
  const repairVerifier = verifier("verify_staff_salary_rate_boundary_repair.sql");
  const deleteVerifier = verifier("verify_staff_worker_delete.sql");
  const consistencyVerifier = verifier("verify_staff_salary_month_start_consistency.sql");
  assert.match(foundationVerifier, /Staff Salary foundation verifier completed/);
  assert.match(entitlementVerifier, /Staff monthly entitlement verifier completed/);
  assert.match(entitlementVerifier, /inactive gap received a salary earning/i);
  assert.match(entitlementVerifier, /one earning maximum per Staff\/month/i);
  assert.match(withdrawalVerifier, /Staff withdrawal verifier completed/);
  assert.match(deductionVerifier, /Staff salary deduction verifier completed/);
  assert.match(repairVerifier, /legacy August-20-style category rate safely moved to month start/i);
  assert.match(repairVerifier, /immutable earning conflict rejects the correction without mutation/i);
  assert.match(repairVerifier, /future-start Staff shows configured salary without early earnings/i);
  assert.match(repairVerifier, /Staff salary rate boundary repair verifier completed/);
  assert.match(deleteVerifier, /future-start no-history Staff setup deletes without generating salary/i);
  assert.match(deleteVerifier, /earnings, withdrawals, and deductions each force deactivation instead/i);
  assert.match(deleteVerifier, /direct and anonymous Staff deletion is denied/i);
  assert.match(deleteVerifier, /Staff worker delete verifier completed/);
  assert.match(consistencyVerifier, /current-month card resolution and entitlement share month-start salary/i);
  assert.match(consistencyVerifier, /custom 9000 credit retains the normal 10500 monthly salary snapshot/i);
  assert.match(consistencyVerifier, /future-start salary displays at its start month with zero current balance/i);
  assert.match(consistencyVerifier, /missing start-month salary leaves no invalid worker or eligibility/i);
  assert.match(consistencyVerifier, /Staff salary month-start consistency verifier completed/i);
});
