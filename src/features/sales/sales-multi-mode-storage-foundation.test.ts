import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260929000067_create_customer_payment_method_storage.sql", import.meta.url),
  "utf8",
);
const finalMigration = readFileSync(
  new URL("../../../supabase/migrations/20260929000069_add_multi_mode_customer_payment_rpc.sql", import.meta.url),
  "utf8",
);
const finalVerifier = readFileSync(
  new URL("../../../supabase/verify_customer_payment_multi_mode_rpc.sql", import.meta.url),
  "utf8",
);

test("payment method storage is additive, factory-safe, read-only, and has no independent UUID", () => {
  assert.match(migration, /create table public\.customer_payment_methods/);
  assert.match(migration, /primary key \(payment_id, mode\)/);
  assert.match(migration, /foreign key \(payment_id, factory_id\)[\s\S]*references public\.customer_payments\(id, factory_id\) on delete restrict/);
  assert.match(migration, /customer_payment_methods_factory_payment_idx[\s\S]*\(factory_id, payment_id, mode\)/);
  assert.match(migration, /alter table public\.customer_payment_methods enable row level security/);
  assert.match(migration, /grant select on public\.customer_payment_methods to authenticated/);
  assert.match(migration, /customer_payment_methods_prevent_update_delete[\s\S]*public\.prevent_customer_payment_mutation/);
  assert.doesNotMatch(migration, /\bid uuid\b/);
});

test("historical payments backfill one legacy mode without fabricating a split", () => {
  assert.match(migration, /payments\.payment_mode,[\s\S]*null,[\s\S]*payments\.created_at/);
  assert.match(migration, /on conflict \(payment_id, mode\) do nothing/);
  assert.match(migration, /count\(methods\.payment_id\) <> 1/);
  assert.match(migration, /count\(methods\.split_amount\) <> 0/);
});

test("the additive storage foundation supports the final compatibility-safe multi-mode contract", () => {
  assert.doesNotMatch(migration, /create(?: or replace)? function public\.create_customer_payment/i);
  assert.doesNotMatch(migration, /drop (?:column|function)/i);
  assert.doesNotMatch(migration, /alter column payment_mode|drop column payment_mode/i);
  assert.match(finalMigration, /create function public\.create_customer_payment_with_methods/);
  assert.match(finalMigration, /for method_index in 1\.\.array_length\(method_modes, 1\)[\s\S]*insert into public\.customer_payment_methods/);
  assert.match(finalMigration, /when array_length\(method_modes, 1\) = 1 then method_modes\[1\][\s\S]*else 'multiple'/);
  assert.match(finalVerifier, /unsplit UPI \+ Cheque creates one payment and two NULL method splits/);
  assert.match(finalVerifier, /10,000 UPI \+ 90,000 Cheque uses one header and one allocation set/);
});
