import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260929000068_sync_customer_payment_method_writers.sql",
    import.meta.url,
  ),
  "utf8",
);
const finalMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260929000069_add_multi_mode_customer_payment_rpc.sql",
    import.meta.url,
  ),
  "utf8",
);
const finalVerifier = readFileSync(
  new URL("../../../supabase/verify_customer_payment_multi_mode_rpc.sql", import.meta.url),
  "utf8",
);
const paidNowMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260919000063_create_challan_with_received_payment.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Step 2 catches up missing rows without fabricating method splits", () => {
  assert.match(migration, /insert into public\.customer_payment_methods/);
  assert.match(migration, /payments\.payment_mode,[\s\S]*null,[\s\S]*payments\.created_at/);
  assert.match(migration, /where not exists \([\s\S]*methods\.payment_id = payments\.id/);
  assert.match(migration, /on conflict \(payment_id, mode\) do nothing/);
  assert.match(migration, /count\(methods\.payment_id\) <> 1/);
});

test("the final writer stores selected methods once and preserves the scalar compatibility writer", () => {
  assert.match(migration, /create or replace function public\.create_customer_payment/);
  assert.match(migration, /returning \* into new_payment;[\s\S]*insert into public\.customer_payment_methods/);
  assert.match(migration, /new_payment\.id,[\s\S]*normalized_payment_mode,[\s\S]*null,[\s\S]*new_payment\.created_at/);
  assert.match(migration, /insert into public\.customer_payment_methods[\s\S]*insert into public\.customer_payment_allocations[\s\S]*update public\.challans/);
  assert.doesNotMatch(migration, /p_payment_methods|jsonb.*method|split_amount\s*\)\s*values[\s\S]*p_amount/i);
  assert.match(finalMigration, /create function public\.create_customer_payment_with_methods/);
  assert.match(finalMigration, /for method_index in 1\.\.array_length\(method_modes, 1\)[\s\S]*method_modes\[method_index\],[\s\S]*method_amounts\[method_index\]/);
  assert.match(finalMigration, /create or replace function public\.create_customer_payment[\s\S]*public\.create_customer_payment_with_methods/);
  assert.match(finalVerifier, /legacy scalar RPC creates one unsplit method/);
});

test("Received now remains a thin transaction wrapper around the synchronized writer", () => {
  assert.match(paidNowMigration, /perform public\.create_customer_payment\(/);
  assert.doesNotMatch(paidNowMigration, /insert into public\.customer_payments/);
  assert.match(finalMigration, /public\.create_customer_payment_with_methods\([\s\S]*jsonb_build_array\(jsonb_build_object\([\s\S]*'amount', null/);
  assert.match(finalVerifier, /Received Now remains one unsplit single-mode payment/);
  assert.match(finalVerifier, /Cash Book remains one movement for the multi-mode payment header/);
});

test("final RPC contracts retain the legacy entry point without weakening the multi-mode model", () => {
  assert.match(
    finalVerifier,
    /create_customer_payment\(uuid,uuid,date,numeric,text,text,jsonb\)/,
  );
  assert.match(
    finalVerifier,
    /create_customer_payment_with_methods\(uuid,uuid,date,numeric,jsonb,text,jsonb\)/,
  );
  assert.match(finalMigration, /payment_mode in \([\s\S]*'multiple'/);
  assert.doesNotMatch(migration, /alter table public\.customer_payments/);
  assert.doesNotMatch(migration, /drop (?:column|function|table)/i);
  assert.doesNotMatch(finalMigration, /drop (?:column|table)/i);
});
