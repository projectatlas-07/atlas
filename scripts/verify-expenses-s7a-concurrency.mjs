import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const email = process.env.ATLAS_S7A_TEST_EMAIL ?? process.env.ATLAS_S5A_TEST_EMAIL;
const password = process.env.ATLAS_S7A_TEST_PASSWORD ?? process.env.ATLAS_S5A_TEST_PASSWORD;
const allowPermanentRows = process.env.ATLAS_S7A_ALLOW_PERMANENT_TEST_ROWS
  ?? process.env.ATLAS_S5A_ALLOW_PERMANENT_TEST_ROWS;
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}
if (!email) throw new Error("ATLAS_S7A_TEST_EMAIL or ATLAS_S5A_TEST_EMAIL is required.");
if (!password) throw new Error("ATLAS_S7A_TEST_PASSWORD or ATLAS_S5A_TEST_PASSWORD is required.");
if (allowPermanentRows !== "true") {
  throw new Error(
    "Set ATLAS_S7A_ALLOW_PERMANENT_TEST_ROWS=true only for an isolated test database. Expense verifier rows are immutable.",
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) throw signInError;

const { data: mappings, error: mappingError } = await supabase
  .from("factory_users")
  .select("factory_id")
  .eq("is_active", true)
  .limit(2);
if (mappingError) throw mappingError;
assert.equal(mappings?.length, 1, "Test user must have exactly one active factory mapping.");
const factoryId = mappings[0].factory_id;
const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

const { data: supplier, error: supplierError } = await supabase.rpc("create_supplier", {
  p_factory_id: factoryId,
  p_name: `S7A concurrency supplier ${runId}`,
  p_address: "Isolated test database",
  p_mobile: null,
});
if (supplierError) throw supplierError;

const { data: source, error: sourceError } = await supabase.rpc("create_expense_record", {
  p_factory_id: factoryId,
  p_business_date: "2026-08-28",
  p_kind: "purchase",
  p_supplier_id: supplier.id,
  p_counterparty_name: null,
  p_description: `S7A concurrency purchase ${runId}`,
  p_total_amount: 10000,
  p_note: "Two simultaneous ₹8,000 attempts",
});
if (sourceError) throw sourceError;

const createCompetingPayment = () => supabase.rpc("create_expense_payment", {
  p_factory_id: factoryId,
  p_payment_date: "2026-08-28",
  p_amount: 8000,
  p_payment_mode: "cash",
  p_note: `S7A concurrency verifier ${runId}`,
  p_allocations: [{ expense_record_id: source.id, amount: 8000 }],
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
      "get_expense_record_payment_state",
      { p_factory_id: factoryId, p_expense_record_id: source.id },
    );
    const { data: diagnosticAllocations, error: diagnosticAllocationsError } = await supabase
      .from("expense_payment_allocations")
      .select("payment_id, expense_record_id, allocated_amount")
      .eq("factory_id", factoryId)
      .eq("expense_record_id", source.id);
    console.error("Unexpected concurrent create_expense_payment results:");
    console.error(JSON.stringify({
      source: { id: source.id, total_amount: source.total_amount, is_locked: source.is_locked },
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
  assert.equal(successes.length, 1, "Exactly one competing ₹8,000 expense payment must succeed.");
  assert.equal(failures.length, 1, "Exactly one competing ₹8,000 expense payment must fail.");
  assert.equal(
    failures[0].error?.code,
    "P4105",
    "The losing request must fail against recomputed authoritative outstanding.",
  );

  const { data: allocations, error: allocationsError } = await supabase
    .from("expense_payment_allocations")
    .select("allocated_amount")
    .eq("factory_id", factoryId)
    .eq("expense_record_id", source.id);
  if (allocationsError) throw allocationsError;
  assert.equal(allocations?.length, 1, "Concurrent requests created an extra allocation.");
  assert.equal(
    allocations.reduce((sum, allocation) => sum + Number(allocation.allocated_amount), 0),
    8000,
    "Concurrent allocations exceeded the Expense/Purchase outstanding amount.",
  );

  const { data: stateRows, error: stateError } = await supabase.rpc(
    "get_expense_record_payment_state",
    { p_factory_id: factoryId, p_expense_record_id: source.id },
  );
  if (stateError) throw stateError;
  assert.equal(Number(stateRows?.[0]?.total_paid), 8000);
  assert.equal(Number(stateRows?.[0]?.outstanding_amount), 2000);
  assert.equal(stateRows?.[0]?.payment_state, "partially_paid");
  assert.equal(stateRows?.[0]?.is_locked, true);

  console.log(
    "PASS: two simultaneous ₹8,000 attempts against ₹10,000 outstanding produced one outgoing payment, ₹8,000 paid, and ₹2,000 due.",
  );
} finally {
  await supabase.auth.signOut();
}
