import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createClient, type AuthChangeEvent, type Session, type User } from "@supabase/supabase-js";
import { GoTrueClient } from "@supabase/auth-js";
import { createRecoveryFlow, recoverySharedIdentity } from "./recovery-session.ts";
import { AUTH_EMAIL_OTP_LENGTH } from "./auth-config.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

await mock.module("../../../lib/supabase/client.ts", { namedExports: {
  supabase: { auth: { async resetPasswordForEmail() { return { error: null }; } } },
} });
const { requestPasswordRecovery, resendRecoveryCode } = await import("./recovery-service.ts");
test("recovery request calls resetPasswordForEmail and always returns the neutral accepted result", async () => {
  const calls: string[] = [];
  const accepted = await requestPasswordRecovery("person@example.com", {
    async resetPasswordForEmail(email) { calls.push(email); return { error: new Error("account-specific provider detail") }; },
  });
  assert.deepEqual(calls, ["person@example.com"]); assert.deepEqual(accepted, { ok: true });
  assert.doesNotMatch(JSON.stringify(accepted), /account|exist|provider/i);
  assert.deepEqual(await requestPasswordRecovery("person@example.com", {
    async resetPasswordForEmail() { throw new Error("network detail"); },
  }), { ok: true });
});
test("recovery resend uses resetPasswordForEmail again and maps rate limits safely", async () => {
  const calls: string[] = [];
  assert.deepEqual(await resendRecoveryCode("person@example.com", {
    async resetPasswordForEmail(email) { calls.push(email); return { error: null }; },
  }), { ok: true });
  assert.deepEqual(calls, ["person@example.com"]);
  assert.deepEqual(await resendRecoveryCode("person@example.com", {
    async resetPasswordForEmail() { return { error: new Error("provider rate detail") }; },
  }), { ok: false, message: ATLAS_UI_STRINGS.auth.recoveryResendError });
});

const ids = { A: "00000000-0000-4000-8000-000000000001", B: "00000000-0000-4000-8000-000000000002" };
type Actor = keyof typeof ids;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });
let harnessSequence = 0;
function harness(t: { after: (callback: () => void) => void }) {
  const storage = new Map<string, string>();
  const storageKey = `synthetic-recovery-shared-${++harnessSequence}`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const jwt = (actor: Actor) => [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: ids[actor], session_id: `synthetic-session-${actor}`, exp: expires })).toString("base64url"), Buffer.alloc(32).toString("base64url")].join(".");
  const user = (actor: Actor): User => ({ id: ids[actor], aud: "authenticated", role: "authenticated",
    email: actor === "A" ? "person@example.com" : "other@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
  const session = (actor: Actor): Session => ({ access_token: jwt(actor), refresh_token: `synthetic-refresh-${actor}`,
    expires_at: expires, expires_in: 3600, token_type: "bearer", user: user(actor) });
  type Request = { method: string; path: string; authorization: string | null; body: Record<string, unknown> };
  const requests: Request[] = [];
  const hooks: Partial<Record<"verify" | "get" | "update" | "logout", (request: Request) => Promise<Response | undefined>>> = {};
  const send: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const request = { method: init?.method ?? "GET", path: url.pathname + url.search,
      authorization: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body ?? "{}")) };
    requests.push(request);
    const actor = request.authorization === `Bearer ${jwt("B")}` ? "B" : "A";
    const kind = url.pathname.endsWith("/verify") ? "verify" : url.pathname.endsWith("/logout") ? "logout" : request.method === "PUT" ? "update" : "get";
    const custom = await hooks[kind]?.(request); if (custom) return custom;
    if (kind === "logout") return new Response(null, { status: 204 });
    return json(kind === "verify" ? session("A") : user(actor));
  };
  const url = "https://auth.example.invalid", key = "synthetic-public-key";
  const clientOptions = { auth: { storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    storage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } } }, global: { fetch: send } };
  const shared = createClient(url, key, clientOptions); const peers: typeof shared[] = [];
  let marker: { userId: string } | null = null, clock = Date.now();
  const flow = createRecoveryFlow({ sharedAuth: shared.auth, url, key, fetch: send, now: () => clock,
    readMarker: () => marker, saveMarker: (userId) => { marker = { userId }; }, clearMarker: () => { marker = null; },
    readSharedIdentity: () => { const raw = storage.get(storageKey); return recoverySharedIdentity(raw ? JSON.parse(raw) as Session : null); },
  });
  const events: string[] = []; shared.auth.onAuthStateChange((event) => { events.push(event); });
  async function activate(actor: Actor, client = shared) { assert.equal((await client.auth.setSession(session(actor))).error, null); }
  async function verified(active?: () => boolean) {
    const result = await flow.verify("person@example.com", "123456", active); assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Synthetic verification failed"); return result.context;
  }
  t.after(() => { flow.stop(); shared.auth.dispose(); peers.forEach((peer) => peer.auth.dispose()); });
  return { shared, flow, requests, hooks, storage, storageKey, events, jwt, user, session, activate, verified,
    setMarker(value: typeof marker) { marker = value; }, advance(milliseconds: number) { clock += milliseconds; },
    peer() { const peer = createClient(url, key, clientOptions); peers.push(peer); return peer; },
  };
}
test("recovery OTP uses type recovery, validates returned actor, and keeps six-digit credentials in memory only", async (t) => {
  const h = harness(t); await h.activate("A"); const before = h.storage.get(h.storageKey); const handle = await h.verified();
  assert.equal(AUTH_EMAIL_OTP_LENGTH, 6); assert.equal(handle.userId, ids.A);
  const request = h.requests.find((entry) => entry.path.endsWith("/verify"))!;
  assert.equal(request.body.type, "recovery"); assert.equal(request.body.email, "person@example.com"); assert.equal(request.body.token, "123456");
  assert.deepEqual(Object.keys(handle), ["userId"]); assert.equal(h.storage.get(h.storageKey), before); assert.deepEqual([...h.storage.keys()], [h.storageKey]);
});
test("recovery cannot substitute a newer shared actor for the actor returned by OTP", async (t) => {
  const h = harness(t); await h.activate("A"); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.verify = async () => { started.resolve(); return release.promise; };
  const verification = h.flow.verify("person@example.com", "123456"); await started.promise; await h.activate("B");
  const before = h.storage.get(h.storageKey), index = h.events.length; release.resolve(json(h.session("A")));
  assert.equal((await verification).ok, false); assert.equal(h.flow.context(), null); assert.equal(h.storage.get(h.storageKey), before);
  assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false);
});
test("wrong or expired recovery OTP returns one safe message and stops before getUser", async (t) => {
  const h = harness(t); h.hooks.verify = async () => json({ code: "otp_expired", message: "private detail" }, 403);
  assert.deepEqual(await h.flow.verify("person@example.com", "000000"), { ok: false, message: ATLAS_UI_STRINGS.auth.recoveryOtpInvalid });
  assert.equal(h.requests.filter((entry) => entry.method === "GET").length, 0);
});
test("recovery session validation requires the same captured user, never a shared substitute", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); assert.equal(await h.flow.validate(handle), true);
  h.hooks.get = async () => json(h.user("B")); assert.equal(await h.flow.validate(handle), false);
  h.hooks.get = async () => json({ code: "session_not_found", message: "private detail" }, 400); assert.equal(await h.flow.validate(handle), false);
});
test("delayed A session_not_found validation does not remove shared B or emit SIGNED_OUT", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.get = async (request) => { if (request.authorization !== `Bearer ${h.jwt("A")}`) return; started.resolve(); return release.promise; };
  const validation = h.flow.validate(handle); await started.promise; await h.activate("B"); const before = h.storage.get(h.storageKey), index = h.events.length;
  release.resolve(json({ code: "session_not_found", message: "private detail" }, 400));
  assert.equal(await validation, false); assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false);
});
for (const initial of ["A", null] as const) {
  test(`normal isolated recovery preserves global revocation policy and approved local fallback (${initial ?? "logged out"})`, async (t) => {
    const h = harness(t); if (initial) await h.activate(initial); const before = h.storage.get(h.storageKey); const handle = await h.verified();
    const result = await h.flow.update(handle, "synthetic-new-password"); assert.equal(result.ok, true); if (!result.ok) return;
    assert.deepEqual(result.completion, { passwordChanged: true, revocation: "confirmed", localSessionCleared: false }); assert.equal(result.mayPublish, true);
    assert.equal(h.storage.get(h.storageKey), before); const updates = h.requests.filter((entry) => entry.method === "PUT");
    assert.equal(updates.length, 1); assert.equal(updates[0].authorization, `Bearer ${h.jwt("A")}`); assert.equal(updates[0].body.password, "synthetic-new-password");
    const logout = h.requests.find((entry) => entry.path.includes("/logout"))!; assert.equal(logout.path, "/auth/v1/logout?scope=global"); assert.equal(logout.authorization, `Bearer ${h.jwt("A")}`);
    assert.equal((await h.flow.update(handle, "second-password")).ok, false); assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
  });
}
test("A -> B before submission dispatches zero password updates or logouts", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); await h.activate("B"); const before = h.storage.get(h.storageKey);
  assert.equal((await h.flow.update(handle, "synthetic-password")).ok, false); assert.equal(h.flow.canPublish(handle), false);
  assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/logout")), false); assert.equal(h.storage.get(h.storageKey), before);
});
test("account switch during dispatch-time verification prevents any password PUT", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.get = async (request) => { if (request.authorization !== `Bearer ${h.jwt("A")}`) return; started.resolve(); return release.promise; };
  const update = h.flow.update(handle, "synthetic-password"); await started.promise; await h.activate("B"); release.resolve(json(h.user("A")));
  assert.equal((await update).ok, false); assert.equal(h.requests.some((entry) => entry.method === "PUT"), false);
});
test("A update finishing after B signs in stays confirmed without B mutation or stale publication", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.update = async () => { started.resolve(); return release.promise; }; const update = h.flow.update(handle, "synthetic-password"); await started.promise; await h.activate("B");
  const before = h.storage.get(h.storageKey), index = h.events.length; release.resolve(json(h.user("A"))); const result = await update;
  assert.equal(result.ok, true); if (!result.ok) return; assert.equal(result.completion.passwordChanged, true); assert.equal(result.mayPublish, false);
  assert.equal(h.flow.canPublish(handle), false); assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false);
  assert.equal(h.requests.find((entry) => entry.path.includes("/logout"))?.authorization, `Bearer ${h.jwt("A")}`);
});
for (const scope of ["global", "local"] as const) {
  test(`original SDK shared ${scope} logout reproduces delayed A removal of B (unsafe baseline)`, async (t) => {
    const h = harness(t); await h.activate("A"); const started = deferred<void>(), release = deferred<Response>();
    h.hooks.logout = async () => { started.resolve(); return release.promise; }; const logout = h.shared.auth.signOut({ scope }); await started.promise; await h.activate("B");
    assert.ok(h.storage.has(h.storageKey)); release.resolve(new Response(null, { status: 204 })); await logout;
    assert.equal(h.storage.has(h.storageKey), false); assert.ok(h.events.includes("SIGNED_OUT")); assert.equal(h.requests.find((entry) => entry.path.includes("/logout"))?.authorization, `Bearer ${h.jwt("A")}`);
  });
}
test("delayed isolated global revocation preserves B storage and events", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.logout = async () => { started.resolve(); return release.promise; }; const update = h.flow.update(handle, "synthetic-password"); await started.promise; await h.activate("B");
  const before = h.storage.get(h.storageKey), index = h.events.length; release.resolve(new Response(null, { status: 204 })); const result = await update;
  assert.equal(result.ok, true); if (!result.ok) return; assert.equal(result.mayPublish, false); assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false);
});
test("missing memory context/reload cannot use stored marker or shared B as password authority", async (t) => {
  const h = harness(t); await h.activate("B"); h.setMarker({ userId: ids.A }); assert.equal(h.flow.context(), null);
  assert.equal(await h.flow.validate({ userId: ids.A }), false); assert.equal((await h.flow.update({ userId: ids.A }, "synthetic-password")).ok, false); assert.equal(await h.flow.leave({ userId: ids.A }), false);
  assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/logout")), false);
});
for (const marker of [null, { userId: ids.B }]) {
  test(`missing/mismatched marker fails closed without logout (${marker?.userId ?? "missing"})`, async (t) => {
    const h = harness(t); await h.activate("A"); const handle = await h.verified(); h.setMarker(marker);
    assert.equal(await h.flow.validate(handle), false); assert.equal((await h.flow.update(handle, "synthetic-password")).ok, false);
    assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/logout")), false);
  });
}
test("expired captured recovery fails closed without refresh or update", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); h.advance(3600_000);
  assert.equal(h.flow.context(), null); assert.equal(await h.flow.validate(handle), false); assert.equal((await h.flow.update(handle, "synthetic-password")).ok, false);
  assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/token")), false);
});
test("A -> B -> A cannot reuse old activation, but repeated same-account events retain valid recovery", async (t) => {
  const h = harness(t); await h.activate("A"); const old = await h.verified(); await h.activate("A"); assert.equal(await h.flow.validate(old), true);
  await h.activate("B"); await h.activate("A"); assert.equal(h.flow.canPublish(old), false); assert.equal((await h.flow.update(old, "synthetic-password")).ok, false);
  const fresh = await h.verified(); assert.notEqual(fresh, old); assert.equal((await h.flow.update(fresh, "synthetic-password")).ok, true);
});
test("unmount cancels publication, while already-confirmed updates remain confirmed", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); let mounted = true;
  const started = deferred<void>(), release = deferred<Response>(); h.hooks.update = async () => { started.resolve(); return release.promise; };
  const update = h.flow.update(handle, "synthetic-password", () => mounted); await started.promise; mounted = false; release.resolve(json(h.user("A"))); const result = await update;
  assert.equal(result.ok, true); if (!result.ok) return; assert.equal(result.mayPublish, false); assert.equal(h.flow.canPublish(handle), false);
});
for (const during of [false, true]) {
  test(`another SDK client replacing shared storage is preserved (${during ? "during update" : "before dispatch"})`, async (t) => {
    const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
    if (during) h.hooks.update = async () => { started.resolve(); return release.promise; };
    const update = during ? h.flow.update(handle, "synthetic-password") : null; if (during) await started.promise;
    await h.activate("B", h.peer()); const before = h.storage.get(h.storageKey), index = h.events.length;
    if (during) release.resolve(json(h.user("A")));
    const result = await (update ?? h.flow.update(handle, "synthetic-password")); assert.equal(result.ok, during);
    if (result.ok) assert.equal(result.mayPublish, false);
    assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, during ? 1 : 0);
    assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false);
    assert.equal((await h.shared.auth.getSession()).data.session?.user.id, ids.B);
  });
}
test("revocation failure cannot undo confirmed password change or allow a second update", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); h.hooks.logout = async () => json({ code: "unexpected_failure", message: "private detail" }, 500);
  const result = await h.flow.update(handle, "synthetic-password"); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.completion.revocation, "uncertain"); assert.equal(result.completion.passwordChanged, true);
  assert.equal((await h.flow.update(handle, "second-password")).ok, false); assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
});
test("lost update response is UNKNOWN and cannot automatically or manually re-dispatch", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); h.hooks.update = async () => { throw new Error("synthetic lost response"); };
  const originalConsoleError = console.error; console.error = () => {};
  try { const result = await h.flow.update(handle, "synthetic-password"); assert.equal(result.ok, false); assert.ok("unknown" in result);
    assert.equal((await h.flow.update(handle, "second-password")).ok, false); assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
    assert.equal(h.requests.some((entry) => entry.path.includes("/logout")), false);
  } finally { console.error = originalConsoleError; }
});
test("explicit password rejection retains generic message and permits correction, not automatic retry", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); h.hooks.update = async () => json({ code: "weak_password", message: "private detail" }, 422);
  assert.deepEqual(await h.flow.update(handle, "rejected-password"), { ok: false, message: ATLAS_UI_STRINGS.auth.passwordUpdateError });
  assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1); delete h.hooks.update;
  assert.equal((await h.flow.update(handle, "synthetic-password")).ok, true); assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 2);
});
test("synchronous service latch rejects duplicates before async work finishes", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.update = async () => { started.resolve(); return release.promise; }; const update = h.flow.update(handle, "synthetic-password"); await started.promise;
  assert.equal((await h.flow.update(handle, "second-password")).ok, false); release.resolve(json(h.user("A"))); assert.equal((await update).ok, true);
  assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
});
for (const status of [401, 403, 404]) {
  test(`SDK-ignored logout HTTP ${status} must not be reported as confirmed revocation`, async (t) => {
    const h = harness(t); await h.activate("A"); const handle = await h.verified();
    h.hooks.logout = async () => json({ code: "session_not_found", message: "private detail" }, status);
    const result = await h.flow.update(handle, "synthetic-password"); assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.completion.revocation, "uncertain");
  });
}
test("cross-tab A -> B -> a fresh A session cannot reuse old recovery before event delivery", async (t) => {
  const h = harness(t); await h.activate("A"); const old = await h.verified(); const peer = h.peer(); await h.activate("B", peer);
  const renewed = h.session("A"); const parts = renewed.access_token.split(".");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()); claims.session_id = "synthetic-session-A2";
  parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url"); renewed.access_token = parts.join(".");
  assert.equal((await peer.auth.setSession(renewed)).error, null);
  assert.equal(h.flow.canPublish(old), false); assert.equal((await h.flow.update(old, "synthetic-password")).ok, false);
  assert.equal(h.requests.some((entry) => entry.method === "PUT"), false);
});
test("same-session token replacement does not invalidate legitimate recovery", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const renewed = h.session("A");
  const parts = renewed.access_token.split("."); const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  claims.exp += 600; parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url"); renewed.access_token = parts.join(".");
  assert.equal((await h.shared.auth.setSession(renewed)).error, null);
  assert.equal(await h.flow.validate(handle), true); assert.equal((await h.flow.update(handle, "synthetic-password")).ok, true);
});
test("returned OTP user/session and server-verified token actor must agree", async (t) => {
  const h = harness(t); await h.activate("A"); const before = h.storage.get(h.storageKey);
  h.hooks.verify = async () => json({ ...h.session("A"), access_token: h.jwt("B") });
  assert.equal((await h.flow.verify("person@example.com", "123456")).ok, false);
  assert.equal(h.flow.context(), null); assert.equal(h.storage.get(h.storageKey), before);
  assert.equal(h.requests.some((entry) => entry.method === "PUT"), false);
});
test("near-expiry OTP context fails closed instead of allowing implicit SDK refresh", async (t) => {
  const h = harness(t); h.hooks.verify = async () => json({ ...h.session("A"), expires_at: Math.floor(Date.now() / 1000) + 30 });
  assert.equal((await h.flow.verify("person@example.com", "123456")).ok, false);
  assert.equal(h.requests.some((entry) => entry.path.includes("/token") || entry.method === "PUT"), false);
});
test("OTP page unmount prevents memory handoff and marker publication after a delayed response", async (t) => {
  const h = harness(t); let mounted = true; const started = deferred<void>(), release = deferred<Response>();
  h.hooks.verify = async () => { started.resolve(); return release.promise; };
  const verification = h.flow.verify("person@example.com", "123456", () => mounted); await started.promise; mounted = false;
  release.resolve(json(h.session("A"))); assert.equal((await verification).ok, false); assert.equal(h.flow.context(), null);
});
test("late INITIAL_SESSION cannot overwrite a newer account-switch ownership event", async (t) => {
  const h = harness(t); let listener!: (event: AuthChangeEvent, session: Session | null) => void | Promise<void>;
  let dispatches = 0;
  // Controlled event source drives the production lifetime code; other tests
  // above use real SDK event delivery and actual shared storage adapters.
  const flow = createRecoveryFlow({ sharedAuth: { onAuthStateChange(callback) { listener = callback; return { data: { subscription: { id: "synthetic", callback, unsubscribe() {} } } }; } },
    url: "https://auth.example.invalid", key: "synthetic-public-key", readMarker: () => null, saveMarker() {}, clearMarker() {},
    readSharedIdentity: () => recoverySharedIdentity(h.session("B")),
    fetch: async () => { dispatches += 1; return json(h.session("A")); },
  });
  t.after(() => flow.stop());
  listener("SIGNED_IN", h.session("B")); listener("INITIAL_SESSION", h.session("A"));
  // A recovery under B must fail once returned actor A is known, but the
  // initial request may start only because current ownership remains B.
  const result = await flow.verify("person@example.com", "123456");
  assert.equal(result.ok, false);
  assert.equal(dispatches, 1);
});
test("recovery exit is isolated and cannot publish navigation after B replaces A", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const started = deferred<void>(), release = deferred<Response>();
  h.hooks.logout = async () => { started.resolve(); return release.promise; };
  const exit = h.flow.leave(handle); await started.promise;
  assert.equal((await h.flow.update(handle, "synthetic-password")).ok, false);
  await h.activate("B"); const before = h.storage.get(h.storageKey), index = h.events.length;
  release.resolve(new Response(null, { status: 204 })); assert.equal(await exit, false);
  assert.equal(h.flow.canPublish(handle), false); assert.equal(h.storage.get(h.storageKey), before);
  assert.equal(h.events.slice(index).includes("SIGNED_OUT"), false); assert.equal(h.requests.some((entry) => entry.method === "PUT"), false);
});
test("invalid successful update response remains UNKNOWN without success, revocation or duplicate dispatch", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); h.hooks.update = async () => json(h.user("B"));
  const result = await h.flow.update(handle, "synthetic-password"); assert.equal(result.ok, false); assert.ok("unknown" in result);
  assert.equal((await h.flow.update(handle, "second-password")).ok, false);
  assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1); assert.equal(h.requests.some((entry) => entry.path.includes("/logout")), false);
});
test("email-send callback ownership is invalidated by account switch or page unmount", async (t) => {
  const h = harness(t); await h.activate("A"); let mounted = true; const active = await h.flow.captureAction(() => mounted);
  assert.equal(active(), true); await h.activate("A"); assert.equal(active(), true);
  await h.activate("B"); assert.equal(active(), false); await h.activate("A"); assert.equal(active(), false);
  const fresh = await h.flow.captureAction(() => mounted); assert.equal(fresh(), true); mounted = false; assert.equal(fresh(), false);
});

test("effect cleanup preserves recovery activation but cancels the first validation", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); let firstActive = true;
  const started = deferred<void>(), release = deferred<Response>(); let reads = 0;
  h.hooks.get = async () => { if (++reads === 1) { started.resolve(); return release.promise; } };
  const first = h.flow.validate(handle, () => firstActive); await started.promise; firstActive = false;
  assert.equal(h.flow.context(), handle);
  assert.equal(await h.flow.validate(handle, () => true), true);
  release.resolve(json(h.user("A"))); assert.equal(await first, false);
  delete h.hooks.get;
  assert.equal((await h.flow.update(handle, "synthetic-password")).ok, true);
  assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
  assert.equal(h.requests.find((entry) => entry.method === "PUT")?.authorization, `Bearer ${h.jwt("A")}`);
});

test("concurrent validation cannot authorize a cancelled submitting operation", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); let submitting = true;
  const started = deferred<void>(), release = deferred<Response>(); let reads = 0;
  h.hooks.get = async () => { if (++reads === 1) { started.resolve(); return release.promise; } };
  const update = h.flow.update(handle, "synthetic-password", () => submitting); await started.promise;
  assert.equal(await h.flow.validate(handle, () => true), true); submitting = false;
  release.resolve(json(h.user("A"))); const result = await update;
  assert.equal(result.ok, false);
  assert.ok("mayPublish" in result); assert.equal(result.mayPublish, false);
  assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/logout")), false);
});

test("retiring an older validation cannot cancel a newer authorized update", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); let validating = true;
  const started = deferred<void>(), release = deferred<Response>(); let reads = 0;
  h.hooks.get = async () => { if (++reads === 1) { started.resolve(); return release.promise; } };
  const old = h.flow.validate(handle, () => validating); await started.promise;
  const update = h.flow.update(handle, "synthetic-password"); validating = false;
  const result = await update; assert.equal(result.ok, true); if (result.ok) assert.equal(result.mayPublish, true);
  release.resolve(json(h.user("A"))); assert.equal(await old, false);
  assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
});

for (const outcome of ["success", "unknown", "rejected"] as const) {
  test(`sent attempt survives unmount/remount without duplicate dispatch (${outcome})`, async (t) => {
    const h = harness(t); await h.activate("A"); const handle = await h.verified(); let mounted = true;
    const started = deferred<void>(), release = deferred<Response>();
    h.hooks.update = async () => { started.resolve(); if (outcome === "unknown") { await release.promise; throw new Error("Synthetic lost response"); } return release.promise; };
    const update = h.flow.update(handle, "synthetic-password", () => mounted); await started.promise; mounted = false;
    assert.equal(h.flow.context(), handle); assert.equal(h.flow.state(handle).status, "updating");
    assert.equal(await h.flow.validate(handle, () => true), true);
    assert.equal((await h.flow.update(handle, "second-password")).ok, false);
    release.resolve(outcome === "rejected" ? json({ code: "weak_password", message: "private detail" }, 422) : json(h.user("A")));
    const result = await update;
    assert.equal(h.flow.canPublish(handle), false);
    assert.equal(h.flow.context(), handle);
    assert.equal(h.flow.state(handle).status, outcome === "success" ? "complete" : outcome);
    if (outcome === "success") { assert.equal(result.ok, true); if (result.ok) assert.equal(result.mayPublish, false); assert.equal(h.flow.state(handle).completion?.passwordChanged, true); }
    if (outcome === "unknown") { assert.equal(result.ok, false); assert.ok("unknown" in result); }
    if (outcome !== "rejected") assert.equal((await h.flow.update(handle, "second-password")).ok, false);
    assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 1);
    assert.equal(h.requests.filter((entry) => entry.path.includes("/logout")).length, outcome === "success" ? 1 : 0);
  });
}

for (const replacement of [false, true]) {
  test(`SDK session-load await cannot bypass the final HTTP guard (${replacement ? "account replacement" : "operation cancellation"})`, async (t) => {
    const h = harness(t); await h.activate("A"); const handle = await h.verified(); let submitting = true;
    const started = deferred<void>(), release = deferred<void>();
    // Test-only instrumentation of the installed SDK's actual awaited
    // __loadSession boundary. Its original implementation still executes.
    const prototype = GoTrueClient.prototype as unknown as { __loadSession: (this: GoTrueClient) => Promise<{ data: { session: Session | null }; error: unknown }> };
    const original = prototype.__loadSession; let delayed = false;
    const instrument = t.mock.method(prototype, "__loadSession", async function (this: GoTrueClient) {
      const result = await original.call(this);
      if (!delayed && result.data.session?.access_token === h.jwt("A")) { delayed = true; started.resolve(); await release.promise; }
      return result;
    });
    const update = h.flow.update(handle, "synthetic-password", () => submitting); await started.promise;
    if (replacement) await h.activate("B"); else submitting = false;
    release.resolve(); const result = await update; instrument.mock.restore();
    assert.equal(result.ok, false);
    assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/logout")), false);
    assert.equal(h.flow.canPublish(handle), false);
    assert.equal(h.flow.state(handle).status, replacement ? "unavailable" : "ready");
    assert.equal("unknown" in result, false); assert.ok("mayPublish" in result); assert.equal(result.mayPublish, false);
  });
}

test("a cancelled operation cannot become active when its supplied predicate flips back", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); let submitting = true;
  const started = deferred<void>(), release = deferred<Response>(); h.hooks.update = async () => { started.resolve(); return release.promise; };
  const update = h.flow.update(handle, "synthetic-password", () => submitting); await started.promise;
  submitting = false; assert.equal(h.flow.canPublish(handle), false); submitting = true;
  release.resolve(json(h.user("A"))); const result = await update;
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.mayPublish, false);
  assert.equal(h.flow.canPublish(handle), false);
});

test("new recovery supersedes old operations without reusing their handle", async (t) => {
  const h = harness(t); await h.activate("A"); const old = await h.verified();
  const fresh = await h.verified(); assert.notEqual(old, fresh);
  assert.equal(await h.flow.validate(old), false); assert.equal((await h.flow.update(old, "synthetic-password")).ok, false);
  assert.equal(h.flow.canPublish(old), false); assert.equal(h.flow.context(), fresh);
});

test("explicit recovery termination removes write authority without shared logout", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified(); const before = h.storage.get(h.storageKey);
  assert.equal(await h.flow.leave(handle), true); assert.equal(h.flow.context(), null);
  assert.equal(await h.flow.validate(handle), false); assert.equal((await h.flow.update(handle, "synthetic-password")).ok, false);
  assert.equal(h.storage.get(h.storageKey), before); assert.equal(h.requests.filter((entry) => entry.method === "PUT").length, 0);
});

test("server-invalid recovery credentials cannot be revived by a later validation", async (t) => {
  const h = harness(t); await h.activate("A"); const handle = await h.verified();
  h.hooks.get = async () => json({ code: "session_not_found", message: "private detail" }, 400);
  assert.equal(await h.flow.validate(handle), false); delete h.hooks.get;
  assert.equal(h.flow.context(), null); assert.equal(await h.flow.validate(handle), false);
  assert.equal((await h.flow.update(handle, "synthetic-password")).ok, false);
  assert.equal(h.requests.some((entry) => entry.method === "PUT" || entry.path.includes("/logout")), false);
});
