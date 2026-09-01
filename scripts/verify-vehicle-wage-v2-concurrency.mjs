import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ATLAS_VW2_TEST_EMAIL",
  "ATLAS_VW2_TEST_PASSWORD",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (process.env.ATLAS_VW2_ALLOW_PERMANENT_TEST_ROWS !== "true") {
  throw new Error(
    "Set ATLAS_VW2_ALLOW_PERMANENT_TEST_ROWS=true only for Test Atlas Clean. Vehicle wage payments and numbered Challans are immutable.",
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { error: signInError } = await supabase.auth.signInWithPassword({
  email: process.env.ATLAS_VW2_TEST_EMAIL,
  password: process.env.ATLAS_VW2_TEST_PASSWORD,
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

const { data: factory, error: factoryError } = await supabase
  .from("factories")
  .select("name, business_description, village, post_office, police_station, district, state, mobile")
  .eq("id", factoryId)
  .single();
if (factoryError) throw factoryError;
for (const field of [
  "name", "business_description", "village", "post_office",
  "police_station", "district", "state", "mobile",
]) assert.ok(factory[field]?.trim(), `Factory ${field} must be populated before this test.`);

const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
const { data: customer, error: customerError } = await supabase.rpc("create_customer", {
  p_factory_id: factoryId,
  p_name: `VW2 concurrency ${runId}`,
  p_address: "Test Atlas Clean",
  p_mobile: "0000000000",
});
if (customerError) throw customerError;

async function createVehicle(suffix) {
  const { data, error } = await supabase.rpc("find_or_create_vehicle", {
    p_factory_id: factoryId,
    p_vehicle_number: `VW2${runId}${suffix}`,
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
      particulars: `VW2 concurrency ${label} ${runId}`,
    }],
  });
  if (error) throw error;
  return data;
}

async function account(vehicleId) {
  const { data, error } = await supabase.rpc("get_vehicle_wage_account_summary", {
    p_factory_id: factoryId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw error;
  return data?.[0];
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

const paymentRaceVehicle = await createVehicle("P");
await createWageChallan(paymentRaceVehicle.id, 1000, "payment race");
const paymentRace = await Promise.all([
  pay(paymentRaceVehicle.id, 700, `Competing A ${runId}`),
  pay(paymentRaceVehicle.id, 700, `Competing B ${runId}`),
]);
const paymentSuccesses = paymentRace.filter((result) => !result.error);
const paymentFailures = paymentRace.filter((result) => result.error);
assert.equal(paymentSuccesses.length, 1, "Exactly one competing ₹700 payment must succeed.");
assert.equal(paymentFailures.length, 1, "Exactly one competing ₹700 payment must fail.");
assert.equal(paymentFailures[0].error.code, "P3110");
const paymentRaceAccount = await account(paymentRaceVehicle.id);
assert.equal(Number(paymentRaceAccount.total_earned), 1000);
assert.equal(Number(paymentRaceAccount.total_paid), 700);
assert.equal(Number(paymentRaceAccount.available_balance), 300);

const mutationRaceVehicle = await createVehicle("M");
await createWageChallan(mutationRaceVehicle.id, 750, "mutation race base");
const removableChallan = await createWageChallan(
  mutationRaceVehicle.id,
  500,
  "mutation race removable",
);
const mutationRace = await Promise.all([
  pay(mutationRaceVehicle.id, 1000, `Payment/void race ${runId}`),
  supabase.rpc("void_challan", {
    p_factory_id: factoryId,
    p_challan_id: removableChallan.id,
  }),
]);
const mutationSuccesses = mutationRace.filter((result) => !result.error);
const mutationFailures = mutationRace.filter((result) => result.error);
assert.equal(mutationSuccesses.length, 1, "Exactly one payment/void race participant must succeed.");
assert.equal(mutationFailures.length, 1, "Exactly one payment/void race participant must fail.");
assert.ok(
  ["P3110", "P3111"].includes(mutationFailures[0].error.code),
  `Unexpected payment/void losing SQLSTATE ${mutationFailures[0].error.code}.`,
);
const mutationRaceAccount = await account(mutationRaceVehicle.id);
assert.ok(
  Number(mutationRaceAccount.total_paid) <= Number(mutationRaceAccount.total_earned),
  "Payment/void race violated Paid <= Earned.",
);

console.log("PASS: competing ₹700 payments serialized; exactly one committed.");
console.log("PASS: concurrent Vehicle wage payment and Challan void serialized; exactly one committed.");
console.log("PASS: final Paid <= Earned for both concurrency accounts.");
console.log(`Permanent Test Atlas Clean fixture run: ${runId}`);
