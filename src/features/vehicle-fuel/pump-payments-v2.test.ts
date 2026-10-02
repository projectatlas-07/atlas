import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(new URL(
  "../office/components/vehicle-fuel-office-section.tsx",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("./vehicle-fuel-model.ts", import.meta.url), "utf8");
const service = readFileSync(new URL(
  "./services/vehicle-fuel-service.ts",
  import.meta.url,
), "utf8");

test("Pump Payment recording is always visible as the primary Pump Payments task", () => {
  assert.match(component, /activeArea === "pump-payments" && !showPaymentArchive && <div/);
  assert.match(component, /<form onSubmit=\{savePayment\} className="space-y-atlas-4 lg:col-span-2">/);
  assert.doesNotMatch(component, /const \[showPayment,|setShowPayment\(/);
  for (const field of ["Fuel Pump", "Note / reference (optional)"]) {
    assert.match(component, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.date/);
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.amount/);
  assert.match(component, /ATLAS_UI_STRINGS\.payment\.mode/);
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.fromDate/);
  assert.match(component, /ATLAS_UI_STRINGS\.fields\.toDate/);
  assert.match(component, />Save Pump Payment<\/Button>/);
});

test("Pump totals reuse the existing model summary over authoritative Fuel records", () => {
  assert.match(component, /const pumpSummary = summarizeVehicleFuel\(/);
  assert.match(component, /records\.filter\(\(record\) => record\.pumpId === paymentForm\.pumpId\)/);
  assert.match(component, /label="Fuel Purchased" value=\{pumpSummary\.totalPurchased\}/);
  assert.match(component, /label="Paid" value=\{pumpSummary\.totalPaid\}/);
  assert.match(component, /label="Outstanding" value=\{pumpSummary\.totalOutstanding\}/);
  assert.match(model, /export function summarizeVehicleFuel/);
});

test("settlement eligibility and order remain model and backend owned", () => {
  assert.match(component, /getVehicleFuelPeriodOutstanding\(\s*records, paymentForm\.pumpId, paymentForm\.fromDate, paymentForm\.toDate/);
  assert.match(component, /periodOutstanding\.eligibleRecords\.map/);
  assert.match(model, /record\.pumpId === pumpId/);
  assert.match(model, /record\.fuelDate >= fromDate && record\.fuelDate <= toDate/);
  assert.match(model, /record\.status === "active" && record\.outstandingAmount > 0/);
  assert.match(model, /\.sort\(compareFuelOldestFirst\)/);
  assert.match(model, /left\.fuelDate\.localeCompare\(right\.fuelDate\)[\s\S]*left\.fuelTime\.localeCompare\(right\.fuelTime\)[\s\S]*left\.createdAt\.localeCompare\(right\.createdAt\)[\s\S]*left\.id\.localeCompare\(right\.id\)/);
  assert.doesNotMatch(component, /type="checkbox"|<Checkbox|Pay This Time|allocatedAmount: event/);
});

test("payment validation and the single batch RPC remain the only write path", () => {
  assert.match(component, /buildVehicleFuelBatchPaymentInput\(factoryId, paymentForm, records\)/);
  assert.match(component, /createVehicleFuelBatchPayment\(input\)/);
  assert.match(model, /amountPaise > BigInt\(Math\.round\(period\.outstandingAmount \* 100\)\)/);
  assert.match(model, /isNewCustomerPaymentMode\(form\.paymentMode\)/);
  assert.match(service, /supabase\.rpc\("create_vehicle_fuel_batch_payment"/);
  assert.match(component, /\["office-cash-book-day", factoryId\]/);
  assert.doesNotMatch(component, /createVehicleFuelPayment\(/);
});

test("Recent Pump Payments is bounded and exposes exact persisted allocations", () => {
  assert.match(component, /const recentPayments = payments[\s\S]*\.slice\(0, 8\)/);
  assert.match(component, /id="recent-pump-payments-heading"/);
  assert.match(component, /className="flex h-96 flex-col"/);
  assert.match(component, /className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(component, /payment\.allocationCount/);
  assert.match(component, /payment\.note/);
  assert.match(component, /payment\.allocations\.map/);
  assert.match(component, /allocation\.allocatedAmount/);
  assert.match(component, /<Button type="button" variant="ghost" onClick=\{openPaymentArchive\}>View all payments →<\/Button>/);
});

test("Pump Payments uses the V2 responsive hierarchy without changing Fuel Entries", () => {
  assert.match(component, /grid items-start gap-atlas-4 lg:grid-cols-3/);
  assert.match(component, /space-y-atlas-4 lg:col-span-2/);
  assert.match(component, /<Card as="section" aria-labelledby="pump-summary-heading">/);
  assert.match(component, /<Card as="section" aria-labelledby="pump-payment-details-heading">/);
  assert.match(component, /<Card as="section" aria-labelledby="outstanding-fuel-entries-heading">/);
  assert.match(component, /<SearchChoice v2 label="Fuel Pump"/);
  assert.match(component, /id="new-fuel-entry-heading"/);
  assert.match(component, /id="recent-fuel-entries-heading"/);
});
