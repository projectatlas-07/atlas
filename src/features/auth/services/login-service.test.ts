import assert from "node:assert/strict";
import { mock, test } from "node:test";

const signInCalls: Array<{ email: string; password: string }> = [];
let signInError: unknown | null = null;
let factoryResolution: unknown = { ok: true, factoryId: "factory-a" };
let factoryResolutionCalls = 0;

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: {
    supabase: {
      auth: {
        async signInWithPassword(credentials: { email: string; password: string }) {
          signInCalls.push(credentials);
          return { data: null, error: signInError };
        },
      },
    },
  },
});

await mock.module("./factory-access-service.ts", {
  namedExports: {
    async resolveAuthenticatedFactoryId() {
      factoryResolutionCalls += 1;
      return factoryResolution;
    },
  },
});

const { loginWithPassword, resolvePostLoginDestination } = await import("./login-service.ts");

function reset() {
  signInCalls.length = 0;
  signInError = null;
  factoryResolution = { ok: true, factoryId: "factory-a" };
  factoryResolutionCalls = 0;
}

test("email and password login calls Supabase then routes an active factory user to Office", async () => {
  reset();

  const result = await loginWithPassword({
    email: "owner@example.com",
    password: "correct horse battery staple",
  });

  assert.deepEqual(signInCalls, [{
    email: "owner@example.com",
    password: "correct horse battery staple",
  }]);
  assert.equal(factoryResolutionCalls, 1);
  assert.deepEqual(result, {
    ok: true,
    destination: "/office",
    needsOnboarding: false,
  });
});

test("Supabase credential errors become one generic Atlas message", async () => {
  reset();
  signInError = new Error("User with this email does not exist");

  const result = await loginWithPassword({
    email: "unknown@example.com",
    password: "wrong-password",
  });

  assert.deepEqual(result, {
    ok: false,
    message: "Email or password is incorrect.",
  });
  assert.equal(factoryResolutionCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /does not exist/i);
});

test("a signed-in user without active membership routes to onboarding", async () => {
  reset();
  factoryResolution = {
    ok: false,
    error: { code: "access_denied", message: "raw membership detail" },
  };

  assert.deepEqual(await loginWithPassword({
    email: "new@example.com",
    password: "valid-password",
  }), {
    ok: true,
    destination: "/onboarding",
    needsOnboarding: true,
  });
});

test("existing signed-in users resolve through the same authoritative membership flow", async () => {
  reset();

  assert.deepEqual(await resolvePostLoginDestination(), {
    ok: true,
    destination: "/office",
    needsOnboarding: false,
  });
  assert.equal(factoryResolutionCalls, 1);
  assert.equal(signInCalls.length, 0);
});

test("factory-resolution failures expose no backend details", async () => {
  reset();
  factoryResolution = {
    ok: false,
    error: { code: "request_failed", message: "relation factory_users failed" },
  };

  const result = await resolvePostLoginDestination();
  assert.deepEqual(result, {
    ok: false,
    message: "Unable to verify your workspace. Please try again.",
  });
  assert.doesNotMatch(JSON.stringify(result), /factory_users/);
});
