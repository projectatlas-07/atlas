import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ATLAS_S5A_TEST_EMAIL",
  "ATLAS_S5A_TEST_PASSWORD",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (process.env.ATLAS_S5A_ALLOW_PERMANENT_TEST_ROWS !== "true") {
  throw new Error(
    "Set ATLAS_S5A_ALLOW_PERMANENT_TEST_ROWS=true only for an isolated test database. Payment verifier rows are immutable.",
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { error: signInError } = await supabase.auth.signInWithPassword({
  email: process.env.ATLAS_S5A_TEST_EMAIL,
  password: process.env.ATLAS_S5A_TEST_PASSWORD,
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
  .select("name, business_description, address, mobile")
  .eq("id", factoryId)
  .single();
if (factoryError) throw factoryError;
for (const field of ["name", "business_description", "address", "mobile"]) {
  assert.ok(factory[field]?.trim(), `Factory ${field} must be populated before this test.`);
}

let brickTypeId = process.env.ATLAS_S5A_TEST_BRICK_TYPE_ID;
if (!brickTypeId) {
  const { data: brickTypes, error: brickTypeError } = await supabase
    .from("brick_types")
    .select("id")
    .eq("factory_id", factoryId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (brickTypeError) throw brickTypeError;
  assert.equal(brickTypes?.length, 1, "Test factory needs one active brick type.");
  brickTypeId = brickTypes[0].id;
}

const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const { data: customer, error: customerError } = await supabase.rpc("create_customer", {
  p_factory_id: factoryId,
  p_name: `S5A concurrency verifier ${runId}`,
  p_address: "Isolated test database",
  p_mobile: "0000000000",
});
if (customerError) throw customerError;

const { data: challan, error: challanError } = await supabase.rpc("create_challan", {
  p_factory_id: factoryId,
  p_challan_date: "2026-08-27",
  p_customer_id: customer.id,
  p_vehicle_number: `S5A${runId}`,
  p_tractor_labour_rate: 0,
  p_items: [{ brick_type_id: brickTypeId, quantity: 1000, rate: 10000 }],
});
if (challanError) throw challanError;

const { data: initialStateRows, error: initialStateError } = await supabase.rpc(
  "get_challan_payment_state",
  { p_factory_id: factoryId, p_challan_id: challan.id },
);
if (initialStateError) throw initialStateError;
const initialState = initialStateRows?.[0];
assert.equal(Number(challan.challan_total), 10000, "Verifier Challan total must be ₹10,000.");
assert.equal(challan.is_locked, false, "Verifier Challan must start unlocked.");
assert.equal(Number(initialState?.sale_total), 10000, "Initial sale total must be ₹10,000.");
assert.equal(Number(initialState?.total_paid), 0, "Verifier Challan must start unpaid.");
assert.equal(
  Number(initialState?.outstanding_amount),
  10000,
  "Verifier Challan must start with ₹10,000 outstanding.",
);
assert.equal(initialState?.payment_state, "unpaid", "Verifier Challan must start unpaid.");

const createCompetingPayment = () => supabase.rpc("create_customer_payment", {
  p_factory_id: factoryId,
  p_customer_id: customer.id,
  p_payment_date: "2026-08-27",
  p_amount: 8000,
  p_payment_mode: "cash",
  p_note: `S5A concurrency verifier ${runId}`,
  p_allocations: [{ challan_id: challan.id, amount: 8000 }],
});

try {
  const concurrentResults = await Promise.all([
    createCompetingPayment(),
    createCompetingPayment(),
  ]);
  const successes = concurrentResults.filter((result) => !result.error);
  const failures = concurrentResults.filter((result) => result.error);
  if (successes.length !== 1 || failures.length !== 1) {
    const { data: diagnosticState, error: diagnosticStateError } = await supabase.rpc(
      "get_challan_payment_state",
      { p_factory_id: factoryId, p_challan_id: challan.id },
    );
    const { data: diagnosticAllocations, error: diagnosticAllocationsError } = await supabase
      .from("customer_payment_allocations")
      .select("payment_id, challan_id, allocated_amount")
      .eq("factory_id", factoryId)
      .eq("challan_id", challan.id);
    console.error("Unexpected concurrent create_customer_payment results:");
    console.error(JSON.stringify({
      challan: {
        id: challan.id,
        challan_total: challan.challan_total,
        is_locked: challan.is_locked,
      },
      initial_state: initialState,
      calls: concurrentResults.map((result, index) => ({
        call: index + 1,
        payment_id: result.data?.id ?? null,
        error: result.error ? {
          code: result.error.code,
          message: result.error.message,
          details: result.error.details,
          hint: result.error.hint,
        } : null,
      })),
      final_state: diagnosticState,
      final_state_error: diagnosticStateError,
      allocations: diagnosticAllocations,
      allocations_error: diagnosticAllocationsError,
    }, null, 2));
  }
  assert.equal(successes.length, 1, "Exactly one competing ₹8,000 payment must succeed.");
  assert.equal(failures.length, 1, "Exactly one competing ₹8,000 payment must fail.");
  assert.equal(
    failures[0].error?.code,
    "P3105",
    "The losing request must fail against the recomputed authoritative outstanding amount.",
  );

  const { data: allocations, error: allocationsError } = await supabase
    .from("customer_payment_allocations")
    .select("allocated_amount")
    .eq("factory_id", factoryId)
    .eq("challan_id", challan.id);
  if (allocationsError) throw allocationsError;
  assert.equal(allocations?.length, 1, "Concurrent requests created an extra allocation.");
  assert.equal(
    allocations.reduce((sum, allocation) => sum + Number(allocation.allocated_amount), 0),
    8000,
    "Concurrent allocations exceeded the Challan outstanding amount.",
  );

  const { data: stateRows, error: stateError } = await supabase.rpc(
    "get_challan_payment_state",
    { p_factory_id: factoryId, p_challan_id: challan.id },
  );
  if (stateError) throw stateError;
  assert.equal(Number(stateRows?.[0]?.total_paid), 8000);
  assert.equal(Number(stateRows?.[0]?.outstanding_amount), 2000);
  assert.equal(stateRows?.[0]?.payment_state, "partially_paid");

  console.log(
    "PASS: two simultaneous ₹8,000 attempts against ₹10,000 outstanding produced one payment, ₹8,000 total paid, and ₹2,000 due.",
  );
} finally {
  await supabase.auth.signOut();
}
