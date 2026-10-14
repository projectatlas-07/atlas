import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";

const source = readFileSync(new URL("./components/logout-button.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
function elements(value: unknown): Element[] {
  if (!value || typeof value !== "object" || !("children" in value)) return [];
  const element = value as Element;
  return [element, ...element.children.flatMap(elements)];
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

// Execute the complete production component with controlled hooks and JSX.
// This tests its actual handlers and rendered error/button props, not a React
// mount or a real browser document unload/cache reset.
type LocalSessionRead = { data?: { session?: unknown } | null; error?: unknown | null };
function harness(
  v2: boolean,
  signOut: () => Promise<{ error: unknown | null }>,
  getSession: () => Promise<LocalSessionRead> = async () => ({ data: { session: { present: true } }, error: null }),
) {
  const slots: unknown[] = [];
  let cursor = 0;
  const assignments: string[] = [];
  const routerCalls: string[] = [];
  const calls: unknown[][] = [];
  const sessionReads: unknown[][] = [];
  const dependencies: Record<string, unknown> = {
    react: {
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: unknown) => { slots[index] = value; }];
      },
    },
    "next/navigation": { useRouter: () => ({
      push: () => routerCalls.push("push"),
      replace: () => routerCalls.push("replace"),
      refresh: () => routerCalls.push("refresh"),
    }) },
    "@/components/ui/button": { Button: "AtlasButton" },
    "@/components/ui/feedback": { Feedback: "AtlasFeedback" },
    "@/lib/strings": { ATLAS_UI_STRINGS },
    "@/lib/supabase/client": { supabase: { auth: {
      signOut: (...args: unknown[]) => { calls.push(args); return signOut(); },
      getSession: (...args: unknown[]) => { sessionReads.push(args); return getSession(); },
    } } },
  };
  const exports: { LogoutButton?: (props: { v2: boolean; fullWidth: boolean }) => Element } = {};
  const jsx = { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) };
  new Function("require", "exports", "React", "window", compiled)(
    (name: string) => {
      assert.ok(name in dependencies, `unexpected production dependency: ${name}`);
      return dependencies[name];
    }, exports, jsx, { location: { assign: (path: string) => assignments.push(path) } },
  );
  function render() {
    cursor = 0;
    assert.ok(exports.LogoutButton);
    return elements(exports.LogoutButton({ v2, fullWidth: true }));
  }
  function button() {
    const found = render().find((element) => element.type === (v2 ? "AtlasButton" : "button"));
    assert.ok(found);
    return found;
  }
  function errorText() {
    const alert = render().find((element) => element.props.role === "alert");
    return alert ? alert.children.join("") : null;
  }
  return { calls, sessionReads, assignments, routerCalls, button, errorText,
    click: () => { (button().props.onClick as () => void)(); } };
}

for (const v2 of [false, true]) {
  const variant = v2 ? "Office V2" : "legacy";
  test(`${variant} logout awaits successful signOut before hard navigation and preserves default scope`, async () => {
    const pending = deferred<{ error: unknown | null }>();
    const h = harness(v2, () => pending.promise);
    h.click();
    assert.deepEqual(h.calls, [[]]); // Preserve signOut() and its SDK default scope.
    assert.deepEqual(h.assignments, []);
    assert.equal(h.button().props.disabled, true);
    assert.equal(h.errorText(), null);
    await flush();
    assert.deepEqual(h.assignments, [], "an unresolved signOut is not success");
    pending.resolve({ error: null });
    await flush();
    assert.deepEqual(h.assignments, ["/login"]);
    assert.deepEqual(h.routerCalls, []);
  });

  for (const failure of ["returned", "thrown"] as const) {
    test(`${variant} ${failure} logout failure displays a safe error, permits explicit retry and never navigates early`, async () => {
      let attempt = 0;
      const retry = deferred<{ error: unknown | null }>();
      const h = harness(v2, async () => {
        if (++attempt > 1) return retry.promise;
        if (failure === "thrown") throw new Error("private provider diagnostic");
        return { error: new Error("private provider diagnostic") };
      });
      h.click();
      await flush();
      assert.deepEqual(h.assignments, []);
      assert.deepEqual(h.routerCalls, []);
      assert.equal(h.errorText(), ATLAS_UI_STRINGS.auth.logoutError);
      assert.equal(h.button().props.disabled, false);
      await flush();
      assert.equal(h.calls.length, 1, "failure must not automatically retry logout");
      h.click();
      assert.equal(h.errorText(), null);
      assert.equal(h.button().props.disabled, true);
      assert.equal(h.calls.length, 2);
      assert.deepEqual(h.assignments, []);
      retry.resolve({ error: null });
      await flush();
      assert.deepEqual(h.assignments, ["/login"]);
      assert.deepEqual(h.routerCalls, []);
      assert.equal(h.errorText(), null);
    });
  }

  test(`${variant} rapid clicks keep the existing synchronous logout latch`, async () => {
    const pending = deferred<{ error: unknown | null }>();
    const h = harness(v2, () => pending.promise);
    const click = h.button().props.onClick as () => void;
    click(); click();
    assert.equal(h.calls.length, 1);
    pending.resolve({ error: null });
    await flush();
    assert.deepEqual(h.assignments, ["/login"]);
    assert.deepEqual(h.routerCalls, []);
  });
}

test("logout has no client-router dependency or alternate navigation path", () => {
  assert.match(source, /window\.location\.assign\("\/login"\)/);
  assert.doesNotMatch(source, /next\/navigation|useRouter|router\.(?:push|replace|refresh)/);
});

for (const v2 of [false, true]) {
  const variant = v2 ? "Office V2" : "legacy";
  test(`${variant} logout error waits for a confirmed null local session before hard navigation`, async () => {
    const pendingRead = deferred<LocalSessionRead>();
    const h = harness(v2, async () => ({ error: new Error("private provider diagnostic") }), () => pendingRead.promise);
    h.click();
    await flush();
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.sessionReads, [[]]);
    assert.deepEqual(h.assignments, []);
    assert.equal(h.button().props.disabled, true);
    pendingRead.resolve({ data: { session: null }, error: null });
    await flush();
    assert.deepEqual(h.assignments, ["/login"]);
    assert.deepEqual(h.routerCalls, []);
    assert.equal(h.errorText(), null);
    assert.equal(h.calls.length, 1, "local retirement must not retry global logout");
  });

  const uncertainReads: Array<{ name: string; read: () => Promise<LocalSessionRead> }> = [
    { name: "returned read error", read: async () => ({ data: { session: null }, error: new Error("private read diagnostic") }) },
    { name: "thrown read error", read: async () => { throw new Error("private read diagnostic"); } },
    { name: "missing data", read: async () => ({ error: null }) },
    { name: "missing session", read: async () => ({ data: {}, error: null }) },
    { name: "null data", read: async () => ({ data: null, error: null }) },
    { name: "missing error result", read: async () => ({ data: { session: null } }) },
  ];
  for (const { name, read } of uncertainReads) {
    test(`${variant} ${name} never implies logout success and leaves explicit retry available`, async () => {
      let attempts = 0;
      const h = harness(v2, async () => ({ error: ++attempts === 1 ? new Error("private provider diagnostic") : null }), read);
      h.click();
      await flush();
      assert.deepEqual(h.assignments, []);
      assert.deepEqual(h.routerCalls, []);
      assert.equal(h.errorText(), ATLAS_UI_STRINGS.auth.logoutError);
      assert.equal(h.button().props.disabled, false);
      await flush();
      assert.equal(h.calls.length, 1);
      assert.equal(h.sessionReads.length, 1);
      h.click();
      await flush();
      assert.deepEqual(h.assignments, ["/login"]);
      assert.deepEqual(h.routerCalls, []);
      assert.equal(h.errorText(), null);
      assert.equal(h.calls.length, 2);
      assert.equal(h.sessionReads.length, 1, "successful retry does not need another post-error read");
    });
  }

  test(`${variant} rapid clicks during the post-error read cannot issue another signOut`, async () => {
    const pendingRead = deferred<LocalSessionRead>();
    const h = harness(v2, async () => ({ error: new Error("private provider diagnostic") }), () => pendingRead.promise);
    const click = h.button().props.onClick as () => void;
    click();
    await flush();
    click(); click();
    assert.equal(h.calls.length, 1);
    assert.equal(h.sessionReads.length, 1);
    assert.equal(h.button().props.disabled, true);
    pendingRead.resolve({ data: { session: null }, error: null });
    await flush();
    assert.deepEqual(h.assignments, ["/login"]);
  });
}

// Actual installed SDK, controlled HTTP and memory storage; single-user only.
// The overlapping-account logout race is explicitly KNOWN-OPEN, not covered
// or fixed by the component's post-error navigation check.
for (const status of [204, 500]) {
  test(`installed SDK HTTP ${status}: global single-user logout retires local state and hard navigates without claiming remote success`, async (t) => {
    const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
    const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"),
      Buffer.alloc(32).toString("base64url")].join(".");
    const storage = new Map<string, string>();
    let logoutRequests = 0;
    let remoteError = false;
    const client = createClient("https://auth.example.invalid", "synthetic-public-key", {
      auth: { storageKey: `atlas-l4a2-single-user-${status}`, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: (key) => { storage.delete(key); } } },
      global: { fetch: async (input) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname.endsWith("/logout")) {
          logoutRequests++;
          assert.equal(url.searchParams.get("scope"), "global");
          return status === 204 ? new Response(null, { status })
            : new Response(JSON.stringify({ code: "unexpected_failure", message: "simulated unavailable service" }), { status, headers: { "Content-Type": "application/json" } });
        }
        assert.ok(url.pathname.endsWith("/user"));
        return new Response(JSON.stringify(user), { status: 200, headers: { "Content-Type": "application/json" } });
      } },
    });
    t.after(async () => { await client.auth.dispose(); });
    assert.equal((await client.auth.setSession({ access_token: token, refresh_token: "synthetic-refresh" })).error, null);
    const h = harness(true, async () => {
      const result = await client.auth.signOut();
      remoteError = Boolean(result.error);
      return result;
    }, () => client.auth.getSession());
    h.click();
    await flush();
    assert.equal(remoteError, status === 500);
    assert.deepEqual(h.assignments, ["/login"]);
    assert.deepEqual(h.routerCalls, []);
    assert.equal(h.errorText(), null);
    assert.equal(h.sessionReads.length, status === 500 ? 1 : 0);
    assert.equal(logoutRequests, 1);
    assert.equal((await client.auth.getSession()).data.session, null);
  });
}
