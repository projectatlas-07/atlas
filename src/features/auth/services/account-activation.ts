import { createClient, isAuthApiError, isAuthSessionMissingError, type AuthChangeEvent, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../types/supabase.ts";

export type AccountActivation = Readonly<{ actorId: string; sessionId: string; generation: number }>;
export type AccountSnapshot = Readonly<{
  // initializing/pending: checking, never protected authorization.
  // uncertain: retryable/unavailable, NOT signed out or a membership decision.
  // verified: exact credential verified; factory authorization is still separate.
  // signed_out: observed null session with consistent storage, not a request error.
  status: "initializing" | "signed_out" | "uncertain" | "pending_verification" | "verified";
  activation?: AccountActivation;
  credentialRevision?: number;
  reason?: "claims" | "storage" | "expired" | "network" | "authentication";
  verification: Readonly<{ checking: boolean; retriesUsed: number; retriesRemaining: number; availableAt: number | null; exhausted: boolean }>;
}>;
declare const captureBrand: unique symbol;
export type AccountCapture = Readonly<{
  activation: AccountActivation;
  credentialRevision: number;
  [captureBrand]: true;
}>;
type Credentials = { token: string; expires: number; owner: AccountCoordinator; retired: boolean };
const credentials = new WeakMap<AccountCapture, Credentials>();
const verificationLifecycles = new WeakMap<AccountCoordinator, {
  begin: (captured: AccountCapture) => () => void;
  complete: (captured: AccountCapture) => void;
  fail: (captured: AccountCapture, reason: "network" | "authentication", cooldown: number) => void;
  now: () => number;
}>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class AccountSupersededError extends Error {
  constructor() { super("Account request no longer owns the current credential."); }
}
export class AccountVerificationError extends Error {
  readonly kind: "authentication_failed" | "request_error";
  constructor(kind: AccountVerificationError["kind"]) { super("Account verification unavailable."); this.kind = kind; }
}
function provenance(session: Session) {
  try {
    const parts = session.access_token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload)) as Record<string, unknown>;
    if (typeof claims.sub !== "string" || !uuid.test(claims.sub) || claims.sub !== session.user.id ||
      typeof claims.session_id !== "string" || !uuid.test(claims.session_id) ||
      typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) ||
      typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.exp <= claims.iat ||
      typeof claims.iss !== "string" || !["http:", "https:"].includes(new URL(claims.iss).protocol) ||
      !(claims.aud === "authenticated" || (Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string") && claims.aud.includes("authenticated")))) return null;
    return { actorId: claims.sub, sessionId: claims.session_id, expires: claims.exp * 1000 };
  } catch { return null; }
}
export type AccountCoordinator = ReturnType<typeof createAccountCoordinator>;
export function createAccountCoordinator(
  auth: Pick<SupabaseClient["auth"], "onAuthStateChange">,
  boundary: { readSession: () => string | null | undefined; subscribe?: (listener: () => void) => () => void },
  now: () => number = () => Date.now(),
) {
  let retriesUsed = 0, availableAt = 0, needsRetry = false, authenticationRejected = false, retryReserved = false;
  let inFlight: { captured: AccountCapture } | null = null;
  const verificationState = () => Object.freeze({ checking: inFlight !== null || retryReserved, retriesUsed,
    retriesRemaining: Math.max(0, 3 - retriesUsed), availableAt: needsRetry ? availableAt : null, exhausted: retriesUsed >= 3 && needsRetry });
  let snapshot: AccountSnapshot = Object.freeze({ status: "initializing", verification: verificationState() });
  let activation: AccountActivation | undefined;
  let current: AccountCapture | null = null;
  let activationRetired = false;
  let generation = 0, revision = 0, observedEvent = false, stopped = false;
  const listeners = new Set<(event?: AuthChangeEvent) => void>();
  const publish = (value: Omit<AccountSnapshot, "verification">, event?: AuthChangeEvent) => {
    const verification = verificationState();
    if (!event && value.status === snapshot.status && value.reason === snapshot.reason &&
      value.activation === snapshot.activation && value.credentialRevision === snapshot.credentialRevision &&
      Object.keys(verification).every((key) => verification[key as keyof typeof verification] === snapshot.verification[key as keyof typeof verification])) return;
    snapshot = Object.freeze({ ...value, verification });
    listeners.forEach((listener) => listener(event));
  };
  const retireCapture = () => {
    const secret = current && credentials.get(current);
    if (secret && !secret.retired) secret.retired = true; // One-way transition; never reset.
  };
  const uncertain = (reason: AccountSnapshot["reason"], retire = false, event?: AuthChangeEvent) => {
    if (retire) { retireCapture(); activationRetired = true; retryReserved = false; }
    if (reason === "storage" && current && (retire || !credentials.get(current)?.retired) && !needsRetry) { needsRetry = true; availableAt = now() + 5_000; }
    publish({ status: "uncertain", reason }, event);
  };
  // Storage is a contradiction fence, never a source of replacement credentials.
  const storageMatches = (token: string): boolean => {
    let raw: string | null | undefined;
    try { raw = boundary.readSession(); } catch { uncertain("storage"); return false; }
    if (raw === undefined) { uncertain("storage"); return false; }
    // Absence without an SDK event is uncertainty, not an invented sign-out.
    if (raw === null) { uncertain("storage", true); return false; }
    try {
      const stored = JSON.parse(raw) as Session;
      const claim = provenance(stored);
      if (!claim || stored.access_token !== token) {
        const differentAccount = !claim || claim.actorId !== activation?.actorId || claim.sessionId !== activation?.sessionId;
        if (!differentAccount) retireCapture(); // Refresh retains activation, never an obsolete capture.
        uncertain("storage", differentAccount);
        return false;
      }
      return true;
    } catch { uncertain("storage", true); return false; }
  };
  const check = (captured: AccountCapture) => {
    const secret = credentials.get(captured);
    if (stopped || !secret || secret.retired || secret.owner !== api || captured !== current || captured.activation !== activation) return false;
    if (secret.expires <= now()) { retireCapture(); uncertain("expired"); return false; }
    if (!storageMatches(secret.token)) { if (snapshot.status !== "uncertain") uncertain("storage", true); return false; }
    return true;
  };
  const api = {
    getSnapshot: () => { if (current) check(current); return snapshot; },
    capture(): AccountCapture | null {
      return current && snapshot.status !== "uncertain" && (!needsRetry || retryReserved || inFlight !== null) && check(current) ? current : null;
    },
    isActivationCurrent(value: AccountActivation) {
      return value === activation && current !== null && check(current) && snapshot.status !== "uncertain";
    },
    // Ownership only, not authentication proof. Used to discard an obsolete
    // verification error without confusing its own uncertainty with replacement.
    ownsCredential: check,
    assertCredentialCurrent(captured: AccountCapture) {
      if (!check(captured) || snapshot.status === "uncertain") throw new AccountSupersededError();
    },
    verificationFailed(captured: AccountCapture, reason: "network" | "authentication") {
      verificationLifecycles.get(api)!.fail(captured, reason, 5_000);
    },
    // Explicit retry only. No refresh/login/logout or unbounded automatic loop.
    // Network uncertainty can reuse the same still-owned identity; storage cannot
    // supply a new identity or restore a retired activation.
    retryVerification(): AccountCapture | null {
      if (!current || !check(current) || authenticationRejected || inFlight || retryReserved ||
        snapshot.status !== "uncertain" || !needsRetry || retriesUsed >= 3 || now() < availableAt) return null;
      retriesUsed++; retryReserved = true;
      publish({ status: "pending_verification", activation, credentialRevision: revision });
      return current;
    },
    // Read-time countdown is separate from the stable external-store snapshot.
    // F3C can render availableAt with a timer without mutating ownership.
    getVerificationRetryState() {
      const owned = current !== null && check(current);
      const delay = Math.max(0, availableAt - now());
      const status = !owned || authenticationRejected || !needsRetry ? "unavailable"
        : inFlight || retryReserved ? "checking" : retriesUsed >= 3 ? "exhausted" : delay > 0 ? "cooldown" : "available";
      return Object.freeze({ status, retriesUsed, retriesRemaining: Math.max(0, 3 - retriesUsed), retryAfterMs: needsRetry ? delay : 0 });
    },
    subscribe(listener: (event?: AuthChangeEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { retireCapture(); stopped = true; current = null; activation = undefined; subscription.unsubscribe(); stopStorage(); listeners.clear(); snapshot = Object.freeze({ status: "uncertain", verification: verificationState() }); },
  };
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (stopped || (event === "INITIAL_SESSION" && observedEvent)) return;
    observedEvent = true;
    if (!session) {
      let stored: string | null | undefined;
      try { stored = boundary.readSession(); } catch { stored = undefined; }
      retireCapture(); current = null; activation = undefined; activationRetired = true; retryReserved = false;
      publish(stored === null ? { status: "signed_out" } : { status: "uncertain", reason: "storage" }, event);
      return;
    }
    const claim = provenance(session);
    if (!claim) { uncertain("claims", true, event); return; }
    if (activationRetired || !activation || activation.actorId !== claim.actorId || activation.sessionId !== claim.sessionId) {
      retireCapture();
      activation = Object.freeze({ actorId: claim.actorId, sessionId: claim.sessionId, generation: ++generation });
      current = null; activationRetired = false;
      retriesUsed = 0; availableAt = 0; needsRetry = false; authenticationRejected = false; retryReserved = false; inFlight = null;
    }
    if (!current || credentials.get(current)?.token !== session.access_token) {
      retireCapture(); retryReserved = false;
      current = Object.freeze({ activation, credentialRevision: ++revision }) as AccountCapture;
      credentials.set(current, { token: session.access_token, expires: claim.expires, owner: api, retired: false });
      publish(authenticationRejected ? { status: "uncertain", reason: "authentication" }
        : needsRetry ? { status: "uncertain", reason: "network" }
        : { status: "pending_verification", activation, credentialRevision: revision }, event);
    } else if (snapshot.status === "uncertain") {
      // Identical events cannot override server rejection or network uncertainty.
      return;
    } else {
      publish(snapshot, event);
    }
    check(current);
  });
  const stopStorage = boundary.subscribe?.(() => { if (current) check(current); }) ?? (() => {});
  // Promotion is private: decoded provenance or matching storage cannot mark
  // an account verified. Only the isolated server-verification helper can.
  verificationLifecycles.set(api, {
    now,
    begin(captured) {
      api.assertCredentialCurrent(captured);
      if (inFlight || (needsRetry && !retryReserved)) throw new AccountVerificationError("request_error");
      const attempt = { captured }; inFlight = attempt; retryReserved = false;
      publish({ status: "pending_verification", activation, credentialRevision: revision });
      return () => { if (inFlight === attempt) { inFlight = null; publish(snapshot); } };
    },
    fail(captured, reason, cooldown) {
      if (!check(captured)) return;
      authenticationRejected ||= reason === "authentication";
      // Keep cooldowns relative to failure completion, after SDK body processing.
      // Sample once: validate the exact timestamp stored, with no await/rebasing.
      const failedAt = now(), candidate = failedAt + cooldown;
      const representable = (value: number) => Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000;
      const deadline = representable(candidate) ? candidate : failedAt + 30_000;
      retryReserved = false;
      // If even the minimum cannot fit the clock, withhold retry rather than
      // store an invalid deadline. No allowance reset or authorization promotion.
      if (!representable(deadline)) { needsRetry = false; uncertain(authenticationRejected ? "authentication" : reason); return; }
      needsRetry = true; availableAt = Math.max(availableAt, deadline);
      uncertain(authenticationRejected ? "authentication" : reason);
    },
    complete(captured) {
      api.assertCredentialCurrent(captured);
      retriesUsed = 0; availableAt = 0; needsRetry = false; authenticationRejected = false; retryReserved = false;
      publish({ status: "verified", activation, credentialRevision: revision });
    },
  });
  return api;
}

export type AccountConnection = { url: string; key: string; fetch?: typeof fetch };
let verifierSequence = 0;
function guardedFetch(coordinator: AccountCoordinator, captured: AccountCapture, connection: AccountConnection, beforeDispatch: () => void) {
  const token = credentials.get(captured)?.token;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    beforeDispatch();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!token || headers.get("Authorization") !== `Bearer ${token}`) throw new AccountSupersededError();
    coordinator.assertCredentialCurrent(captured);
    // No await between the final synchronous ownership checks and native dispatch.
    return (connection.fetch ?? globalThis.fetch)(input, init);
  };
}
function retryAfterDelay(header: string | null, now: number): number {
  const minimum = 30_000;
  const value = header?.trim();
  let deadline: number;
  // Accept only digit-only delta-seconds or canonical IMF-fixdate in GMT.
  // No legacy date forms; rejected numeric input never falls through to dates.
  if (value && /^\d+$/.test(value)) {
    const seconds = Number(value);
    const milliseconds = seconds * 1000;
    if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(milliseconds)) return minimum;
    deadline = now + milliseconds;
  } else if (value && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:0[1-9]|[12]\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT$/.test(value)) {
    deadline = Date.parse(value);
    // Round-trip rejects calendar rollover and inconsistent weekdays.
    if (!Number.isSafeInteger(deadline) || new Date(deadline).toUTCString() !== value) return minimum;
  } else return minimum;
  const delay = Math.max(minimum, deadline - now);
  const cooldownDeadline = now + delay;
  // Date's representable range, not an arbitrary cap on valid server delays.
  if (!Number.isSafeInteger(delay) || !Number.isSafeInteger(cooldownDeadline) || Math.abs(cooldownDeadline) > 8_640_000_000_000_000) return minimum;
  return delay;
}
export async function verifyCapturedAccount(coordinator: AccountCoordinator, captured: AccountCapture, connection: AccountConnection, beforeDispatch = () => {}) {
  coordinator.assertCredentialCurrent(captured);
  const lifecycle = verificationLifecycles.get(coordinator)!;
  const finish = lifecycle.begin(captured);
  const token = credentials.get(captured)!.token;
  let responseStatus: number | undefined, rateLimitDelay = 30_000;
  const send = guardedFetch(coordinator, captured, connection, beforeDispatch);
  let verifier: SupabaseClient<Database> | undefined;
  try {
    verifier = createClient<Database>(connection.url, connection.key, {
      auth: { storageKey: `atlas-account-verification-${++verifierSequence}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        const response = await send(input, init);
        responseStatus = response.status;
        if (response.status === 429) {
          rateLimitDelay = retryAfterDelay(response.headers.get("Retry-After"), lifecycle.now());
        }
        return response;
      } },
    });
    const { data, error } = await verifier.auth.getUser(token);
    coordinator.assertCredentialCurrent(captured);
    if (error || data.user?.id !== captured.activation.actorId) {
      // These SDK-proven rejections are deliberately narrow. Status alone, a
      // rate limit, an unknown error or a malformed body cannot invalidate Auth.
      const definitive = error ? isAuthSessionMissingError(error) || (isAuthApiError(error) &&
        [400, 401, 403].includes(error.status) && ["bad_jwt", "session_expired"].includes(error.code ?? ""))
        : typeof data.user?.id === "string" && uuid.test(data.user.id) && data.user.id !== captured.activation.actorId;
      const kind = responseStatus !== 429 && definitive ? "authentication_failed" : "request_error";
      lifecycle.fail(captured, kind === "request_error" ? "network" : "authentication", responseStatus === 429 ? rateLimitDelay : 5_000);
      throw new AccountVerificationError(kind);
    }
    lifecycle.complete(captured);
    return data.user;
  } catch (error) {
    // Supersession takes precedence even when the SDK wrapped a failed dispatch.
    if (error instanceof AccountVerificationError) {
      if (!coordinator.ownsCredential(captured)) throw new AccountSupersededError();
      throw error;
    }
    coordinator.assertCredentialCurrent(captured);
    lifecycle.fail(captured, "network", responseStatus === 429 ? rateLimitDelay : 5_000);
    throw new AccountVerificationError("request_error");
  } finally { verifier?.auth.dispose(); finish(); }
}
export function capturedAccountClient(coordinator: AccountCoordinator, captured: AccountCapture, connection: AccountConnection, beforeDispatch = () => {}) {
  coordinator.assertCredentialCurrent(captured);
  const token = credentials.get(captured)!.token;
  return createClient<Database>(connection.url, connection.key, {
    accessToken: async () => { coordinator.assertCredentialCurrent(captured); return token; },
    global: { fetch: guardedFetch(coordinator, captured, connection, beforeDispatch) },
  });
}
// A compatibility view, not another Auth subscription or authority tracker.
export function transportAccountAdapter(coordinator: AccountCoordinator) {
  return {
    coordinator,
    capture: coordinator.capture,
    isCurrent(captured: AccountCapture | null) {
      if (!captured) return false;
      try { coordinator.assertCredentialCurrent(captured); return true; } catch { return false; }
    },
    subscribe(listener: (event: AuthChangeEvent | undefined, actorId: string | null) => void) {
      return coordinator.subscribe((event) => {
        // Undefined denotes local uncertainty, not a fabricated SDK Auth event.
        const state = coordinator.getSnapshot();
        // A failed inspection already closes its financial gate. Broadcasting
        // network failure back into inspection would create an automatic loop.
        if (event || (state.status === "uncertain" && state.reason !== "network")) listener(event, coordinator.capture()?.activation.actorId ?? null);
      });
    },
    stop: coordinator.stop,
  };
}
