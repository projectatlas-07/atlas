import { createClient, isAuthSessionMissingError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

export type RecoveryContext = Readonly<{ userId: string }>;
export type RecoveryCompletion = Readonly<{
  passwordChanged: true;
  revocation: "confirmed" | "uncertain";
  localSessionCleared: false;
}>;
export type RecoveryAttemptState = Readonly<{
  status: "ready" | "updating" | "rejected" | "unknown" | "complete" | "unavailable";
  completion: RecoveryCompletion | null;
}>;
type Operation = Readonly<{ id: object; active: () => boolean }>;
type Marker = { userId: string } | null;
type Options = {
  sharedAuth: Pick<SupabaseClient["auth"], "onAuthStateChange">;
  url: string;
  key: string;
  fetch?: typeof fetch;
  now?: () => number;
  readMarker: () => Marker;
  saveMarker: (userId: string) => void;
  clearMarker: () => void;
  // Read-only ownership check, not a source of recovery credentials. This
  // also detects another tab's storage replacement before its event arrives.
  readSharedIdentity: () => string | null | undefined;
};
type Intent = {
  owner: object;
  sharedActor: string | null;
  sharedIdentity: string | null | undefined;
  handle: RecoveryContext | null;
  token: string | null;
  expiresAt: number;
  session: Session | null;
  invalidated: boolean;
  phase: "verifying" | "ready" | "updating" | "leaving" | "unknown" | "complete";
  dispatched: boolean;
  completion: RecoveryCompletion | null;
  revocationAcknowledged: boolean;
  attempt: { readonly operation: Operation; outcome: "pending" | "rejected" | "unknown" | "confirmed" | "cancelled" } | null;
};
let isolatedSequence = 0;

// Untrusted local identity is used only to deny stale work, never to grant
// recovery authority. A refreshed token retains session_id; a new A session
// after another tab's A -> B -> A switch does not.
export function recoverySharedIdentity(session: Session | null): string | null | undefined {
  if (!session) return null;
  try {
    const encoded = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded)) as { session_id?: unknown };
    return typeof claims.session_id === "string" && session.user.id
      ? `${session.user.id}:${claims.session_id}` : undefined;
  } catch { return undefined; }
}

/** Memory-only activation: effect cleanup cancels operations, not this authority.
 * Account/session replacement, supersession and invalid credentials retire it.
 * Completion retains read-only outcome evidence; no terminal phase can write.
 * A full reload loses both authority and evidence. Never adopt shared Auth.
 */
export function createRecoveryFlow(options: Options) {
  const now = options.now ?? Date.now;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  // Seed the deny-only snapshot before awaiting SDK initialization. Matching
  // INITIAL_SESSION is not a new activation; an intervening switch is.
  let sharedIdentity = options.readSharedIdentity();
  let sharedActor: string | null = typeof sharedIdentity === "string" ? sharedIdentity.split(":")[0] : null;
  let receivedEvent = false;
  let owner = {};
  let current: Intent | null = null;
  const clients = new Set<SupabaseClient>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  // The identity and predicate belong to this call, never to a shared slot.
  // Once cancellation is observed it cannot be reversed by a later callback.
  function operation(active: () => boolean): Operation {
    let cancelled = false;
    return Object.freeze({ id: Object.freeze({}), active: () => {
      if (!active()) cancelled = true;
      return !cancelled;
    } });
  }
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  const { data: subscriptionData } = options.sharedAuth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" && receivedEvent) return;
    receivedEvent = true;
    const nextActor = session?.user.id ?? null;
    const nextIdentity = recoverySharedIdentity(session);
    if (nextActor !== sharedActor || nextIdentity !== sharedIdentity) {
      sharedActor = nextActor;
      sharedIdentity = nextIdentity;
      owner = {}; // Same actor after A -> B -> A is a different activation.
      if (current) current.invalidated = true;
      notify();
    }
    readyResolve();
  });
  function owns(intent: Intent) {
    if (intent.sharedIdentity !== undefined && options.readSharedIdentity() !== intent.sharedIdentity) intent.invalidated = true;
    return current === intent && owner === intent.owner && !intent.invalidated
      && intent.sharedIdentity !== undefined
      && options.readSharedIdentity() === intent.sharedIdentity;
  }
  function usable(intent: Intent) {
    if (intent.expiresAt && intent.expiresAt <= now() + 90_000) intent.invalidated = true;
    return owns(intent) && intent.phase !== "complete" && intent.handle !== null && intent.token !== null
      && intent.expiresAt > now() + 90_000
      && options.readMarker()?.userId === intent.handle.userId;
  }
  function assertOwned(intent: Intent) {
    if (!owns(intent)) throw new Error("ATLAS_RECOVERY_SUPERSEDED");
  }
  function assertUsable(intent: Intent) {
    if (!usable(intent)) throw new Error("ATLAS_RECOVERY_UNAVAILABLE");
  }
  function assertOperation(op: Operation) {
    if (!op.active()) throw new Error("ATLAS_RECOVERY_OPERATION_CANCELLED");
  }
  const unavailable = () => ({ ok: false as const, message: ATLAS_UI_STRINGS.auth.recoverySessionError });
  function intentFor(handle: RecoveryContext | null) {
    return handle && current?.handle === handle ? current : null;
  }
  async function captureAction(active: () => boolean) {
    const op = operation(active);
    const initialIdentity = options.readSharedIdentity();
    const capturedOwner = owner;
    await ready;
    const capturedIdentity = sharedIdentity;
    return () => op.active() && initialIdentity !== undefined && initialIdentity === capturedIdentity
      && capturedOwner === owner && options.readSharedIdentity() === capturedIdentity;
  }

  async function verify(email: string, token: string, active: () => boolean = () => true) {
    const op = operation(active);
    const ownedAction = await captureAction(op.active);
    if (!ownedAction()) return unavailable();
    const intent: Intent = {
      owner, sharedActor, sharedIdentity, handle: null, token: null, expiresAt: 0,
      session: null, invalidated: false,
      phase: "verifying", dispatched: false, completion: null, revocationAcknowledged: false, attempt: null,
    };
    if (current) current.invalidated = true;
    current = intent;
    const client = boundClient(intent, op);
    try {
      const { data, error } = await client.auth.verifyOtp({ email, token, type: "recovery" });
      assertOperation(op); assertOwned(intent);
      if (error) return { ok: false as const, message: ATLAS_UI_STRINGS.auth.recoveryOtpInvalid };
      const session = data.session;
      if (!data.user || !session?.access_token || !session.refresh_token
        || session.user.id !== data.user.id
        || (intent.sharedActor !== null && intent.sharedActor !== data.user.id)
        || data.user.email?.trim().toLowerCase() !== email.trim().toLowerCase()
        || !Number.isFinite(session.expires_at)) return unavailable();
      intent.handle = Object.freeze({ userId: data.user.id });
      intent.token = session.access_token;
      intent.session = session;
      intent.expiresAt = session.expires_at! * 1000;
      if (intent.expiresAt <= now() + 90_000) return unavailable();
      const verified = await client.auth.getUser(intent.token);
      assertOperation(op); assertOwned(intent);
      if (verified.error || verified.data.user?.id !== intent.handle.userId) return unavailable();
      options.saveMarker(intent.handle.userId);
      if (options.readMarker()?.userId !== intent.handle.userId) return unavailable();
      intent.phase = "ready";
      return { ok: true as const, userId: intent.handle.userId, context: intent.handle };
    } catch { return unavailable(); }
    finally {
      if (intent.phase === "verifying") intent.invalidated = true;
      dispose(client);
    }
  }

  function dispose(client: SupabaseClient) { clients.delete(client); void client.auth.dispose(); }
  // Each SDK client closes over one immutable operation. SDK-internal awaits
  // cannot resolve a different operation's predicate at the fetch boundary.
  function boundClient(intent: Intent, op: Operation, revocation = false) {
    const client = createClient(options.url, options.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: `atlas-recovery-${++isolatedSequence}` },
      global: { fetch: (input, init) => {
        const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
        const method = init?.method ?? "GET";
        // No refresh/retry can change the captured credential. The installed
        // SDK can proactively refresh even with autoRefreshToken:false.
        if (path.endsWith("/token")) throw new Error("ATLAS_RECOVERY_RESTART_REQUIRED");
        if (path.endsWith("/logout")) {
          // After confirmed update, revoke A even if its page was superseded.
          // This isolated client cannot remove or broadcast to shared B.
          if (!(revocation && intent.completion)) { assertOperation(op); assertUsable(intent); }
        } else {
          assertOperation(op);
          assertOwned(intent);
          if (intent.phase !== "verifying") assertUsable(intent);
        }
        if (path.endsWith("/user") || path.endsWith("/logout")) {
          if (!intent.token || new Headers(init?.headers).get("Authorization") !== `Bearer ${intent.token}`) {
            throw new Error("ATLAS_RECOVERY_CREDENTIAL_MISMATCH");
          }
        }
        if (method === "PUT") {
          if (intent.phase !== "updating" || intent.attempt?.operation !== op || intent.dispatched) throw new Error("ATLAS_RECOVERY_ALREADY_SUBMITTED");
          intent.dispatched = true;
        }
        const response = send(input, init);
        if (path.endsWith("/logout")) {
          return response.then((result) => {
            intent.revocationAcknowledged = result.ok;
            return result;
          });
        }
        return response;
      } },
    });
    clients.add(client);
    return client;
  }

  function context() {
    if (!current || !owns(current)) return null;
    if (current.phase === "complete") return current.completion ? current.handle : null;
    if (current.phase === "verifying" || current.phase === "leaving") return null;
    return usable(current) ? current.handle : null;
  }
  async function validate(handle: RecoveryContext, active: () => boolean = () => true) {
    const op = operation(active);
    const intent = intentFor(handle);
    if (!intent) return false;
    const client = boundClient(intent, op);
    try {
      assertOperation(op); assertUsable(intent);
      const result = await client.auth.getUser(intent.token!);
      assertOperation(op); assertUsable(intent);
      if (isAuthSessionMissingError(result.error) || result.error?.status === 401 || (!result.error && result.data.user?.id !== handle.userId)) intent.invalidated = true;
      return !result.error && result.data.user?.id === handle.userId;
    } catch { return false; }
    finally { dispose(client); }
  }
  async function revoke(intent: Intent, client: SupabaseClient) {
    try {
      const result = await client.auth.signOut({ scope: "global" });
      // SDK signOut ignores 401/403/404 and can return null error without a
      // successful revocation response. Do not turn that into confirmation.
      return !result.error && intent.revocationAcknowledged ? "confirmed" as const : "uncertain" as const;
    } catch { return "uncertain" as const; }
  }
  async function update(handle: RecoveryContext, password: string, active: () => boolean = () => true) {
    const op = operation(active);
    const intent = intentFor(handle);
    if (!intent || intent.phase !== "ready") return unavailable();
    // Latch before any awaited verification, not just at HTTP dispatch.
    intent.phase = "updating";
    intent.attempt = { operation: op, outcome: "pending" };
    const client = boundClient(intent, op, true);
    const mayPublish = () => op.active() && owns(intent);
    notify();
    try {
      assertOperation(op); assertUsable(intent);
      // Supported isolated setSession verifies the captured JWT server-side.
      // It never adopts the application's shared credentials.
      const verified = await client.auth.setSession({ access_token: intent.token!, refresh_token: intent.session!.refresh_token });
      assertOperation(op); assertUsable(intent);
      if (verified.error || verified.data.user?.id !== handle.userId) {
        if (isAuthSessionMissingError(verified.error) || verified.error?.status === 401 || !verified.error) intent.invalidated = true;
        return unavailable();
      }
      const { data, error } = await client.auth.updateUser({ password });
      if (error || data.user?.id !== handle.userId) {
        // A fetch-boundary denial is wrapped by the SDK as a fetch error.
        // No native PUT means no ambiguous password-change outcome.
        if (!intent.dispatched) return { ...unavailable(), mayPublish: false as const };
        if (error && [400, 401, 403, 422].includes(error.status ?? 0)) {
          if (isAuthSessionMissingError(error) || error.status === 401) intent.invalidated = true;
          intent.phase = "ready";
          intent.attempt.outcome = "rejected";
          intent.dispatched = false;
          return { ok: false as const, message: ATLAS_UI_STRINGS.auth.passwordUpdateError };
        }
        intent.phase = "unknown";
        intent.attempt.outcome = "unknown";
        return { ok: false as const, message: ATLAS_UI_STRINGS.auth.recoveryUpdateUnknown, unknown: true as const };
      }
      // Password change is confirmed independently of cleanup or publication.
      intent.phase = "complete";
      intent.attempt.outcome = "confirmed";
      intent.completion = { passwordChanged: true, revocation: "uncertain", localSessionCleared: false };
      intent.completion = { ...intent.completion, revocation: await revoke(intent, client) };
      if (mayPublish() && options.readMarker()?.userId === handle.userId) options.clearMarker();
      return { ok: true as const, completion: intent.completion, mayPublish: mayPublish() };
    } catch {
      if (intent.completion) {
        return { ok: true as const, completion: intent.completion, mayPublish: mayPublish() };
      }
      if (intent.dispatched) {
        intent.phase = "unknown";
        intent.attempt!.outcome = "unknown";
        return { ok: false as const, message: ATLAS_UI_STRINGS.auth.recoveryUpdateUnknown, unknown: true as const };
      }
      return { ...unavailable(), mayPublish: false as const };
    }
    finally {
      if (!intent.dispatched && intent.phase === "updating") { intent.phase = "ready"; intent.attempt!.outcome = "cancelled"; }
      dispose(client); notify();
    }
  }
  async function leave(handle: RecoveryContext, active: () => boolean = () => true) {
    const op = operation(active);
    const intent = intentFor(handle);
    if (!intent || intent.phase !== "ready") return false;
    if (!op.active() || !usable(intent)) return false;
    intent.phase = "leaving";
    intent.attempt = null;
    const client = boundClient(intent, op);
    try {
      const verified = await client.auth.setSession({ access_token: intent.token!, refresh_token: intent.session!.refresh_token });
      if (verified.error || !op.active() || !usable(intent) || verified.data.user?.id !== handle.userId) return false;
      await revoke(intent, client);
      if (!op.active() || !owns(intent)) return false;
      if (options.readMarker()?.userId === handle.userId) options.clearMarker();
      intent.phase = "complete";
      return true;
    } finally { intent.phase = "complete"; dispose(client); notify(); }
  }
  function state(handle: RecoveryContext): RecoveryAttemptState {
    const intent = intentFor(handle);
    if (!intent || !owns(intent)) return { status: "unavailable", completion: null };
    if (intent.completion) return { status: "complete", completion: intent.completion };
    if (!usable(intent)) return { status: "unavailable", completion: null };
    if (intent.attempt?.outcome === "rejected") return { status: "rejected", completion: null };
    return { status: intent.phase === "updating" || intent.phase === "unknown" ? intent.phase : "ready", completion: null };
  }
  return { verify, context, validate, update, leave, captureAction, state,
    completion: (handle: RecoveryContext) => intentFor(handle)?.completion ?? null,
    canPublish: (handle: RecoveryContext) => { const intent = intentFor(handle); return Boolean(intent && owns(intent) && (!intent.attempt || intent.attempt.operation.active())); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { owner = {}; clients.forEach(dispose); current = null; subscriptionData.subscription.unsubscribe(); listeners.clear(); },
  };
}
