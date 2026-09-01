import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ATLAS_S1_TEST_EMAIL",
  "ATLAS_S1_TEST_PASSWORD",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (process.env.ATLAS_S1_ALLOW_PERMANENT_TEST_ROWS !== "true") {
  throw new Error(
    "Set ATLAS_S1_ALLOW_PERMANENT_TEST_ROWS=true only for an isolated test database. Numbered verifier Challans are permanent.",
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { error: signInError } = await supabase.auth.signInWithPassword({
  email: process.env.ATLAS_S1_TEST_EMAIL,
  password: process.env.ATLAS_S1_TEST_PASSWORD,
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

let brickTypeId = process.env.ATLAS_S1_TEST_BRICK_TYPE_ID;
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
  p_name: `S1 concurrency verifier ${runId}`,
  p_address: "Isolated test database",
  p_mobile: "0000000000",
});
if (customerError) throw customerError;

const createdChallanIds = [];
const createOne = async (suffix) => {
  const { data, error } = await supabase.rpc("create_challan", {
    p_factory_id: factoryId,
    p_challan_date: "2026-08-26",
    p_customer_id: customer.id,
    p_vehicle_number: `S1${runId}${suffix}`,
    p_tractor_labour_rate: 0,
    p_items: [{ brick_type_id: brickTypeId, quantity: 1000 + suffix, rate: 1000 }],
  });
  if (error) throw error;
  createdChallanIds.push(data.id);
  return data;
};

let primaryError;
try {
  const concurrentCount = 12;
  const concurrentResults = await Promise.all(
    Array.from({ length: concurrentCount }, (_, index) => createOne(index + 1)),
  );
  const allocatedNumbers = concurrentResults
    .map((challan) => Number(challan.challan_number))
    .sort((left, right) => left - right);
  assert.equal(new Set(allocatedNumbers).size, concurrentCount, "Duplicate numbers allocated.");
  for (let index = 1; index < allocatedNumbers.length; index += 1) {
    assert.equal(
      allocatedNumbers[index],
      allocatedNumbers[index - 1] + 1,
      "Concurrent allocation left an unexpected counter gap.",
    );
  }

  const beforeFailedCreation = allocatedNumbers.at(-1);
  const { error: falseAmountError } = await supabase.rpc("create_challan", {
    p_factory_id: factoryId,
    p_challan_date: "2026-08-26",
    p_customer_id: customer.id,
    p_vehicle_number: `S1${runId}F`,
    p_tractor_labour_rate: 0,
    p_items: [{
      brick_type_id: brickTypeId,
      quantity: 1000,
      rate: 1000,
      line_amount: 1,
    }],
  });
  assert.equal(falseAmountError?.code, "22023", "False line amount should be rejected.");

  const afterFailedCreation = await createOne(90);
  assert.equal(
    Number(afterFailedCreation.challan_number),
    beforeFailedCreation + 1,
    "Failed creation consumed or corrupted the next number.",
  );

  const { error: firstVoidError } = await supabase.rpc("void_challan", {
    p_factory_id: factoryId,
    p_challan_id: concurrentResults[0].id,
  });
  if (firstVoidError) throw firstVoidError;
  const afterVoid = await createOne(91);
  assert.equal(
    Number(afterVoid.challan_number),
    beforeFailedCreation + 2,
    "Voiding reused a permanent number.",
  );

  console.log(
    `PASS: ${concurrentCount} simultaneous create_challan requests allocated unique contiguous per-factory numbers; failure rollback and void non-reuse also passed.`,
  );
} catch (error) {
  primaryError = error;
} finally {
  const voidResults = await Promise.allSettled(createdChallanIds.map(async (challanId) => {
    const { error } = await supabase.rpc("void_challan", {
      p_factory_id: factoryId,
      p_challan_id: challanId,
    });
    if (error && error.code !== "P3006") throw error;
  }));
  const cleanupFailure = voidResults.find((result) => result.status === "rejected");
  await supabase.auth.signOut();
  if (!primaryError && cleanupFailure?.status === "rejected") {
    primaryError = cleanupFailure.reason;
  }
}

if (primaryError) throw primaryError;
