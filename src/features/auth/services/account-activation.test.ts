import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createClient, type Session, type User, type AuthChangeEvent } from "@supabase/supabase-js";
import { createAccountCoordinator, transportAccountAdapter, verifyCapturedAccount, capturedAccountClient,
  AccountSupersededError, type AccountCapture } from "./account-activation.ts";
import { resolveCapturedFactoryAccess, assertFactoryResultCurrent } from "./captured-factory-access-service.ts";
import { createAuthStorageBoundary } from "../../../lib/supabase/auth-storage.ts";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002";
const factory = "00000000-0000-4000-8000-000000000003";
const url = "https://auth.example.invalid", key = "synthetic-public-key";
const expires = Math.floor(Date.now() / 1000) + 3600;
function session(actor = A, sessionId = actor, revision = 0, overrides: Record<string, unknown> = {}): Session {
  const claims = { sub: actor, session_id: sessionId, exp: expires, iat: expires - 3600, iss: `${url}/auth/v1`, aud: "authenticated", revision, ...overrides };
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url"), Buffer.alloc(32).toString("base64url")].join(".");
  return { access_token: token, refresh_token: `synthetic-refresh-${actor}-${revision}`, expires_at: expires,
    expires_in: 3600, token_type: "bearer", user: user(actor) };
}
function user(id = A): User { return { id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });
type Lifetime = { after: (callback: () => void) => void };
let sequence = 0;
async function harness(t: Lifetime) {
  let clock = Date.now(), unreadable = false;
  const storage = new Map<string, string>(), storageKey = `synthetic-activation-${++sequence}`;
  const requests: { path: string; authorization: string | null }[] = [];
  const hooks: { user?: () => Promise<Response>; rpc?: () => Promise<Response> } = {};
  const send: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const authorization = new Headers(init?.headers).get("Authorization"); requests.push({ path, authorization });
    if (path.endsWith("/user")) return hooks.user ? hooks.user() : json(user(authorization === `Bearer ${session(B).access_token}` ? B : A));
    return hooks.rpc ? hooks.rpc() : json([{ status: "active", factory_id: factory }]);
  };
  const shared = createClient(url, key, { auth: { storageKey, storage: {
    getItem: (name) => storage.get(name) ?? null, setItem: (name, value) => { storage.set(name, value); }, removeItem: (name) => { storage.delete(name); },
  }, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: send } });
  const coordinator = createAccountCoordinator(shared.auth, { readSession: () => {
    if (unreadable) throw new Error("Synthetic unavailable storage"); return storage.get(storageKey) ?? null;
  } }, () => clock);
  const events: string[] = []; const subscription = shared.auth.onAuthStateChange((event) => { events.push(event); });
  await shared.auth.getSession();
  const activate = async (value: Session) => { assert.equal((await shared.auth.setSession(value)).error, null); };
  const capture = () => { const value = coordinator.capture(); assert.ok(value); return value; };
  t.after(() => { coordinator.stop(); subscription.data.subscription.unsubscribe(); shared.auth.dispose(); });
  return { shared, coordinator, activate, capture, requests, hooks, storage, storageKey, events, now: () => clock, advance: (ms: number) => { clock += ms; }, setUnreadable: (value: boolean) => { unreadable = value; }, connection: { url, key, fetch: send } };
}
function eventHarness(t: Lifetime, now = () => Date.now(), make = createAccountCoordinator) {
  let callback!: (event: AuthChangeEvent, value: Session | null) => void;
  let stored: string | null | undefined = null;
  const coordinator = make({ onAuthStateChange(listener) {
    callback = listener; return { data: { subscription: { unsubscribe() {} } } } as ReturnType<ReturnType<typeof createClient>["auth"]["onAuthStateChange"]>;
  } }, { readSession: () => stored }, now);
  const adapter = transportAccountAdapter(coordinator);
  t.after(coordinator.stop);
  const emit = (event: AuthChangeEvent, value: Session | null, updateStorage = true) => {
    if (updateStorage) stored = value ? JSON.stringify(value) : null;
    callback(event, value);
  };
  return { coordinator, adapter, emit, setStorage(value: typeof stored) { stored = value; } };
}
test("A/P: actual SDK verifies and resolves with the exact captured token; public handles contain no credentials", async (t) => {
  const h = await harness(t); await h.activate(session()); h.requests.length = 0;
  const capture = h.capture(); const result = await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection);
  assert.deepEqual(result, { kind: "authorized", actorId: A, activation: capture.activation, factoryId: factory });
  assert.deepEqual(h.requests.map((request) => request.authorization), [`Bearer ${session().access_token}`, `Bearer ${session().access_token}`]);
  assert.equal(h.coordinator.getSnapshot().status, "verified"); assertFactoryResultCurrent(h.coordinator, result);
  assert.equal(Object.isFrozen(capture), true); assert.equal(Object.isFrozen(capture.activation), true);
  assert.equal(Object.isFrozen(h.coordinator.getSnapshot()), true);
  assert.deepEqual(Object.keys(capture).sort(), ["activation", "credentialRevision"]);
  assert.doesNotMatch(JSON.stringify(h.coordinator.getSnapshot()), /access_token|refresh_token/);
});

function supportedStorageHarness(t: Lifetime, make = createAccountCoordinator) {
  let clock = Date.now(), unreadable = false;
  let callback!: (event: AuthChangeEvent, value: Session | null) => void;
  const boundary = createAuthStorageBoundary(`synthetic-supported-${++sequence}`);
  const read = boundary.readSession;
  boundary.readSession = () => { if (unreadable) throw new Error("Synthetic unavailable storage"); return read(); };
  const coordinator = make({ onAuthStateChange(listener) {
    callback = listener; return { data: { subscription: { unsubscribe() {} } } } as ReturnType<ReturnType<typeof createClient>["auth"]["onAuthStateChange"]>;
  } }, boundary, () => clock);
  t.after(coordinator.stop);
  const emit = (event: AuthChangeEvent, value: Session | null) => {
    if (value) boundary.storage.setItem(boundary.key, JSON.stringify(value)); else boundary.storage.removeItem(boundary.key);
    callback(event, value);
  };
  return { coordinator, boundary, emit, advance(ms: number) { clock += ms; }, setUnreadable(value: boolean) { unreadable = value; } };
}
test("F3B.1 fail-first: malformed readable JSON permanently retires A1 even after exact restoration and retry", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const original = h.coordinator.capture()!;
  h.boundary.storage.setItem(h.boundary.key, "{");
  assert.equal(h.coordinator.isActivationCurrent(original.activation), false);
  assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  h.boundary.storage.setItem(h.boundary.key, JSON.stringify(session())); h.advance(30_000);
  assert.equal(h.coordinator.retryVerification(), null, "retired A1 must not be reused");
  let sends = 0;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, original, { url, key, fetch: async () => { sends++; return json(user()); } }), { kind: "superseded" });
  assert.equal(sends, 0);
  assert.throws(() => assertFactoryResultCurrent(h.coordinator, { kind: "authorized", actorId: A, activation: original.activation, factoryId: factory }), AccountSupersededError);
});
test("F3B.1 fail-first: actual SDK rate limit is recoverable verification, not invalid authentication", async (t) => {
  const h = await harness(t); await h.activate(session()); const original = h.capture();
  h.hooks.user = async () => json({ code: "over_request_rate_limit", message: "Synthetic limit" }, 429);
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, original, h.connection), { kind: "request_error" });
  assert.equal(h.events.includes("SIGNED_OUT"), false);
  h.advance(30_000); const retry = h.coordinator.retryVerification(); assert.equal(retry, original);
  h.hooks.user = undefined;
  assert.equal((await resolveCapturedFactoryAccess(h.coordinator, retry!, h.connection)).kind, "authorized");
});
test("A: delayed isolated A session_not_found cannot remove B or emit shared SIGNED_OUT", async (t) => {
  const h = await harness(t); await h.activate(session()); const capture = h.capture();
  const entered = deferred<void>(), release = deferred<Response>();
  h.hooks.user = () => { entered.resolve(); return release.promise; };
  const pending = resolveCapturedFactoryAccess(h.coordinator, capture, h.connection); await entered.promise;
  h.hooks.user = undefined; await h.activate(session(B)); const before = h.storage.get(h.storageKey); const index = h.events.length;
  release.resolve(json({ code: "session_not_found", message: "Synthetic missing session" }, 400));
  assert.deepEqual(await pending, { kind: "superseded" });
  assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false);
  assert.equal((await h.shared.auth.getSession()).data.session?.user.id, B);
  assert.equal(h.requests.filter((request) => request.path.includes("/rpc/")).length, 0);
});
test("B: account replacement during verification dispatches no membership request and never substitutes B", async (t) => {
  const h = await harness(t); await h.activate(session()); const entered = deferred<void>(), release = deferred<Response>();
  h.hooks.user = () => { entered.resolve(); return release.promise; };
  h.requests.length = 0; const pending = resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection); await entered.promise;
  h.hooks.user = undefined; await h.activate(session(B)); release.resolve(json(user()));
  assert.deepEqual(await pending, { kind: "superseded" });
  assert.equal(h.requests.filter((request) => request.path.includes("/rpc/")).length, 0);
  assert.equal(h.requests[0].authorization, `Bearer ${session().access_token}`);
});
for (const restore of [false, true]) test(`C/D/J: delayed same-factory A result cannot publish under ${restore ? "restored A2" : "B"}`, async (t) => {
  const h = await harness(t); await h.activate(session()); const original = h.capture();
  const entered = deferred<void>(), release = deferred<Response>(); h.hooks.rpc = () => { entered.resolve(); return release.promise; };
  const pending = resolveCapturedFactoryAccess(h.coordinator, original, h.connection); await entered.promise;
  await h.activate(session(B)); if (restore) await h.activate(session());
  release.resolve(json([{ status: "active", factory_id: factory }])); assert.deepEqual(await pending, { kind: "superseded" });
  assert.equal(h.coordinator.isActivationCurrent(original.activation), false);
  assert.throws(() => assertFactoryResultCurrent(h.coordinator, { kind: "authorized", actorId: A, activation: original.activation, factoryId: factory }), AccountSupersededError);
});
test("E/F/G and adapter parity: event sequence retains activation but retires obsolete credential dispatch authority", async (t) => {
  const h = eventHarness(t); h.emit("INITIAL_SESSION", session()); let captured = h.coordinator.capture()!;
  const activation = captured.activation;
  const assertParity = (handle: AccountCapture, expected: boolean) => {
    let current = true; try { h.coordinator.assertCredentialCurrent(handle); } catch { current = false; }
    assert.equal(current, expected); assert.equal(h.adapter.isCurrent(handle), expected);
  };
  assertParity(captured, true); h.emit("SIGNED_IN", session()); assert.equal(h.coordinator.capture(), captured); assertParity(captured, true);
  h.emit("TOKEN_REFRESHED", session(A, A, 1)); assert.equal(h.coordinator.capture()?.activation, activation); assertParity(captured, false);
  captured = h.coordinator.capture()!; h.emit("USER_UPDATED", session(A, A, 2)); assert.equal(h.coordinator.capture()?.activation, activation); assertParity(captured, false);
  captured = h.coordinator.capture()!; h.emit("SIGNED_IN", session(B)); assertParity(captured, false);
  h.emit("SIGNED_IN", session()); assert.notEqual(h.coordinator.capture()?.activation.generation, activation.generation); assertParity(captured, false);
  captured = h.coordinator.capture()!; h.emit("SIGNED_OUT", null); assertParity(captured, false); assert.equal(h.coordinator.getSnapshot().status, "signed_out");
  h.emit("SIGNED_IN", session()); captured = h.coordinator.capture()!;
  h.emit("INITIAL_SESSION", session(B), false); assert.equal(h.coordinator.capture(), captured); assertParity(captured, true);
  assert.throws(() => h.coordinator.assertCredentialCurrent({ ...captured } as AccountCapture), AccountSupersededError);
});
test("F: actual SDK refresh preserves session activation and invalidates the old revision", async (t) => {
  const h = await harness(t); await h.activate(session()); const previous = h.capture();
  h.hooks.rpc = async () => json(session(A, A, 1)); // Controlled /token response uses the generic non-user hook.
  assert.equal((await h.shared.auth.refreshSession()).error, null);
  const refreshed = h.capture(); assert.equal(refreshed.activation, previous.activation);
  assert.ok(refreshed.credentialRevision > previous.credentialRevision);
  assert.throws(() => h.coordinator.assertCredentialCurrent(previous), AccountSupersededError);
});
test("H: visible cross-tab storage replacement blocks dispatch before any Auth event", async (t) => {
  const h = await harness(t); await h.activate(session()); const capture = h.capture(); const count = h.requests.length;
  h.storage.set(h.storageKey, JSON.stringify(session(B)));
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection), { kind: "superseded" });
  assert.equal(h.requests.length, count); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  h.storage.set(h.storageKey, JSON.stringify(session()));
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(h.coordinator.isActivationCurrent(capture.activation), false);
});
test("storage fence cannot prove cross-tab atomicity before another tab's replacement is observable", async (t) => {
  const h = await harness(t); await h.activate(session()); const capture = h.capture();
  // B's not-yet-visible installation is deliberately outside this session's observation.
  const result = await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection);
  assert.equal(result.kind, "authorized");
  h.storage.set(h.storageKey, JSON.stringify(session(B)));
  assert.throws(() => assertFactoryResultCurrent(h.coordinator, result), AccountSupersededError);
});
test("I: each missing/malformed required claim fails closed without accepting a credential", (t) => {
  const h = eventHarness(t);
  for (const overrides of [{ session_id: undefined }, { session_id: "bad" }, { sub: B }, { exp: "later" }, { iat: null }, { iss: null }, { aud: "anon" }]) {
    h.emit("SIGNED_IN", session(A, A, 0, overrides)); assert.equal(h.coordinator.capture(), null);
    assert.equal(h.coordinator.getSnapshot().status, "uncertain"); assert.equal(h.coordinator.retryVerification(), null);
  }
});
for (const status of ["none", "inactive"]) test(`K/L: verified ${status} remains distinct from authentication failure`, async (t) => {
  const h = await harness(t); await h.activate(session()); h.hooks.rpc = async () => json([{ status, factory_id: null }]);
  const capture = h.capture(); assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection), {
    kind: status === "none" ? "no_factory" : "inactive", actorId: A, activation: capture.activation,
  });
});
test("M: invalid captured session is authentication_failed, never no_factory or automatic logout", async (t) => {
  const h = await harness(t); await h.activate(session()); h.hooks.user = async () => json({ code: "session_not_found", message: "Synthetic unavailable" }, 400);
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection), { kind: "authentication_failed" });
  assert.equal(h.events.includes("SIGNED_OUT"), false); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(h.requests.some((request) => request.path.includes("/rpc/")), false);
});
test("server-verified user must match captured actor; structural claims alone cannot promote verification", async (t) => {
  const h = await harness(t); await h.activate(session()); const capture = h.capture();
  assert.equal("markVerified" in h.coordinator, false); h.hooks.user = async () => json(user(B));
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection), { kind: "authentication_failed" });
  assert.equal(h.requests.some((request) => request.path.includes("/rpc/")), false);
});
test("same-session storage token replacement invalidates captures permanently but preserves activation continuity", (t) => {
  const h = eventHarness(t); h.emit("SIGNED_IN", session()); const old = h.coordinator.capture()!;
  h.setStorage(JSON.stringify(session(A, A, 1))); assert.equal(h.adapter.isCurrent(old), false);
  h.emit("TOKEN_REFRESHED", session(A, A, 1)); const next = h.coordinator.capture()!;
  assert.equal(next.activation, old.activation); assert.ok(next.credentialRevision > old.credentialRevision);
  h.emit("TOKEN_REFRESHED", session()); assert.equal(h.adapter.isCurrent(old), false);
});
test("transient states grant no verification; explicit bounded retry recovers network uncertainty without a new activation", async (t) => {
  const h = await harness(t); assert.equal(h.coordinator.getSnapshot().status, "signed_out");
  await h.activate(session()); const capture = h.capture(); assert.equal(h.coordinator.getSnapshot().status, "pending_verification");
  h.hooks.user = async () => json({ message: "Synthetic outage" }, 503);
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection), { kind: "request_error" });
  assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.isActivationCurrent(capture.activation), false);
  const count = h.requests.length; await Promise.resolve(); assert.equal(h.requests.length, count);
  h.advance(5_000); const retry = h.coordinator.retryVerification(); assert.equal(retry, capture);
  h.hooks.user = undefined; assert.equal((await resolveCapturedFactoryAccess(h.coordinator, retry!, h.connection)).kind, "authorized");
  assert.equal(h.capture().activation, capture.activation);
});
test("initializing and unreadable storage never mean signed_out or membership absence", (t) => {
  let clock = Date.now(); const h = eventHarness(t, () => clock); assert.equal(h.coordinator.getSnapshot().status, "initializing"); assert.equal(h.coordinator.capture(), null);
  h.emit("INITIAL_SESSION", session()); h.setStorage(undefined);
  assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  h.setStorage(JSON.stringify(session())); clock += 5_000; assert.ok(h.coordinator.retryVerification());
});
for (const response of [[], [null], [{}], [{ status: "active", factory_id: "bad" }], [{ status: "none", factory_id: factory }], [{ status: "active", factory_id: factory }, { status: "active", factory_id: factory }]]) {
  test("N: malformed resolver response is configuration_error, not onboarding", async (t) => {
    const h = await harness(t); await h.activate(session()); h.hooks.rpc = async () => json(response);
    assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection), { kind: "configuration_error" });
  });
}
test("N: resolver outage returns request_error and no false membership", async (t) => {
  const h = await harness(t); await h.activate(session()); h.hooks.rpc = async () => json({ code: "XX000", message: "Synthetic outage" }, 500);
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection), { kind: "request_error" });
});
test("session rejection between verification and membership invalidates proof without logout or onboarding", async (t) => {
  const h = await harness(t); await h.activate(session()); const capture = h.capture();
  const earlier = await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection);
  h.hooks.rpc = async () => json({ code: "PGRST301", message: "Synthetic invalid JWT" }, 401);
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection), { kind: "authentication_failed" });
  assert.equal(h.events.includes("SIGNED_OUT"), false); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  assert.throws(() => assertFactoryResultCurrent(h.coordinator, earlier), AccountSupersededError);
});
test("O: installed SDK GET retry cannot dispatch a superseded credential", async (t) => {
  const h = await harness(t); await h.activate(session()); const capture = h.capture(); await verifyCapturedAccount(h.coordinator, capture, h.connection);
  let sends = 0; const connection = { url, key, fetch: (async () => {
    sends++; await h.activate(session(B)); return json({ message: "Synthetic retry" }, 520);
  }) as typeof fetch };
  // SDK retries a GET, not the POST resolver. All retry dispatches use the same guarded fetch.
  const client = capturedAccountClient(h.coordinator, capture, connection);
  const result = await client.from("factory_users").select("factory_id").limit(2);
  assert.ok(result.error); assert.equal(sends, 1); assert.equal(h.coordinator.isActivationCurrent(capture.activation), false);
});
test("actual SDK token-resolution await cannot bypass the final native-dispatch ownership check", async (t) => {
  const h = eventHarness(t); h.emit("SIGNED_IN", session()); const capture = h.coordinator.capture()!;
  let sends = 0; const client = capturedAccountClient(h.coordinator, capture, { url, key, fetch: async () => { sends++; return json([]); } });
  const pending = client.rpc("resolve_factory_access").then((result) => result);
  queueMicrotask(() => h.emit("SIGNED_IN", session(B)));
  const result = await pending; assert.ok(result.error); assert.equal(sends, 0);
});
test("control reproduction: shared SDK getUser can remove B, while the isolated regression above cannot", async (t) => {
  const h = await harness(t); await h.activate(session()); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.user = () => { started.resolve(); return release.promise; };
  const pending = h.shared.auth.getUser(); await started.promise; h.hooks.user = undefined; await h.activate(session(B));
  release.resolve(json({ code: "session_not_found", message: "Synthetic unavailable" }, 400)); await pending;
  assert.equal(h.storage.has(h.storageKey), false); assert.equal(h.events.includes("SIGNED_OUT"), true);
});
test("control reproduction: shared PostgREST substitutes B after A verification", async (t) => {
  const h = await harness(t); await h.activate(session()); assert.equal((await h.shared.auth.getUser()).data.user?.id, A);
  await h.activate(session(B)); h.requests.length = 0;
  await h.shared.from("factory_users").select("factory_id").eq("user_id", A).limit(2);
  assert.equal(h.requests[0].authorization, `Bearer ${session(B).access_token}`);
});
test("expired credentials and stop invalidate ownership without logging out or manufacturing another actor", (t) => {
  let clock = Date.now(); const h = eventHarness(t, () => clock); h.emit("SIGNED_IN", session()); const capture = h.coordinator.capture()!;
  clock = expires * 1000; assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.getSnapshot().reason, "expired");
  assert.equal(h.coordinator.retryVerification(), null); h.coordinator.stop(); assert.equal(h.adapter.isCurrent(capture), false);
});

// In-memory mutation controls: production source is transpiled without creating
// or editing files. These demonstrate assertion sensitivity, not browser proof.
async function mutantAccount(before: string, after: string) {
  const source = readFileSync(new URL("./account-activation.ts", import.meta.url), "utf8");
  assert.ok(source.includes(before));
  const javascript = ts.transpileModule(source.replace(before, after), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('"@supabase/supabase-js"', JSON.stringify(import.meta.resolve("@supabase/supabase-js")));
  return await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`) as typeof import("./account-activation.ts");
}
test("mutation sensitivity: removing generation/capture equality incorrectly restores A1 authority", async (t) => {
  // Retirement is now a second fence: this unsafe control removes both fences
  // to retain the original generation-comparison sensitivity demonstration.
  const mutant = await mutantAccount("secret.retired || secret.owner !== api || captured !== current || captured.activation !== activation", "secret.owner !== api || captured.activation.actorId !== activation?.actorId || captured.activation.sessionId !== activation?.sessionId");
  for (const [make, shouldReject] of [[createAccountCoordinator, true], [mutant.createAccountCoordinator, false]] as const) {
    const h = eventHarness(t, Date.now, make); h.emit("SIGNED_IN", session()); const old = h.coordinator.capture()!;
    h.emit("SIGNED_IN", session(B)); h.emit("SIGNED_IN", session());
    let rejects = false; try { h.coordinator.assertCredentialCurrent(old); } catch { rejects = true; }
    assert.equal(rejects, shouldReject);
  }
});
test("mutation sensitivity: removing final dispatch assertion allows an obsolete SDK request", async (t) => {
  const mutant = await mutantAccount("coordinator.assertCredentialCurrent(captured);\n    // No await", "// MUTATION: omitted final ownership check\n    // No await");
  for (const [implementation, expected] of [[{ createAccountCoordinator, capturedAccountClient }, 0], [mutant, 1]] as const) {
    const h = eventHarness(t, Date.now, implementation.createAccountCoordinator); h.emit("SIGNED_IN", session());
    let sends = 0; const client = implementation.capturedAccountClient(h.coordinator, h.coordinator.capture()!, { url, key, fetch: async () => { sends++; return json([]); } });
    const pending = client.rpc("resolve_factory_access").then((result) => result);
    queueMicrotask(() => h.emit("SIGNED_IN", session(B))); await pending;
    assert.equal(sends, expected);
  }
});
test("mutation sensitivity: collapsing verification failure into no_factory creates false onboarding", async (t) => {
  const source = readFileSync(new URL("./captured-factory-access-service.ts", import.meta.url), "utf8");
  assert.ok(source.includes("return { kind: error.kind };"));
  const javascript = ts.transpileModule(source.replace("return { kind: error.kind };", "return { kind: 'no_factory', actorId: capture.activation.actorId, activation: capture.activation };"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('"./account-activation.ts"', JSON.stringify(import.meta.resolve("./account-activation.ts")));
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`) as typeof import("./captured-factory-access-service.ts");
  for (const [resolve, expected] of [[resolveCapturedFactoryAccess, "authentication_failed"], [mutant.resolveCapturedFactoryAccess, "no_factory"]] as const) {
    const h = await harness(t); await h.activate(session()); h.hooks.user = async () => json({ code: "session_not_found", message: "Synthetic unavailable" }, 400);
    assert.equal((await resolve(h.coordinator, h.capture(), h.connection)).kind, expected);
  }
});
test("adapter and coordinator reject stale verification completion without changing newer B state", async (t) => {
  const h = await harness(t); const adapter = transportAccountAdapter(h.coordinator);
  await h.activate(session()); const old = h.capture(); const entered = deferred<void>(), release = deferred<Response>();
  h.hooks.user = () => { entered.resolve(); return release.promise; };
  const pending = verifyCapturedAccount(h.coordinator, old, h.connection); await entered.promise;
  h.hooks.user = undefined; await h.activate(session(B)); const before = h.coordinator.getSnapshot();
  release.resolve(json(user())); await assert.rejects(pending, AccountSupersededError);
  assert.equal(h.coordinator.getSnapshot(), before); assert.equal(adapter.isCurrent(old), false); assert.equal(h.coordinator.ownsCredential(old), false);
});
test("pre-dispatch callback cannot synchronously switch accounts and then dispatch A", async (t) => {
  const h = eventHarness(t); h.emit("SIGNED_IN", session()); let sends = 0;
  const client = capturedAccountClient(h.coordinator, h.coordinator.capture()!, { url, key, fetch: async () => { sends++; return json([]); } }, () => h.emit("SIGNED_IN", session(B)));
  assert.ok((await client.rpc("resolve_factory_access")).error); assert.equal(sends, 0);
});

for (const stored of ["{", "null", "[]", "{}", JSON.stringify(session(A, A, 0, { session_id: "bad" })), ""]) {
  test("readable malformed session retires ownership; only a fresh SDK event can establish a verified generation", async (t) => {
    const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const old = h.coordinator.capture()!;
    h.boundary.storage.setItem(h.boundary.key, stored);
    assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
    h.boundary.storage.setItem(h.boundary.key, JSON.stringify(session())); h.advance(30_000);
    assert.equal(h.coordinator.retryVerification(), null); assert.throws(() => h.coordinator.assertCredentialCurrent(old), AccountSupersededError);
    h.emit("SIGNED_IN", session()); const fresh = h.coordinator.capture()!;
    assert.ok(fresh.activation.generation > old.activation.generation);
    assert.equal(h.coordinator.getSnapshot().status, "pending_verification");
    let sends = 0; const result = await resolveCapturedFactoryAccess(h.coordinator, fresh, { url, key, fetch: async (input, init) => {
      sends++; assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${session().access_token}`);
      return String(input).includes("/user") ? json(user()) : json([{ status: "active", factory_id: factory }]);
    } });
    assert.equal(result.kind, "authorized"); assertFactoryResultCurrent(h.coordinator, result); assert.equal(sends, 2);
    assert.throws(() => h.coordinator.assertCredentialCurrent(old), AccountSupersededError);
  });
}
test("delayed old verification cannot promote a malformed-storage-retired capture after restoration or a new event", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const old = h.coordinator.capture()!;
  const entered = deferred<void>(), release = deferred<Response>(); let sends = 0;
  const pending = resolveCapturedFactoryAccess(h.coordinator, old, { url, key, fetch: async () => { sends++; entered.resolve(); return release.promise; } });
  await entered.promise; h.boundary.storage.setItem(h.boundary.key, "{"); assert.equal(h.coordinator.capture(), null);
  h.boundary.storage.setItem(h.boundary.key, JSON.stringify(session())); assert.equal(h.coordinator.retryVerification(), null);
  h.emit("SIGNED_IN", session()); const newer = h.coordinator.getSnapshot();
  release.resolve(json(user())); assert.deepEqual(await pending, { kind: "superseded" });
  assert.equal(h.coordinator.getSnapshot(), newer); assert.equal(newer.status, "pending_verification"); assert.equal(sends, 1);
});
test("temporarily throwing supported storage denies dispatch/publication but explicit consistent-storage recovery retains activation", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const captured = h.coordinator.capture()!;
  let sends = 0; const connection = { url, key, fetch: (async (input) => { sends++; return String(input).includes("/user") ? json(user()) : json([{ status: "none", factory_id: null }]); }) as typeof fetch };
  h.setUnreadable(true); assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, captured, connection), { kind: "superseded" }); assert.equal(sends, 0);
  assert.throws(() => assertFactoryResultCurrent(h.coordinator, { kind: "authorized", actorId: A, activation: captured.activation, factoryId: factory }), AccountSupersededError);
  h.setUnreadable(false); assert.equal(h.coordinator.retryVerification(), null); h.advance(5_000);
  const retry = h.coordinator.retryVerification(); assert.equal(retry, captured);
  const result = await resolveCapturedFactoryAccess(h.coordinator, retry!, connection);
  assert.equal(result.kind, "no_factory"); assert.equal(h.coordinator.getSnapshot().activation, captured.activation); assert.equal(sends, 2);
});
for (const observedSignOut of [false, true]) test(`empty storage ${observedSignOut ? "with SDK sign-out" : "without observed sign-out"} permanently retires A1`, async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const old = h.coordinator.capture()!;
  if (observedSignOut) h.emit("SIGNED_OUT", null); else h.boundary.storage.removeItem(h.boundary.key);
  assert.equal(h.coordinator.capture(), null);
  assert.equal(h.coordinator.getSnapshot().status, observedSignOut ? "signed_out" : "uncertain");
  h.boundary.storage.setItem(h.boundary.key, JSON.stringify(session())); assert.equal(h.coordinator.retryVerification(), null);
  let sends = 0;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, old, { url, key, fetch: async () => { sends++; return json(user()); } }), { kind: "superseded" });
  assert.equal(sends, 0); h.emit("SIGNED_IN", session()); assert.ok(h.coordinator.capture()!.activation.generation > old.activation.generation);
  assert.throws(() => h.coordinator.assertCredentialCurrent(old), AccountSupersededError);
});
for (const malformed of [false, true]) test(`A1 -> ${malformed ? "malformed" : "unreadable"} storage -> B never revives A1 or removes B`, async (t) => {
  const h = await harness(t); await h.activate(session()); const old = h.capture();
  if (malformed) h.storage.set(h.storageKey, "{"); else h.setUnreadable(true);
  assert.equal(h.coordinator.capture(), null); h.setUnreadable(false); await h.activate(session(B)); const before = h.storage.get(h.storageKey);
  const count = h.requests.length;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, old, h.connection), { kind: "superseded" });
  assert.equal(h.requests.length, count); assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.includes("SIGNED_OUT"), false);
  assert.equal(h.capture().activation.actorId, B);
});

const verificationErrors = [
  { label: "session missing", code: "session_not_found", status: 400, name: "AuthSessionMissingError", sdkCode: undefined, sdkStatus: 400, outcome: "authentication_failed" },
  { label: "invalid JWT", code: "bad_jwt", status: 401, name: "AuthApiError", sdkCode: "bad_jwt", sdkStatus: 401, outcome: "authentication_failed" },
  { label: "expired session", code: "session_expired", status: 403, name: "AuthApiError", sdkCode: "session_expired", sdkStatus: 403, outcome: "authentication_failed" },
  { label: "rate limited", code: "over_request_rate_limit", status: 429, name: "AuthApiError", sdkCode: "over_request_rate_limit", sdkStatus: 429, outcome: "request_error" },
  { label: "rate limit with misleading session code", code: "session_not_found", status: 429, name: "AuthSessionMissingError", sdkCode: undefined, sdkStatus: 400, outcome: "request_error" },
  { label: "unknown 401", code: "unexpected_failure", status: 401, name: "AuthApiError", sdkCode: "unexpected_failure", sdkStatus: 401, outcome: "request_error" },
  { label: "validation 400", code: "validation_failed", status: 400, name: "AuthApiError", sdkCode: "validation_failed", sdkStatus: 400, outcome: "request_error" },
  { label: "server unavailable", code: "unexpected_failure", status: 503, name: "AuthRetryableFetchError", sdkCode: undefined, sdkStatus: 503, outcome: "request_error" },
  { label: "malformed provider error", code: undefined, status: 400, name: "AuthUnknownError", sdkCode: undefined, sdkStatus: undefined, outcome: "request_error" },
  { label: "network failure", code: undefined, status: 0, name: "AuthRetryableFetchError", sdkCode: undefined, sdkStatus: 0, outcome: "request_error" },
] as const;
for (const row of verificationErrors) test(`installed SDK decision table: ${row.label}`, async (t) => {
  const response = async () => {
    if (row.status === 0) throw new TypeError("Synthetic network unavailable");
    if (row.label === "malformed provider error") return new Response("not-json", { status: row.status });
    return json({ code: row.code, message: "Synthetic provider response" }, row.status);
  };
  const probe = createClient(url, key, { auth: { storageKey: `synthetic-errors-${++sequence}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: response } });
  t.after(() => probe.auth.dispose());
  const error = (await probe.auth.getUser(session().access_token)).error!;
  assert.equal(error.name, row.name); assert.equal(error.code, row.sdkCode); assert.equal(error.status, row.sdkStatus);
  const h = await harness(t); await h.activate(session()); const capture = h.capture(), before = h.storage.get(h.storageKey);
  h.requests.length = 0; h.hooks.user = response;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, h.connection), { kind: row.outcome });
  assert.equal(h.coordinator.getSnapshot().status, "uncertain"); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].authorization, `Bearer ${session().access_token}`);
  assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.includes("SIGNED_OUT"), false);
  assert.equal(h.coordinator.capture(), null);
  assert.equal(h.coordinator.retryVerification(), null); // Both failure kinds deny immediate work.
  h.advance(row.status === 429 ? 30_000 : 5_000); const retry = h.coordinator.retryVerification();
  if (row.outcome === "authentication_failed") { assert.equal(retry, null); assert.equal(h.requests.length, 1); }
  else {
    assert.equal(retry, capture); h.hooks.user = undefined;
    assert.equal((await resolveCapturedFactoryAccess(h.coordinator, retry!, h.connection)).kind, "authorized");
    assert.equal(h.requests.length, 3); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
  }
});
test("initial request plus three explicit retries; fourth, repeated events, subscriptions and refresh cannot bypass exhaustion", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const original = h.coordinator.capture()!;
  let sends = 0, outage = true;
  const connection = { url, key, fetch: (async (input, init) => {
    sends++;
    if (String(input).includes("/user")) return outage ? json({ message: "Synthetic outage" }, 503)
      : json(user(new Headers(init?.headers).get("Authorization") === `Bearer ${session(B).access_token}` ? B : A));
    return json([{ status: "active", factory_id: factory }]);
  }) as typeof fetch };
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, original, connection), { kind: "request_error" });
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const count = sends; assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, count);
    assert.equal(h.coordinator.getVerificationRetryState().status, "cooldown"); h.advance(5_000);
    const retry = h.coordinator.retryVerification(); assert.equal(retry, original);
    assert.equal(h.coordinator.retryVerification(), null); // Reserved/overlapping retry denied.
    assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, retry!, connection), { kind: "request_error" });
    assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, attempt);
    const unsubscribe = h.coordinator.subscribe(() => {}); unsubscribe(); // Remount/subscription cannot reset.
    h.coordinator.getSnapshot(); h.emit("SIGNED_IN", session());
    assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, attempt);
  }
  h.advance(30_000); assert.equal(h.coordinator.retryVerification(), null);
  assert.equal(h.coordinator.getVerificationRetryState().status, "exhausted"); assert.equal(sends, 4);
  const before = sends;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, original, connection), { kind: "superseded" });
  assert.equal(sends, before); h.emit("TOKEN_REFRESHED", session(A, A, 1));
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 3);
  outage = false; h.emit("SIGNED_IN", session(B)); const b = h.coordinator.capture()!;
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
  assert.equal((await resolveCapturedFactoryAccess(h.coordinator, b, connection)).kind, "authorized");
  h.emit("SIGNED_IN", session()); const restored = h.coordinator.capture()!; assert.ok(restored.activation.generation > original.activation.generation);
  assert.throws(() => h.coordinator.assertCredentialCurrent(original), AccountSupersededError);
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
});
for (const header of [null, "1", "120", "http-date", "invalid"]) test(`429 cooldown honors Retry-After ${header ?? "absent"}`, async (t) => {
  const h = await harness(t); await h.activate(session()); const captured = h.capture();
  const delay = header === "120" ? 120_000 : header === "http-date" ? 90_000 : 30_000;
  h.hooks.user = async () => {
    const response = json({ code: "over_request_rate_limit", message: "Synthetic limit" }, 429);
    if (header) response.headers.set("Retry-After", header === "http-date" ? new Date(h.now() + delay).toUTCString() : header);
    return response;
  };
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, captured, h.connection), { kind: "request_error" });
  const expected = header === "http-date" ? Math.floor(h.now() / 1000) * 1000 + delay - h.now() : delay;
  assert.equal(h.coordinator.getVerificationRetryState().retryAfterMs, expected);
  const count = h.requests.length; h.advance(expected - 1); assert.equal(h.coordinator.retryVerification(), null); assert.equal(h.requests.length, count);
  h.advance(1); assert.equal(h.coordinator.getVerificationRetryState().status, "available"); const retry = h.coordinator.retryVerification();
  h.hooks.user = undefined; assert.equal((await resolveCapturedFactoryAccess(h.coordinator, retry!, h.connection)).kind, "authorized");
});

const retryClock = Date.UTC(2026, 9, 12);
const retryAfterCases: readonly [string | null, number][] = [
  [null, 30_000], ["", 30_000], ["-1", 30_000], ["-9999", 30_000], ["+120", 30_000],
  ["9000.5", 30_000], ["1e12", 30_000], ["Infinity", 30_000], ["NaN", 30_000],
  ["0x78", 30_000], ["120seconds", 30_000], ["9".repeat(100), 30_000],
  ["9007199254740993", 30_000], ["9007199254741", 30_000], ["9007199254740", 30_000],
  // Safe integer milliseconds can still produce an unusable Date deadline.
  [String(Math.floor((8_640_000_000_000_000 - retryClock) / 1000) + 1), 30_000],
  ["0", 30_000], ["10", 30_000], ["120", 120_000], ["00120", 120_000],
  [" 120 ", 120_000], ["315360000", 315_360_000_000],
  ["Mon, 12 Oct 2026 00:02:00 GMT", 120_000], ["Sun, 06 Nov 1994 08:49:37 GMT", 30_000],
  ["Sun, 31 Feb 2027 00:00:00 GMT", 30_000], ["Mon, 29 Feb 2027 00:00:00 GMT", 30_000],
  ["Mon, 32 Oct 2026 00:02:00 GMT", 30_000], ["Mon, 00 Oct 2026 00:02:00 GMT", 30_000],
  ["Mon, 12 Xxx 2026 00:02:00 GMT", 30_000], ["Tue, 12 Oct 2026 00:02:00 GMT", 30_000],
  ["Mon, 12 Oct 2026 24:02:00 GMT", 30_000], ["Mon, 12 Oct 2026 00:60:00 GMT", 30_000],
  ["Mon, 12 Oct 2026 00:02:60 GMT", 30_000], ["Mon, 12 Oct 2026 00:02:00 UTC", 30_000],
  ["Mon, 12 Oct 2026 00:02:00 +0000", 30_000], ["2026-10-12T00:02:00Z", 30_000],
  ["Monday, 12-Oct-26 00:02:00 GMT", 30_000], ["Mon Oct 12 00:02:00 2026", 30_000],
  ["arbitrary text", 30_000],
];
async function assertRetryAfterPolicy(t: Lifetime, header: string | null, delay: number,
  implementation = { createAccountCoordinator, verifyCapturedAccount }) {
  let clock = retryClock, sends = 0;
  const h = eventHarness(t, () => clock, implementation.createAccountCoordinator);
  // Long-lived synthetic credentials let deadline tests advance without token expiry.
  h.emit("SIGNED_IN", session(A, A, 0, { iat: retryClock / 1000 - 60, exp: 8_640_000_000_001 }));
  const capture = h.coordinator.capture()!;
  const connection = { url, key, fetch: (async () => {
    sends++;
    const response = json({ code: "session_not_found", message: "Synthetic limit" }, 429);
    if (header !== null) response.headers.set("Retry-After", header);
    return response;
  }) as typeof fetch };
  await assert.rejects(implementation.verifyCapturedAccount(h.coordinator, capture, connection),
    (error: unknown) => (error as { kind?: string }).kind === "request_error");
  assert.equal(sends, 1); assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.getSnapshot().activation, undefined);
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
  assert.equal(h.coordinator.getVerificationRetryState().retryAfterMs, delay, "strict Retry-After cooldown");
  const deadline = h.coordinator.getSnapshot().verification.availableAt!;
  assert.equal(deadline, retryClock + delay);
  assert.equal(Number.isSafeInteger(deadline), true); assert.equal(Number.isFinite(new Date(deadline).getTime()), true);
  clock = deadline - 1; assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, 1);
  clock = deadline; const retry = h.coordinator.retryVerification(); assert.equal(retry, capture);
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, 1); // Reserved retry cannot overlap.
  await assert.rejects(implementation.verifyCapturedAccount(h.coordinator, retry!, connection),
    (error: unknown) => (error as { kind?: string }).kind === "request_error");
  assert.equal(sends, 2); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 1);
  clock += delay; const next = h.coordinator.retryVerification(); assert.equal(next, capture);
  await implementation.verifyCapturedAccount(h.coordinator, next!, { url, key, fetch: async () => { sends++; return json(user()); } });
  assert.equal(sends, 3); assert.equal(h.coordinator.getSnapshot().status, "verified");
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
}
for (const [header, delay] of retryAfterCases) test(`F3B.3 strict Retry-After: ${header ?? "absent"}`, async (t) => {
  await assertRetryAfterPolicy(t, header, delay);
});
test("F3B.3 rate-limit cooldown cannot revive A1 after B and restored A2", async (t) => {
  const h = await harness(t); await h.activate(session()); const old = h.capture();
  h.hooks.user = async () => {
    const response = json({ code: "session_not_found", message: "Synthetic limit" }, 429);
    response.headers.set("Retry-After", "-9999"); return response;
  };
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, old, h.connection), { kind: "request_error" });
  h.hooks.user = undefined; await h.activate(session(B)); const before = h.storage.get(h.storageKey), eventIndex = h.events.length;
  h.advance(30_000); const count = h.requests.length;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, old, h.connection), { kind: "superseded" });
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(h.requests.length, count);
  assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(eventIndex).includes("SIGNED_OUT"), false);
  assert.equal((await resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection)).kind, "authorized");
  await h.activate(session()); const fresh = h.capture(); assert.ok(fresh.activation.generation > old.activation.generation);
  const afterRestore = h.requests.length;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, old, h.connection), { kind: "superseded" });
  assert.equal(h.requests.length, afterRestore);
  assert.equal((await resolveCapturedFactoryAccess(h.coordinator, fresh, h.connection)).kind, "authorized");
});
test("F3B.3 Retry-After mutation: corrected PASS, original parser FAIL, corrected PASS", async (t) => {
  const mutant = await mutantAccount('rateLimitDelay = retryAfterDelay(response.headers.get("Retry-After"), lifecycle.now());',
    `const header = response.headers.get("Retry-After")?.trim();
          const seconds = header && /^\\d+$/.test(header) ? Number(header) : NaN;
          const delay = Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000 ? seconds * 1000
            : header ? Date.parse(header) - lifecycle.now() : NaN;
          if (Number.isFinite(delay) && delay >= 0) rateLimitDelay = Math.max(30_000, delay);`);
  for (const header of ["-9999", "9000.5"]) {
    await assertRetryAfterPolicy(t, header, 30_000);
    await assert.rejects(assertRetryAfterPolicy(t, header, 30_000, mutant), /strict Retry-After cooldown/);
    await assertRetryAfterPolicy(t, header, 30_000);
  }
});

const maximumDateTimestamp = 8_640_000_000_000_000;
const maximumRetrySeconds = (maximumDateTimestamp - retryClock) / 1000;
async function assertFinalRetryDeadline(t: Lifetime, header: string, bodyDelay: number, expectedDelay: number,
  implementation = { createAccountCoordinator, verifyCapturedAccount }) {
  let clock = retryClock, sends = 0;
  const h = eventHarness(t, () => clock, implementation.createAccountCoordinator);
  h.emit("SIGNED_IN", session(A, A, 0, { iat: retryClock / 1000 - 60, exp: 8_640_000_000_001 }));
  const captured = h.coordinator.capture()!;
  await assert.rejects(implementation.verifyCapturedAccount(h.coordinator, captured, { url, key, fetch: async () => {
    sends++;
    const response = json({ code: "session_not_found", message: "Synthetic limit" }, 429);
    response.headers.set("Retry-After", header);
    const read = response.json.bind(response);
    // SDK consumes the body after the application's header parser has run.
    response.json = async () => { clock += bodyDelay; return read(); };
    return response;
  } }), (error: unknown) => (error as { kind?: string }).kind === "request_error");
  assert.equal(sends, 1); assert.equal(clock, retryClock + bodyDelay);
  const snapshot = h.coordinator.getSnapshot(), deadline = snapshot.verification.availableAt!;
  assert.equal(Number.isFinite(new Date(deadline).getTime()), true, "final retry deadline must be representable");
  assert.equal(Number.isSafeInteger(deadline), true);
  assert.equal(deadline, clock + expectedDelay, "cooldown uses the final failure clock");
  assert.equal(snapshot.status, "uncertain"); assert.equal(snapshot.verification.retriesUsed, 0);
  assert.equal(h.coordinator.capture(), null);
  clock = deadline - 1; assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, 1);
  clock = deadline; const retry = h.coordinator.retryVerification(); assert.equal(retry, captured);
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, 1);
  await implementation.verifyCapturedAccount(h.coordinator, retry!, { url, key, fetch: async () => { sends++; return json(user()); } });
  assert.equal(sends, 2); assert.equal(h.coordinator.getSnapshot().status, "verified");
}
for (const [label, header, bodyDelay, expectedDelay] of [
  ["exact boundary plus 1 ms", String(maximumRetrySeconds), 1, 30_000],
  ["exact boundary plus 1000 ms", String(maximumRetrySeconds), 1000, 30_000],
  ["exact valid maximum", String(maximumRetrySeconds), 0, maximumDateTimestamp - retryClock],
  ["maximum at final assignment", String(maximumRetrySeconds - 1), 1000, maximumDateTimestamp - retryClock - 1000],
  ["above maximum", String(maximumRetrySeconds + 1), 1000, 30_000],
  ["normal numeric delay", "120", 1000, 120_000],
  ["normal IMF-fixdate", "Mon, 12 Oct 2026 00:02:00 GMT", 1000, 120_000],
] as const) test(`F3B.5 final deadline: ${label}`, async (t) => {
  await assertFinalRetryDeadline(t, header, bodyDelay, expectedDelay);
});
test("F3B.5 account replacement during SDK body processing cannot store A's deadline or mutate B", async (t) => {
  const h = await harness(t); await h.activate(session()); const old = h.capture();
  const entered = deferred<void>(), release = deferred<void>();
  h.hooks.user = async () => {
    const response = json({ code: "session_not_found", message: "Synthetic limit" }, 429);
    response.headers.set("Retry-After", "120");
    const read = response.json.bind(response);
    response.json = async () => { entered.resolve(); await release.promise; return read(); };
    return response;
  };
  const pending = resolveCapturedFactoryAccess(h.coordinator, old, h.connection); await entered.promise;
  h.hooks.user = undefined; await h.activate(session(B));
  const bResult = await resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection);
  assert.equal(bResult.kind, "authorized");
  const before = h.storage.get(h.storageKey), snapshot = h.coordinator.getSnapshot(), eventIndex = h.events.length, count = h.requests.length;
  release.resolve(); assert.deepEqual(await pending, { kind: "superseded" });
  assert.equal(h.coordinator.getSnapshot(), snapshot); assertFactoryResultCurrent(h.coordinator, bResult);
  assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(eventIndex).includes("SIGNED_OUT"), false);
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(h.requests.length, count);
});
test("F3B.5 a clock with no representable minimum cooldown withholds retry without storing an invalid deadline", async (t) => {
  let clock = retryClock, sends = 0;
  const h = eventHarness(t, () => clock);
  h.emit("SIGNED_IN", session(A, A, 0, { iat: retryClock / 1000 - 60, exp: 8_640_000_000_001 }));
  const captured = h.coordinator.capture()!;
  await assert.rejects(verifyCapturedAccount(h.coordinator, captured, { url, key, fetch: async () => {
    sends++;
    const response = json({ code: "over_request_rate_limit", message: "Synthetic limit" }, 429);
    response.headers.set("Retry-After", "120"); const read = response.json.bind(response);
    response.json = async () => { clock = maximumDateTimestamp - 20_000; return read(); };
    return response;
  } }), (error: unknown) => (error as { kind?: string }).kind === "request_error");
  assert.equal(h.coordinator.getSnapshot().status, "uncertain");
  assert.equal(h.coordinator.getSnapshot().verification.availableAt, null);
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0);
  assert.equal(h.coordinator.getVerificationRetryState().status, "unavailable");
  assert.equal(h.coordinator.capture(), null); assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, 1);
});
test("F3B.5 deadline mutation: corrected PASS, unsafe two-clock assignment FAIL, corrected PASS", async (t) => {
  const source = readFileSync(new URL("./account-activation.ts", import.meta.url), "utf8");
  const guardedAssignment = source.match(/      \/\/ Keep cooldowns relative to failure completion[\s\S]*?      needsRetry = true; availableAt = Math.max\(availableAt, deadline\);/)?.[0];
  assert.ok(guardedAssignment);
  const mutant = await mutantAccount(guardedAssignment,
    "      needsRetry = true; retryReserved = false; availableAt = Math.max(availableAt, now() + cooldown);");
  for (const delay of [1, 1000]) {
    await assertFinalRetryDeadline(t, String(maximumRetrySeconds), delay, 30_000);
    await assert.rejects(assertFinalRetryDeadline(t, String(maximumRetrySeconds), delay, 30_000, mutant), /final retry deadline must be representable/);
    await assertFinalRetryDeadline(t, String(maximumRetrySeconds), delay, 30_000);
  }
});
test("retry is non-overlapping and A retry completion cannot publish under B or clear B verification", async (t) => {
  const h = await harness(t); await h.activate(session()); const captured = h.capture();
  h.hooks.user = async () => json({ message: "Synthetic outage" }, 503);
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, captured, h.connection), { kind: "request_error" });
  h.advance(5_000); const retry = h.coordinator.retryVerification()!;
  const entered = deferred<void>(), release = deferred<Response>(); h.hooks.user = () => { entered.resolve(); return release.promise; };
  const count = h.requests.length, pending = resolveCapturedFactoryAccess(h.coordinator, retry, h.connection); await entered.promise;
  assert.equal(h.coordinator.retryVerification(), null); assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, retry, h.connection), { kind: "request_error" });
  assert.equal(h.requests.length, count + 1); h.hooks.user = undefined; await h.activate(session(B)); const before = h.storage.get(h.storageKey);
  const bResult = await resolveCapturedFactoryAccess(h.coordinator, h.capture(), h.connection); assert.equal(bResult.kind, "authorized");
  release.resolve(json({ code: "session_not_found", message: "Synthetic rejection" }, 400));
  assert.deepEqual(await pending, { kind: "superseded" }); assertFactoryResultCurrent(h.coordinator, bResult);
  assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.includes("SIGNED_OUT"), false);
});
test("successful retry resets consecutive allowance; temporary unreadability and failed attempts do not", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const captured = h.coordinator.capture()!;
  let outage = true, sends = 0;
  const connection = { url, key, fetch: (async (input) => { sends++; return String(input).includes("/user") ? outage ? json({ message: "Synthetic outage" }, 503) : json(user()) : json([{ status: "none", factory_id: null }]); }) as typeof fetch };
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, captured, connection), { kind: "request_error" });
  h.advance(5_000); let retry = h.coordinator.retryVerification()!;
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, retry, connection), { kind: "request_error" });
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 1);
  h.setUnreadable(true); h.coordinator.getSnapshot(); h.setUnreadable(false);
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 1); h.advance(5_000);
  retry = h.coordinator.retryVerification()!; outage = false;
  assert.equal((await resolveCapturedFactoryAccess(h.coordinator, retry, connection)).kind, "no_factory");
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 0); assert.equal(sends, 4);
});
test("same-session token refresh cannot overlap an outstanding retry or reset its activation allowance", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const original = h.coordinator.capture()!;
  let sends = 0;
  const connection = { url, key, fetch: (async () => { sends++; return json({ message: "Synthetic outage" }, 503); }) as typeof fetch };
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, original, connection), { kind: "request_error" });
  h.advance(5_000); const retry = h.coordinator.retryVerification()!;
  const entered = deferred<void>(), release = deferred<Response>();
  const pending = resolveCapturedFactoryAccess(h.coordinator, retry, { url, key, fetch: async () => { sends++; entered.resolve(); return release.promise; } });
  await entered.promise; h.emit("TOKEN_REFRESHED", session(A, A, 1));
  assert.equal(h.coordinator.retryVerification(), null); assert.equal(sends, 2);
  assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 1);
  release.resolve(json(user())); assert.deepEqual(await pending, { kind: "superseded" });
  const next = h.coordinator.retryVerification()!; assert.ok(next); assert.equal(next.activation, original.activation);
  assert.notEqual(next, original); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 2);
  assert.throws(() => h.coordinator.assertCredentialCurrent(original), AccountSupersededError);
  const result = await resolveCapturedFactoryAccess(h.coordinator, next, { url, key, fetch: async (input, init) => {
    sends++; assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${session(A, A, 1).access_token}`);
    return String(input).includes("/user") ? json(user()) : json([{ status: "none", factory_id: null }]);
  } });
  assert.equal(result.kind, "no_factory"); assert.equal(sends, 4);
});
test("unknown SDK construction failure releases verification lifetime and permits bounded explicit recovery", async (t) => {
  const h = supportedStorageHarness(t); h.emit("SIGNED_IN", session()); const capture = h.coordinator.capture()!;
  let sends = 0;
  const send: typeof fetch = async (input) => { sends++; return String(input).includes("/user") ? json(user()) : json([{ status: "inactive", factory_id: null }]); };
  assert.deepEqual(await resolveCapturedFactoryAccess(h.coordinator, capture, { url: "invalid-url", key, fetch: send }), { kind: "request_error" });
  assert.equal(sends, 0); assert.equal(h.coordinator.getSnapshot().verification.checking, false);
  assert.equal(h.coordinator.getSnapshot().status, "uncertain"); h.advance(5_000);
  const retry = h.coordinator.retryVerification(); assert.equal(retry, capture);
  assert.equal((await resolveCapturedFactoryAccess(h.coordinator, retry!, { url, key, fetch: send })).kind, "inactive");
  assert.equal(sends, 2);
});
test("F3B.1 retirement assertion mutation: corrected PASS, bypass FAIL, restored PASS", async (t) => {
  const mutant = await mutantAccount("!secret || secret.retired || secret.owner", "!secret || secret.owner");
  const assertRetirement = (make: typeof createAccountCoordinator) => {
    const h = supportedStorageHarness(t, make); h.emit("SIGNED_IN", session()); const captured = h.coordinator.capture()!;
    h.boundary.storage.setItem(h.boundary.key, "{"); h.coordinator.getSnapshot();
    h.boundary.storage.setItem(h.boundary.key, JSON.stringify(session())); h.advance(30_000);
    assert.equal(h.coordinator.retryVerification(), null, "retired capture must not be reused");
    assert.throws(() => h.coordinator.assertCredentialCurrent(captured));
  };
  assertRetirement(createAccountCoordinator);
  assert.throws(() => assertRetirement(mutant.createAccountCoordinator), /retired capture must not be reused/);
  assertRetirement(createAccountCoordinator);
});
test("F3B.1 error classification mutation: corrected PASS, unsafe FAIL, restored PASS for 429 and malformed bodies", async (t) => {
  const mutant = await mutantAccount('const kind = responseStatus !== 429 && definitive ? "authentication_failed" : "request_error";',
    'const kind = error && (error.status === 0 || (error.status !== undefined && error.status >= 500)) ? "request_error" : "authentication_failed";');
  for (const malformed of [false, true]) {
    const assertUnavailable = async (verify: typeof verifyCapturedAccount) => {
      // Mutant helpers keep credentials privately, so pair each helper with its
      // own coordinator rather than sharing WeakMap handles across modules.
      const make = verify === verifyCapturedAccount ? createAccountCoordinator : mutant.createAccountCoordinator;
      const owned = supportedStorageHarness(t, make); owned.emit("SIGNED_IN", session()); const ownedCapture = owned.coordinator.capture()!;
      let sends = 0;
      await assert.rejects(verify(owned.coordinator, ownedCapture, { url, key, fetch: async () => {
        sends++; return malformed ? new Response("not-json", { status: 400 }) : json({ code: "over_request_rate_limit", message: "Synthetic limit" }, 429);
      } }), (error: unknown) => {
        assert.equal((error as { kind: string }).kind, "request_error", "unavailable verification must not become invalid Auth"); return true;
      });
      assert.equal(sends, 1);
    };
    await assertUnavailable(verifyCapturedAccount);
    await assert.rejects(assertUnavailable(mutant.verifyCapturedAccount), /unavailable verification must not become invalid Auth/);
    await assertUnavailable(verifyCapturedAccount);
  }
});
