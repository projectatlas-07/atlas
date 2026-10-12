import type { Session } from "@supabase/supabase-js";
import { type AccountActivation, type AccountCapture, type AccountConnection, type AccountCoordinator, type AccountSnapshot } from "./account-activation.ts";
import { assertFactoryResultCurrent, resolveCapturedFactoryAccess, type CapturedFactoryResult } from "./captured-factory-access-service.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

export type AuthDestinationResult =
  | ((Extract<CapturedFactoryResult, { kind: "authorized" }> | { kind: "no_factory"; actorId: string; activation: AccountActivation }) & { ok: true; destination: "/office" | "/onboarding"; needsOnboarding: boolean })
  | { ok: false; kind: Exclude<CapturedFactoryResult["kind"], "authorized" | "no_factory"> | "uncertain" | "signed_out" | "invalid_credentials" | "otp"; message: string };
export const unavailableDestination = (kind: Extract<AuthDestinationResult, { ok: false }>["kind"]): AuthDestinationResult => ({
  ok: false, kind, message: kind === "invalid_credentials" ? ATLAS_UI_STRINGS.auth.invalidCredentials
    : kind === "otp" ? ATLAS_UI_STRINGS.auth.otpInvalid
    : kind === "inactive" ? ATLAS_UI_STRINGS.auth.accessDisabledDescription
    : kind === "authentication_failed" ? ATLAS_UI_STRINGS.auth.authenticationRejected : ATLAS_UI_STRINGS.auth.workspaceError,
});

// Component/request lifetime only. The injected singleton coordinator remains
// the sole account authority; this scope never installs or verifies a session.
export function createAuthNavigationScope(coordinator: AccountCoordinator) {
  let cancelPrevious = () => {};
  let active = true;
  return {
    activate() { active = true; },
    isActive: () => active,
    cancel() { active = false; cancelPrevious(); },
    begin() {
      cancelPrevious();
      const cancellation = new AbortController();
      const initialCapture = coordinator.capture();
      const initial = initialCapture?.activation;
      const initiallyInitializing = coordinator.getSnapshot().status === "initializing";
      const observed = new Set<AccountActivation>();
      let signedOut = false, captured: AccountCapture | null = null;
      let expected: { actor: string; sessionId: string } | undefined;
      const changed = new Set<() => void>();
      const unsubscribe = coordinator.subscribe((event) => {
        const activation = coordinator.getSnapshot().activation;
        if (activation && activation !== initial) observed.add(activation);
        if (event === "SIGNED_OUT") signedOut = true;
        changed.forEach((listener) => listener());
      });
      const stop = () => { cancellation.abort(); unsubscribe(); };
      cancelPrevious = stop;
      if (!active) stop();
      const live = () => active && !cancellation.signal.aborted;
      const unchanged = () => {
        if (!live() || signedOut) return false;
        const current = coordinator.getSnapshot().activation;
        // Correlation may permit a generic uncertainty message, never factory
        // authorization. Only a bound, server-verified capture can authorize.
        if (expected) return observed.size <= 1 && [...observed].every(value => value.actorId === expected!.actor && value.sessionId === expected!.sessionId)
          && (!current || (current.actorId === expected.actor && current.sessionId === expected.sessionId));
        return observed.size === 0 && current === initial;
      };
      const bind = (value: AccountCapture): AccountCapture | null => {
        if (!live() || signedOut || [...observed].some((activation) => activation !== value.activation)) return null;
        captured = value;
        return coordinator.ownsCredential(value) ? value : null;
      };
      function waitFor<T>(inspect: () => T | undefined, milliseconds: number): Promise<T | undefined> {
        const immediate = inspect();
        if (immediate !== undefined || !live()) return Promise.resolve(immediate);
        return new Promise((resolve) => {
          const finish = (value: T | undefined) => { clearTimeout(timeout); changed.delete(check); cancellation.signal.removeEventListener("abort", abort); resolve(value); };
          const check = () => { const value = inspect(); if (value !== undefined) finish(value); };
          const abort = () => finish(undefined);
          const timeout = setTimeout(abort, milliseconds);
          changed.add(check); cancellation.signal.addEventListener("abort", abort, { once: true });
          check();
        });
      }
      return {
        coordinator, live, unchanged,
        dispose: unsubscribe,
        async observeExpectedSession(session: Session | null, milliseconds = 2_000): Promise<AccountCapture | null> {
          // Returned JWT is correlation evidence ONLY. All ownership/provenance
          // checks and server verification still belong to the F3B foundation.
          let actor: string, sessionId: string;
          try {
            if (!session) return null;
            const payload = JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            actor = session.user.id; sessionId = payload.session_id;
            if (payload.sub !== actor || typeof sessionId !== "string") return null;
            expected = { actor, sessionId };
          } catch { return null; }
          const value = await waitFor(() => {
            if (!live() || signedOut || [...observed].some((activation) => activation.actorId !== actor || activation.sessionId !== sessionId) || observed.size > 1) return null;
            const current = coordinator.capture();
            if (current && current.activation.actorId === actor && current.activation.sessionId === sessionId) return current;
            if (current) return null;
            return undefined;
          }, milliseconds);
          return value ? bind(value) : null;
        },
        async currentCapture(milliseconds = 2_000, retrySnapshot?: AccountSnapshot): Promise<AccountCapture | null> {
          if (retrySnapshot) {
            // A click rendered for A must not silently verify B. Deadline/cap
            // checks remain inside the coordinator, before any HTTP dispatch.
            if (!live() || coordinator.getSnapshot() !== retrySnapshot) { stop(); return null; }
            const value = coordinator.retryVerification() ?? coordinator.capture();
            return value ? bind(value) : null;
          }
          if (!initiallyInitializing) return initialCapture ? bind(initialCapture) : null;
          await waitFor(() => coordinator.getSnapshot().status === "initializing" ? undefined : true, milliseconds);
          const value = coordinator.capture();
          return value ? bind(value) : null;
        },
        canPublish(result: { ok?: boolean; kind?: string; activation?: AccountActivation }) {
          if (!live() || result.kind === "superseded") return false;
          if (result.activation) {
            try { assertFactoryResultCurrent(coordinator, result as CapturedFactoryResult); return true; } catch { return false; }
          }
          return captured ? coordinator.ownsCredential(captured) : unchanged();
        },
      };
    },
  };
}
export type AuthNavigationOperation = ReturnType<ReturnType<typeof createAuthNavigationScope>["begin"]>;

export function authConnection(): AccountConnection {
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" };
}
export async function resolveAuthDestination(operation: AuthNavigationOperation, captured: AccountCapture, connection = authConnection()): Promise<AuthDestinationResult> {
  if (!operation.live()) return unavailableDestination("superseded");
  const result = await resolveCapturedFactoryAccess(operation.coordinator, captured, connection);
  if (!operation.canPublish(result)) return unavailableDestination("superseded");
  if (result.kind === "authorized") return { ...result, ok: true, destination: "/office", needsOnboarding: false };
  if (result.kind === "no_factory") return { kind: "no_factory", actorId: result.actorId, activation: result.activation, ok: true, destination: "/onboarding", needsOnboarding: true };
  return unavailableDestination(result.kind);
}
