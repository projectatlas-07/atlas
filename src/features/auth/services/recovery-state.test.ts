import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingRecoveryEmail,
  clearPendingRecoveryState,
  consumeRecoveryOtpRecentlySent,
  markRecoveryOtpRecentlySent,
  readPendingRecoveryEmail,
  readPendingRecoverySession,
  savePendingRecoveryEmail,
  savePendingRecoverySession,
} from "./pending-recovery-state.ts";
import { recoveryEmailSchema, recoveryPasswordSchema } from "./recovery-validation.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    entries() { return [...values.entries()]; },
  };
}

test("recovery persistence stores only the pending email and verified-user marker", () => {
  const storage = memoryStorage();
  savePendingRecoveryEmail("  person@example.com  ", storage);
  savePendingRecoverySession("user-a", storage);

  assert.equal(readPendingRecoveryEmail(storage), "person@example.com");
  assert.deepEqual(readPendingRecoverySession(storage), { userId: "user-a" });
  assert.deepEqual(storage.entries(), [
    ["atlas.auth.pending-recovery-email", "person@example.com"],
    ["atlas.auth.pending-recovery-session", '{"userId":"user-a"}'],
  ]);
  assert.doesNotMatch(JSON.stringify(storage.entries()), /password|token|otp/i);

  clearPendingRecoveryEmail(storage);
  assert.equal(readPendingRecoveryEmail(storage), null);
  assert.deepEqual(readPendingRecoverySession(storage), { userId: "user-a" });
  clearPendingRecoveryState(storage);
  assert.deepEqual(storage.entries(), []);
});

test("invalid recovery persistence is discarded and fails closed", () => {
  const storage = memoryStorage();
  storage.setItem("atlas.auth.pending-recovery-email", "not an email");
  storage.setItem("atlas.auth.pending-recovery-session", '{"unexpected":true}');
  assert.equal(readPendingRecoveryEmail(storage), null);
  assert.equal(readPendingRecoverySession(storage), null);
  assert.deepEqual(storage.entries(), []);
});

test("recovery send marker is in-memory, explicit, and consumed once", () => {
  assert.equal(consumeRecoveryOtpRecentlySent(), false);
  markRecoveryOtpRecentlySent();
  assert.equal(consumeRecoveryOtpRecentlySent(), true);
  assert.equal(consumeRecoveryOtpRecentlySent(), false);
});

test("recovery validation accepts email and enforces 12 matching password characters", () => {
  assert.equal(recoveryEmailSchema.safeParse("person@example.com").success, true);
  assert.equal(recoveryEmailSchema.safeParse("invalid").success, false);
  assert.equal(recoveryPasswordSchema.safeParse({ password: "short", confirmPassword: "short" }).success, false);
  assert.equal(recoveryPasswordSchema.safeParse({ password: "long-enough-password", confirmPassword: "different-value" }).success, false);
  assert.equal(recoveryPasswordSchema.safeParse({ password: "long-enough-password", confirmPassword: "long-enough-password" }).success, true);
});
