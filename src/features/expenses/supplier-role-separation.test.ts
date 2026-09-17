import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260914000041_create_supplier_roles.sql",
  import.meta.url,
), "utf8");
const verifier = readFileSync(new URL(
  "../../../supabase/verify_supplier_roles.sql",
  import.meta.url,
), "utf8");
const coalUi = readFileSync(new URL(
  "../office/components/coal-purchase-office-section.tsx",
  import.meta.url,
), "utf8");
const maintenanceUi = readFileSync(new URL(
  "../office/components/vehicle-maintenance-office-section.tsx",
  import.meta.url,
), "utf8");

test("one supplier identity supports independent Coal Seller and Garage mappings", () => {
  assert.match(migration, /create table public\.supplier_roles/);
  assert.match(migration, /role in \('COAL_SELLER', 'GARAGE'\)/);
  assert.match(migration, /unique \(supplier_id, role\)/);
  assert.doesNotMatch(migration, /alter table public\.suppliers[\s\S]*supplier_type/i);
});

test("existing structured Coal and Maintenance references are backfilled without rewrites", () => {
  assert.match(migration, /from public\.coal_purchases as coal/);
  assert.match(migration, /'COAL_SELLER'/);
  assert.match(migration, /from public\.vehicle_maintenance_records as maintenance/);
  assert.match(migration, /'GARAGE'/);
  assert.doesNotMatch(migration, /update public\.(expense_records|coal_purchases|vehicle_maintenance_records)/);
});

test("Coal selectors, filters, and inline creation use only COAL_SELLER", () => {
  assert.match(coalUi, /listSuppliersByRole\(factoryId, "COAL_SELLER"\)/);
  assert.match(coalUi, /role: "COAL_SELLER"/);
  assert.match(coalUi, /"office-suppliers-by-role", factoryId, "COAL_SELLER"/);
  assert.doesNotMatch(coalUi, /listSuppliers\(factoryId\)/);
});

test("Maintenance selectors, filters, and inline creation use only GARAGE", () => {
  assert.match(maintenanceUi, /listSuppliersByRole\(factoryId, "GARAGE"\)/);
  assert.match(maintenanceUi, /role: "GARAGE"/);
  assert.match(maintenanceUi, /"office-suppliers-by-role", factoryId, "GARAGE"/);
  assert.doesNotMatch(maintenanceUi, /listSuppliers\(factoryId\)/);
});

test("database guards reject cross-role module writes", () => {
  assert.match(migration, /require_coal_supplier_role/);
  assert.match(migration, /Choose a supplier assigned as a Coal Seller/);
  assert.match(migration, /require_maintenance_garage_role/);
  assert.match(migration, /Choose a supplier assigned as a Garage/);
});

test("role data is factory-isolated and controlled through authorized RPCs", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /factory_users\.user_id = auth\.uid\(\)/);
  assert.match(migration, /revoke all on public\.supplier_roles/);
  assert.match(migration, /create_or_assign_supplier_role/);
});

test("rollback verifier covers exclusive, dual, unclassified, isolation, and identity behavior", () => {
  for (const phrase of [
    "Coal-only", "Garage-only", "dual-role", "unclassified",
    "same supplier UUID", "factory-isolated", "rolled back all fixtures",
  ]) assert.match(verifier, new RegExp(phrase, "i"));
});
