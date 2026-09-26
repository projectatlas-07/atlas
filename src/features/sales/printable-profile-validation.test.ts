import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260921000064_fix_printable_profile_receipt_validation.sql",
    import.meta.url,
  ),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_printable_profile_validation.sql", import.meta.url),
  "utf8",
);
const officeModel = readFileSync(
  new URL("../office/sales-office-model.ts", import.meta.url),
  "utf8",
);

test("receipt validation matches the legitimate structured Challan profile fields", () => {
  const receiptGuard = migration.slice(
    migration.indexOf("if not found"),
    migration.indexOf("printable_address_snapshot :="),
  );
  for (const field of [
    "name",
    "business_description",
    "village",
    "post_office",
    "police_station",
    "district",
    "state",
    "mobile",
  ]) assert.match(receiptGuard, new RegExp(`factory_profile\\.${field} = ''`));
  assert.doesNotMatch(receiptGuard, /factory_profile\.(address|gstin) = ''/);
});

test("receipt address uses the same legacy-compatible structured fallback as Challans", () => {
  assert.match(migration, /coalesce\([\s\S]*nullif\(factory_profile\.address, ''\)/);
  assert.match(migration, /'Vill\. %s · P\.O\. %s · P\.S\. %s · Dist\. %s · %s'/);
  assert.match(migration, /new\.company_address_snapshot := printable_address_snapshot/);
  assert.doesNotMatch(migration, /alter table|drop trigger|create trigger/i);
});

test("GSTIN stays optional in both UI and database guards", () => {
  const uiGuard = officeModel.slice(
    officeModel.indexOf("export function isFactoryPrintableProfileComplete"),
    officeModel.indexOf("export function buildFactoryProfileInput"),
  );
  assert.doesNotMatch(uiGuard, /gstin/i);
  assert.doesNotMatch(migration, /factory_profile\.gstin\s*(?:=|is)/i);
  assert.match(migration, /GSTIN remains optional/);
});

test("regression verifier covers both callers without weakening incomplete-profile rejection", () => {
  for (const phrase of [
    "New Challan accepts complete structured profile with blank legacy address and optional GSTIN",
    "Customer Dues payment accepts the same complete structured profile",
    "genuinely incomplete structured profile remains rejected",
  ]) assert.match(verifier, new RegExp(phrase));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /rollback;/);
});
