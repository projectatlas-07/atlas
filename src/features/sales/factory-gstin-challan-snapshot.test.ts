import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260913000036_add_factory_gstin_challan_snapshot.sql", import.meta.url),
  "utf8",
);
const latestChallanMigration = readFileSync(
  new URL("../../../supabase/migrations/20260911000035_make_challan_number_optional_manual_text.sql", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_factory_gstin_challan_snapshot.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const officeModel = readFileSync(new URL("../office/sales-office-model.ts", import.meta.url), "utf8");
const officeScreen = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");
const printScreen = readFileSync(
  new URL("./components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);

const profileFunction = migration.slice(
  migration.indexOf("create function public.update_factory_printable_profile"),
  migration.indexOf("revoke all on function public.update_factory_printable_profile"),
);
const createFunction = migration.slice(
  migration.indexOf("create or replace function public.create_challan_with_vehicle_snapshot"),
);
const updateFunction = latestChallanMigration.slice(
  latestChallanMigration.indexOf("create function public.update_challan_with_vehicle_snapshot"),
  latestChallanMigration.indexOf("create function public.create_challan("),
);

test("GSTIN schema is additive, nullable, and does not backfill historical Challans", () => {
  assert.match(migration, /alter table public\.factories[\s\S]*add column gstin text/);
  assert.match(migration, /alter table public\.challans[\s\S]*add column company_gstin_snapshot text/);
  assert.doesNotMatch(migration, /gstin text not null|company_gstin_snapshot text not null/i);
  assert.doesNotMatch(migration, /update public\.challans[\s\S]*company_gstin_snapshot\s*=/i);
  assert.doesNotMatch(migration, /drop column|truncate|delete from public\.challans/i);
});

test("Factory Profile owns optional normalized GSTIN behind existing factory authorization", () => {
  assert.match(profileFunction, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(profileFunction, /factory_users\.factory_id = p_factory_id/);
  assert.match(profileFunction, /normalized_gstin text := nullif\(upper\(btrim/);
  assert.match(profileFunction, /gstin = normalized_gstin/);
  assert.match(service, /p_gstin: gstin\.trim\(\)\.toUpperCase\(\) \|\| null/);
  assert.match(officeScreen, /GSTIN \(optional\)/);
  assert.doesNotMatch(
    officeModel.slice(
      officeModel.indexOf("export function isFactoryPrintableProfileComplete"),
      officeModel.indexOf("export function buildFactoryProfileInput"),
    ),
    /gstin/,
  );
});

test("new Challans snapshot Factory GSTIN and all edit paths preserve it", () => {
  assert.match(createFunction, /company_state_snapshot, company_gstin_snapshot/);
  assert.match(createFunction, /factory_profile\.state, factory_profile\.gstin/);
  assert.doesNotMatch(createFunction, /p_company_gstin_snapshot/);
  assert.doesNotMatch(updateFunction, /company_gstin_snapshot\s*=/);
  assert.match(
    migration,
    /new\.company_gstin_snapshot is distinct from old\.company_gstin_snapshot/,
  );
});

test("view, print, and PDF share the saved GSTIN model and hide a missing value", () => {
  assert.match(service, /companyGstinSnapshot: row\.company_gstin_snapshot/);
  assert.match(printModel, /gstin: challan\.companyGstinSnapshot/);
  assert.doesNotMatch(printModel, /FactoryPrintableProfile|getFactory|\.from\(/);
  assert.match(printScreen, /challan\.company\.gstin &&/);
  assert.match(officeScreen, /challan\.companyGstinSnapshot &&/);
  assert.match(printScreen, /<RoadChallanDocument challan=\{challan\} \/>/);
  assert.match(printScreen, />Print<\/button>/);
  assert.match(printScreen, />Download PDF<\/button>/);
});

test("transactional SQL verifier covers snapshot history, legacy nulls, and factory isolation", () => {
  for (const phrase of [
    "Factory Profile stores normalized optional GSTIN",
    "Challan A retains GSTIN-A",
    "Challan B receives GSTIN-B",
    "legacy Challan keeps a null GSTIN snapshot",
    "Factory A cannot read or write Factory B GSTIN",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /^rollback;/m);
});
