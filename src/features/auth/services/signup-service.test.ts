import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { signupFormSchema } from "./signup-validation.ts";
import { AUTH_EMAIL_OTP_LENGTH } from "./auth-config.ts";
import { navigationHarness, sdkFacade, jsonResponse, syntheticSession, deferred, productionFunction } from "./auth-navigation-test-support.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import { createAuthNavigationScope, type AuthNavigationOperation, type AuthDestinationResult } from "./auth-navigation.ts";

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: sdkFacade } });
const { formatResendCountdown, nextResendCountdown, normalizeSignupOtp, resendSignupOtp, signupWithPassword, verifySignupOtp } = await import("./signup-service.ts");
const { resolvePostLoginDestination } = await import("./login-service.ts");
const credentials = { email: "a@example.invalid", password: "synthetic-password" };
test("signup calls Supabase with email and password and accepts the confirmation-required response", async t => {
  const h = await navigationHarness(t), operation = h.scope.begin();
  const result = await signupWithPassword(credentials, operation);
  assert.deepEqual(result, { ok: true, kind: "verification_required" });
  assert.deepEqual(h.requests[0].body, { ...credentials, data: {}, gotrue_meta_security: {}, code_challenge: null, code_challenge_method: null });
  assert.equal(operation.canPublish(result), true);
  assert.equal(h.coordinator.getSnapshot().status, "signed_out");
  assert.equal(h.requests.some(row => row.path.includes("/rpc/") || row.path.endsWith("/user")), false);
});
test("known existing-email responses use the same accepted result without enumeration", async t => {
  const h = await navigationHarness(t); h.hooks.signup = async () => jsonResponse({ code: "user_already_exists", message: "Private provider detail" }, 400);
  const result = await signupWithPassword(credentials, h.scope.begin());
  assert.deepEqual(result, { ok: true, kind: "verification_required" });
  assert.doesNotMatch(JSON.stringify(result), /exist|registered|Private/);
});
test("an unexpected signup session remains a configuration mismatch without shared logout cleanup", async t => {
  const h = await navigationHarness(t); h.hooks.signup = async () => jsonResponse(syntheticSession());
  const operation = h.scope.begin(), result = await signupWithPassword(credentials, operation);
  assert.deepEqual(result, { ok: false, kind: "configuration_error", reason: "configuration", message: "Email verification is unavailable. Please contact support." });
  assert.equal(operation.canPublish(result), true); assert.equal(h.requests.length, 1);
  assert.equal(h.requests.some(row => row.path.endsWith("/logout") || row.path.includes("/rpc/")), false);
});
test("verification sends the signup OTP, validates the user, and routes a factory member to Office", async t => {
  const h = await navigationHarness(t), operation = h.scope.begin();
  const result = await verifySignupOtp("a@example.invalid", "123456", operation, h.connection);
  assert.equal(result.kind, "authorized"); assert.equal(result.ok, true); assert.equal(result.otpAccepted, true);
  if (result.ok) assert.equal(result.destination, "/office");
  assert.equal(operation.canPublish(result), true);
  assert.deepEqual(h.requests.map(row => row.path), ["/auth/v1/verify", "/auth/v1/user", "/rest/v1/rpc/resolve_factory_access"]);
  assert.equal(h.requests[0].body?.type, "signup"); assert.equal(h.requests[0].body?.token, "123456");
});
test("a verified user without factory membership routes to onboarding", async t => {
  const h = await navigationHarness(t); h.hooks.rpc = async () => jsonResponse([{ status: "none", factory_id: null }]);
  const result = await verifySignupOtp("a@example.invalid", "123456", h.scope.begin(), h.connection);
  assert.equal(result.kind, "no_factory"); assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.destination, "/onboarding");
});
test("wrong or expired OTP returns one stable message and stops before identity resolution", async t => {
  const h = await navigationHarness(t); h.hooks.otp = async () => jsonResponse({ code: "otp_expired", message: "Private token detail" }, 403);
  const result = await verifySignupOtp("a@example.invalid", "000000", h.scope.begin(), h.connection);
  assert.deepEqual(result, { ok: false, kind: "otp", message: "The code is incorrect or has expired." });
  assert.equal(h.requests.length, 1);
});
test("resend is explicit and uses the Supabase signup resend type", async t => {
  const h = await navigationHarness(t), result = await resendSignupOtp("a@example.invalid");
  assert.deepEqual(result, { ok: true }); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body?.type, "signup"); assert.equal(h.requests[0].body?.email, "a@example.invalid");
});
test("OTP normalization and resend countdown remain configurable and deterministic", () => {
  assert.equal(AUTH_EMAIL_OTP_LENGTH, 6); assert.equal(normalizeSignupOtp("12 3a456789"), "123456");
  assert.equal(normalizeSignupOtp("123456", 4), "1234"); assert.equal(nextResendCountdown(1), 0);
  assert.equal(nextResendCountdown(0), 0); assert.equal(formatResendCountdown(60), "1:00"); assert.equal(formatResendCountdown(9), "0:09");
});
for (const status of ["inactive", "request_error"] as const) test(`OTP handoff cannot authorize or onboard on ${status}`, async t => {
  const h = await navigationHarness(t);
  h.hooks.rpc = async () => status === "inactive" ? jsonResponse([{ status, factory_id: null }]) : jsonResponse({ code: "XX000", message: "Private DB detail" }, 500);
  const result = await verifySignupOtp("a@example.invalid", "123456", h.scope.begin(), h.connection);
  assert.equal(result.kind, status); assert.equal(result.ok, false); assert.equal("destination" in result, false);
});
test("Signup null-session response after account replacement cannot publish pending-email handoff", async t => {
  const h = await navigationHarness(t), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.signup = () => { entered.resolve(); return release.promise; };
  const operation = h.scope.begin(), pending = signupWithPassword(credentials, operation); await entered.promise;
  await h.activate("B"); release.resolve(jsonResponse({ id: syntheticSession().user.id }));
  const result = await pending; assert.equal(result.kind, "superseded"); assert.equal(operation.canPublish(result), false);
  assert.equal(h.requests.some(row => row.path.includes("/rpc/")), false);
});
test("late Signup OTP factory completion cannot publish after B or component unmount", async t => {
  const h = await navigationHarness(t), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.rpc = () => { entered.resolve(); return release.promise; };
  const operation = h.scope.begin(), pending = verifySignupOtp("a@example.invalid", "123456", operation, h.connection); await entered.promise;
  await h.activate("B"); h.scope.cancel(); release.resolve(jsonResponse([{ status: "none", factory_id: null }]));
  const result = await pending; assert.equal(result.kind, "superseded"); assert.equal(operation.canPublish(result), false);
});
test("accepted OTP followed by verification outage retries only reads, never the OTP or Signup request", async t => {
  const h = await navigationHarness(t); h.hooks.user = async () => jsonResponse({ message: "Synthetic outage" }, 503);
  const result = await verifySignupOtp("a@example.invalid", "123456", h.scope.begin(), h.connection);
  assert.equal(result.kind, "request_error"); assert.equal(result.otpAccepted, true);
  h.advance(5000); h.hooks.user = undefined;
  const recovered = await resolvePostLoginDestination(h.scope.begin(), h.connection, h.coordinator.getSnapshot());
  assert.equal(recovered.kind, "authorized"); assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
  assert.equal(h.requests.some(row => row.path.endsWith("/signup")), false);
});

// Production handler execution with injected closure dependencies, not browser QA.
function signupHandler(context: Record<string, unknown>) {
  const source = ts.createSourceFile("signup.tsx", readFileSync(new URL("../../../app/signup/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "createAccount") found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found);
  const js = ts.transpileModule(found.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${js}\nreturn createAccount;`)(...Object.values(context)) as (values: { email: string; password: string; confirmPassword: string }) => Promise<void>;
}
for (const switched of [false, true]) test(`actual Signup null-session handler ${switched ? "discards stale handoff" : "opens existing verification UI"}`, async t => {
  const h = await navigationHarness(t), entered = deferred<void>(), release = deferred<Response>();
  if (switched) h.hooks.signup = () => { entered.resolve(); return release.promise; };
  const paths: string[] = [], emails: string[] = [], publications: unknown[] = [];
  const handler = signupHandler({ scope: h.scope, signupWithPassword, signupFormSchema,
    isCreatingRef: { current: false }, setError() {}, setSignupError() {}, setOutcome: (value: unknown) => publications.push(value),
    savePendingSignupEmail: (email: string) => emails.push(email), markSignupOtpRecentlySent() {}, setIsRedirecting() {},
    router: { push: (path: string) => paths.push(path) }, ATLAS_UI_STRINGS: { auth: { signupError: "Signup unavailable" } } });
  const pending = handler({ ...credentials, confirmPassword: credentials.password });
  if (switched) { await entered.promise; await h.activate("B"); release.resolve(jsonResponse(syntheticSession().user)); }
  await pending;
  assert.deepEqual(paths, switched ? [] : ["/signup/verify"]); assert.deepEqual(emails, switched ? [] : [credentials.email]);
  assert.equal(publications.length, switched ? 0 : 1); assert.equal(h.requests.some(row => row.path.includes("/rpc/")), false);
});

type NavigationHarness = Awaited<ReturnType<typeof navigationHarness>>;
type UiNode = { type?: unknown; props: Record<string, unknown> };
function findUi(tree: unknown, predicate: (node: UiNode) => boolean): UiNode | undefined {
  if (Array.isArray(tree)) return tree.map(node => findUi(node, predicate)).find(Boolean);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return undefined;
  const node = tree as UiNode;
  return predicate(node) ? node : findUi(node.props.children, predicate);
}
function verificationUi(h: NavigationHarness) {
  const path = new URL("../../../app/signup/verify/page.tsx", import.meta.url).pathname;
  const state = { isVerifying: false, isResending: false, isRedirecting: false, otpAccepted: false,
    token: "123456", resendSeconds: 0, verificationError: "", resendFeedback: null as { tone: string; message: string } | null,
    access: undefined as { result: AuthDestinationResult; operation: AuthNavigationOperation } | undefined };
  const refs = { isVerifyingRef: { current: false }, isResendingRef: { current: false }, accessOperationRef: { current: null as AuthNavigationOperation | null } };
  const paths: string[] = [], publications: string[] = [];
  function context(): Record<string, unknown> {
    const ctx: Record<string, unknown> = { ...state, ...refs, scope: h.scope, snapshot: h.coordinator.getSnapshot(), pendingEmail: "a@example.invalid",
      AUTH_EMAIL_OTP_LENGTH, SIGNUP_RESEND_COOLDOWN_SECONDS: 60, ATLAS_UI_STRINGS, formatResendCountdown,
      setIsVerifying: (value: boolean) => { publications.push("isVerifying"); state.isVerifying = value; },
      setIsResending: (value: boolean) => { publications.push("isResending"); state.isResending = value; },
      setIsRedirecting: (value: boolean) => { publications.push("isRedirecting"); state.isRedirecting = value; },
      setOtpAccepted: (value: boolean) => { publications.push("otpAccepted"); state.otpAccepted = value; },
      setAccess: (value: typeof state.access) => { publications.push("access"); state.access = value; },
      setVerificationError: (value: string) => { publications.push("verificationError"); state.verificationError = value; },
      setResendFeedback: (value: typeof state.resendFeedback) => { publications.push("resendFeedback"); state.resendFeedback = value; },
      setToken: (value: string) => { publications.push("token"); state.token = value; },
      setResendSeconds: (value: number) => { publications.push("resendSeconds"); state.resendSeconds = value; },
      clearPendingSignupEmail: () => publications.push("clearPendingSignupEmail"),
      router: { replace: (path: string) => paths.push(path), refresh() {} },
      verifySignupOtp: (email: string, token: string, operation: AuthNavigationOperation) => verifySignupOtp(email, token, operation, h.connection),
      resolvePostLoginDestination: (operation: AuthNavigationOperation, _connection: unknown, snapshot: Parameters<typeof resolvePostLoginDestination>[2]) => resolvePostLoginDestination(operation, h.connection, snapshot),
      resendSignupOtp,
    };
    ctx.followDestination = productionFunction(path, "followDestination", ctx);
    return ctx;
  }
  const invoke = (name: string) => productionFunction<(event?: { preventDefault(): void }) => Promise<void>>(path, name, context())({ preventDefault() {} });
  function render() {
    const currentAccess = state.access && state.access.operation.canPublish(state.access.result) ? state.access.result : undefined;
    const tree = productionFunction<() => UiNode>(path, "VerifySignupEmailPage", { ...context(), currentAccess,
      AuthShell: "AuthShell", AuthAccessFeedback: "AuthAccessFeedback", Feedback: "Feedback", Button: "Button", SignupOtpInput: "SignupOtpInput",
      verifyEmail: () => invoke("verifyEmail"), resendCode: () => invoke("resendCode"), retryAccess: () => invoke("retryAccess"), changeEmail() {},
    }, true)();
    const feedbackNode = findUi(tree, node => node.type === "AuthAccessFeedback"); assert.ok(feedbackNode);
    const feedback = productionFunction<(props: Record<string, unknown>) => UiNode | null>(new URL("../components/auth-access-feedback.tsx", import.meta.url).pathname, "AuthAccessFeedback", {
      useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(), useState: () => [0, () => {}], useEffect() {},
      accountCoordinator: h.coordinator, formatResendCountdown, ATLAS_UI_STRINGS, Button: "Button", Feedback: "Feedback",
    })(feedbackNode.props);
    return { tree, feedback, retryButton: findUi(feedback, node => node.type === "Button"),
      verifyButton: findUi(tree, node => node.type === "Button" && node.props.type === "submit"),
      resendButton: findUi(tree, node => node.type === "Button" && Boolean(node.props.onClick) && node.props.loadingLabel === ATLAS_UI_STRINGS.auth.resendingCode),
      inputFieldset: findUi(tree, node => node.type === "fieldset"), feedbackProps: feedbackNode.props };
  }
  return { state, refs, paths, publications, render, verify: () => invoke("verifyEmail"), resend: () => invoke("resendCode"), retry: () => invoke("retryAccess") };
}
async function acceptedOtpTimeout(t: Parameters<typeof navigationHarness>[0]) {
  const h = await navigationHarness(t, true), ui = verificationUi(h);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = ui.verify(); await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(2000); await pending;
  assert.equal(ui.state.access?.result.kind, "uncertain"); assert.equal(ui.state.otpAccepted, true);
  assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
  return { h, ui };
}
test("accepted OTP timeout recovers through current late activation and one explicit read-only Retry", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); h.releaseActivations();
  assert.equal(h.coordinator.getSnapshot().status, "pending_verification");
  assert.equal(ui.render().retryButton?.props.disabled, false, "Late expected activation must offer read-only Retry");
  assert.equal(ui.render().verifyButton?.props.disabled, true); assert.equal(ui.render().resendButton?.props.disabled, true);
  assert.equal(h.requests.length, 1, "No automatic verification on activation");
  await ui.retry(); assert.deepEqual(ui.paths, ["/office"]);
  assert.deepEqual(h.requests.map(row => row.path), ["/auth/v1/verify", "/auth/v1/user", "/rest/v1/rpc/resolve_factory_access"]);
});
test("pending Resend blocks Verify and clears loading so another legitimate Resend works", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.resend = () => { entered.resolve(); return release.promise; };
  h.hooks.otp = async () => jsonResponse({ code: "otp_expired", message: "Synthetic rejection" }, 403);
  const pending = ui.resend(); await entered.promise;
  const pendingUi = ui.render(); await ui.verify();
  release.resolve(jsonResponse({})); await pending;
  assert.equal(ui.state.isResending, false, "Resend must not remain busy after both handlers finish");
  assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 0, "Verify must not supersede pending Resend");
  assert.equal(pendingUi.verifyButton?.props.disabled, true); assert.equal(pendingUi.inputFieldset?.props.disabled, true);
  h.hooks.resend = undefined; ui.state.resendSeconds = 0; await ui.resend();
  assert.equal(h.requests.filter(row => row.path.endsWith("/resend")).length, 2); assert.equal(ui.state.isResending, false);
});
test("late activation being verified elsewhere never dispatches overlapping verification", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); h.releaseActivations();
  const otherScope = createAuthNavigationScope(h.coordinator); t.after(() => otherScope.cancel());
  const entered = deferred<void>(), release = deferred<Response>(); h.hooks.user = () => { entered.resolve(); return release.promise; };
  const pending = resolvePostLoginDestination(otherScope.begin(), h.connection); await entered.promise;
  assert.equal(ui.render().retryButton, undefined, "Actively verifying has no Retry control");
  const count = h.requests.length; await ui.retry(); assert.equal(h.requests.length, count);
  release.resolve(jsonResponse(syntheticSession().user)); await pending;
  assert.equal(ui.render().retryButton?.props.disabled, false); h.hooks.user = undefined;
  await ui.retry(); assert.deepEqual(ui.paths, ["/office"]);
  assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
});
test("late B activation cannot enable or dispatch Retry for the accepted A OTP", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); await h.activate("B"); h.releaseActivations();
  const count = h.requests.length, stored = h.storage.get(h.key);
  assert.notEqual(ui.render().retryButton?.props.disabled, false); await ui.retry();
  assert.equal(h.requests.length, count); assert.equal(h.storage.get(h.key), stored); assert.deepEqual(ui.paths, []);
});
test("A1 -> B -> A2 after the OTP timeout never revives A1; a fresh UI lifetime can resolve A2", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); h.releaseActivations(); const original = ui.state.access!.operation;
  await h.activate("B"); await h.activate("A"); const count = h.requests.length;
  assert.equal(original.canPublish(ui.state.access!.result), false); await ui.retry(); assert.equal(h.requests.length, count); assert.deepEqual(ui.paths, []);
  const fresh = verificationUi(h); await fresh.retry(); assert.deepEqual(fresh.paths, ["/office"]);
});
test("accepted OTP recovery retains cooldown, three-retry cap and zero automatic authentication writes", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h); h.hooks.user = async () => jsonResponse({ message: "Synthetic outage" }, 503);
  await ui.verify(); assert.equal(ui.state.otpAccepted, true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(ui.render().retryButton?.props.disabled, true); const count = h.requests.length;
    await ui.retry(); assert.equal(h.requests.length, count); h.advance(5000);
    assert.equal(ui.render().retryButton?.props.disabled, false); await ui.retry();
    assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, attempt);
  }
  h.advance(5000); assert.equal(ui.render().retryButton?.props.disabled, true); const count = h.requests.length;
  await ui.retry(); assert.equal(h.requests.length, count);
  assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
  assert.equal(h.requests.filter(row => row.path.endsWith("/user")).length, 4);
  assert.equal(h.requests.some(row => row.path.endsWith("/resend") || row.path.endsWith("/token")), false); assert.deepEqual(ui.paths, []);
});
test("unmount/remount recovery retires old UI without resetting coordinator retry usage", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h); h.hooks.user = async () => jsonResponse({ message: "Synthetic outage" }, 503);
  await ui.verify(); h.advance(5000); await ui.retry(); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 1);
  h.scope.cancel(); const count = h.requests.length; await ui.retry(); assert.equal(h.requests.length, count);
  h.scope.activate(); const fresh = verificationUi(h);
  assert.equal(fresh.render().retryButton?.props.disabled, true); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 1);
  h.advance(5000); await fresh.retry(); assert.equal(h.coordinator.getSnapshot().verification.retriesUsed, 2); assert.deepEqual(ui.paths, []);
});
for (const status of ["none", "inactive"] as const) test(`late OTP recovery maps current ${status} without fabricated authorization`, async t => {
  const { h, ui } = await acceptedOtpTimeout(t); h.releaseActivations(); h.hooks.rpc = async () => jsonResponse([{ status, factory_id: null }]);
  await ui.retry(); assert.deepEqual(ui.paths, status === "none" ? ["/onboarding"] : []);
  assert.equal(ui.state.access!.result.kind, status === "none" ? "no_factory" : "inactive");
  assert.equal(h.coordinator.getSnapshot().status, "verified"); assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
});
test("OTP observation timeout without a later activation shows unavailable feedback, not endless checking", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); const rendered = ui.render();
  const message = findUi(rendered.feedback, node => node.type === "Feedback")?.props.children;
  assert.equal(message, ATLAS_UI_STRINGS.auth.verificationTemporary); assert.equal(rendered.retryButton?.props.disabled, true);
  assert.equal(ui.state.isVerifying, false); assert.deepEqual(ui.paths, []); assert.equal(h.requests.length, 1);
});
test("an initializing coordinator after bounded timeout renders a comprehensible unavailable state", () => {
  const feedback = productionFunction<(props: Record<string, unknown>) => UiNode>(new URL("../components/auth-access-feedback.tsx", import.meta.url).pathname, "AuthAccessFeedback", {
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(), useState: () => [0, () => {}], useEffect() {},
    accountCoordinator: { getSnapshot: () => ({ status: "initializing", verification: { checking: false, availableAt: null } }),
      getVerificationRetryState: () => ({ status: "unavailable" }), capture: () => null },
    formatResendCountdown, ATLAS_UI_STRINGS, Button: "Button", Feedback: "Feedback",
  })({ result: { ok: false, kind: "uncertain", message: ATLAS_UI_STRINGS.auth.workspaceError }, onRetry() {} });
  assert.equal(findUi(feedback, node => node.type === "Feedback")?.props.children, ATLAS_UI_STRINGS.auth.verificationTemporary);
  assert.equal(findUi(feedback, node => node.type === "Button")?.props.disabled, true);
});
test("unmount during read-only recovery prevents late UI publication; remount can safely resolve current ownership", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); h.releaseActivations();
  const entered = deferred<void>(), release = deferred<Response>(); h.hooks.user = () => { entered.resolve(); return release.promise; };
  const pending = ui.retry(); await entered.promise; h.scope.cancel(); const publications = ui.publications.length;
  release.resolve(jsonResponse(syntheticSession().user)); await pending;
  assert.equal(ui.publications.length, publications); assert.deepEqual(ui.paths, []);
  h.hooks.user = undefined; h.scope.activate(); const fresh = verificationUi(h); await fresh.retry(); assert.deepEqual(fresh.paths, ["/office"]);
  assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
});
test("pending Resend blocks read-only Retry without superseding or dispatching any protected reads", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h), entered = deferred<void>(), release = deferred<Response>();
  await h.activate("A"); const count = h.requests.length; h.hooks.resend = () => { entered.resolve(); return release.promise; };
  const pending = ui.resend(); await entered.promise; assert.equal(ui.render().feedbackProps.disabled, true);
  await ui.retry(); assert.equal(h.requests.length, count + 1);
  release.resolve(jsonResponse({})); await pending; assert.equal(ui.state.isResending, false); assert.deepEqual(ui.paths, []);
});
test("pending Verify blocks Resend; wrong OTP still clears loading and permits a later Resend", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.otp = () => { entered.resolve(); return release.promise; };
  const pending = ui.verify(); await entered.promise; assert.equal(ui.render().resendButton?.props.disabled, true);
  await ui.resend(); assert.equal(h.requests.length, 1);
  release.resolve(jsonResponse({ code: "otp_expired", message: "Synthetic rejection" }, 403)); await pending;
  assert.equal(ui.state.isVerifying, false); assert.equal(ui.state.verificationError, ATLAS_UI_STRINGS.auth.otpInvalid);
  await ui.resend(); assert.equal(h.requests.filter(row => row.path.endsWith("/resend")).length, 1); assert.equal(ui.state.isResending, false);
});
test("pending read-only Retry blocks Resend and OTP; one read sequence completes normally", async t => {
  const { h, ui } = await acceptedOtpTimeout(t); h.releaseActivations();
  const entered = deferred<void>(), release = deferred<Response>(); h.hooks.user = () => { entered.resolve(); return release.promise; };
  const pending = ui.retry(); await entered.promise; assert.equal(ui.state.isVerifying, true);
  const rendered = ui.render(); assert.equal(rendered.resendButton?.props.disabled, true); assert.equal(rendered.verifyButton?.props.disabled, true); assert.equal(rendered.inputFieldset?.props.disabled, true);
  const count = h.requests.length; await ui.resend(); await ui.verify(); assert.equal(h.requests.length, count);
  release.resolve(jsonResponse(syntheticSession().user)); await pending;
  assert.equal(ui.state.isVerifying, false); assert.deepEqual(ui.paths, ["/office"]); assert.equal(h.requests.filter(row => row.path.endsWith("/verify")).length, 1);
});
test("Resend failure clears loading and preserves its error; a later legitimate Resend succeeds", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h); h.hooks.resend = async () => jsonResponse({ message: "Private provider detail" }, 500);
  await ui.resend(); assert.equal(ui.state.isResending, false); assert.equal(ui.state.resendFeedback?.tone, "danger");
  assert.doesNotMatch(ui.state.resendFeedback!.message, /Private/); assert.equal(ui.render().resendButton?.props.disabled, false);
  h.hooks.resend = undefined; await ui.resend(); assert.equal(ui.state.resendFeedback?.tone, "success"); assert.equal(ui.state.isResending, false); assert.equal(h.requests.length, 2);
});
test("unmount during Resend prevents every late state publication and navigation", async t => {
  const h = await navigationHarness(t), ui = verificationUi(h), entered = deferred<void>(), release = deferred<Response>();
  h.hooks.resend = () => { entered.resolve(); return release.promise; };
  const pending = ui.resend(); await entered.promise; h.scope.cancel(); const publications = ui.publications.length;
  release.resolve(jsonResponse({})); await pending; assert.equal(ui.publications.length, publications); assert.deepEqual(ui.paths, []); assert.equal(h.requests.length, 1);
});
for (const operation of ["Resend", "Verify"] as const) test(`B account switch during ${operation} discards A feedback/navigation without changing B authentication`, async t => {
  const h = await navigationHarness(t), ui = verificationUi(h), entered = deferred<void>(), release = deferred<Response>();
  if (operation === "Resend") h.hooks.resend = () => { entered.resolve(); return release.promise; };
  else h.hooks.user = actor => actor === "A" ? (entered.resolve(), release.promise) : Promise.resolve(jsonResponse(syntheticSession("B").user));
  const pending = operation === "Resend" ? ui.resend() : ui.verify(); await entered.promise;
  await h.activate("B"); const stored = h.storage.get(h.key);
  release.resolve(jsonResponse(operation === "Resend" ? {} : syntheticSession().user)); await pending;
  assert.equal(h.storage.get(h.key), stored); assert.deepEqual(ui.paths, []); assert.equal(ui.state.access, undefined); assert.equal(ui.state.resendFeedback, null);
  assert.equal(ui.publications.includes("clearPendingSignupEmail"), false); assert.equal(h.requests.some(row => row.path.endsWith("/logout") || row.path.includes("/rpc/")), false);
  assert.notEqual(ui.render().retryButton?.props.disabled, false);
});
