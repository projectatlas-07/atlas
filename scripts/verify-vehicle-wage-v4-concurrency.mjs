import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ATLAS_VW4_TEST_EMAIL",
  "ATLAS_VW4_TEST_PASSWORD",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (process.env.ATLAS_VW4_ALLOW_PERMANENT_TEST_ROWS !== "true") {
  throw new Error(
    "Set ATLAS_VW4_ALLOW_PERMANENT_TEST_ROWS=true only for Test Atlas Clean. Vehicle payments, reversals, and numbered Challans are immutable.",
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { error: signInError } = await supabase.auth.signInWithPassword({
  email: process.env.ATLAS_VW4_TEST_EMAIL,
  password: process.env.ATLAS_VW4_TEST_PASSWORD,
});
if (signInError) throw signInError;

const { data: mappings, error: mappingError } = await supabase
  .from("factory_users")
  .select("factory_id")
  .eq("is_active", true)
  .limit(2);
if (mappingError) throw mappingError;
assert.equal(mappings?.length, 1, "Test user must have exactly one active factory mapping.");
const factoryId = mappings[0].factory_id;
const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();

const { data: customer, error: customerError } = await supabase.rpc("create_customer", {
  p_factory_id: factoryId,
  p_name: `VW4 concurrency ${runId}`,
  p_address: "Test Atlas Clean",
  p_mobile: "0000000000",
});
if (customerError) throw customerError;

async function createVehicle(suffix) {
  const { data, error } = await supabase.rpc("find_or_create_vehicle", {
    p_factory_id: factoryId,
    p_vehicle_number: `VW4${runId}${suffix}`,
    p_delivery_wage_tracking_enabled: true,
  });
  if (error) throw error;
  return data;
}

async function createWageChallan(vehicleId, wage, label) {
  const { data, error } = await supabase.rpc("create_challan", {
    p_factory_id: factoryId,
    p_challan_date: "2026-09-01",
    p_customer_id: customer.id,
    p_vehicle_id: vehicleId,
    p_trip_labour_wage: wage,
    p_items: [],
    p_flexible_lines: [{
      line_type: "NOTE",
      order_index: 0,
      particulars: `VW4 concurrency ${label} ${runId}`,
    }],
  });
  if (error) throw error;
  return data;
}

async function pay(vehicleId, amount, note) {
  return supabase.rpc("record_vehicle_wage_payment", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
    p_payment_date: "2026-09-01",
    p_amount: amount,
    p_note: note,
  });
}

async function reverse(paymentId, reason) {
  return supabase.rpc("reverse_vehicle_wage_payment", {
    p_factory_id: factoryId,
    p_payment_id: paymentId,
    p_reversal_date: "2026-09-01",
    p_reason: reason,
  });
}

async function account(vehicleId) {
  const { data, error } = await supabase.rpc("get_vehicle_wage_account_summary", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw error;
  return data?.[0];
}

const accountRaceVehicle = await createVehicle("A");
await createWageChallan(accountRaceVehicle.id, 2000, "payment reversal race");
const { data: wrongPaymentRows, error: wrongPaymentError } = await pay(
  accountRaceVehicle.id,
  1200,
  `Wrong payment ${runId}`,
);
if (wrongPaymentError) throw wrongPaymentError;
const wrongPayment = wrongPaymentRows[0];

const paymentReversalRace = await Promise.all([
  reverse(wrongPayment.payment_id, `Concurrent reversal ${runId}`),
  pay(accountRaceVehicle.id, 1500, `Concurrent corrected payment ${runId}`),
]);
assert.equal(paymentReversalRace[0].error, null, "The reversal must commit exactly once.");
assert.ok(
  paymentReversalRace[1].error === null || paymentReversalRace[1].error.code === "P3110",
  `Unexpected concurrent payment result ${paymentReversalRace[1].error?.code}.`,
);
const accountAfterRace = await account(accountRaceVehicle.id);
assert.ok(
  Number(accountAfterRace.total_paid) <= Number(accountAfterRace.total_earned),
  "Concurrent reversal/payment violated effective Paid <= Earned.",
);
assert.equal(
  Number(accountAfterRace.total_paid),
  paymentReversalRace[1].error ? 0 : 1500,
  "Final effective Paid does not match the serialized race outcome.",
);

const duplicateRaceVehicle = await createVehicle("D");
await createWageChallan(duplicateRaceVehicle.id, 1000, "duplicate reversal race");
const { data: duplicatePaymentRows, error: duplicatePaymentError } = await pay(
  duplicateRaceVehicle.id,
  500,
  `Duplicate reversal target ${runId}`,
);
if (duplicatePaymentError) throw duplicatePaymentError;
const duplicatePayment = duplicatePaymentRows[0];
const duplicateRace = await Promise.all([
  reverse(duplicatePayment.payment_id, `Competing reversal A ${runId}`),
  reverse(duplicatePayment.payment_id, `Competing reversal B ${runId}`),
]);
assert.equal(
  duplicateRace.filter((result) => !result.error).length,
  1,
  "Exactly one competing reversal must succeed.",
);
assert.equal(
  duplicateRace.filter((result) => result.error?.code === "P3121").length,
  1,
  "Exactly one competing reversal must fail as already reversed.",
);
const { data: storedReversals, error: reversalReadError } = await supabase
  .from("vehicle_wage_payment_reversals")
  .select("id")
  .eq("factory_id", factoryId)
  .eq("payment_id", duplicatePayment.payment_id);
if (reversalReadError) throw reversalReadError;
assert.equal(storedReversals.length, 1, "Duplicate reversal race stored more than one row.");

console.log("PASS: concurrent reversal/payment serialized and preserved effective Paid <= Earned.");
console.log("PASS: concurrent duplicate reversals stored exactly one immutable reversal.");
console.log(`Permanent Test Atlas Clean fixture run: ${runId}`);
