import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCreateChallanInput,
  buildCustomerUpdateInput,
  customerFormFromSaved,
  selectCustomer,
  type ChallanFormState,
} from "../office/sales-office-model.ts";
import { buildPrintableChallan } from "./challan-print-model.ts";
import type { Challan, Customer } from "./types.ts";

const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const customerService = readFileSync(
  new URL("./services/customer-service.ts", import.meta.url),
  "utf8",
);
const currentChallanMigration = readFileSync(
  new URL("../../../supabase/migrations/20260911000035_make_challan_number_optional_manual_text.sql", import.meta.url),
  "utf8",
);
const customerFoundation = readFileSync(
  new URL("../../../supabase/migrations/20260826000020_create_sales_challan_foundation.sql", import.meta.url),
  "utf8",
);

const originalCustomer: Customer = {
  id: "customer-a",
  factoryId: "factory-a",
  name: "ABC Traders",
  address: "Old Road",
  mobile: "9000000001",
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};
const updatedCustomer: Customer = {
  ...originalCustomer,
  address: "New Road",
  mobile: "9000000002",
  updatedAt: "2026-09-11T08:00:00Z",
};

const baseForm: ChallanFormState = {
  challanNumber: "A-39",
  challanDate: "2026-09-11",
  customerId: originalCustomer.id,
  vehicleId: "",
  selectedVehicleIsActive: true,
  vehicleDeliveryWageTrackingEnabled: false,
  tripLabourWage: "",
  lines: [{
    key: "brick-a",
    brickTypeId: "brick-a",
    quantity: "12347",
    pricingMode: "AMOUNT",
    ratePer1000Bricks: "6479.306714182",
    lineAmount: "80000",
  }],
  flexibleLines: [],
};

const historicalChallan: Challan = {
  id: "challan-old",
  factoryId: "factory-a",
  challanNumber: "OLD-1",
  challanDate: "2026-09-01",
  customerId: originalCustomer.id,
  customerNameSnapshot: originalCustomer.name,
  customerAddressSnapshot: originalCustomer.address,
  customerMobileSnapshot: originalCustomer.mobile,
  companyNameSnapshot: "Atlas Bricks",
  companyBusinessDescriptionSnapshot: "Brick manufacturer",
  companyAddressSnapshot: "Factory Road",
  companyMobileSnapshot: "9000000000",
  companyVillageSnapshot: "Rampur",
  companyPostOfficeSnapshot: "Rampur Head",
  companyPoliceStationSnapshot: "Kotwali",
  companyDistrictSnapshot: "Jaipur",
  companyStateSnapshot: "Rajasthan",
  vehicleId: null,
  vehicleNumberSnapshot: null,
  deliveryWageApplicableSnapshot: false,
  tripLabourWage: null,
  vehicleNumber: "",
  tractorLabourRateSnapshot: 0,
  challanTotal: 80000,
  status: "active",
  isLocked: true,
  voidedAt: null,
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
  items: [{
    id: "item-old",
    factoryId: "factory-a",
    challanId: "challan-old",
    brickTypeId: "brick-a",
    brickParticularsSnapshot: "Class One",
    quantity: 12347,
    pricingMode: "AMOUNT",
    ratePer1000Bricks: 6479.306714182,
    pricingUnit: "PER_1000_BRICKS",
    lineCategory: "BRICK_REVENUE",
    lineAmount: 80000,
    linePosition: 1,
    createdAt: "2026-09-01T08:00:00Z",
  }],
  flexibleLines: [],
};

test("selected customer exposes a creation-only inline Edit action", () => {
  assert.match(office, /\{!challan && <button[^>]*onClick=\{startCustomerEdit\}[^>]*>Edit<\/button>\}/);
  assert.match(office, /Edit selected customer/);
  assert.match(office, /Save customer/);
  assert.match(office, /onClick=\{cancelCustomerEdit\}/);
  assert.doesNotMatch(office, /href=.*customer|window\.location/);
});

test("edit starts from current master fields and builds an update for the same ID", () => {
  const draft = customerFormFromSaved(originalCustomer);
  assert.deepEqual(draft, {
    name: "ABC Traders",
    address: "Old Road",
    mobile: "9000000001",
  });
  assert.deepEqual(buildCustomerUpdateInput("factory-a", originalCustomer.id, {
    ...draft,
    name: "  ABC   Traders ",
    address: " New Road ",
    mobile: " 9000000002 ",
  }), {
    factoryId: "factory-a",
    customerId: originalCustomer.id,
    name: "ABC Traders",
    address: "New Road",
    mobile: "9000000002",
  });
});

test("edit validation rejects a missing identity or blank required name", () => {
  assert.equal(buildCustomerUpdateInput("factory-a", originalCustomer.id, {
    name: " ", address: "New Road", mobile: "",
  }), null);
  assert.equal(buildCustomerUpdateInput("factory-a", "", {
    name: "ABC Traders", address: "New Road", mobile: "",
  }), null);
});

test("save updates the cached master and keeps customerId as selected identity", () => {
  assert.match(office, /const customer = await updateCustomer\(input\)/);
  assert.match(office, /onCustomerSaved\(customer\)/);
  assert.match(office, /customerId: customer\.id/);
  assert.match(office, /setQueryData<Customer\[\]>/);
  assert.equal(selectCustomer([updatedCustomer], originalCustomer.id)?.address, "New Road");
  assert.equal(baseForm.customerId, updatedCustomer.id);
});

test("cancel closes the draft without writing or changing the selected customer", () => {
  const draft = customerFormFromSaved(originalCustomer);
  const changedDraft = { ...draft, address: "Unsaved Road" };
  assert.equal(originalCustomer.address, "Old Road");
  assert.equal(changedDraft.address, "Unsaved Road");
  assert.match(office, /function cancelCustomerEdit\(\) \{[\s\S]*?setEditingCustomerId\(""\);[\s\S]*?\}/);
  assert.doesNotMatch(
    office.match(/function cancelCustomerEdit\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "",
    /updateCustomer|onCustomerSaved|setForm/,
  );
});

test("new Challan keeps current customer ID while exact Amount and optional number remain unchanged", () => {
  const input = buildCreateChallanInput("factory-a", baseForm);
  assert.equal(input?.customerId, updatedCustomer.id);
  assert.equal(input?.challanNumber, "A-39");
  assert.deepEqual(input?.items, [{
    brickTypeId: "brick-a",
    quantity: 12347,
    pricingMode: "AMOUNT",
    lineAmount: "80000.00",
  }]);
  assert.match(currentChallanMigration, /customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot/);
  assert.match(currentChallanMigration, /customer_profile\.name, customer_profile\.address, customer_profile\.mobile/);
});

test("historical detail and print stay on the saved snapshot after master changes", () => {
  const printBefore = buildPrintableChallan(historicalChallan);
  const printAfterMasterEdit = buildPrintableChallan(historicalChallan);
  assert.equal(updatedCustomer.address, "New Road");
  assert.equal(printBefore.customer.address, "Old Road");
  assert.deepEqual(printAfterMasterEdit, printBefore);
  assert.match(office, /Saved customer snapshot/);
  assert.match(office, /challan\.customerAddressSnapshot/);
});

test("existing update authority remains factory-scoped and does not touch Challans", () => {
  const updateFunction = customerFoundation.match(
    /create or replace function public\.update_customer\([\s\S]*?\n\$\$;/,
  )?.[0];
  assert.ok(updateFunction);
  assert.match(updateFunction, /factory_users\.factory_id = p_factory_id/);
  assert.match(updateFunction, /where id = p_customer_id and factory_id = p_factory_id/);
  assert.match(updateFunction, /update public\.customers/);
  assert.doesNotMatch(updateFunction, /update public\.challans|insert into public\.customers/);
  assert.match(customerService, /supabase\.rpc\("update_customer"/);
});

test("Add Customer, dues identity, and searchable Vehicle selector stay intact", () => {
  assert.match(office, /const customer = await createCustomer\(input\)/);
  assert.match(office, /Add and select customer/);
  assert.match(office, /role="combobox"/);
  assert.match(office, /Search or select vehicle\.\.\./);
  assert.match(office, /customerId: customer\.id/);
  assert.doesNotMatch(customerService, /challan|payment|outstanding/);
});
