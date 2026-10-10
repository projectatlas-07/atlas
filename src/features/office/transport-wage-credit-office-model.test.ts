import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";
import { AsyncLocalStorage } from "node:async_hooks";
import { activateTransportCreditContext, bindTransportCreditGate, createTransportCreditGateOwner, deactivateTransportCreditGateOwner, ownsTransportCreditGate, publishTransportCreditRecovery, resetTransportCreditGate, markTransportCreditCurrent, createTransportCreditRecovery as createRecovery, creditFreshnessKey, creditHistoryKey, isTransportCreditReadCurrent, transportCreditHistoryOptions, isTransportCreditHistoryCurrent, markTransportCreditPending as markOwnedPending, refreshTransportCreditQueries as refreshOwnedQueries, sumPostedTransportCredits, type TransportCreditGateContext } from "./transport-wage-credit-office-model.ts";
import { createCreditCoordinator, createCreditWorkflow, creditSavedConfirmation, creditStorageKey, readCreditRecord } from "../transport/transport-wage-credit-model.ts";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
// Existing query tests keep their original assertions; each call now supplies
// an explicit current owner rather than bypassing the production contract.
const testContexts = new WeakMap<QueryClient, Map<string, () => TransportCreditGateContext>>();
function remember(client: QueryClient, factoryId: string, context: () => TransportCreditGateContext) {
  let map = testContexts.get(client); if (!map) { map = new Map(); testContexts.set(client, map); } map.set(factoryId, context);
}
function testOwner(client: QueryClient, factoryId: string, workerId: string) {
  if (!testContexts.get(client)?.has(factoryId)) {
    const context = activateTransportCreditContext(client, factoryId, "11111111-1111-4111-8111-111111111111"); remember(client, factoryId, () => context);
  }
  return createTransportCreditGateOwner(testContexts.get(client)!.get(factoryId)!(), workerId);
}
function createTransportCreditRecovery(...args: Parameters<typeof createRecovery>) {
  const controller = createRecovery(...args); remember(args[0], args[1], () => controller.getSnapshot().context); return controller;
}
function markTransportCreditPending(client: QueryClient, factoryId: string, workerId: string, id?: string, available?: boolean) { return markOwnedPending(testOwner(client, factoryId, workerId), id, available); }
function refreshTransportCreditQueries(client: QueryClient, factoryId: string, workerId: string, id?: string) { return refreshOwnedQueries(testOwner(client, factoryId, workerId), id); }
test("post-credit refresh cancels old balance request, starts a real replacement, and isolates unrelated workers/factories", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const old = deferred<number>(); const fresh = deferred<number>(); let reads = 0;
  const key = ["office-transport-worker-balance", "factory-a", "worker-a", "2026-10-10"];
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => ++reads === 1 ? old.promise : fresh.promise });
  const stop = observer.subscribe(() => {});
  const unrelated = deferred<number>(); let unrelatedReads = 0;
  const otherKey = ["office-transport-worker-balance", "factory-a", "worker-b", "2026-10-10"];
  const other = new QueryObserver(client, { queryKey: otherKey, queryFn: () => { unrelatedReads++; return unrelated.promise; } }); const stopOther = other.subscribe(() => {});
  const history = new QueryObserver(client, { queryKey: creditHistoryKey(testOwner(client, "factory-a", "worker-a").context, "worker-a"), queryFn: async () => ["credit"] }); const stopHistory = history.subscribe(() => {});
  markTransportCreditPending(client, "factory-a", "worker-a", "intent-a"); assert.equal(client.getQueryData(creditFreshnessKey("factory-a", "worker-a")), "pending");
  const refresh = refreshTransportCreditQueries(client, "factory-a", "worker-a", "intent-a");
  await new Promise((r) => setTimeout(r, 0)); assert.equal(reads, 2); old.resolve(100);
  await new Promise((r) => setTimeout(r, 0)); assert.notEqual(client.getQueryData(key), 100);
  assert.equal(client.getQueryState(otherKey)?.fetchStatus, "fetching"); assert.equal(unrelatedReads, 1);
  fresh.resolve(112.34); await refresh; assert.equal(client.getQueryData(key), 112.34); assert.equal(client.getQueryData(creditFreshnessKey("factory-a", "worker-a")), "current");
  unrelated.resolve(40); stop(); stopOther(); stopHistory(); client.clear();
});
test("offline refresh remains outdated; reconnect and explicit read-only refresh completes successful reads", async () => {
  onlineManager.setOnline(false);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); let reads = 0;
  const observer = new QueryObserver(client, { queryKey: ["office-transport-worker-balance", "a", "w", "2026-10-10"], queryFn: async () => { reads++; return 12.34; } }); const stop = observer.subscribe(() => {});
  try {
    await assert.rejects(refreshTransportCreditQueries(client, "a", "w")); assert.equal(reads, 0);
    assert.equal(client.getQueryData(creditFreshnessKey("a", "w")), "outdated");
    onlineManager.setOnline(true); await refreshTransportCreditQueries(client, "a", "w");
    assert.ok(reads > 0); assert.equal(client.getQueryData(creditFreshnessKey("a", "w")), "current");
  } finally { onlineManager.setOnline(true); stop(); client.clear(); }
});
test("inactive balance variants remain invalidated until reopened and cannot display CURRENT", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const key = ["office-transport-worker-balance", "a", "w", "2026-10-09"];
  await client.fetchQuery({ queryKey: key, queryFn: async () => 0 });
  await refreshTransportCreditQueries(client, "a", "w");
  assert.equal(client.getQueryState(key)?.isInvalidated, true); assert.equal(isTransportCreditReadCurrent(client.getQueryState(key)!), false);
  assert.equal(isTransportCreditReadCurrent({ status: "success", fetchStatus: "paused", error: null, dataUpdatedAt: 1 }), false); client.clear();
});
test("older refresh completion and generic Refresh cannot clear a newer unresolved credit", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const read = deferred<number>();
  const observer = new QueryObserver(client, { queryKey: ["office-transport-worker-balance", "a", "w", "2026-10-10"], queryFn: () => read.promise });
  const stop = observer.subscribe(() => {});
  markTransportCreditPending(client, "a", "w", "first");
  const old = refreshTransportCreditQueries(client, "a", "w", "first");
  await new Promise((r) => setTimeout(r, 0));
  markTransportCreditPending(client, "a", "w", "second");
  read.resolve(12.34); await assert.rejects(old);
  assert.equal(client.getQueryData(creditFreshnessKey("a", "w")), "pending");
  await assert.rejects(refreshTransportCreditQueries(client, "a", "w"));
  await assert.rejects(refreshTransportCreditQueries(client, "a", "w", "first"));
  assert.equal(client.getQueryData(creditFreshnessKey("a", "w")), "pending");
  stop(); client.clear();
});
test("credit-only worker and immutable history use posting-date earnings, never original work-date eligibility", () => {
  const credit = { id: "credit", factoryId: "a", workerId: "archived-or-omitted", actorId: "actor", amount: "12.34", reason: "Missed", originalWorkDate: "2026-09-21", postingDate: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", wasReplayed: true };
  assert.equal(sumPostedTransportCredits([credit], "2026-09-01", "2026-09-30"), 0);
  assert.equal(sumPostedTransportCredits([credit], "2026-10-10", "2026-10-10", credit.workerId), 12.34);
  assert.equal(sumPostedTransportCredits([credit], "2026-10-10", "2026-10-10", "foreign-worker"), 0);
});
test("UI wiring: deliberate confirmation, frozen recovery payload, immutable history and source-only drawer integration", () => {
  const panel = readFileSync(new URL("./components/transport-wage-credit-panel.tsx", import.meta.url), "utf8");
  const drawer = readFileSync(new URL("./components/chamber-transport-account-drawer.tsx", import.meta.url), "utf8");
  const section = readFileSync(new URL("./components/transport-office-section.tsx", import.meta.url), "utf8");
  const overview = readFileSync(new URL("./components/chamber-transport-workforce-overview.tsx", import.meta.url), "utf8");
  assert.match(overview, /const totalAvailableBalance = !recoveryReady \|\| workersLoading \|\| workersError/);
  assert.match(section, /document.visibilityState === "visible"\) changed\(\)/);
  assert.match(section, /document.addEventListener\("visibilitychange", visible\)/);
  assert.match(section, /document.removeEventListener\("visibilitychange", visible\)/);
  assert.match(panel, /<Checkbox checked=\{confirmed\}/); assert.match(panel, /workflow\.prepare\(form, \(\) => crypto\.randomUUID\(\), preparation.current\?\.signal\)/);
  // Storage failure must not remount the active account and lose known SAVED.
  assert.match(panel, /key=\{`\$\{actorId\}:\$\{factoryId\}:\$\{worker\.id\}`\}/);
  assert.match(panel, /workflow\.reconcile\(\)/); assert.match(panel, /workflow\.submit\(\)/); assert.match(panel, /disabled=\{!!intent \|\| busy \|\| !workflow \|\| !workflow.coordinated \|\| !recovery.ready\}/);
  assert.match(panel, /credit\.postingDate/); assert.match(panel, /credit\.originalWorkDate/); assert.match(panel, /credit\.actorId/);
  assert.doesNotMatch(panel, /createTransportWorkerWithdrawal|\.insert\(|\.update\(|\.delete\(/);
  assert.match(drawer, /<TransportWageCreditPanel factoryId=\{factoryId\} worker=\{worker\} recovery=\{recovery\}/);
  assert.match(drawer, /!readCurrent\(paymentDateBalanceQuery\)/);
  // Source wiring only: exact field values are exercised in the production view-model tests.
  assert.match(panel, /const saved = creditSavedConfirmation\(outcome, \{ actorId, factoryId, workerId: worker.id \}, intent\?\.id \?\? null\)/);
  assert.match(panel, /<dt>\{S.creditId\}<\/dt><dd className="select-text break-all">\{saved.creditId\}<\/dd>/);
  assert.match(panel, /saved && saved.recovery === "unavailable"/);
  assert.match(drawer, /freshness.data === "current"/);
  assert.match(drawer, /disabled=\{!validPaymentAmount \|\| !paymentDate \|\| !readCurrent\(paymentDateBalanceQuery\)\}/);
  assert.match(panel, /disabled=\{busy \|\| !recovery.ready \|\| outcome\?\.status !== "saved" \|\| outcome.recovery !== "available"\}/);
});
const actor = "11111111-1111-4111-8111-111111111111";
const factory = "22222222-2222-4222-8222-222222222222";
const worker = "33333333-3333-4333-8333-333333333333";
const creditId = "44444444-4444-4444-8444-444444444444";
function recoveryStorage() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}
test("one recovery contract gates delayed inspection and immediately invalidates identity/factory switches", async () => {
  const client = new QueryClient(); const identity = deferred<string | null>(); const storage = recoveryStorage();
  const controller = createTransportCreditRecovery(client, factory, () => identity.promise, () => storage);
  const pending = controller.inspect([worker]); assert.equal(controller.getSnapshot().ready, false);
  identity.resolve(actor); await pending; assert.equal(controller.getSnapshot().actorId, actor); assert.equal(controller.getSnapshot().ready, true);
  const changed = controller.inspect([worker], "55555555-5555-4555-8555-555555555555", true);
  assert.equal(controller.getSnapshot().ready, false); assert.equal(controller.getSnapshot().actorId, null);
  await changed; assert.equal(controller.getSnapshot().ready, false);
  const other = createTransportCreditRecovery(client, "other-factory", async () => actor, () => storage);
  assert.equal(other.getSnapshot().ready, false); assert.equal(other.getSnapshot().factoryId, "other-factory"); client.clear();
});
test("routine same-user SIGNED_IN preserves confirmed current intent; storage changes trigger recovery", async () => {
  const client = new QueryClient(); const storage = recoveryStorage(); let verifies = 0;
  const key = creditStorageKey({ actorId: actor, factoryId: factory, workerId: worker });
  storage.setItem(key, JSON.stringify({ actorId: actor, factoryId: factory, workerId: worker, id: creditId, originalWorkDate: "2026-09-21", amount: "12.34", reason: "Missed", recoveryState: "saved" }));
  const controller = createTransportCreditRecovery(client, factory, async () => { verifies++; return actor; }, () => storage);
  await controller.inspect([worker]); assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "pending");
  await refreshTransportCreditQueries(client, factory, worker, creditId);
  await controller.inspect([worker], actor, true); assert.equal(verifies, 1); assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
  await controller.inspect([worker]); assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
  storage.removeItem(key); const external = controller.inspect([worker]); assert.equal(controller.getSnapshot().ready, false); await external;
  assert.equal(controller.getSnapshot().intentIds[worker], "invalid"); assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "pending"); client.clear();
});
test("late identity inspection cannot restore readiness after a newer switch or unmount", async () => {
  const client = new QueryClient(); const a = deferred<string | null>(); const b = deferred<string | null>(); let reads = 0;
  const controller = createTransportCreditRecovery(client, factory, () => ++reads === 1 ? a.promise : b.promise, () => recoveryStorage());
  const first = controller.inspect([worker]); await Promise.resolve();
  const second = controller.inspect([worker], null); await Promise.resolve();
  a.resolve(actor); await first; assert.equal(controller.getSnapshot().ready, false);
  controller.stop(); b.resolve(actor); await second; assert.equal(controller.getSnapshot().ready, false); client.clear();
});
test("new identity cannot inherit old cached CURRENT balances or let an obsolete refresh clear a gate", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); const storage = recoveryStorage();
  const old = deferred<number>(); const fresh = deferred<number>(); let reads = 0;
  const key = ["office-transport-worker-balance", factory, worker, "2026-10-10"];
  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => ++reads === 1 ? old.promise : fresh.promise }); const stop = observer.subscribe(() => {});
  markTransportCreditPending(client, factory, worker, creditId);
  const controller = createTransportCreditRecovery(client, factory, async () => actor, () => storage);
  const inspected = controller.inspect([worker]); assert.equal(controller.getSnapshot().ready, false); await inspected;
  await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(reads, 2);
  assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "outdated");
  old.resolve(999); await Promise.resolve(); assert.notEqual(client.getQueryData(key), 999);
  fresh.resolve(12.34); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current"); stop(); client.clear();
});
for (const [reads, storageFails] of [["fresh", false], ["hanging", false], ["fresh", true], ["hanging", true], ["failing", true]] as const) {
  test(`confirmed evidence survives ${reads} reads / ${storageFails ? "failed" : "healthy"} recovery storage; withdrawals stay gated independently`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const storage = recoveryStorage(); let failStorage = false; let creates = 0; let uuids = 0; let mode: string = "fresh";
    const unavailable = { ...storage, getItem: (key: string) => { if (failStorage) throw new Error("Unavailable"); return storage.getItem(key); } };
    const blocked = deferred<number>();
    const balanceKey = ["office-transport-worker-balance", factory, worker, "2026-10-10"];
    const observer = new QueryObserver(client, { queryKey: balanceKey, queryFn: async () => {
      if (mode === "hanging") return blocked.promise;
      if (mode === "failing") throw new Error("Offline");
      return 12.34;
    } }); const stop = observer.subscribe(() => {});
    const coordinator = createCreditCoordinator({ request: async (_name, _options, action) => action() }, true)!;
    const workflow = createCreditWorkflow({ actorId: actor, factoryId: factory, workerId: worker }, unavailable, {
      create: async (intent) => { creates++; return { ...intent, postingDate: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", wasReplayed: false }; },
      lookup: async () => { throw new Error("Known save must not need another creation or lookup"); },
      refresh: (credit) => refreshTransportCreditQueries(client, factory, worker, credit.id),
      recoveryChanged: (available, id) => markTransportCreditPending(client, factory, worker, id, available),
    }, coordinator);
    try {
      const intent = await workflow.prepare({ originalWorkDate: "2026-09-21", amount: "12.34", reason: "Missed" }, () => { uuids++; return creditId; });
      markTransportCreditPending(client, factory, worker, creditId);
      await workflow.submit(); await workflow.refresh();
      assert.equal(workflow.outcome?.status, "saved");
      failStorage = storageFails; mode = reads;
      await workflow.reconcile(); // The exact E13 failure: storage fails after SAVED.
      assert.equal(workflow.outcome?.status, "saved");
      if (workflow.outcome?.status === "saved") assert.equal(workflow.outcome.credit.id, creditId);
      const refresh = workflow.refresh();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(workflow.outcome?.status, "saved");
      if (reads !== "hanging") await refresh;
      const result = workflow.outcome;
      assert.equal(result?.status, "saved");
      if (result?.status === "saved") {
        assert.deepEqual(result.credit, { ...intent, postingDate: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", wasReplayed: false });
        assert.equal(result.recovery, storageFails ? "unavailable" : "available");
        assert.equal(result.refresh, reads === "fresh" ? "current" : reads === "hanging" ? "refreshing" : "outdated");
      }
      const canWithdraw = client.getQueryData(creditFreshnessKey(factory, worker)) === "current" && isTransportCreditReadCurrent(client.getQueryState(balanceKey)!);
      assert.equal(canWithdraw, reads === "fresh" && !storageFails);
      assert.equal(creates, 1); assert.equal(uuids, 1); assert.equal(workflow.intent?.id, creditId);
      if (storageFails) {
        assert.throws(() => createCreditWorkflow(intent, unavailable, { create: async () => { throw new Error("No reload write"); }, lookup: async () => null, refresh: async () => {} }, coordinator));
        assert.equal(JSON.parse(storage.getItem(creditStorageKey(intent))!).id, creditId);
      }
      blocked.resolve(12.34); await refresh;
    } finally { blocked.resolve(12.34); stop(); client.clear(); }
  });
}
test("cross-tab deletion cannot reopen fresh withdrawal gates; exact confirmed cleanup restores only after real reads", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const storage = recoveryStorage(); let creates = 0; let generated = 0; let reads = 0;
  const records = new Map<string, import("../transport/transport-wage-credit-model.ts").WageCredit>();
  const balanceKey = ["office-transport-worker-balance", factory, worker, "2026-10-10"];
  const observer = new QueryObserver(client, { queryKey: balanceKey, queryFn: async () => { reads++; return 12.34; } });
  const stop = observer.subscribe(() => {});
  const coordinator = createCreditCoordinator({ request: async (_name, _options, action) => action() }, true)!;
  const deps = {
    create: async (intent: import("../transport/transport-wage-credit-model.ts").CreditIntent) => { creates++; const result = { ...intent, postingDate: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", wasReplayed: false }; records.set(intent.id, result); return result; },
    lookup: async (intent: import("../transport/transport-wage-credit-model.ts").CreditIntent) => records.get(intent.id) ?? null,
    refresh: (credit: import("../transport/transport-wage-credit-model.ts").WageCredit) => refreshTransportCreditQueries(client, factory, worker, credit.id),
    recoveryChanged: (available: boolean, id: string) => markTransportCreditPending(client, factory, worker, id, available),
  };
  const scope = { actorId: actor, factoryId: factory, workerId: worker };
  const a = createCreditWorkflow(scope, storage, deps, coordinator);
  try {
    const intent = await a.prepare({ originalWorkDate: "2026-09-21", amount: "12.34", reason: "Missed" }, () => { generated++; return creditId; });
    markTransportCreditPending(client, factory, worker, creditId);
    const b = createCreditWorkflow(scope, storage, deps, coordinator);
    storage.removeItem(creditStorageKey(scope));
    assert.equal((await a.reconcile()).status, "storage"); assert.equal((await a.submit()).status, "storage");
    await assert.rejects(refreshTransportCreditQueries(client, factory, worker));
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "pending"); assert.equal(creates, 0);
    storage.setItem(creditStorageKey(scope), JSON.stringify({ ...intent, recoveryState: "unresolved" }));
    await a.submit(); await a.refresh(); await b.reconcile(); await b.refresh();
    const original = b.outcome;
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
    storage.removeItem(creditStorageKey(scope));
    await b.reconcile(); await b.refresh();
    assert.equal(isTransportCreditReadCurrent(client.getQueryState(balanceKey)!), true); // Reads really succeeded.
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "pending");
    const blocked = b.outcome;
    assert.equal(blocked?.status, "saved");
    if (blocked?.status === "saved" && original?.status === "saved") {
      assert.deepEqual(blocked.credit, original.credit); assert.equal(blocked.refresh, "current"); assert.equal(blocked.recovery, "unavailable");
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await b.submit(); await assert.rejects(b.reset());
      await assert.rejects(b.prepare({ originalWorkDate: "2026-09-21", amount: "99", reason: "Replacement" }, () => { generated++; return creditId; }));
    }
    assert.equal(creates, 1); assert.equal(generated, 1);
    // A healthy exact tombstone from a confirmed peer is distinguishable from deletion.
    storage.setItem(creditStorageKey(scope), JSON.stringify({ ...intent, recoveryState: "saved" }));
    await a.reset(); const before = reads; await b.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(b.intent, null); assert.equal(b.outcome, null); assert.ok(reads > before);
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
    assert.equal(creates, 1); assert.equal(generated, 1);
    // Ordinary no-intent accounts use normal read readiness, not a prior saved-credit requirement.
    await refreshTransportCreditQueries(client, factory, worker);
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
  } finally { stop(); client.clear(); }
});
test("E15 delayed SAVED-A reconciliation cannot replace unresolved B's financial gate; returning A recovers the same UUID", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const storage = recoveryStorage(); const scopeA = { actorId: actor, factoryId: factory, workerId: worker };
  const actorB = "55555555-5555-4555-8555-555555555555";
  const scopeB = { ...scopeA, actorId: actorB }; const idB = "66666666-6666-4666-8666-666666666666";
  let identity = actor; let failedStorage = false; let creates = 0; let reads = 0; let generated = 0; let suspend = false;
  const held = deferred<void>(); const entered = deferred<void>();
  const coordinator = createCreditCoordinator({ request: async (_name, _options, action) => {
    if (suspend) { suspend = false; entered.resolve(); await held.promise; } return action();
  } }, true)!;
  const controller = createRecovery(client, factory, async () => identity, () => storage);
  const key = ["office-transport-worker-balance", factory, worker, "2026-10-10"];
  const traceContext = new AsyncLocalStorage<{ operation: string; actorId: string; startedBeforeSwitch: boolean }>();
  let step = "initial observer"; let switched = false; let refreshNumber = 0;
  const generations = new Map<TransportCreditGateContext["generation"], number>(); const requestTrace: Record<string, unknown>[] = [];
  const queuedReads: Promise<number>[] = [];
  const traced = <T>(operation: string, actorId: string, action: () => T) => traceContext.run({ operation, actorId, startedBeforeSwitch: !switched }, action);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => {
    reads++;
    const origin = traceContext.getStore(); const context = controller.getSnapshot().context;
    if (!generations.has(context.generation)) generations.set(context.generation, generations.size + 1);
    const entry: Record<string, unknown> = { request: reads, operation: origin?.operation ?? "initial observer", actorId: origin?.actorId ?? identity,
      factoryId: factory, workerId: worker, generation: generations.get(context.generation), active: context.active, step,
      initiatedBeforeSwitch: !switched, operationQueuedBeforeSwitch: origin?.startedBeforeSwitch ?? !switched };
    requestTrace.push(entry);
    const response = deferred<number>(); queueMicrotask(() => response.resolve(12.34));
    queuedReads.push(response.promise);
    const value = await response.promise; entry.completedAfterSwitch = switched; return value;
  } }); const stop = observer.subscribe(() => {});
  const records = new Map<string, import("../transport/transport-wage-credit-model.ts").WageCredit>();
  const operations = {
    create: async (intent: import("../transport/transport-wage-credit-model.ts").CreditIntent) => {
      creates++; const credit = { ...intent, postingDate: "2026-10-10", createdAt: "2026-10-10T10:00:00Z", wasReplayed: false }; records.set(intent.id, credit); return credit;
    },
    lookup: async (intent: import("../transport/transport-wage-credit-model.ts").CreditIntent) => records.get(intent.id) ?? null,
  };
  try {
    step = "A initial inspection"; await traced(step, actor, () => controller.inspect([worker], actor));
    const ownerA = createTransportCreditGateOwner(controller.getSnapshot().context, worker);
    const callbacksA = bindTransportCreditGate(ownerA, operations);
    const originalRefresh = callbacksA.refresh;
    callbacksA.refresh = (credit) => traced(`A credit refresh ${++refreshNumber}`, actor, () => originalRefresh(credit));
    const guardedStorage = { ...storage, getItem: (key: string) => { if (failedStorage) throw new Error("Temporary storage failure"); return storage.getItem(key); } };
    const a = createCreditWorkflow(scopeA, guardedStorage, callbacksA, coordinator);
    await a.prepare({ originalWorkDate: "2026-09-21", amount: "12.34", reason: "Missed" }, () => { generated++; return creditId; });
    step = "A confirmed save"; markOwnedPending(ownerA, creditId); await a.submit(); step = "A explicit refresh"; await a.refresh();
    failedStorage = true; await a.reconcile();
    assert.equal(a.outcome?.status, "saved"); if (a.outcome?.status === "saved") assert.equal(a.outcome.recovery, "unavailable");
    failedStorage = false; suspend = true; const obsolete = a.reconcile(); await entered.promise;
    // B's persisted unresolved intent must precede inspection: this is recovery, not an ordinary-account refresh.
    const pendingB = createCreditWorkflow(scopeB, storage, { ...operations, refresh: async () => {} }, coordinator);
    const intentB = await pendingB.prepare({ originalWorkDate: "2026-09-21", amount: "22", reason: "Unresolved B" }, () => { generated++; return idB; });
    switched = true; identity = actorB; step = "B pending recovery inspection"; await traced(step, actorB, () => controller.inspect([worker], actorB));
    const ownerB = createTransportCreditGateOwner(controller.getSnapshot().context, worker);
    const snapshotB = controller.getSnapshot();
    const assertPendingB = () => {
      assert.equal(controller.getSnapshot(), snapshotB);
      assert.equal(snapshotB.ready, true); assert.equal(snapshotB.actorId, actorB);
      assert.equal(snapshotB.intentIds[worker], idB); assert.equal(snapshotB.context, ownerB.context);
      assert.equal(ownerB.context.factoryId, factory); assert.equal(ownerB.workerId, worker);
      assert.equal(ownsTransportCreditGate(ownerB), true); assert.equal(ownsTransportCreditGate(ownerA), false);
      assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "pending");
      assert.deepEqual(readCreditRecord(scopeB, storage)?.intent, intentB);
      assert.equal(readCreditRecord(scopeB, storage)?.state, "unresolved");
      assert.equal(creditSavedConfirmation(a.outcome, scopeB, idB), null);
      assert.equal(creates, 1); assert.equal(generated, 2);
    };
    // Boundary 1: B's original pending UUID is authoritative; only four legitimate A reads have started.
    assertPendingB(); assert.equal(reads, 4);
    const before = client.getQueryCache().getAll().map((q) => [q.queryHash, q.state]); const beforeReads = reads;
    step = "A obsolete reconciliation resumes"; held.resolve(); await obsolete;
    assert.equal(markOwnedPending(ownerA, creditId, true), false, "obsolete A cannot replace B's pending financial gate");
    assert.equal(markTransportCreditCurrent(ownerA, undefined), false);
    assert.equal(resetTransportCreditGate(ownerA), false);
    assert.equal(publishTransportCreditRecovery(ownerA, () => assert.fail("obsolete A must not publish")), false);
    callbacksA.recoveryChanged!(true, creditId); callbacksA.recoveryChanged!(false, creditId);
    await assert.rejects(callbacksA.refresh(records.get(creditId)!)); await a.refresh();
    // Boundary 2: obsolete reconciliation/callbacks neither read nor mutate B's cache or ownership.
    assertPendingB(); assert.equal(reads, 4);
    assert.equal(reads, beforeReads); assert.deepEqual(client.getQueryCache().getAll().map((q) => [q.queryHash, q.state]), before);
    assert.throws(() => callbacksA.create(intentB)); assert.throws(() => callbacksA.lookup(intentB));
    // Boundary 3: drain queued read completions and async refresh continuations before checking again.
    await Promise.all(queuedReads); await new Promise((resolve) => setTimeout(resolve, 0));
    assertPendingB(); assert.equal(reads, 4);
    assert.deepEqual(client.getQueryCache().getAll().map((q) => [q.queryHash, q.state]), before);
    assert.deepEqual(requestTrace.map((entry) => entry.operation), ["initial observer", "A initial inspection", "A credit refresh 1", "A credit refresh 2"]);
    assert.ok(requestTrace.every((entry) => entry.actorId === actor && entry.active === true && entry.initiatedBeforeSwitch === true && entry.completedAfterSwitch === false));
    identity = actor; await controller.inspect([worker], actor);
    const ownerA2 = createTransportCreditGateOwner(controller.getSnapshot().context, worker);
    assert.notEqual(ownerA2.context.generation, ownerA.context.generation); assert.equal(ownsTransportCreditGate(ownerA), false);
    const returned = createCreditWorkflow(scopeA, storage, bindTransportCreditGate(ownerA2, operations), coordinator);
    await returned.reconcile(); await returned.refresh();
    assert.equal(returned.intent?.id, creditId); assert.equal(returned.outcome?.status, "saved"); assert.equal(creates, 1);
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
  } finally { held.resolve(); controller.stop(); stop(); client.clear(); }
});
test("every obsolete gate entry point is inert after unmount/remount and rapid A-B-A activation", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const contextA1 = activateTransportCreditContext(client, factory, actor);
  const a1 = createTransportCreditGateOwner(contextA1, worker);
  const pendingRead = deferred<number>(); let reads = 0;
  const observer = new QueryObserver(client, { queryKey: ["office-transport-worker-balance", factory, worker, "2026-10-10"], queryFn: () => { reads++; return pendingRead.promise; } }); const stop = observer.subscribe(() => {});
  markOwnedPending(a1, "a1"); const old = refreshOwnedQueries(a1, "a1"); void old.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  deactivateTransportCreditGateOwner(a1);
  const strictModeA2 = createTransportCreditGateOwner(contextA1, worker);
  assert.notEqual(a1.generation, strictModeA2.generation); markOwnedPending(strictModeA2, "mount-2");
  const b1 = createTransportCreditGateOwner(activateTransportCreditContext(client, factory, "55555555-5555-4555-8555-555555555555"), worker);
  markOwnedPending(b1, "b1");
  const contextA2 = activateTransportCreditContext(client, factory, actor);
  const a2 = createTransportCreditGateOwner(contextA2, worker); markOwnedPending(a2, "a2");
  let published = 0; const beforeReads = reads;
  const before = client.getQueryCache().getAll().map((q) => [q.queryHash, q.state]);
  try {
    for (const stale of [a1, strictModeA2, b1]) {
      assert.equal(ownsTransportCreditGate(stale), false);
      assert.equal(markOwnedPending(stale, "obsolete", true), false);
      assert.equal(markTransportCreditCurrent(stale, undefined), false);
      assert.equal(resetTransportCreditGate(stale), false);
      assert.equal(publishTransportCreditRecovery(stale, () => { published++; }), false);
      await assert.rejects(refreshOwnedQueries(stale, "obsolete"));
      const callbacks = bindTransportCreditGate(stale, { create: async () => { throw new Error("Must not dispatch"); }, lookup: async () => { throw new Error("Must not read"); } });
      callbacks.recoveryChanged!(true, "obsolete"); await assert.rejects(callbacks.refresh({ id: "obsolete" } as import("../transport/transport-wage-credit-model.ts").WageCredit));
      assert.deepEqual(client.getQueryCache().getAll().map((q) => [q.queryHash, q.state]), before);
    }
    assert.equal(published, 0); assert.equal(reads, beforeReads);
    pendingRead.resolve(12.34); await assert.rejects(old);
    assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "pending");
    // Another worker under the same actor has an independent producer lifetime.
    const other = createTransportCreditGateOwner(contextA2, "other-worker"); markOwnedPending(other, "other"); deactivateTransportCreditGateOwner(other);
    assert.equal(ownsTransportCreditGate(a2), true); assert.equal(markOwnedPending(a2, "a2", true), true);
    await refreshOwnedQueries(a2, "a2"); assert.equal(client.getQueryData(creditFreshnessKey(factory, worker)), "current");
  } finally { pendingRead.resolve(12.34); stop(); client.clear(); }
});

test("history keys isolate actor, activation, factory, worker and overview without changing an existing activation", () => {
  const client = new QueryClient();
  const a1 = activateTransportCreditContext(client, factory, actor);
  const a1Worker = creditHistoryKey(a1, worker);
  assert.deepEqual(creditHistoryKey(a1, worker), a1Worker, "same activation/remount retains its query identity");
  const b = activateTransportCreditContext(client, factory, "55555555-5555-4555-8555-555555555555");
  const a2 = activateTransportCreditContext(client, factory, actor);
  const otherFactory = activateTransportCreditContext(client, "other-factory", actor);
  const keys = [a1Worker, creditHistoryKey(b, worker), creditHistoryKey(a2, worker), creditHistoryKey(a2, "other-worker"),
    creditHistoryKey(a1), creditHistoryKey(b), creditHistoryKey(a2), creditHistoryKey(otherFactory, worker)];
  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, keys.length);
  client.clear();
});

test("production history options stay disabled and hidden until current identity inspection completes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const verified = deferred<string | null>(); let reads = 0;
  const controller = createRecovery(client, factory, () => verified.promise, () => recoveryStorage());
  const read = async () => { reads++; return []; };
  const observer = new QueryObserver(client, transportCreditHistoryOptions(controller.getSnapshot(), factory, read, worker));
  const stop = observer.subscribe(() => {});
  try {
    const inspection = controller.inspect([worker], actor);
    observer.setOptions(transportCreditHistoryOptions(controller.getSnapshot(), factory, read, worker));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reads, 0);
    assert.equal(isTransportCreditHistoryCurrent(controller.getSnapshot(), factory, { status: "success", fetchStatus: "idle", error: null, dataUpdatedAt: 1 }), false);
    verified.resolve(actor); await inspection;
    observer.setOptions(transportCreditHistoryOptions(controller.getSnapshot(), factory, read, worker));
    await observer.refetch(); assert.equal(reads, 1);
    assert.equal(isTransportCreditHistoryCurrent(controller.getSnapshot(), factory, observer.getCurrentResult()), true);
    const recheck = controller.inspect([worker]);
    assert.equal(isTransportCreditHistoryCurrent(controller.getSnapshot(), factory, observer.getCurrentResult()), false);
    observer.setOptions(transportCreditHistoryOptions(controller.getSnapshot(), factory, read, worker));
    assert.equal(observer.options.enabled, false); await recheck;
    assert.equal(transportCreditHistoryOptions(controller.getSnapshot(), "wrong-factory", read, worker).enabled, false);
  } finally { verified.resolve(actor); stop(); controller.stop(); client.clear(); }
});

test("history React consumers use readiness-gated generation keys and hide unverified or invalidated history (source wiring only)", () => {
  const panel = readFileSync(new URL("./components/transport-wage-credit-panel.tsx", import.meta.url), "utf8");
  const drawer = readFileSync(new URL("./components/chamber-transport-account-drawer.tsx", import.meta.url), "utf8");
  const overview = readFileSync(new URL("./components/chamber-transport-workforce-overview.tsx", import.meta.url), "utf8");
  for (const source of [panel, drawer, overview]) {
    assert.match(source, /transportCreditHistoryOptions\(recovery, factoryId, listTransportWageCredits/);
    assert.match(source, /isTransportCreditHistoryCurrent\(recovery, factoryId/);
    assert.match(source, /creditHistoryKey\(recovery.context/);
    assert.doesNotMatch(source, /queryFn: \(\) => listTransportWageCredits/);
  }
  assert.match(drawer, /!creditsCurrent \|\| freshness.data !== "current"/);
  assert.match(overview, /!earningsRange \|\| !credits.data \|\| !creditsCurrent/);
});
