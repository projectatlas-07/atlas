import assert from "node:assert/strict";
import { mock, test } from "node:test";

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: {
    supabase: {
      auth: {
        async signUp() { return { data: { session: null }, error: null }; },
        async signOut() { return { error: null }; },
        async verifyOtp() { return { data: null, error: null }; },
        async getUser() { return { data: { user: { id: "user-a" } }, error: null }; },
        async resend() { return { data: null, error: null }; },
      },
    },
  },
});

await mock.module("./factory-access-service.ts", {
  namedExports: {
    async resolveAuthenticatedFactoryId() {
      return { ok: true, factoryId: "factory-a" };
    },
  },
});

const {
  CURRENT_SIGNUP_OTP_LENGTH,
  formatResendCountdown,
  nextResendCountdown,
  normalizeSignupOtp,
  resendSignupOtp,
  signupWithPassword,
  verifySignupOtp,
} = await import("./signup-service.ts");

test("signup calls Supabase with email and password and accepts the confirmation-required response", async () => {
  const calls: unknown[] = [];
  const result = await signupWithPassword(
    { email: "new@example.com", password: "a secure password" },
    {
      async signUp(credentials) {
        calls.push(credentials);
        return { data: { session: null }, error: null };
      },
      async signOut() {
        throw new Error("must not sign out normal signup");
      },
    },
  );

  assert.deepEqual(calls, [{ email: "new@example.com", password: "a secure password" }]);
  assert.deepEqual(result, { ok: true });
});

test("known existing-email responses use the same accepted result without enumeration", async () => {
  const result = await signupWithPassword(
    { email: "existing@example.com", password: "a secure password" },
    {
      async signUp() {
        return { data: { session: null }, error: { code: "user_already_exists" } };
      },
      async signOut() { return undefined; },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.doesNotMatch(JSON.stringify(result), /exist|registered/i);
});

test("an unexpected signup session is signed out locally and reported as configuration mismatch", async () => {
  let signOutCalls = 0;
  const result = await signupWithPassword(
    { email: "new@example.com", password: "a secure password" },
    {
      async signUp() {
        return { data: { session: {} }, error: null };
      },
      async signOut() {
        signOutCalls += 1;
      },
    },
  );

  assert.equal(signOutCalls, 1);
  assert.deepEqual(result, {
    ok: false,
    reason: "configuration",
    message: "Email verification is unavailable. Please contact support.",
  });
});

test("verification sends the signup OTP, validates the user, and routes a factory member to Office", async () => {
  const calls: string[] = [];
  const result = await verifySignupOtp("new@example.com", "12345678", {
    async verifyOtp(params) {
      calls.push(`verify:${JSON.stringify(params)}`);
      return { error: null };
    },
    async getUser() {
      calls.push("getUser");
      return { data: { user: { id: "user-a" } }, error: null };
    },
    async resolveFactoryAccess() {
      calls.push("factory");
      return { ok: true, factoryId: "factory-a" };
    },
  });

  assert.deepEqual(calls, [
    'verify:{"email":"new@example.com","token":"12345678","type":"signup"}',
    "getUser",
    "factory",
  ]);
  assert.deepEqual(result, { ok: true, destination: "/office" });
});

test("a verified user without active factory membership routes to onboarding", async () => {
  const result = await verifySignupOtp("new@example.com", "12345678", {
    async verifyOtp() { return { error: null }; },
    async getUser() { return { data: { user: { id: "user-a" } }, error: null }; },
    async resolveFactoryAccess() {
      return { ok: false, error: { code: "access_denied", message: "no mapping" } };
    },
  });

  assert.deepEqual(result, { ok: true, destination: "/onboarding" });
});

test("wrong or expired OTP returns one stable message and stops before identity resolution", async () => {
  let getUserCalls = 0;
  const result = await verifySignupOtp("new@example.com", "00000000", {
    async verifyOtp() { return { error: new Error("expired token detail") }; },
    async getUser() {
      getUserCalls += 1;
      return { data: { user: null }, error: null };
    },
    async resolveFactoryAccess() {
      throw new Error("must not resolve factory");
    },
  });

  assert.equal(getUserCalls, 0);
  assert.deepEqual(result, {
    ok: false,
    reason: "otp",
    message: "The code is incorrect or has expired.",
  });
  assert.doesNotMatch(JSON.stringify(result), /token detail/i);
});

test("resend is explicit and uses the Supabase signup resend type", async () => {
  const calls: unknown[] = [];
  const result = await resendSignupOtp("new@example.com", {
    async resend(params) {
      calls.push(params);
      return { error: null };
    },
  });

  assert.deepEqual(calls, [{ type: "signup", email: "new@example.com" }]);
  assert.deepEqual(result, { ok: true });
});

test("OTP normalization and resend countdown remain configurable and deterministic", () => {
  assert.equal(CURRENT_SIGNUP_OTP_LENGTH, 8);
  assert.equal(normalizeSignupOtp("12 3a456789"), "12345678");
  assert.equal(normalizeSignupOtp("12345678", 6), "123456");
  assert.equal(nextResendCountdown(1), 0);
  assert.equal(nextResendCountdown(0), 0);
  assert.equal(formatResendCountdown(60), "1:00");
  assert.equal(formatResendCountdown(9), "0:09");
});
