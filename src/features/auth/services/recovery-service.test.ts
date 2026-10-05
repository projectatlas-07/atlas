import assert from "node:assert/strict";
import { mock, test } from "node:test";

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: {
    supabase: {
      auth: {
        async resetPasswordForEmail() { return { error: null }; },
        async verifyOtp() { return { error: null }; },
        async getUser() { return { data: { user: { id: "user-a" } }, error: null }; },
        async updateUser() { return { error: null }; },
        async signOut() { return { error: null }; },
      },
    },
  },
});

const {
  CURRENT_RECOVERY_OTP_LENGTH,
  requestPasswordRecovery,
  resendRecoveryCode,
  signOutAfterRecovery,
  updateRecoveryPassword,
  validateRecoverySession,
  verifyRecoveryOtp,
} = await import("./recovery-service.ts");

test("recovery request calls resetPasswordForEmail and always returns the neutral accepted result", async () => {
  const calls: string[] = [];
  const accepted = await requestPasswordRecovery("person@example.com", {
    async resetPasswordForEmail(email) {
      calls.push(email);
      return { error: new Error("account-specific provider detail") };
    },
  });

  assert.deepEqual(calls, ["person@example.com"]);
  assert.deepEqual(accepted, { ok: true });
  assert.doesNotMatch(JSON.stringify(accepted), /account|exist|provider/i);

  const thrown = await requestPasswordRecovery("person@example.com", {
    async resetPasswordForEmail() { throw new Error("network detail"); },
  });
  assert.deepEqual(thrown, { ok: true });
});

test("recovery resend uses resetPasswordForEmail again and maps rate limits safely", async () => {
  const calls: string[] = [];
  assert.deepEqual(await resendRecoveryCode("person@example.com", {
    async resetPasswordForEmail(email) {
      calls.push(email);
      return { error: null };
    },
  }), { ok: true });
  assert.deepEqual(calls, ["person@example.com"]);

  const limited = await resendRecoveryCode("person@example.com", {
    async resetPasswordForEmail() { return { error: new Error("provider rate detail") }; },
  });
  assert.deepEqual(limited, {
    ok: false,
    message: "Unable to send a new code yet. Please wait and try again.",
  });
  assert.doesNotMatch(JSON.stringify(limited), /provider rate detail/i);
});

test("recovery OTP uses type recovery, then validates the current user", async () => {
  const calls: unknown[] = [];
  const result = await verifyRecoveryOtp("person@example.com", "12345678", {
    async verifyOtp(params) {
      calls.push(params);
      return { error: null };
    },
    async getUser() {
      calls.push("getUser");
      return { data: { user: { id: "user-a" } }, error: null };
    },
  });

  assert.equal(CURRENT_RECOVERY_OTP_LENGTH, 8);
  assert.deepEqual(calls, [
    { email: "person@example.com", token: "12345678", type: "recovery" },
    "getUser",
  ]);
  assert.deepEqual(result, { ok: true, userId: "user-a" });
});

test("wrong or expired recovery OTP returns one safe message and stops before getUser", async () => {
  let getUserCalls = 0;
  const result = await verifyRecoveryOtp("person@example.com", "00000000", {
    async verifyOtp() { return { error: new Error("expired provider detail") }; },
    async getUser() {
      getUserCalls += 1;
      return { data: { user: null }, error: null };
    },
  });

  assert.equal(getUserCalls, 0);
  assert.deepEqual(result, { ok: false, message: "The code is incorrect or has expired." });
  assert.doesNotMatch(JSON.stringify(result), /provider detail/i);
});

test("recovery session validation requires the same current user", async () => {
  assert.equal(await validateRecoverySession("user-a", {
    async getUser() { return { data: { user: { id: "user-a" } }, error: null }; },
  }), true);
  assert.equal(await validateRecoverySession("user-a", {
    async getUser() { return { data: { user: { id: "user-b" } }, error: null }; },
  }), false);
  assert.equal(await validateRecoverySession("user-a", {
    async getUser() { return { data: { user: null }, error: new Error("expired") }; },
  }), false);
});

test("password update and completion use exact updateUser and global signOut contracts", async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await updateRecoveryPassword("long-new-password", {
    async updateUser(attributes) {
      calls.push(["update", attributes]);
      return { error: null };
    },
  }), { ok: true });
  assert.deepEqual(await signOutAfterRecovery({
    async signOut(options) {
      calls.push(["signOut", options]);
      return { error: null };
    },
  }), { ok: true });
  assert.deepEqual(calls, [
    ["update", { password: "long-new-password" }],
    ["signOut", { scope: "global" }],
  ]);
});
