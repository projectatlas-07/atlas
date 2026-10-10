import assert from "node:assert/strict";
import { test } from "node:test";
import { createCreditWorkflow, createCreditCoordinator, creditSavedConfirmation, creditLockKey, creditError, creditStorageKey, normalizeCreditAmount, readCreditIntent, MAX_TRANSPORT_CREDIT_PAISE, CreditFailure, type CreditIntent, type CreditStorage, type WageCredit } from "./transport-wage-credit-model.ts";
import { formatIndianCurrency } from "../../lib/formatting.ts";

// Deterministic exclusive-manager test double; browser Web Locks are not exercised here.
function manager() {
  const tails = new Map<string, Promise<unknown>>();
  return { async request<T>(name: string, options: { signal?: AbortSignal }, action: () => T | Promise<T>): Promise<T> {
    const previous = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    tails.set(name, previous.catch(() => {}).then(() => held));
    try { await previous.catch(() => {}); options.signal?.throwIfAborted(); return await action(); }
    finally { release(); }
  } };
}
const coordinator = createCreditCoordinator(manager(), true)!;
function testWorkflow(scope: Parameters<typeof createCreditWorkflow>[0], storage: Parameters<typeof createCreditWorkflow>[1],
  deps: Parameters<typeof createCreditWorkflow>[2]) {
  return createCreditWorkflow(scope, storage, deps, coordinator);
}
const scope = { actorId: "11111111-1111-4111-8111-111111111111", factoryId: "22222222-2222-4222-8222-222222222222", workerId: "33333333-3333-4333-8333-333333333333" };
const id = "44444444-4444-4444-8444-444444444444";
const draft = { originalWorkDate: "2026-09-21", amount: "12.34", reason: "  Missed attendance  " };
function memory(): CreditStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
}
function saved(intent: CreditIntent, wasReplayed = false): WageCredit {
  return { ...intent, postingDate: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", wasReplayed };
}
test("credit amounts use exact integer paise and reject invalid precision/nonfinite values", () => {
  assert.equal(normalizeCreditAmount("00012.3"), "12.30");
  assert.equal(normalizeCreditAmount("0.01"), "0.01");
  assert.equal(normalizeCreditAmount("1000000000.29"), "1000000000.29");
  for (const raw of ["0", "-1", "NaN", "Infinity", "1e2", "0.001", "12.340", "999999999999999999999.99", ""]) assert.equal(normalizeCreditAmount(raw), null);
});
test("V1 amount bounds, actual JSON numeric decoding and immutable history formatting preserve exact paise", () => {
  assert.equal(normalizeCreditAmount("9999999999.98"), "9999999999.98");
  assert.equal(normalizeCreditAmount("9999999999.99"), "9999999999.99");
  assert.equal(normalizeCreditAmount("10000000000.00"), null);
  assert.equal(normalizeCreditAmount("90071992547409.91"), null);
  const values = [1n, MAX_TRANSPORT_CREDIT_PAISE - 1n, MAX_TRANSPORT_CREDIT_PAISE];
  // Deterministic broad samples support the binary64 bound above; not an exhaustive trillion-value enumeration.
  let seed = 1n;
  for (let i = 0; i < 4096; i++) { seed = (seed * 48271n) % MAX_TRANSPORT_CREDIT_PAISE; values.push(seed || 1n); }
  for (const paise of values) {
    const text = `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;
    const decoded = JSON.parse(`{"amount":${text}}`).amount;
    const restored = normalizeCreditAmount(String(decoded));
    assert.equal(restored, text);
    const parts = restored!.split("."); assert.equal(BigInt(parts[0]) * 100n + BigInt(parts[1]), paise);
  }
  assert.equal(formatIndianCurrency(Number("9999999999.99"), { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "₹9,99,99,99,999.99");
  assert.equal(formatIndianCurrency(Number("0.01"), { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "₹0.01");
});
test("persisted UUID/payload precede the RPC; rapid double-submit makes one create call", async () => {
  const storage = memory(); let calls = 0; let release!: (credit: WageCredit) => void;
  const workflow = testWorkflow(scope, storage, {
    create: (intent) => { calls++; assert.deepEqual(readCreditIntent(scope, storage), intent); return new Promise((resolve) => { release = resolve; }); },
    lookup: async () => null, refresh: async () => {},
  });
  let uuidCalls = 0;
  const intent = await workflow.prepare(draft, () => { uuidCalls++; return id; });
  assert.equal(intent.reason, "Missed attendance");
  const first = workflow.submit(); const second = workflow.submit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1); assert.equal(uuidCalls, 1);
  await assert.rejects(workflow.prepare(draft, () => id));
  release(saved(intent)); assert.equal((await first).status, "saved"); assert.equal((await second).status, "saved");
});
test("lost response after commit survives reload and reconciles read-only without second create", async () => {
  const storage = memory(); let calls = 0; let record: WageCredit | null = null; let reads = 0;
  const first = testWorkflow(scope, storage, { create: async (intent) => { calls++; record = saved(intent); throw new Error("Lost response"); }, lookup: async () => null, refresh: async () => {} });
  const intent = await first.prepare(draft, () => id);
  assert.equal((await first.submit()).status, "unknown"); assert.equal(first.canCorrect, false);
  const restored = testWorkflow(scope, storage, { create: async () => { calls++; throw new Error("Must not create"); }, lookup: async (restoredIntent) => { reads++; assert.deepEqual(restoredIntent, intent); return record; }, refresh: async () => {} });
  assert.deepEqual(restored.intent, intent);
  assert.equal((await restored.reconcile()).status, "saved"); assert.equal(calls, 1); assert.equal(reads, 1);
  assert.equal(restored.intent?.id, id);
});
test("absent reconciliation is UNKNOWN; retry reuses exact intent and identical replay", async () => {
  const storage = memory(); const payloads: CreditIntent[] = []; let creates = 0;
  const workflow = testWorkflow(scope, storage, { create: async (intent) => { payloads.push(intent); creates++; if (creates === 1) throw new Error("Timeout"); return saved(intent, true); }, lookup: async () => null, refresh: async () => {} });
  await workflow.prepare(draft, () => id); await workflow.submit();
  assert.equal((await workflow.reconcile()).status, "unknown");
  await assert.rejects(workflow.reset());
  const result = await workflow.submit();
  assert.equal(result.status, "saved"); if (result.status === "saved") assert.equal(result.credit.wasReplayed, true);
  assert.deepEqual(payloads[0], payloads[1]);
});
test("refresh failure preserves confirmed success/ID and read-only retry never recreates", async () => {
  let creates = 0; let fail = true;
  const workflow = testWorkflow(scope, memory(), { create: async (intent) => { creates++; return saved(intent); }, lookup: async () => null, refresh: async () => { if (fail) throw new Error("Offline"); } });
  await workflow.prepare(draft, () => id);
  const result = await workflow.submit();
  assert.equal(result.status, "saved"); if (result.status === "saved") assert.equal(result.credit.id, id);
  assert.equal((await workflow.refresh()).status, "saved"); assert.equal(workflow.outcome?.status, "saved");
  if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.refresh, "outdated");
  fail = false; await workflow.refresh(); if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.refresh, "current"); assert.equal(creates, 1);
});
test("confirmed credit publishes immediately despite a permanently hanging refresh; read-only retry never creates", async () => {
  let creates = 0; let refreshes = 0;
  const workflow = testWorkflow(scope, memory(), { create: async (intent) => { creates++; return saved(intent); }, lookup: async () => null,
    refresh: () => ++refreshes === 1 ? new Promise<void>(() => {}) : Promise.resolve() });
  const observed: string[] = []; workflow.subscribe((result) => { if (result) observed.push(result.status); });
  await workflow.prepare(draft, () => id);
  const result = await workflow.submit(); assert.equal(result.status, "saved"); assert.equal(workflow.busy, false);
  assert.ok(observed.includes("saved")); if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.credit.id, id);
  await workflow.refresh(); assert.equal(creates, 1); if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.refresh, "current");
});
test("first definitive rejection permits correction but unknown/reloaded intent is never discarded", async () => {
  const storage = memory(); const reject = async () => { throw creditError({ code: "P2631", message: "ATLAS_TRANSPORT_CREDIT_WEEK_NOT_FINALIZED" }); };
  const first = testWorkflow(scope, storage, { create: reject, lookup: async () => null, refresh: async () => {} });
  await first.prepare(draft, () => id); assert.equal((await first.submit()).status, "rejected"); assert.equal(first.canCorrect, true);
  const restored = testWorkflow(scope, storage, { create: reject, lookup: async () => null, refresh: async () => {} });
  await restored.submit(); assert.equal(restored.canCorrect, false); await assert.rejects(restored.reset());
});
test("payload and actor conflicts are hard failures, not replacement intents", async () => {
  const workflow = testWorkflow(scope, memory(), { create: async (intent) => saved({ ...intent, amount: "12.35" }), lookup: async () => null, refresh: async () => {} });
  await workflow.prepare(draft, () => id); assert.equal((await workflow.submit()).status, "conflict"); await assert.rejects(workflow.reset());
  assert.equal(creditError({ code: "P2632", message: "ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT" }).kind, "conflict");
});
test("actor/factory/worker storage scopes cannot leak or replace unresolved intents", async () => {
  const storage = memory(); const workflow = testWorkflow(scope, storage, { create: async (intent) => saved(intent), lookup: async () => null, refresh: async () => {} });
  await workflow.prepare(draft, () => id);
  for (const key of ["actorId", "factoryId", "workerId"] as const) assert.equal(readCreditIntent({ ...scope, [key]: "55555555-5555-4555-8555-555555555555" }, storage), null);
  assert.equal(readCreditIntent(scope, storage)?.id, id);
});
test("unavailable, failed or corrupted durable storage blocks submission and remains intact", async () => {
  const deps = { create: async (intent: CreditIntent) => saved(intent), lookup: async () => null, refresh: async () => {} };
  assert.throws(() => testWorkflow(scope, null, deps), CreditFailure);
  const storage = memory(); storage.setItem(creditStorageKey(scope), "broken");
  assert.throws(() => testWorkflow(scope, storage, deps)); assert.equal(storage.getItem(creditStorageKey(scope)), "broken");
  const readOnly = { ...memory(), setItem: () => { throw new Error("Quota"); } };
  await assert.rejects(testWorkflow(scope, readOnly, deps).prepare(draft, () => id));
});
test("approved errors map narrowly and never expose raw provider details", () => {
  assert.match(creditError({ code: "42501", message: "secret SQL" }).message, /original account/);
  assert.match(creditError({ code: "22023", message: "secret SQL" }).message, /two decimals/);
  assert.equal(creditError({ code: "P2631", message: "Different contract" }).kind, "unknown");
  assert.equal(creditError({ code: "40001", message: "internal query" }).kind, "unknown");
});
test("two independent tabs atomically adopt one durable intent before either request", async () => {
  const storage = memory(); let generated = 0; const sent: CreditIntent[] = [];
  const deps = { create: async (intent: CreditIntent) => { sent.push(intent); return saved(intent); }, lookup: async () => null, refresh: async () => {} };
  const a = testWorkflow(scope, storage, deps); const b = testWorkflow(scope, storage, deps);
  const [first, second] = await Promise.all([a.prepare(draft, () => { generated++; return id; }), b.prepare({ ...draft, amount: "99" }, () => { generated++; return "55555555-5555-4555-8555-555555555555"; })]);
  assert.deepEqual(first, second); assert.equal(generated, 1);
  await Promise.all([a.submit(), b.submit()]); assert.deepEqual(sent[0], sent[1]);
  assert.equal(a.outcome?.status, "saved"); assert.equal(b.outcome?.status, "saved");
  assert.equal(a.intent?.id, id); assert.equal(b.intent?.id, id);
});
test("unresolved intent reset/deletion blocks resubmission without replacing UUID/payload", async () => {
  for (const cleared of [false, true]) {
    const storage = memory(); let creates = 0; let generated = 0; let payable = false;
    const deps = { create: async (intent: CreditIntent) => { creates++; return saved(intent); }, lookup: async () => null,
      refresh: async () => { payable = true; }, recoveryChanged: (available: boolean) => { if (!available) payable = false; } };
    const a = testWorkflow(scope, storage, deps);
    const original = await a.prepare(draft, () => { generated++; return id; });
    const b = testWorkflow(scope, storage, deps);
    await assert.rejects(b.reset()); // An unresolved peer has no authority to reset.
    if (cleared) storage.setItem(creditStorageKey(scope), JSON.stringify({ ...original, recoveryState: "cleared" }));
    else storage.removeItem(creditStorageKey(scope)); // Unexpected external deletion, not a coordinated reset.
    assert.equal((await a.reconcile()).status, "storage");
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await a.submit()).status, "storage");
      await assert.rejects(a.prepare(draft, () => { generated++; return "55555555-5555-4555-8555-555555555555"; }));
      await assert.rejects(a.reset());
    }
    assert.deepEqual(a.intent, original); assert.equal(creates, 0); assert.equal(generated, 1); assert.equal(payable, false);
  }
});
test("confirmed saved deletion retains evidence, reports recovery inconsistency and blocks re-creation", async () => {
  const storage = memory(); let creates = 0; let generated = 0; let payable = false; let record: WageCredit | null = null;
  const deps = { create: async (intent: CreditIntent) => { creates++; record = saved(intent); return record; },
    lookup: async (intent: CreditIntent) => record?.id === intent.id ? record : null, refresh: async () => { payable = true; },
    recoveryChanged: (available: boolean) => { if (!available) payable = false; } };
  const a = testWorkflow(scope, storage, deps); const original = await a.prepare(draft, () => { generated++; return id; });
  await a.submit(); await a.refresh(); assert.equal(payable, true);
  storage.removeItem(creditStorageKey(scope));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await a.reconcile();
    assert.equal(result.status, "saved");
    if (result.status === "saved") { assert.deepEqual(result.credit, record); assert.equal(result.recovery, "unavailable"); }
    assert.equal(payable, false); assert.equal((await a.submit()).status, "saved");
    await assert.rejects(a.reset());
    await assert.rejects(a.prepare(draft, () => { generated++; return "55555555-5555-4555-8555-555555555555"; }));
  }
  assert.deepEqual(a.intent, original); assert.equal(creates, 1); assert.equal(generated, 1);
  // Restoring the original immutable record permits read-only recovery, not a replacement write.
  storage.setItem(creditStorageKey(scope), JSON.stringify({ ...original, recoveryState: "saved" }));
  const returned = testWorkflow(scope, storage, deps);
  assert.equal((await returned.reconcile()).status, "saved"); assert.equal(returned.intent?.id, id); assert.equal(creates, 1);
  const unavailable = { ...storage, getItem: () => { throw new Error("Unavailable"); } };
  assert.throws(() => testWorkflow(scope, unavailable, deps)); assert.equal(creates, 1); assert.equal(generated, 1);
});
test("completed exact-UUID coordinated reset is accepted only with authoritative completion evidence", async () => {
  const storage = memory(); let creates = 0;
  const records = new Map<string, WageCredit>();
  const deps = { create: async (intent: CreditIntent) => { creates++; const record = saved(intent); records.set(intent.id, record); return record; },
    lookup: async (intent: CreditIntent) => records.get(intent.id) ?? null, refresh: async () => {} };
  const a = testWorkflow(scope, storage, deps); await a.prepare(draft, () => id);
  const b = testWorkflow(scope, storage, deps); await a.submit(); await b.reconcile(); await a.reset();
  // The old failing assertion treated this legitimate tombstone like lost storage.
  const retained = await b.submit(); assert.equal(retained.status, "saved");
  if (retained.status === "saved") { assert.equal(retained.credit.id, id); assert.equal(retained.recovery, "unavailable"); }
  await b.reconcile(); assert.equal(b.intent, null); assert.equal(b.outcome, null); assert.equal(creates, 1);
  // A terminal marker belonging to a different UUID is never accepted as cleanup.
  const c = testWorkflow(scope, memory(), deps); const original = await c.prepare(draft, () => id);
  await c.submit();
  const otherStorage = memory(); otherStorage.setItem(creditStorageKey(scope), JSON.stringify({ ...original, recoveryState: "saved" }));
  const d = testWorkflow(scope, otherStorage, deps); await d.reconcile();
  otherStorage.setItem(creditStorageKey(scope), JSON.stringify({ ...original, id: "55555555-5555-4555-8555-555555555555", recoveryState: "cleared" }));
  const inconsistent = await d.reconcile(); assert.equal(inconsistent.status, "saved");
  if (inconsistent.status === "saved") assert.equal(inconsistent.recovery, "unavailable");
  assert.equal(d.intent?.id, id);
});
test("financial refresh never writes recovery storage outside cross-tab exclusion", async () => {
  const storage = memory(); let writes = 0; let failSavedWrite = true;
  const guarded = { ...storage, setItem: (key: string, value: string) => {
    writes++;
    if (failSavedWrite && JSON.parse(value).recoveryState === "saved") throw new Error("Quota");
    storage.setItem(key, value);
  } };
  let creates = 0;
  const workflow = testWorkflow(scope, guarded, { create: async (intent) => { creates++; return saved(intent); }, lookup: async () => null, refresh: async () => {} });
  await workflow.prepare(draft, () => id); await workflow.submit();
  const before = writes; failSavedWrite = false;
  await workflow.refresh(); assert.equal(writes, before);
  if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.recovery, "unavailable");
  await workflow.reconcile(); await workflow.refresh();
  if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.recovery, "available");
  assert.equal(creates, 1); assert.equal(workflow.intent?.id, id);
});
test("different workers do not share exclusion; queued cancellation/failure cannot overwrite storage", async () => {
  const lock = createCreditCoordinator(manager(), true)!;
  let release!: () => void;
  const held = lock.exclusive(scope, () => new Promise<void>((resolve) => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const storage = memory(); const deps = { create: async (intent: CreditIntent) => saved(intent), lookup: async () => null, refresh: async () => {} };
  const otherScope = { ...scope, workerId: "55555555-5555-4555-8555-555555555555" };
  assert.notEqual(creditLockKey(scope), creditLockKey(otherScope));
  const other = createCreditWorkflow(otherScope, storage, deps, lock);
  assert.equal((await other.prepare(draft, () => id)).workerId, otherScope.workerId);
  const abort = new AbortController(); const queued = createCreditWorkflow(scope, storage, deps, lock).prepare(draft, () => id, abort.signal);
  abort.abort(); release(); await held; await assert.rejects(queued);
  assert.equal(readCreditIntent(scope, storage), null);
  // Model a terminated holder by rejection/release; native tab termination still needs browser QA.
  await assert.rejects(lock.exclusive(scope, () => { throw new Error("Terminated"); }));
  assert.equal((await createCreditWorkflow(scope, storage, deps, lock).prepare(draft, () => id)).id, id);
});
test("missing/insecure coordination fails closed and preserves restored intent", async () => {
  const storage = memory(); const deps = { create: async (intent: CreditIntent) => saved(intent), lookup: async () => null, refresh: async () => {} };
  await testWorkflow(scope, storage, deps).prepare(draft, () => id);
  assert.equal(createCreditCoordinator(manager(), false), null);
  const unsupported = createCreditWorkflow(scope, storage, deps, null);
  assert.equal(unsupported.coordinated, false); await assert.rejects(unsupported.prepare(draft, () => id), /coordinate/);
  assert.equal((await unsupported.submit()).status, "storage"); assert.equal(readCreditIntent(scope, storage)?.id, id);
  const failedLock = createCreditCoordinator({ request: async () => { throw new Error("Lock denied"); } }, true);
  let generated = 0;
  await assert.rejects(createCreditWorkflow(scope, memory(), deps, failedLock).prepare(draft, () => { generated++; return id; }));
  assert.equal(generated, 0);
});
test("another tab's UNKNOWN retry prevents clearing an earlier definitive rejection", async () => {
  const storage = memory();
  const a = testWorkflow(scope, storage, { create: async () => { throw creditError({ code: "P2631", message: "ATLAS_TRANSPORT_CREDIT_WEEK_NOT_FINALIZED" }); }, lookup: async () => null, refresh: async () => {} });
  await a.prepare(draft, () => id); assert.equal((await a.submit()).status, "rejected");
  const b = testWorkflow(scope, storage, { create: async () => { throw new Error("Lost response"); }, lookup: async () => null, refresh: async () => {} });
  assert.equal((await b.submit()).status, "unknown"); await assert.rejects(a.reset()); assert.equal(readCreditIntent(scope, storage)?.id, id);
});
test("mounted recovery adopts another tab's intent and coordinated completion without replacing UNKNOWN", async () => {
  const storage = memory(); const records = new Map<string, WageCredit>(); let calls = 0;
  const deps = { create: async (intent: CreditIntent) => { calls++; const record = saved(intent); records.set(intent.id, record); return record; }, lookup: async (intent: CreditIntent) => records.get(intent.id) ?? null, refresh: async () => {} };
  const a = testWorkflow(scope, storage, deps); const mounted = testWorkflow(scope, storage, deps);
  await a.prepare(draft, () => id); assert.equal((await mounted.reconcile()).status, "unknown");
  assert.equal(mounted.intent?.id, id);
  await a.submit(); await a.reset(); await mounted.reconcile(); assert.equal(mounted.intent, null);
  const nextId = "55555555-5555-4555-8555-555555555555";
  await a.prepare({ ...draft, amount: "22" }, () => nextId); await mounted.reconcile();
  assert.equal((mounted.intent as CreditIntent | null)?.id, nextId); assert.equal(calls, 1);
  await mounted.submit(); assert.equal(calls, 2); assert.equal(readCreditIntent(scope, storage)?.id, nextId);
});
test("storage read-back failure prevents dispatch; remount and concurrent reconciliation retain one creation", async () => {
  const storage = memory(); let calls = 0;
  const deps = { create: async (intent: CreditIntent) => { calls++; return saved(intent); }, lookup: async () => null, refresh: async () => {} };
  const corrupted = { ...storage, setItem: (key: string) => storage.setItem(key, "corrupted") };
  const a = testWorkflow(scope, corrupted, deps); await assert.rejects(a.prepare(draft, () => id)); assert.equal(calls, 0);
  const clean = memory(); const first = testWorkflow(scope, clean, deps); await first.prepare(draft, () => id);
  const remounted = testWorkflow(scope, clean, deps); await Promise.all([remounted.submit(), remounted.reconcile()]); assert.equal(calls, 1); assert.equal(remounted.intent?.id, id);
});
for (const state of ["first save", "identical replay", "hanging refresh", "storage failure"] as const) {
  test(`production confirmation exposes exact authoritative UUID and evidence on ${state}`, async () => {
    const storage = memory(); let unavailable = false; let creates = 0; let generated = 0;
    const guarded = { ...storage, getItem: (key: string) => { if (unavailable) throw new Error("Unavailable"); return storage.getItem(key); } };
    const workflow = testWorkflow(scope, guarded, { create: async (intent) => { creates++; return saved(intent, state === "identical replay"); },
      lookup: async () => null, refresh: () => state === "hanging refresh" ? new Promise<void>(() => {}) : Promise.resolve() });
    const intent = await workflow.prepare(draft, () => { generated++; return id; });
    await workflow.submit();
    if (state === "storage failure") { unavailable = true; await workflow.reconcile(); }
    const confirmation = creditSavedConfirmation(workflow.outcome, scope, intent.id);
    assert.equal(confirmation?.creditId, id);
    assert.equal(confirmation?.amount, "12.34"); assert.equal(confirmation?.originalWorkDate, intent.originalWorkDate);
    assert.equal(confirmation?.postingDate, "2026-10-10"); assert.equal(confirmation?.reason, intent.reason);
    assert.equal(confirmation?.actorId, scope.actorId); assert.equal(confirmation?.createdAt, "2026-10-10T10:00:00Z");
    assert.equal(confirmation?.wasReplayed, state === "identical replay");
    if (state === "hanging refresh") assert.equal(confirmation?.refresh, "refreshing");
    if (state === "storage failure") assert.equal(confirmation?.recovery, "unavailable");
    assert.equal(creates, 1); assert.equal(generated, 1); assert.equal(workflow.intent?.id, id);
  });
}
test("confirmation cannot leak across actor/factory/worker/UUID; returning to the original worker recovers read-only", async () => {
  const storage = memory(); let creates = 0; let reads = 0;
  const workflow = testWorkflow(scope, storage, { create: async (intent) => { creates++; return saved(intent); }, lookup: async () => null, refresh: async () => {} });
  const intent = await workflow.prepare(draft, () => id); await workflow.submit();
  const persisted = storage.getItem(creditStorageKey(scope));
  assert.equal(creditSavedConfirmation(workflow.outcome, scope, id)?.creditId, id);
  for (const key of ["actorId", "factoryId", "workerId"] as const) {
    const otherScope = { ...scope, [key]: "55555555-5555-4555-8555-555555555555" };
    assert.equal(creditSavedConfirmation(workflow.outcome, otherScope, id), null);
    const other = testWorkflow(otherScope, storage, { create: async () => { throw new Error("No other-context submission"); }, lookup: async () => null, refresh: async () => {} });
    assert.equal(other.intent, null); assert.equal(creditSavedConfirmation(other.outcome, otherScope, null), null);
    assert.equal(storage.getItem(creditStorageKey(scope)), persisted);
  }
  assert.equal(creditSavedConfirmation(workflow.outcome, scope, "55555555-5555-4555-8555-555555555555"), null);
  const returned = testWorkflow(scope, storage, { create: async () => { throw new Error("No replacement write"); }, lookup: async (original) => { reads++; assert.deepEqual(original, intent); return saved(original, true); }, refresh: async () => {} });
  await returned.reconcile();
  assert.equal(creditSavedConfirmation(returned.outcome, scope, returned.intent?.id ?? null)?.creditId, id);
  assert.equal(creates, 1); assert.equal(reads, 1); assert.equal(storage.getItem(creditStorageKey(scope)), persisted);
});
