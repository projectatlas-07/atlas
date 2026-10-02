import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000045_create_coal_selective_seller_settlement.sql",
  import.meta.url,
), "utf8");
const verifier = readFileSync(new URL(
  "../../../supabase/verify_coal_selective_settlement.sql",
  import.meta.url,
), "utf8");
const component = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");

test("selective Coal settlement delegates one explicit multi-allocation payment to the shared engine", () => {
  assert.match(migration, /create_coal_selective_payment/);
  assert.match(migration, /public\.create_expense_payment/);
  assert.match(migration, /shared_allocations/);
  assert.doesNotMatch(migration, /create table|insert into public\.cash_book/i);
});

test("server locks selected obligations and revalidates Coal seller, range, status, and due", () => {
  assert.match(migration, /order by records\.id\s+for update of records/);
  assert.match(migration, /target_record\.supplier_id <> p_seller_id/);
  assert.match(migration, /target_record\.business_date < p_from_date/);
  assert.match(migration, /target_record\.business_date > p_to_date/);
  assert.match(migration, /target_record\.status <> 'active'/);
  assert.match(migration, /allocation_amounts\[purchase_index\] > target_record\.total_amount - target_record\.total_paid/);
});

test("Coal UI requires explicit selection and per-purchase Pay This Time amounts", () => {
  assert.match(component, /Nothing is selected automatically/);
  assert.match(component, /Outstanding Coal Purchases/);
  assert.match(component, /Allocation amount/);
  assert.match(component, /label="Payment"/);
  assert.match(component, /label="Allocated"/);
  assert.match(component, /label="Remaining"/);
  assert.match(component, /Save Seller Payment/);
  assert.doesNotMatch(component, /Outstanding Coal Purchase<select/);
});

test("Coal payment history groups the header once and preserves its allocation breakdown", () => {
  assert.match(migration, /list_coal_selective_payments/);
  assert.match(migration, /jsonb_agg\(jsonb_build_object/);
  assert.match(migration, /group by payments\.id/);
  assert.match(component, /Recent Seller Payments/);
  assert.match(component, /payment\.allocations\.map/);
});

test("multi-purchase Coal Cash Book descriptions stay concise without changing other expense descriptions", () => {
  assert.match(migration, /Coal seller settlement · ' \|\| count\(\*\)::text \|\| ' purchases'/);
  assert.match(migration, /else 'Payment for ' \|\| string_agg/);
});

test("rollback verifier covers explicit selection, atomic rejection, one Cash Book row, and isolation", () => {
  for (const phrase of [
    "mixed full and partial", "unselected", "outside range", "other seller",
    "fully paid", "void", "exactly one Cash Book Money Out", "history shows the payment once",
    "atomic", "factory-isolated", "rolled back all fixtures",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});
