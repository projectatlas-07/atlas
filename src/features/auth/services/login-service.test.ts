import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { navigationHarness, sdkFacade, identities, jsonResponse, syntheticSession, deferred } from "./auth-navigation-test-support.ts";
import { createAuthNavigationScope } from "./auth-navigation.ts";
import { createAccountCoordinator } from "./account-activation.ts";

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: sdkFacade } });
const { loginWithPassword, resolvePostLoginDestination } = await import("./login-service.ts");
const credentials = { email: "a@example.invalid", password: "synthetic-password" };
const reads = (h: Awaited<ReturnType<typeof navigationHarness>>) => h.requests.filter(row => row.path.endsWith("/user") || row.path.includes("/rpc/"));

test("email and password login calls Supabase then routes an active factory user to Office", async t => {
  const h = await navigationHarness(t), operation = h.scope.begin();
  const result = await loginWithPassword(credentials, operation, h.connection);
  assert.equal(result.ok, true); assert.equal(result.kind, "authorized");
  if (result.ok) { assert.equal(result.destination, "/office"); assert.equal(result.needsOnboarding, false); assert.equal(result.actorId, identities.A); }
  assert.equal(h.requests.filter(row => row.path.endsWith("/token")).length, 1);
  assert.deepEqual(h.requests[0].body, { ...credentials, gotrue_meta_security: {} });
  assert.equal(reads(h).length, 2); assert.equal(operation.canPublish(result), true);
  assert.ok(h.events.includes("SIGNED_IN:A"));
});
test("Supabase credential errors become one generic Atlas message", async t => {
  const h = await navigationHarness(t); h.hooks.login = async () => jsonResponse({ code: "invalid_credentials", message: "Private provider detail" }, 400);
  const result = await loginWithPassword(credentials, h.scope.begin(), h.connection);
  assert.deepEqual(result, { ok: false, kind: "invalid_credentials", message: "Email or password is incorrect." });
  assert.equal(reads(h).length, 0); assert.equal(h.requests.some(row => row.path.endsWith("/logout")), false);
  assert.doesNotMatch(JSON.stringify(result), /Private provider/);
});
test("a signed-in user without factory membership routes to onboarding only after verification", async t => {
  const h = await navigationHarness(t); h.hooks.rpc = async () => jsonResponse([{ status: "none", factory_id: null }]);
  const operation = h.scope.begin(), result = await loginWithPassword(credentials, operation, h.connection);
  assert.equal(result.kind, "no_factory"); assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.destination, "/onboarding");
  assert.equal(h.coordinator.getSnapshot().status, "verified"); assert.equal(operation.canPublish(result), true);
});
test("existing signed-in users resolve through captured authoritative membership flow", async t => {
  const h = await navigationHarness(t); await h.activate("A"); h.requests.length = 0;
  const operation = h.scope.begin(), result = await resolvePostLoginDestination(operation, h.connection);
  assert.equal(result.kind, "authorized"); assert.equal(operation.canPublish(result), true);
  assert.equal(reads(h).length, 2); assert.equal(h.requests.some(row => row.path.endsWith("/token")), false);
});
test("factory-resolution failures expose no backend details", async t => {
  const h = await navigationHarness(t); await h.activate("A"); h.hooks.rpc = async () => jsonResponse({ code: "XX000", message: "relation factory_users failed" }, 500);
  const operation = h.scope.begin(), result = await resolvePostLoginDestination(operation, h.connection);
  assert.equal(result.kind, "request_error"); assert.equal(result.ok, false); assert.equal(operation.canPublish(result), true);
  assert.doesNotMatch(JSON.stringify(result), /factory_users/);
});
for (const restored of [false, true]) test(`delayed A factory result cannot publish under ${restored ? "A2" : "B"}`, async t => {
  const h = await navigationHarness(t); await h.activate("A");
  const entered = deferred<void>(), release = deferred<Response>();
  h.hooks.rpc = () => { entered.resolve(); return release.promise; };
  const operation = h.scope.begin(), pending = resolvePostLoginDestination(operation, h.connection); await entered.promise;
  await h.activate("B"); if (restored) await h.activate("A");
  release.resolve(jsonResponse([{ status: "active", factory_id: identities.factory }]));
  const result = await pending; assert.equal(result.kind, "superseded"); assert.equal(operation.canPublish(result), false);
});
test("delayed Login A response cannot resolve B or navigate; KNOWN-OPEN SDK installation still replaces B", async t => {
  const h = await navigationHarness(t), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.login = actor => actor === "A" ? (entered.resolve(), release.promise) : Promise.resolve(jsonResponse(syntheticSession("B")));
  const operation = h.scope.begin(), pending = loginWithPassword(credentials, operation, h.connection); await entered.promise;
  await h.client.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic-password" });
  assert.equal(h.coordinator.capture()?.activation.actorId, identities.B);
  release.resolve(jsonResponse(syntheticSession("A")));
  const result = await pending;
  assert.equal(result.kind, "superseded"); assert.equal(operation.canPublish(result), false); assert.equal(reads(h).length, 0);
  assert.equal(h.coordinator.capture()?.activation.actorId, identities.A, "KNOWN-OPEN: late SDK session installation is not fixed");
  assert.deepEqual(h.events.filter(event => event.startsWith("SIGNED_IN")), ["SIGNED_IN:B", "SIGNED_IN:A"]);
});
test("inactive membership is restricted, never onboarding or Office", async t => {
  const h = await navigationHarness(t); await h.activate("A"); h.hooks.rpc = async () => jsonResponse([{ status: "inactive", factory_id: null }]);
  const result = await resolvePostLoginDestination(h.scope.begin(), h.connection);
  assert.equal(result.kind, "inactive"); assert.equal(result.ok, false); assert.equal("destination" in result, false);
});
test("definitive account rejection remains definitive on later Login checks without logout or retry dispatch", async t => {
  const h = await navigationHarness(t); await h.activate("A");
  h.hooks.user = async () => jsonResponse({ code: "bad_jwt", message: "Synthetic invalid JWT" }, 401);
  const first = await resolvePostLoginDestination(h.scope.begin(), h.connection);
  assert.equal(first.kind, "authentication_failed"); const before = h.requests.length;
  const later = await resolvePostLoginDestination(h.scope.begin(), h.connection);
  assert.equal(later.kind, "authentication_failed"); assert.equal(h.requests.length, before);
  assert.equal(h.events.includes("SIGNED_OUT:none"), false); assert.equal("destination" in later, false);
});
test("unmount/Strict Mode replay cancels old publication while a fresh operation succeeds", async t => {
  const h = await navigationHarness(t); await h.activate("A");
  const entered = deferred<void>(), release = deferred<Response>();
  h.hooks.rpc = () => { entered.resolve(); return release.promise; };
  const old = h.scope.begin(), pending = resolvePostLoginDestination(old, h.connection); await entered.promise;
  h.scope.cancel(); h.hooks.rpc = undefined;
  h.scope.activate();
  const fresh = h.scope.begin(), result = await resolvePostLoginDestination(fresh, h.connection);
  release.resolve(jsonResponse([{ status: "none", factory_id: null }]));
  assert.equal((await pending).kind, "superseded"); assert.equal(fresh.canPublish(result), true); assert.equal(old.canPublish(result), false);
});
test("a delayed form callback after unmount cannot restart the scope or dispatch Login", async t => {
  const h = await navigationHarness(t); h.scope.cancel();
  const result = await loginWithPassword(credentials, h.scope.begin(), h.connection);
  assert.equal(result.kind, "superseded"); assert.equal(h.requests.length, 0);
  h.scope.activate(); const current = await loginWithPassword(credentials, h.scope.begin(), h.connection);
  assert.equal(current.kind, "authorized");
});
test("same-session refresh preserves activation-level results but rejects obsolete credential work", async t => {
  const h = await navigationHarness(t); await h.activate("A");
  const operation = h.scope.begin(), result = await resolvePostLoginDestination(operation, h.connection);
  const activation = h.coordinator.getSnapshot().activation;
  await h.refresh(); assert.equal(h.coordinator.capture()?.activation, activation);
  assert.equal(operation.canPublish(result), false, "new credential still needs verification, not logout");
  const fresh = await resolvePostLoginDestination(h.scope.begin(), h.connection);
  assert.equal(fresh.kind, "authorized"); assert.equal(h.events.includes("SIGNED_OUT:none"), false);
});
test("explicit retry respects cooldown, cap, old rendered identity and sends no retired requests", async t => {
  const h = await navigationHarness(t); await h.activate("A");
  h.hooks.user = async () => jsonResponse({ message: "Synthetic outage" }, 503);
  let result = await resolvePostLoginDestination(h.scope.begin(), h.connection); assert.equal(result.kind, "request_error");
  for (let attempt = 1; attempt <= 3; attempt++) {
    let snapshot = h.coordinator.getSnapshot();
    const before = reads(h).length;
    assert.equal((await resolvePostLoginDestination(h.scope.begin(), h.connection, snapshot)).kind, "uncertain"); assert.equal(reads(h).length, before);
    h.advance(5000); snapshot = h.coordinator.getSnapshot();
    result = await resolvePostLoginDestination(h.scope.begin(), h.connection, snapshot);
    assert.equal(result.kind, "request_error"); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, attempt);
  }
  const snapshot = h.coordinator.getSnapshot(), before = reads(h).length;
  h.advance(5000); assert.equal((await resolvePostLoginDestination(h.scope.begin(), h.connection, snapshot)).kind, "uncertain"); assert.equal(reads(h).length, before);
  h.hooks.user = undefined; await h.activate("B"); const switched = reads(h).length;
  assert.equal((await resolvePostLoginDestination(h.scope.begin(), h.connection, snapshot)).kind, "superseded"); assert.equal(reads(h).length, switched);
});
test("bounded coordinator observation times out without factory access and is cancellable", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let callback: unknown;
  const coordinator = createAccountCoordinator({ onAuthStateChange(listener) { callback = listener; return { data: { subscription: { unsubscribe() {} } } } as ReturnType<Parameters<typeof createAccountCoordinator>[0]["onAuthStateChange"]>; } }, { readSession: () => null });
  const scope = createAuthNavigationScope(coordinator); t.after(() => { scope.cancel(); coordinator.stop(); });
  const operation = scope.begin(), pending = operation.observeExpectedSession(syntheticSession());
  t.mock.timers.tick(2000); assert.equal(await pending, null); assert.equal(coordinator.capture(), null);
  const fresh = scope.begin(), cancelled = fresh.observeExpectedSession(syntheticSession()); scope.cancel(); assert.equal(await cancelled, null);
  assert.equal(typeof callback, "function");
});
test("SDK SIGNED_IN is observed before sign-in returns; current activation alone is never factory proof", async t => {
  const h = await navigationHarness(t), operation = h.scope.begin();
  const { data } = await h.client.auth.signInWithPassword(credentials);
  assert.equal(h.coordinator.getSnapshot().status, "pending_verification");
  const capture = await operation.observeExpectedSession(data.session); assert.ok(capture);
  assert.equal(h.requests.filter(row => row.path.includes("/rpc/")).length, 0);
});

// Execute the actual Login publication callback with its real operation guard.
function loginPublication(context: Record<string, unknown>) {
  const source = ts.createSourceFile("login.tsx", readFileSync(new URL("../../../app/login/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "followDestination" && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0]; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found);
  const js = ts.transpileModule(`const handler = ${found.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${js}\nreturn handler;`)(...Object.values(context)) as (result: Awaited<ReturnType<typeof resolvePostLoginDestination>>, operation: ReturnType<ReturnType<typeof createAuthNavigationScope>["begin"]>) => void;
}
test("actual Login navigation callback rejects a result superseded immediately before publication", async t => {
  const h = await navigationHarness(t); await h.activate("A"); const operation = h.scope.begin(), result = await resolvePostLoginDestination(operation, h.connection);
  const navigations: string[] = [], publications: unknown[] = [];
  const follow = loginPublication({ setAccess: (value: unknown) => publications.push(value), setAuthenticationError: () => {}, setIsRedirecting: () => {}, router: { replace: (path: string) => navigations.push(path), refresh() {} } });
  await h.activate("B"); follow(result, operation); assert.deepEqual(navigations, []); assert.deepEqual(publications, []);
});
test("A verification finishing after B cannot request factory access or publish", async t => {
  const h = await navigationHarness(t), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.user = actor => actor === "A" ? (entered.resolve(), release.promise) : Promise.resolve(jsonResponse(syntheticSession("B").user));
  const operation = h.scope.begin(), pending = loginWithPassword(credentials, operation, h.connection); await entered.promise;
  await h.activate("B"); const before = h.storage.get(h.key);
  release.resolve(jsonResponse(syntheticSession().user)); const result = await pending;
  assert.equal(result.kind, "superseded"); assert.equal(operation.canPublish(result), false);
  assert.equal(h.requests.some(row => row.path.includes("/rpc/")), false); assert.equal(h.storage.get(h.key), before);
});
test("existing-session resolution captures A before its first await and cannot substitute B", async t => {
  const h = await navigationHarness(t); await h.activate("A");
  const operation = h.scope.begin(); await h.activate("B"); const count = h.requests.length;
  const result = await resolvePostLoginDestination(operation, h.connection);
  assert.equal(result.kind, "superseded"); assert.equal(h.requests.length, count);
});
test("Login with a returned session but no observed coordinator event remains uncertain after bounded wait", async t => {
  const h = await navigationHarness(t); t.mock.timers.enable({ apis: ["setTimeout"] });
  const coordinator = createAccountCoordinator({ onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } as ReturnType<Parameters<typeof createAccountCoordinator>[0]["onAuthStateChange"]>; } }, { readSession: () => h.storage.get(h.key) ?? null });
  const scope = createAuthNavigationScope(coordinator); t.after(() => { scope.cancel(); coordinator.stop(); });
  const operation = scope.begin(), pending = loginWithPassword(credentials, operation, h.connection);
  await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(2000);
  const result = await pending; assert.equal(result.kind, "uncertain"); assert.equal(result.ok, false);
  assert.equal(h.requests.length, 1); assert.equal(h.requests.some(row => row.path.includes("/rpc/")), false);
});
for (const error of ["request_error", "uncertain"] as const) test(`Login / existing AuthGuard integration: ${error} stays on Login with no redirect or automatic retry loop`, async t => {
  const h = await navigationHarness(t), navigations: string[] = [];
  // Execute unmodified AuthGuard effects with real SDK getSession/subscription.
  // Hook scheduling is controlled here; this is not a mounted React/browser test.
  const text = readFileSync(new URL("../components/auth-guard.tsx", import.meta.url), "utf8").replace(/export function AuthGuard/, "function AuthGuard");
  const declarations = text.slice(text.indexOf("function AuthGuard"));
  const js = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;$/gm, "");
  let state = "loading", effectIndex = 0;
  const effects: (() => void | (() => void))[] = [], dependencies: unknown[][] = [];
  const guardRouter = { replace: (path: string) => navigations.push(path) };
  const guard = new Function("useState", "useEffect", "useRouter", "readPendingRecoverySession", "supabase", "_jsx", `${js}\nreturn AuthGuard;`)(
    () => [state, (value: string) => { state = value; }], (effect: () => void, deps: unknown[]) => {
      const index = effectIndex++, previous = dependencies[index];
      if (!previous || previous.some((value, offset) => value !== deps[offset])) effects.push(effect);
      dependencies[index] = deps;
    }, () => guardRouter, () => null, h.client, () => null,
  );
  guard({ children: null }); const cleanups = effects.splice(0).map(effect => effect());
  await new Promise(resolve => setImmediate(resolve)); effectIndex = 0; guard({ children: null }); effects.splice(0).forEach(effect => effect());
  assert.ok(navigations.includes("/login")); cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); });
  await h.activate("A"); h.hooks.user = async () => jsonResponse({ message: "Synthetic outage" }, 503);
  const operation = h.scope.begin();
  const result = error === "request_error" ? await resolvePostLoginDestination(operation, h.connection)
    : await resolvePostLoginDestination(operation, h.connection, (await resolvePostLoginDestination(operation, h.connection), h.coordinator.getSnapshot()));
  assert.equal(result.kind, error); assert.equal(result.ok, false);
  let visible = "";
  const follow = loginPublication({ setAccess() {}, setAuthenticationError: (value: string) => { visible = value; }, setIsRedirecting() {}, router: { replace: (path: string) => navigations.push(path), refresh() {} } });
  follow(result, operation); assert.ok(visible); assert.equal(navigations.includes("/office"), false); assert.equal(navigations.includes("/onboarding"), false);
  const before = h.requests.length; await new Promise(resolve => setImmediate(resolve)); assert.equal(h.requests.length, before);
  assert.equal(h.coordinator.getVerificationRetryState().status, "cooldown");
});
