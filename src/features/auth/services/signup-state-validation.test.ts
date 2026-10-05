import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingSignupEmail,
  consumeSignupOtpRecentlySent,
  markSignupOtpRecentlySent,
  readPendingSignupEmail,
  savePendingSignupEmail,
} from "./pending-signup-state.ts";
import { AUTH_PASSWORD_MIN_LENGTH, signupFormSchema } from "./signup-validation.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    storedValues() { return [...values.values()]; },
  };
}

test("pending signup state persists only the trimmed email and can be cleared", () => {
  const storage = memoryStorage();
  savePendingSignupEmail("  new@example.com  ", storage);
  assert.equal(readPendingSignupEmail(storage), "new@example.com");
  assert.deepEqual(storage.storedValues(), ["new@example.com"]);

  clearPendingSignupEmail(storage);
  assert.equal(readPendingSignupEmail(storage), null);
});

test("invalid stored pending state is discarded safely", () => {
  const storage = memoryStorage();
  storage.setItem("atlas.auth.pending-signup-email", "not an email");
  assert.equal(readPendingSignupEmail(storage), null);
  assert.deepEqual(storage.storedValues(), []);
});

test("the just-sent marker is in-memory and consumed only once", () => {
  assert.equal(consumeSignupOtpRecentlySent(), false);
  markSignupOtpRecentlySent();
  assert.equal(consumeSignupOtpRecentlySent(), true);
  assert.equal(consumeSignupOtpRecentlySent(), false);
});

test("signup validation enforces the Atlas minimum and matching confirmation", () => {
  assert.equal(AUTH_PASSWORD_MIN_LENGTH, 12);

  const mismatch = signupFormSchema.safeParse({
    email: "new@example.com",
    password: "long-enough-password",
    confirmPassword: "different-password",
  });
  assert.equal(mismatch.success, false);
  if (!mismatch.success) {
    assert.equal(
      mismatch.error.flatten().fieldErrors.confirmPassword?.[0],
      "Passwords do not match.",
    );
  }

  assert.equal(signupFormSchema.safeParse({
    email: "new@example.com",
    password: "short",
    confirmPassword: "short",
  }).success, false);
});
