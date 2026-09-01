import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260826000020_create_sales_challan_foundation.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_sales_s1.sql", import.meta.url),
  "utf8",
);
const concurrencyVerifier = readFileSync(
  new URL("../../../scripts/verify-sales-s1-concurrency.mjs", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const supabaseTypes = readFileSync(new URL("../../types/supabase.ts", import.meta.url), "utf8");

test("S1 stays bounded to customers, Challans, items, factory snapshots, and numbering", () => {
  for (const object of [
    "public.customers",
    "public.challan_number_counters",
    "public.challans",
    "public.challan_items",
  ]) assert.match(migration, new RegExp(`create table ${object.replace(".", "\\.")}`));
  assert.doesNotMatch(migration, /general ledger|chart_of_accounts|cash_book|customer_payments|vehicle_wages/i);
});

test("database owns snapshots, per-1000 line math, totals, and atomic numbering", () => {
  assert.match(migration, /customer_address_snapshot/);
  assert.match(migration, /company_business_description_snapshot/);
  assert.match(migration, /pricing_unit text not null default 'PER_1000_BRICKS'/);
  assert.match(migration, /line_amount numeric\(18, 2\) generated always as/);
  assert.match(migration, /round\(\(quantity::numeric \* rate_per_1000_bricks\) \/ 1000, 2\)/);
  assert.match(migration, /create trigger challan_items_recalculate_total/);
  assert.match(migration, /on conflict \(factory_id\) do update/);
  assert.match(migration, /challans_factory_number_key unique/);
});

test("controlled lifecycle has no delete or financial-lock toggle RPC", () => {
  for (const rpc of [
    "create_customer",
    "update_customer",
    "create_challan",
    "update_challan",
    "void_challan",
  ]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(supabaseTypes, new RegExp(`${rpc}:`));
  }
  assert.match(migration, /create trigger challans_reject_delete/);
  assert.match(migration, /old\.is_locked/);
  assert.doesNotMatch(migration, /function public\.(delete|lock|unlock)_challan/);
  assert.doesNotMatch(service, /deleteChallan|lockChallan|unlockChallan/);
});

test("client mutation payload cannot supply line amount or Challan total", () => {
  const rpcItemsBody = service.slice(service.indexOf("function rpcItems"), service.indexOf("async function listChallanItems"));
  assert.match(rpcItemsBody, /brick_type_id/);
  assert.match(rpcItemsBody, /quantity/);
  assert.match(rpcItemsBody, /rate:/);
  assert.doesNotMatch(rpcItemsBody, /line_amount|challan_total/);
  assert.doesNotMatch(supabaseTypes.match(/create_challan:[\s\S]*?Returns: ChallanRow;/)?.[0] ?? "", /line_amount|challan_total/);
});

test("focused verifier covers snapshots, totals, lifecycle, isolation, and permanent rows", () => {
  for (const phrase of [
    "customer and printable factory snapshots preserve Address A",
    "database calculates multiple lines",
    "active unlocked Challan update atomically",
    "void Challan remains permanently stored",
    "locked Challan cannot be edited or voided",
    "false client amounts are rejected",
    "per-factory counters isolate factories",
    "no hard-delete operation",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});

test("separate harness performs genuine simultaneous database requests", () => {
  assert.match(concurrencyVerifier, /await Promise\.all\(/);
  assert.match(concurrencyVerifier, /Array\.from\(\{ length: concurrentCount \}/);
  assert.match(concurrencyVerifier, /Duplicate numbers allocated/);
  assert.match(concurrencyVerifier, /Failed creation consumed or corrupted/);
  assert.match(concurrencyVerifier, /Voiding reused a permanent number/);
  assert.match(concurrencyVerifier, /ATLAS_S1_ALLOW_PERMANENT_TEST_ROWS/);
});
