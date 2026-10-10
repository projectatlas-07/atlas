import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createClient as sdkCreateClient, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { createCreditCoordinator, createCreditWorkflow, creditSavedConfirmation, creditStorageKey, readCreditIntent, type CreditIntent } from "../transport-wage-credit-model.ts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { activateTransportCreditContext, bindTransportCreditGate, createTransportCreditGateOwner, creditFreshnessKey, creditHistoryKey, createTransportCreditRecovery, markTransportCreditPending, ownsTransportCreditGate, transportCreditHistoryOptions, isTransportCreditHistoryCurrent, type TransportCreditRecovery } from "../../office/transport-wage-credit-office-model.ts";
const intent: CreditIntent = { actorId: "11111111-1111-4111-8111-111111111111", factoryId: "22222222-2222-4222-8222-222222222222", workerId: "33333333-3333-4333-8333-333333333333", id: "44444444-4444-4444-8444-444444444444", originalWorkDate: "2026-09-21", amount: "12.34", reason: "Missed attendance" };
const row = { id: intent.id, credit_id: intent.id, factory_id: intent.factoryId, transport_worker_id: intent.workerId, original_work_date: intent.originalWorkDate, posting_date: "2026-10-10", amount: 12.34, reason: intent.reason, actor_id: intent.actorId, created_at: "2026-10-10T10:00:00Z", was_replayed: false };
let actor = intent.actorId;
const originalActor = intent.actorId;
const otherActor = "55555555-5555-4555-8555-555555555555";
let switchAfterVerification = false;
let actualSdk = false;
let sharedAuth: Pick<ReturnType<typeof sdkCreateClient>, "auth"> | null = null;
const syntheticCredential = (identity: string) => `test-only-${identity}`;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://atlas-test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only-public-key";
let response: { data: unknown; error: unknown } = { data: [row], error: null };
let readResponse: { data: unknown; error: unknown } = { data: row, error: null };
const calls: unknown[][] = [];
const authListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
function emitAuth(id: string | null, event: AuthChangeEvent = "SIGNED_IN", session?: Session | null) {
  const value = session ?? (id ? { user: { id }, access_token: syntheticCredential(id) } as Session : null);
  authListeners.forEach((listener) => listener(event, value));
}
const fake = {
  auth: {
    onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
      authListeners.add(callback); callback("INITIAL_SESSION", { user: { id: actor }, access_token: syntheticCredential(actor) } as Session);
      return { data: { subscription: { unsubscribe: () => { authListeners.delete(callback); } } } };
    },
    async getSession() { return sharedAuth ? sharedAuth.auth.getSession() : { data: { session: { access_token: syntheticCredential(actor) } }, error: null }; },
    async getUser(token?: string) {
      if (sharedAuth) return sharedAuth.auth.getUser(token);
      const verifiedActor = token?.replace("test-only-", "") ?? actor;
      if (switchAfterVerification) actor = otherActor;
      return { data: { user: { id: verifiedActor } }, error: null };
    },
  },
  async rpc(name: string, args: unknown) { calls.push(["rpc", name, args]); return response; },
  from(name: string) {
    calls.push(["from", name]);
    const builder = {
      select(value: string) { calls.push(["select", value]); return builder; },
      eq(key: string, value: string) { calls.push(["eq", key, value]); return builder; },
      order(key: string, value: unknown) { calls.push(["order", key, value]); return builder; },
      limit(size: number) { calls.push(["limit", size]); return builder; },
      gt(key: string, value: string) { calls.push(["gt", key, value]); return builder; },
      abortSignal(signal: AbortSignal) { assert.ok(signal instanceof AbortSignal); return builder; },
      async maybeSingle() { return readResponse; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(readResponse).then(resolve, reject); },
    };
    return builder;
  },
};
await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fake } });
await mock.module("@supabase/supabase-js", { namedExports: { createClient: (url: string, key: string, options: Parameters<typeof sdkCreateClient>[2]) => {
  if (actualSdk) return sdkCreateClient(url, key, options);
  return fake;
} } });
const service = await import("./transport-wage-credit-service.ts");
function reset() { actor = intent.actorId; emitAuth(actor); switchAfterVerification = false; actualSdk = false; sharedAuth = null; calls.length = 0; response = { data: [row], error: null }; readResponse = { data: row, error: null }; }
test("credit creation sends exact immutable UUID/payload, decimal string, never actor/posting date", async () => {
  reset(); const result = await service.createTransportWageCredit(intent);
  assert.equal(result.id, intent.id); assert.equal(result.amount, "12.34");
  assert.deepEqual(calls, [["rpc", "create_transport_wage_credit", { p_factory_id: intent.factoryId, p_credit_id: intent.id, p_transport_worker_id: intent.workerId, p_original_work_date: intent.originalWorkDate, p_amount: "12.34", p_reason: intent.reason }]]);
});
test("server replay retains original posting date and stored amount", async () => {
  reset(); response.data = [{ ...row, posting_date: "2026-10-09", created_at: "2026-10-09T10:00:00Z", was_replayed: true }];
  const credit = await service.createTransportWageCredit(intent); assert.equal(credit.wasReplayed, true); assert.equal(credit.postingDate, "2026-10-09");
});
test("read-only reconciliation uses ledger ID plus factory/worker filters and no creation RPC", async () => {
  reset(); assert.equal((await service.findTransportWageCredit(intent))?.id, intent.id);
  assert.equal(calls.filter((x) => x[0] === "rpc").length, 0);
  for (const pair of [["factory_id", intent.factoryId], ["transport_worker_id", intent.workerId], ["id", intent.id]]) assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(["eq", ...pair])));
  readResponse.data = null; assert.equal(await service.findTransportWageCredit(intent), null);
});
test("changed authenticated actor blocks both writes and reconciliation before RPC/table access", async () => {
  reset(); actor = "55555555-5555-4555-8555-555555555555"; emitAuth(actor);
  await assert.rejects(service.createTransportWageCredit(intent), /original account/);
  await assert.rejects(service.findTransportWageCredit(intent), /original account/); assert.equal(calls.length, 0);
});
test("missing/malformed returned IDs are UNKNOWN; mismatched stored evidence is a hard conflict", async () => {
  for (const data of [[], [{ ...row, credit_id: "bad" }], [{ ...row, was_replayed: null }]]) {
    reset(); response.data = data; await assert.rejects(service.createTransportWageCredit(intent), (error: unknown) => !!error && typeof error === "object" && "kind" in error && error.kind === "unknown");
  }
  reset(); response.data = [{ ...row, actor_id: "55555555-5555-4555-8555-555555555555" }];
  await assert.rejects(service.createTransportWageCredit(intent), /conflicts/);
});
test("finalization/input/authorization/conflict errors remain distinct without automatic write retries", async () => {
  for (const [code, message, expected] of [
    ["P2631", "ATLAS_TRANSPORT_CREDIT_WEEK_NOT_FINALIZED", /not finalized/],
    ["P2632", "ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT", /conflicts/],
    ["42501", "raw SQL", /original account/], ["22023", "raw SQL", /two decimals/],
  ] as const) {
    reset(); response = { data: null, error: { code, message } };
    await assert.rejects(service.createTransportWageCredit(intent), expected); assert.equal(calls.filter((x) => x[0] === "rpc").length, 1);
  }
});
test("ledger history includes archived/omitted workers without weekly joins, and never creates cash movement", async () => {
  reset(); readResponse.data = [row];
  const credits = await service.listTransportWageCredits({ ...intent, signal: new AbortController().signal, assertActive: () => {} });
  assert.equal(credits.length, 1); assert.equal(credits[0].amount, "12.34");
  assert.ok(calls.some((x) => x[0] === "from" && x[1] === "transport_wage_credits"));
  assert.ok(calls.every((x) => x[0] !== "rpc" && !/cash|withdrawal|weekly|is_active/.test(JSON.stringify(x))));
});
test("timeout reports UNKNOWN while the underlying original write can still complete", async () => {
  let resolve!: (value: number) => void;
  const original = new Promise<number>((r) => { resolve = r; });
  await assert.rejects(service.withCreditTimeout(original, 1), /Outcome not confirmed/);
  resolve(1); assert.equal(await original, 1);
});
test("actual installed SDK dispatch remains bound to A when session switches to same-factory member B", async () => {
  reset(); actualSdk = true; switchAfterVerification = true;
  const oldFetch = globalThis.fetch; const committedActors: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const authorization = new Headers(init?.headers).get("Authorization");
    assert.equal(authorization, `Bearer ${syntheticCredential(originalActor)}`);
    if (String(_input).includes("/auth/v1/user")) {
      actor = otherActor;
      return new Response(JSON.stringify({ id: originalActor }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(actor, otherActor); // Both test identities represent active members of the same factory.
    assert.equal(JSON.parse(String(init?.body)).p_factory_id, intent.factoryId);
    committedActors.push(originalActor);
    return new Response(JSON.stringify([row]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const saved = await service.createTransportWageCredit(intent);
    assert.equal(saved.actorId, originalActor); assert.deepEqual(committedActors, [originalActor]);
    assert.equal(committedActors.includes(otherActor), false);
  } finally { globalThis.fetch = oldFetch; reset(); }
});
test("real SDK missing captured-A session cannot sign out B or discard A's recoverable intent", async () => {
  reset(); actualSdk = true;
  const oldFetch = globalThis.fetch;
  const authData = new Map<string, string>(); const recoveryData = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } });
  let verificationStarted!: () => void; let releaseVerification!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
  const held = new Promise<Response>((resolve) => { releaseVerification = resolve; });
  let holdA = true; let creationCalls = 0; const events: string[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/token")) {
      const identity = JSON.parse(String(init?.body)).email === "a@example.invalid" ? originalActor : otherActor;
      return json({ access_token: syntheticCredential(identity), refresh_token: `test-only-refresh-${identity}`,
        token_type: "bearer", expires_in: 3600, user: { id: identity, aud: "authenticated" } });
    }
    const identity = new Headers(init?.headers).get("Authorization")?.replace("Bearer test-only-", "");
    if (url.includes("/auth/v1/user")) {
      if (identity === originalActor && holdA) { holdA = false; verificationStarted(); return held; }
      return json({ id: identity });
    }
    if (url.includes("/rpc/")) { creationCalls++; return json([row]); }
    assert.equal(identity, originalActor);
    return json(row);
  };
  const client = sdkCreateClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storage: storage(authData), storageKey: "atlas-test-shared-auth", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  sharedAuth = client;
  const subscription = client.auth.onAuthStateChange((event, session) => { events.push(event); emitAuth(session?.user.id ?? null, event, session); });
  try {
    assert.equal((await client.auth.signInWithPassword({ email: "a@example.invalid", password: "test-only-password" })).error, null);
    const coordinator = createCreditCoordinator({ request: async (_name, _options, action) => action() }, true)!;
    const workflow = createCreditWorkflow(intent, storage(recoveryData), {
      create: service.createTransportWageCredit, lookup: service.findTransportWageCredit, refresh: async () => {},
    }, coordinator);
    await workflow.prepare(intent, () => intent.id);
    const pending = workflow.submit(); await started;
    assert.equal((await client.auth.signInWithPassword({ email: "b@example.invalid", password: "test-only-password" })).error, null);
    const bStorage = new Map(authData);
    releaseVerification(json({ code: "session_not_found", error_code: "session_not_found", message: "Session missing" }, 400));
    const result = await pending;
    assert.equal((await client.auth.getSession()).data.session?.user.id, otherActor);
    assert.deepEqual(authData, bStorage); assert.equal(events.includes("SIGNED_OUT"), false);
    assert.equal(result.status, "unknown"); assert.equal(workflow.canCorrect, false);
    assert.deepEqual(readCreditIntent(intent, storage(recoveryData)), intent);
    assert.equal(JSON.parse(recoveryData.get(creditStorageKey(intent))!).recoveryState, "unresolved");
    await assert.rejects(service.createTransportWageCredit(intent), /original account/);
    await assert.rejects(service.findTransportWageCredit(intent), /original account/);
    assert.equal(creationCalls, 0);
    assert.equal((await client.auth.signInWithPassword({ email: "a@example.invalid", password: "test-only-password" })).error, null);
    const recovered = await workflow.reconcile();
    assert.equal(recovered.status, "saved"); if (recovered.status === "saved") assert.equal(recovered.credit.id, intent.id);
    assert.equal(creationCalls, 0); assert.deepEqual(workflow.intent, intent);
  } finally { subscription.data.subscription.unsubscribe(); globalThis.fetch = oldFetch; reset(); }
});
test("maximum stored/replayed numeric amount matches immutable intent exactly; unsafe history never rounds silently", async () => {
  reset(); const maximumIntent = { ...intent, amount: "9999999999.99" };
  response.data = JSON.parse('[{"credit_id":"44444444-4444-4444-8444-444444444444","factory_id":"22222222-2222-4222-8222-222222222222","transport_worker_id":"33333333-3333-4333-8333-333333333333","original_work_date":"2026-09-21","posting_date":"2026-10-10","amount":9999999999.99,"reason":"Missed attendance","actor_id":"11111111-1111-4111-8111-111111111111","created_at":"2026-10-10T10:00:00Z","was_replayed":true}]');
  const replay = await service.createTransportWageCredit(maximumIntent); assert.equal(replay.amount, maximumIntent.amount); assert.equal(replay.wasReplayed, true);
  readResponse.data = [{ ...row, amount: 90071992547409.91 }];
  await assert.rejects(service.listTransportWageCredits({ actorId: intent.actorId, factoryId: intent.factoryId, signal: new AbortController().signal, assertActive: () => {} }), /Outcome not confirmed/);
});
test("Office readiness: delayed missing A session cannot sign out B, and B needs its own completed inspection", async () => {
  reset(); actualSdk = true;
  const oldFetch = globalThis.fetch; const authData = new Map<string, string>(); const events: string[] = [];
  let startA!: () => void; let releaseA!: (value: Response) => void; let startB!: () => void; let releaseB!: (value: Response) => void;
  const aStarted = new Promise<void>((resolve) => { startA = resolve; });
  const bStarted = new Promise<void>((resolve) => { startB = resolve; });
  const aRead = new Promise<Response>((resolve) => { releaseA = resolve; });
  const bRead = new Promise<Response>((resolve) => { releaseB = resolve; });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/auth/v1/token")) {
      const id = JSON.parse(String(init?.body)).email === "a@example.invalid" ? originalActor : otherActor;
      return json({ access_token: syntheticCredential(id), refresh_token: `test-only-refresh-${id}`, token_type: "bearer", expires_in: 3600, user: { id, aud: "authenticated" } });
    }
    assert.ok(String(input).includes("/auth/v1/user"));
    const id = new Headers(init?.headers).get("Authorization")?.replace("Bearer test-only-", "");
    if (id === originalActor) { startA(); return aRead; }
    assert.equal(id, otherActor); startB(); return bRead;
  };
  const auth = sdkCreateClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storage: { getItem: (key) => authData.get(key) ?? null, setItem: (key, value) => { authData.set(key, value); }, removeItem: (key) => { authData.delete(key); } },
      storageKey: "atlas-test-office-auth", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  sharedAuth = auth;
  const queryClient = new QueryClient();
  const rows = new Map<string, string>();
  const controller = createTransportCreditRecovery(queryClient, intent.factoryId, service.verifyTransportCreditActor,
    () => ({ getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: (key) => { rows.delete(key); } }));
  const subscription = auth.auth.onAuthStateChange((event, session) => { events.push(event); emitAuth(session?.user.id ?? null, event, session); });
  try {
    await auth.auth.signInWithPassword({ email: "a@example.invalid", password: "test-only-password" });
    const a = controller.inspect([intent.workerId], originalActor); await aStarted;
    await auth.auth.signInWithPassword({ email: "b@example.invalid", password: "test-only-password" });
    const bStorage = new Map(authData);
    const b = controller.inspect([intent.workerId], otherActor); await bStarted;
    releaseA(json({ code: "session_not_found", error_code: "session_not_found", message: "Session missing" }, 400)); await a;
    assert.deepEqual(authData, bStorage); assert.equal(events.includes("SIGNED_OUT"), false);
    assert.equal(controller.getSnapshot().ready, false);
    releaseB(json({ id: otherActor })); await b;
    assert.equal(controller.getSnapshot().actorId, otherActor); assert.equal(controller.getSnapshot().ready, true);
    assert.equal((await auth.auth.getSession()).data.session?.user.id, otherActor);
  } finally { releaseA(json({}, 400)); releaseB(json({ id: otherActor })); controller.stop(); subscription.data.subscription.unsubscribe(); queryClient.clear(); globalThis.fetch = oldFetch; reset(); }
});

for (const boundary of ["delayed verification", "SDK HTTP retry"] as const) test(`obsolete ledger reconciliation cannot dispatch after ${boundary}; B's pending gate and session survive`, async () => {
  reset(); actualSdk = true;
  const oldFetch = globalThis.fetch; const authData = new Map<string, string>(); const recoveryData = new Map<string, string>();
  const storage = (data: Map<string, string>) => ({ getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } });
  const queryClient = new QueryClient();
  let started!: () => void; let release!: (value: Response) => void;
  const verificationStarted = new Promise<void>((resolve) => { started = resolve; });
  const verification = new Promise<Response>((resolve) => { release = resolve; });
  let ledgerReads = 0; let obsoleteLedgerReads = 0; let switched = false; let creations = 0; let generated = 0; let successfulAVerifications = 0;
  const events: string[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/token")) {
      const id = JSON.parse(String(init?.body)).email === "a@example.invalid" ? originalActor : otherActor;
      return json({ access_token: syntheticCredential(id), refresh_token: `test-only-refresh-${id}`, token_type: "bearer", expires_in: 3600, user: { id, aud: "authenticated" } });
    }
    if (url.includes("/auth/v1/user")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${syntheticCredential(originalActor)}`);
      if (boundary === "SDK HTTP retry") { successfulAVerifications++; return json({ id: originalActor }); }
      started(); const response = await verification; successfulAVerifications++; return response;
    }
    if (url.includes("/rest/v1/transport_wage_credits")) {
      ledgerReads++; assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${syntheticCredential(originalActor)}`);
      if (switched) obsoleteLedgerReads++;
      if (boundary === "SDK HTTP retry" && ledgerReads === 1) { started(); return verification; }
      return json(row);
    }
    assert.ok(url.includes("/rpc/")); creations++; return json([row]);
  };
  const auth = sdkCreateClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storage: storage(authData), storageKey: "atlas-test-obsolete-lookup", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  sharedAuth = auth;
  const subscription = auth.auth.onAuthStateChange((event, session) => { events.push(event); emitAuth(session?.user.id ?? null, event, session); });
  const coordinator = createCreditCoordinator({ request: async (_name, _options, action) => action() }, true)!;
  try {
    await auth.auth.signInWithPassword({ email: "a@example.invalid", password: "test-only-password" });
    const ownerA = createTransportCreditGateOwner(activateTransportCreditContext(queryClient, intent.factoryId, originalActor), intent.workerId);
    const callbacksA = bindTransportCreditGate(ownerA, {
      create: service.createTransportWageCredit,
      lookup: (value) => service.findTransportWageCredit(value, callbacksA.assertActive),
    });
    const a = createCreditWorkflow(intent, storage(recoveryData), callbacksA, coordinator);
    await a.prepare(intent, () => { generated++; return intent.id; });
    markTransportCreditPending(ownerA, intent.id);
    const pendingA = a.reconcile(); await verificationStarted;
    await auth.auth.signInWithPassword({ email: "b@example.invalid", password: "test-only-password" });
    const contextB = activateTransportCreditContext(queryClient, intent.factoryId, otherActor);
    switched = true;
    const ownerB = createTransportCreditGateOwner(contextB, intent.workerId);
    const scopeB = { actorId: otherActor, factoryId: intent.factoryId, workerId: intent.workerId };
    const b = createCreditWorkflow(scopeB, storage(recoveryData), bindTransportCreditGate(ownerB, {
      create: service.createTransportWageCredit, lookup: service.findTransportWageCredit,
    }), coordinator);
    const intentB = await b.prepare({ ...intent, amount: "22.00", reason: "Unresolved B" }, () => { generated++; return "66666666-6666-4666-8666-666666666666"; });
    markTransportCreditPending(ownerB, intentB.id);
    const balanceKey = ["office-transport-worker-balance", intent.factoryId, intent.workerId, "2026-10-10"];
    queryClient.setQueryData(balanceKey, 0);
    const beforeCache = queryClient.getQueryCache().getAll().map((query) => [query.queryHash, query.state]);
    const beforeRecovery = new Map(recoveryData); const beforeAuth = new Map(authData);
    release(boundary === "delayed verification" ? json({ id: originalActor })
      : new Response(JSON.stringify({ message: "Temporary test-only failure" }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "0" } }));
    const result = await pendingA;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(successfulAVerifications, 1);
    assert.equal(obsoleteLedgerReads, 0, "obsolete A must not dispatch a ledger SELECT after ownership loss");
    assert.equal(ledgerReads, boundary === "delayed verification" ? 0 : 1);
    assert.equal(creations, 0); assert.equal(generated, 2);
    assert.equal(result.status, "unknown"); assert.equal(a.canCorrect, false);
    assert.equal(creditSavedConfirmation(result, scopeB, intentB.id), null); assert.equal(b.outcome, null);
    assert.equal(ownsTransportCreditGate(ownerA), false); assert.equal(ownsTransportCreditGate(ownerB), true);
    assert.equal(ownerB.context, contextB); assert.equal(ownerB.actorId, otherActor); assert.equal(ownerB.workerId, intent.workerId);
    assert.equal(queryClient.getQueryData(creditFreshnessKey(intent.factoryId, intent.workerId)), "pending");
    assert.deepEqual(queryClient.getQueryCache().getAll().map((query) => [query.queryHash, query.state]), beforeCache);
    assert.deepEqual(recoveryData, beforeRecovery); assert.deepEqual(readCreditIntent(scopeB, storage(recoveryData)), intentB);
    assert.deepEqual(a.intent, intent); assert.deepEqual(readCreditIntent(intent, storage(recoveryData)), intent);
    assert.equal(JSON.parse(recoveryData.get(creditStorageKey(intent))!).recoveryState, "unresolved");
    assert.deepEqual(authData, beforeAuth); assert.equal(events.includes("SIGNED_OUT"), false);
    assert.equal((await auth.auth.getSession()).data.session?.user.id, otherActor);
  } finally { release(json({ id: originalActor })); subscription.data.subscription.unsubscribe(); queryClient.clear(); globalThis.fetch = oldFetch; reset(); }
});

const historyRecovery = (client: QueryClient, actorId: string): TransportCreditRecovery => ({
  factoryId: intent.factoryId, actorId, ready: true, revision: 1, intentIds: {},
  context: activateTransportCreditContext(client, intent.factoryId, actorId),
});
for (const boundary of ["response", "pagination", "HTTP retry", "verification"] as const) test(`production history observers isolate A from B across delayed ${boundary} and preserve B's unresolved gate`, async () => {
  reset(); actualSdk = true;
  const oldFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let release!: (value: Response) => void; let entered!: () => void;
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Retry-After": "0" } });
  let aReads = 0; let bReads = 0; let obsoleteReads = 0; let writes = 0; let switched = false; let holdVerification = false;
  const dispatches: Array<{ actorId: string; factoryId: string | null; workerId: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const credential = new Headers(init?.headers).get("Authorization");
    const identity = credential === `Bearer ${syntheticCredential(originalActor)}` ? originalActor : otherActor;
    assert.equal(credential, `Bearer ${syntheticCredential(identity)}`);
    if (url.pathname.endsWith("/user")) {
      if (holdVerification && identity === originalActor) { entered(); return held; }
      return json({ id: identity });
    }
    if (url.pathname.includes("/rpc/")) { writes++; return json([row]); }
    assert.ok(url.pathname.endsWith("/transport_wage_credits"));
    dispatches.push({ actorId: identity, factoryId: url.searchParams.get("factory_id"), workerId: url.searchParams.get("transport_worker_id") });
    if (identity === originalActor) {
      aReads++; if (switched) obsoleteReads++;
      if (aReads === 2) { entered(); return held; }
      return json([{ ...row, reason: "A cached history" }]);
    }
    bReads++; return json([{ ...row, actor_id: otherActor, amount: "22.00", reason: "B fresh history" }]);
  };
  const a = historyRecovery(client, originalActor);
  const optionsA = transportCreditHistoryOptions(a, intent.factoryId, service.listTransportWageCredits, intent.workerId);
  let stopA = () => {}; let stopB = () => {};
  try {
    const cached = await client.fetchQuery(optionsA); assert.equal(cached[0].reason, "A cached history");
    const observerA = new QueryObserver(client, { ...optionsA, staleTime: Infinity }); stopA = observerA.subscribe(() => {});
    holdVerification = boundary === "verification";
    const pendingA = observerA.refetch(); await started;
    actor = otherActor; emitAuth(actor); switched = true;
    const b = historyRecovery(client, otherActor);
    const ownerB = createTransportCreditGateOwner(b.context, intent.workerId);
    const storageData = new Map<string, string>();
    const storage = { getItem: (key: string) => storageData.get(key) ?? null, setItem: (key: string, value: string) => { storageData.set(key, value); }, removeItem: (key: string) => { storageData.delete(key); } };
    let generated = 0;
    const workflowB = createCreditWorkflow({ ...intent, actorId: otherActor }, storage, bindTransportCreditGate(ownerB, {
      create: service.createTransportWageCredit, lookup: service.findTransportWageCredit,
    }), createCreditCoordinator({ request: async (_name, _options, action) => action() }, true)!);
    const pendingB = await workflowB.prepare({ ...intent, reason: "B pending credit" }, () => { generated++; return "66666666-6666-4666-8666-666666666666"; });
    markTransportCreditPending(ownerB, pendingB.id);
    const beforeStorage = new Map(storageData);
    const optionsB = transportCreditHistoryOptions(b, intent.factoryId, service.listTransportWageCredits, intent.workerId);
    const observerB = new QueryObserver(client, optionsB);
    // This observes the actual QueryClient cache before mounting/fetching B.
    assert.equal(observerB.getCurrentResult().data, undefined, "B must not inherit A's cached financial history");
    assert.notDeepEqual(optionsA.queryKey, optionsB.queryKey);
    stopB = observerB.subscribe(() => {}); await observerB.refetch();
    assert.equal(observerB.getCurrentResult().data?.[0].reason, "B fresh history");
    release(boundary === "verification" ? json({ id: originalActor }) : boundary === "HTTP retry" ? json({}, 503)
      : boundary === "pagination" ? json(Array.from({ length: 500 }, (_, index) => ({ ...row, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` })))
        : json([{ ...row, reason: "A obsolete response" }]));
    await pendingA;
    assert.equal(obsoleteReads, 0); assert.equal(aReads, boundary === "verification" ? 1 : 2); assert.equal(bReads, 1);
    assert.equal(observerB.getCurrentResult().data?.[0].actorId, otherActor);
    assert.equal(isTransportCreditHistoryCurrent(b, intent.factoryId, observerB.getCurrentResult()), true);
    assert.equal(isTransportCreditHistoryCurrent(a, intent.factoryId, observerA.getCurrentResult()), false);
    assert.deepEqual(storageData, beforeStorage); assert.deepEqual(readCreditIntent({ ...intent, actorId: otherActor }, storage), pendingB);
    assert.equal(client.getQueryData(creditFreshnessKey(intent.factoryId, intent.workerId)), "pending", "history cannot reopen withdrawals");
    assert.equal(workflowB.outcome, null); assert.equal(creditSavedConfirmation(workflowB.outcome, { ...intent, actorId: otherActor }, pendingB.id), null);
    assert.equal(generated, 1); assert.equal(writes, 0); assert.equal(actor, otherActor);
    assert.ok(dispatches.every((read) => read.factoryId === `eq.${intent.factoryId}` && read.workerId === `eq.${intent.workerId}`));
  } finally { release(json([{ ...row }])); stopA(); stopB(); client.clear(); globalThis.fetch = oldFetch; reset(); }
});

test("A1 history cannot become A2 current data after A-B-A; A2 requires a fresh captured-actor read", async () => {
  reset(); actualSdk = true; const oldFetch = globalThis.fetch;
  const client = new QueryClient(); const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  let release!: (value: Response) => void; let entered!: () => void; let reads = 0; let writes = 0;
  const held = new Promise<Response>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${syntheticCredential(originalActor)}`);
    if (String(input).includes("/user")) return json({ id: originalActor });
    if (String(input).includes("/rpc/")) writes++;
    if (++reads === 1) { entered(); return held; }
    return json([{ ...row, reason: "A2 freshly read" }]);
  };
  let stopA1 = () => {}; let stopA2 = () => {};
  try {
    const a1 = historyRecovery(client, originalActor); const optionsA1 = transportCreditHistoryOptions(a1, intent.factoryId, service.listTransportWageCredits, intent.workerId);
    const observerA1 = new QueryObserver(client, optionsA1); stopA1 = observerA1.subscribe(() => {}); await started;
    actor = otherActor; emitAuth(actor); historyRecovery(client, otherActor);
    actor = originalActor; emitAuth(actor); const a2 = historyRecovery(client, originalActor);
    const optionsA2 = transportCreditHistoryOptions(a2, intent.factoryId, service.listTransportWageCredits, intent.workerId);
    assert.notDeepEqual(optionsA1.queryKey, optionsA2.queryKey);
    const observerA2 = new QueryObserver(client, optionsA2); assert.equal(observerA2.getCurrentResult().data, undefined);
    stopA2 = observerA2.subscribe(() => {}); await observerA2.refetch();
    release(json([{ ...row, reason: "A1 obsolete" }])); await observerA1.refetch({ cancelRefetch: false });
    assert.equal(reads, 2); assert.equal(writes, 0);
    assert.equal(observerA2.getCurrentResult().data?.[0].reason, "A2 freshly read");
    assert.equal(isTransportCreditHistoryCurrent(a2, intent.factoryId, observerA2.getCurrentResult()), true);
    assert.equal(isTransportCreditHistoryCurrent(a1, intent.factoryId, observerA1.getCurrentResult()), false);
  } finally { release(json([])); stopA1(); stopA2(); client.clear(); globalThis.fetch = oldFetch; reset(); }
});

test("production worker/overview history observers are independent, actor scoped, and last-observer cancellation stops old pagination", async () => {
  reset(); actualSdk = true; const oldFetch = globalThis.fetch; const client = new QueryClient();
  const secondWorker = "77777777-7777-4777-8777-777777777777";
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  let hold = false; let entered!: () => void; let release!: (value: Response) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; }); const held = new Promise<Response>((resolve) => { release = resolve; });
  const reads: Array<{ identity: string; worker: string | null }> = []; let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const identity = new Headers(init?.headers).get("Authorization") === `Bearer ${syntheticCredential(originalActor)}` ? originalActor : otherActor;
    if (url.pathname.endsWith("/user")) return json({ id: identity });
    if (url.pathname.includes("/rpc/")) writes++;
    const workerFilter = url.searchParams.get("transport_worker_id");
    reads.push({ identity, worker: workerFilter });
    assert.equal(url.searchParams.get("factory_id"), `eq.${intent.factoryId}`);
    if (hold && workerFilter === `eq.${intent.workerId}`) { entered(); return held; }
    return json([{ ...row, actor_id: identity, transport_worker_id: workerFilter?.slice(3) ?? intent.workerId }]);
  };
  const stops: Array<() => void> = [];
  try {
    const a = historyRecovery(client, originalActor);
    const workerOptions = transportCreditHistoryOptions(a, intent.factoryId, service.listTransportWageCredits, intent.workerId);
    const secondOptions = transportCreditHistoryOptions(a, intent.factoryId, service.listTransportWageCredits, secondWorker);
    const overviewOptions = transportCreditHistoryOptions(a, intent.factoryId, service.listTransportWageCredits);
    const observer = new QueryObserver(client, workerOptions); const stop = observer.subscribe(() => {}); stops.push(stop); await observer.refetch();
    for (const options of [secondOptions, overviewOptions]) {
      const other = new QueryObserver(client, options); stops.push(other.subscribe(() => {})); await other.refetch();
      assert.equal(isTransportCreditHistoryCurrent(a, intent.factoryId, other.getCurrentResult()), true);
    }
    assert.equal(reads.length, 3); assert.equal(new Set([workerOptions, secondOptions, overviewOptions].map((options) => JSON.stringify(options.queryKey))).size, 3);
    assert.deepEqual(overviewOptions.queryKey, creditHistoryKey(a.context));
    hold = true; const pending = observer.refetch(); await started; stop();
    release(json(Array.from({ length: 500 }, (_, index) => ({ ...row, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` })))); await pending;
    await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(reads.length, 4, "unmounted last observer cannot dispatch another page");
    actor = otherActor; emitAuth(actor); const b = historyRecovery(client, otherActor);
    const bOverviewOptions = transportCreditHistoryOptions(b, intent.factoryId, service.listTransportWageCredits);
    const bOverview = new QueryObserver(client, bOverviewOptions); assert.equal(bOverview.getCurrentResult().data, undefined);
    assert.notDeepEqual(bOverviewOptions.queryKey, overviewOptions.queryKey);
    stops.push(bOverview.subscribe(() => {})); await bOverview.refetch();
    assert.equal(bOverview.getCurrentResult().data?.[0].actorId, otherActor); assert.equal(writes, 0);
    assert.equal(reads.at(-1)?.worker, null); assert.equal(reads.at(-1)?.identity, otherActor);
  } finally { release(json([])); stops.forEach((stop) => stop()); client.clear(); globalThis.fetch = oldFetch; reset(); }
});
