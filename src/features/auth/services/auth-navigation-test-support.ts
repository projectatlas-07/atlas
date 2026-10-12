import { createClient, type Session, type User, type SupabaseClient } from "@supabase/supabase-js";
import type { TestContext } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { createAccountCoordinator } from "./account-activation.ts";
import { createAuthNavigationScope } from "./auth-navigation.ts";

export const identities = { A: "00000000-0000-4000-8000-000000000001", B: "00000000-0000-4000-8000-000000000002", factory: "00000000-0000-4000-8000-000000000003" };
export const sdkUrl = "https://synthetic.invalid", sdkKey = "synthetic-public-key";
export const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
export function syntheticUser(actor: "A" | "B" = "A"): User { return { id: identities[actor], aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }; }
export function syntheticSession(actor: "A" | "B" = "A", revision = 0): Session {
  const now = Math.floor(Date.now() / 1000), user = syntheticUser(actor);
  const payload = { sub: user.id, session_id: user.id, iat: now - 60, exp: now + 3600, iss: `${sdkUrl}/auth/v1`, aud: "authenticated", revision };
  return { access_token: [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify(payload)).toString("base64url"), Buffer.alloc(32).toString("base64url")].join("."),
    refresh_token: `synthetic-${actor}`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
}
let active: SupabaseClient;
export const sdkFacade = { auth: {
  signInWithPassword: (...args: Parameters<typeof active.auth.signInWithPassword>) => active.auth.signInWithPassword(...args),
  signUp: (...args: Parameters<typeof active.auth.signUp>) => active.auth.signUp(...args),
  verifyOtp: (...args: Parameters<typeof active.auth.verifyOtp>) => active.auth.verifyOtp(...args),
  resend: (...args: Parameters<typeof active.auth.resend>) => active.auth.resend(...args),
} };
let sequence = 0;
export async function navigationHarness(t: TestContext, deferActivation = false) {
  let clock = Date.now(), revision = 0;
  const storage = new Map<string, string>(), key = `synthetic-navigation-${++sequence}`;
  const requests: { path: string; body: Record<string, unknown> | null; actor: "A" | "B" }[] = [];
  const events: string[] = [];
  const hooks: { login?: (actor: "A" | "B") => Promise<Response>; user?: (actor: "A" | "B") => Promise<Response>; rpc?: () => Promise<Response>; signup?: () => Promise<Response>; otp?: () => Promise<Response>; resend?: () => Promise<Response> } = {};
  const send: typeof fetch = async (input, init) => {
    const location = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) : null;
    const bearer = new Headers(init?.headers).get("Authorization");
    const sub = bearer?.startsWith("Bearer ") && bearer.slice(7).split(".").length === 3 ? JSON.parse(Buffer.from(bearer.slice(7).split(".")[1], "base64url").toString()).sub : undefined;
    const actor = sub === identities.B || String(body?.email ?? body?.refresh_token).startsWith("b@") || body?.refresh_token === "synthetic-B" ? "B" : "A";
    requests.push({ path: location.pathname, body, actor });
    if (location.pathname.endsWith("/token")) return location.search.includes("password") && hooks.login ? hooks.login(actor) : jsonResponse(syntheticSession(actor, revision));
    if (location.pathname.endsWith("/signup")) return hooks.signup ? hooks.signup() : jsonResponse(syntheticUser());
    if (location.pathname.endsWith("/verify")) return hooks.otp ? hooks.otp() : jsonResponse(syntheticSession());
    if (location.pathname.endsWith("/user")) return hooks.user ? hooks.user(actor) : jsonResponse(syntheticUser(actor));
    if (location.pathname.endsWith("/rpc/resolve_factory_access")) return hooks.rpc ? hooks.rpc() : jsonResponse([{ status: "active", factory_id: identities.factory }]);
    if (location.pathname.endsWith("/resend")) return hooks.resend ? hooks.resend() : jsonResponse({});
    throw new Error("Unexpected synthetic request");
  };
  const client = createClient(sdkUrl, sdkKey, { auth: { storageKey: key, storage: { getItem: (name) => storage.get(name) ?? null, setItem: (name, value) => { storage.set(name, value); }, removeItem: (name) => { storage.delete(name); } }, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: send } });
  active = client;
  const delayed: (() => void)[] = [];
  const coordinator = createAccountCoordinator({ onAuthStateChange(listener) {
    return client.auth.onAuthStateChange((event, session) => {
      if (deferActivation && event === "SIGNED_IN") delayed.push(() => listener(event, session));
      else listener(event, session);
    });
  } }, { readSession: () => storage.get(key) ?? null }, () => clock);
  const scope = createAuthNavigationScope(coordinator);
  const subscription = client.auth.onAuthStateChange((event, session) => { events.push(`${event}:${session?.user.id === identities.B ? "B" : session ? "A" : "none"}`); });
  await client.auth.getSession();
  t.after(() => { scope.cancel(); coordinator.stop(); subscription.data.subscription.unsubscribe(); client.auth.dispose(); });
  return { client, scope, coordinator, hooks, events, storage, key, requests,
    releaseActivations() { deferActivation = false; delayed.splice(0).forEach(deliver => deliver()); },
    connection: { url: sdkUrl, key: sdkKey, fetch: send }, advance(ms: number) { clock += ms; },
    activate: async (actor: "A" | "B") => { const result = await client.auth.setSession(syntheticSession(actor)); if (result.error) throw new Error("Synthetic activation failed"); },
    refresh: async () => { revision++; const result = await client.auth.refreshSession(); if (result.error) throw new Error("Synthetic refresh failed"); },
  };
}

// Execute unchanged production function/JSX bodies with controlled closure and
// hook dependencies. This is handler/component-function evidence, not a mount.
export function productionFunction<T>(path: string, name: string, context: Record<string, unknown>, returnOnly = false): T {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(source);
  if (!found?.body) throw new Error(`Production function missing: ${name}`);
  const expression = found.body.statements.filter(ts.isReturnStatement).at(-1)?.expression;
  if (returnOnly && !expression) throw new Error(`Production JSX missing: ${name}`);
  const code = returnOnly ? `function ${name}() { return ${expression!.getText(source)}; }` : found.getText(source).replace(/^export /, "");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;$/gm, "");
  const closure = { _jsx: jsx, _jsxs: jsxs, _Fragment: Fragment, ...context };
  return new Function(...Object.keys(closure), `${js}\nreturn ${name};`)(...Object.values(closure)) as T;
}
