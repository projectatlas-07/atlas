import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260929000069_add_multi_mode_customer_payment_rpc.sql",
    import.meta.url,
  ),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_customer_payment_multi_mode_rpc.sql", import.meta.url),
  "utf8",
);

test("multi-mode uses a new RPC while the scalar RPC remains a compatibility wrapper", () => {
  assert.match(migration, /function public\.create_customer_payment_with_methods\(/);
  assert.match(migration, /p_payment_methods jsonb/);
  assert.match(migration, /create or replace function public\.create_customer_payment\(/);
  assert.match(migration, /from public\.create_customer_payment_with_methods\(/);
  assert.match(migration, /jsonb_build_array\(jsonb_build_object\([\s\S]*'mode',[\s\S]*'amount', null/);
  assert.match(migration, /create_customer_payment_with_methods[\s\S]*grant execute/);
});

test("method validation is normalized, unique, all-or-none, and exactly reconciled", () => {
  assert.match(migration, /between 1 and 5 payment methods/);
  assert.match(migration, /lower\(btrim\(method_value ->> 'mode'\)\)/);
  assert.match(migration, /normalized_method_mode not in \('cash', 'upi', 'bank_transfer', 'cheque', 'other'\)/);
  assert.match(migration, /normalized_method_mode = any\(method_modes\)/);
  assert.match(migration, /method_amount_count not in \(0, array_length\(method_modes, 1\)\)/);
  assert.match(migration, /method_amount_total <> p_amount/);
  assert.match(migration, /method_amount <= 0[\s\S]*method_amount <> round\(method_amount, 2\)/);
});

test("multiple is only a parent compatibility value and child rows retain real methods", () => {
  assert.match(migration, /customer_payments_payment_mode_check[\s\S]*'multiple'/);
  assert.match(migration, /when array_length\(method_modes, 1\) = 1 then method_modes\[1\][\s\S]*else 'multiple'/);
  assert.match(migration, /method_modes\[method_index\],[\s\S]*method_amounts\[method_index\]/);
  assert.doesNotMatch(migration, /insert into public\.customer_payment_methods[\s\S]*values[\s\S]*'multiple'/);
});

test("one header, one allocation loop, and one lock update serve every method", () => {
  assert.equal((migration.match(/insert into public\.customer_payments\(/g) ?? []).length, 1);
  assert.equal((migration.match(/insert into public\.customer_payment_allocations\(/g) ?? []).length, 1);
  assert.equal((migration.match(/update public\.challans/g) ?? []).length, 1);
  assert.match(migration, /insert into public\.customer_payments[\s\S]*for method_index[\s\S]*for allocation_index[\s\S]*update public\.challans/);
});

test("rollback-only verification covers compatibility, splits, rejection, isolation, and downstream invariants", () => {
  for (const evidence of [
    "legacy scalar RPC creates one unsplit method",
    "unsplit UPI + Cheque creates one payment and two NULL method splits",
    "10,000 UPI + 90,000 Cheque uses one header and one allocation set",
    "partial, mismatched, duplicate, and invalid methods fail without residue",
    "Received Now remains one unsplit single-mode payment",
    "multi-mode writer preserves factory isolation",
    "Cash Book remains one movement for the multi-mode payment header",
  ]) assert.ok(verifier.includes(evidence), `missing verifier evidence: ${evidence}`);
});

test("Step 3 does not alter frontend contracts or remove legacy storage", () => {
  assert.doesNotMatch(migration, /drop column payment_mode|drop table public\.customer_payment_methods/i);
  assert.doesNotMatch(migration, /alter table public\.customer_payment_methods/i);
});
