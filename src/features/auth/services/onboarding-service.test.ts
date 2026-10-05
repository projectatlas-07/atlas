import assert from "node:assert/strict";
import { mock, test } from "node:test";

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: {
    supabase: {
      auth: {
        async getUser() { return { data: { user: null }, error: null }; },
      },
      async rpc() { return { data: null, error: null }; },
    },
  },
});

const {
  FACTORY_NAME_MAX_LENGTH,
  factoryNameSchema,
  provisionFirstFactory,
  resolveFactoryAccessStatus,
  resolveOnboardingAccess,
} = await import("./onboarding-service.ts");

const confirmedUser = {
  email: "owner@example.com",
  email_confirmed_at: "2026-10-04T00:00:00.000Z",
};

test("signed-out or invalid sessions resolve to login without membership lookup", async () => {
  let membershipCalls = 0;
  const result = await resolveOnboardingAccess({
    async getUser() { return { data: { user: null }, error: new Error("expired") }; },
    async resolveFactoryAccess() {
      membershipCalls += 1;
      return { ok: true, status: "active", factoryId: "must-not-run" };
    },
  });

  assert.deepEqual(result, { state: "login" });
  assert.equal(membershipCalls, 0);
});

test("an active existing membership resolves directly to Office", async () => {
  const result = await resolveOnboardingAccess({
    async getUser() { return { data: { user: confirmedUser }, error: null }; },
    async resolveFactoryAccess() {
      return { ok: true, status: "active", factoryId: "factory-a" };
    },
  });

  assert.deepEqual(result, { state: "office", factoryId: "factory-a" });
});

test("a verified user with no mapping reaches the factory form", async () => {
  const result = await resolveOnboardingAccess({
    async getUser() { return { data: { user: confirmedUser }, error: null }; },
    async resolveFactoryAccess() {
      return { ok: true, status: "none", factoryId: null };
    },
  });

  assert.deepEqual(result, { state: "eligible", email: "owner@example.com" });
});

test("an inactive mapping resolves to the access-disabled state before showing the form", async () => {
  const result = await resolveOnboardingAccess({
    async getUser() { return { data: { user: confirmedUser }, error: null }; },
    async resolveFactoryAccess() {
      return { ok: true, status: "inactive", factoryId: null };
    },
  });

  assert.deepEqual(result, { state: "disabled" });
});

test("an authenticated unconfirmed user returns to verification", async () => {
  const result = await resolveOnboardingAccess({
    async getUser() {
      return { data: { user: { email: "pending@example.com", email_confirmed_at: null } }, error: null };
    },
    async resolveFactoryAccess() { throw new Error("must not resolve membership"); },
  });

  assert.deepEqual(result, { state: "verification", email: "pending@example.com" });
});

test("resolver unauthenticated and unexpected failures fail closed", async () => {
  const unauthenticated = await resolveOnboardingAccess({
    async getUser() { return { data: { user: confirmedUser }, error: null }; },
    async resolveFactoryAccess() { return { ok: false, reason: "unauthenticated" }; },
  });
  assert.deepEqual(unauthenticated, { state: "login" });

  const unexpected = await resolveOnboardingAccess({
    async getUser() { return { data: { user: confirmedUser }, error: null }; },
    async resolveFactoryAccess() { return { ok: false, reason: "unexpected" }; },
  });
  assert.deepEqual(unexpected, {
    state: "error",
    message: "Unable to verify your workspace. Please try again.",
  });
});

test("dedicated resolver validates active, inactive, none, and unauthenticated results", async () => {
  assert.deepEqual(await resolveFactoryAccessStatus({
    async rpc() {
      return { data: [{ status: "active", factory_id: "factory-a" }], error: null };
    },
  }), { ok: true, status: "active", factoryId: "factory-a" });

  assert.deepEqual(await resolveFactoryAccessStatus({
    async rpc() {
      return { data: [{ status: "inactive", factory_id: null }], error: null };
    },
  }), { ok: true, status: "inactive", factoryId: null });

  assert.deepEqual(await resolveFactoryAccessStatus({
    async rpc() {
      return { data: [{ status: "none", factory_id: null }], error: null };
    },
  }), { ok: true, status: "none", factoryId: null });

  assert.deepEqual(await resolveFactoryAccessStatus({
    async rpc() {
      return { data: null, error: { message: "ATLAS_UNAUTHENTICATED" } };
    },
  }), { ok: false, reason: "unauthenticated" });
});

test("created=true calls the typed RPC once and succeeds without an intermediate resolver", async () => {
  const rpcCalls: unknown[] = [];
  const result = await provisionFirstFactory("  Shree Kiln Industries  ", {
    async rpc(args) {
      rpcCalls.push(args);
      return { data: [{ factory_id: "factory-new", created: true }], error: null };
    },
  });

  assert.deepEqual(rpcCalls, [{ p_factory_name: "Shree Kiln Industries" }]);
  assert.deepEqual(result, { ok: true, factoryId: "factory-new", created: true });
});

test("created=false is an authoritative successful retry", async () => {
  const result = await provisionFirstFactory("Different Retry Name", {
    async rpc() {
      return { data: [{ factory_id: "factory-existing", created: false }], error: null };
    },
  });

  assert.deepEqual(result, { ok: true, factoryId: "factory-existing", created: false });
});

test("stable invalid-name and inactive errors map without exposing backend details", async () => {
  assert.deepEqual(await provisionFirstFactory("Control\nName", {
    async rpc() { return { data: null, error: { message: "ATLAS_INVALID_FACTORY_NAME" } }; },
  }), {
    ok: false,
    reason: "invalid_name",
    message: "Check the factory name and try again.",
  });

  assert.deepEqual(await provisionFirstFactory("Factory", {
    async rpc() { return { data: null, error: { message: "ATLAS_MEMBERSHIP_INACTIVE" } }; },
  }), {
    ok: false,
    reason: "membership_inactive",
    message: "Your account is signed in, but access to this factory is currently disabled.",
  });
});

test("stable session and confirmation errors remain machine-routable without raw details", async () => {
  const unauthenticated = await provisionFirstFactory("Factory", {
    async rpc() { return { data: null, error: { message: "ATLAS_UNAUTHENTICATED" } }; },
  });
  assert.equal(unauthenticated.ok, false);
  if (!unauthenticated.ok) assert.equal(unauthenticated.reason, "unauthenticated");

  const unconfirmed = await provisionFirstFactory("Factory", {
    async rpc() { return { data: null, error: { message: "ATLAS_EMAIL_NOT_CONFIRMED" } }; },
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.reason, "email_unconfirmed");

  assert.doesNotMatch(JSON.stringify([unauthenticated, unconfirmed]), /ATLAS_/);
});

test("unexpected RPC failures return one safe Atlas message", async () => {
  const result = await provisionFirstFactory("Factory", {
    async rpc() {
      return { data: null, error: { message: "duplicate key constraint factories_internal_detail" } };
    },
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "unexpected",
    message: "We couldn't create your factory. Try again.",
  });
  assert.doesNotMatch(JSON.stringify(result), /constraint|duplicate key|internal_detail/i);
});

test("factory-name validation reflects the backend limit without uniqueness checks", () => {
  assert.equal(FACTORY_NAME_MAX_LENGTH, 200);
  assert.equal(factoryNameSchema.safeParse("Bharat ईंट उद्योग").success, true);
  assert.equal(factoryNameSchema.safeParse("Same Factory Name").success, true);
  assert.equal(factoryNameSchema.safeParse("Same Factory Name").success, true);
  assert.equal(factoryNameSchema.safeParse("x".repeat(201)).success, false);
});
