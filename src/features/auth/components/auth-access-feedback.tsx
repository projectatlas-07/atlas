"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { accountCoordinator } from "../services/shared-account-context";
import { createAuthNavigationScope, type AuthDestinationResult } from "../services/auth-navigation";
import { formatResendCountdown } from "../services/signup-service";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export function useAuthNavigation() {
  const scope = useMemo(() => createAuthNavigationScope(accountCoordinator), []);
  const snapshot = useSyncExternalStore(accountCoordinator.subscribe, accountCoordinator.getSnapshot, accountCoordinator.getSnapshot);
  useEffect(() => { scope.activate(); return () => scope.cancel(); }, [scope]);
  return { scope, snapshot };
}

export function AuthAccessFeedback({ result, onRetry, disabled = false }: Readonly<{ result?: AuthDestinationResult; onRetry: () => void; disabled?: boolean }>) {
  const snapshot = useSyncExternalStore(accountCoordinator.subscribe, accountCoordinator.getSnapshot, accountCoordinator.getSnapshot);
  const [, tick] = useState(0);
  useEffect(() => {
    if (snapshot.verification.availableAt === null) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.verification.availableAt]);
  const retry = accountCoordinator.getVerificationRetryState();
  if (result?.ok || result?.kind === "inactive" || result?.kind === "invalid_credentials" || result?.kind === "otp" || result?.kind === "authentication_failed") return null;
  // A bounded observation timeout is unavailable, not an indefinite spinner.
  const pending = (snapshot.status === "initializing" && result?.kind !== "uncertain") || snapshot.verification.checking;
  const unavailable = snapshot.status === "uncertain" || (result && !result.ok && ["request_error", "uncertain", "configuration_error"].includes(result.kind));
  const canRetry = !disabled && !pending && (retry.status === "available" || (snapshot.status === "pending_verification" && accountCoordinator.capture() !== null)
    || (unavailable && snapshot.status === "verified"));
  if (!pending && !unavailable && !canRetry) return null;
  const message = pending ? snapshot.status === "initializing" ? ATLAS_UI_STRINGS.auth.checkingAuthentication : ATLAS_UI_STRINGS.auth.verifyingAccount
    : snapshot.reason === "authentication" ? ATLAS_UI_STRINGS.auth.authenticationRejected
    : retry.status === "exhausted" ? ATLAS_UI_STRINGS.auth.verificationRetryExhausted
    : retry.status === "cooldown" ? `${ATLAS_UI_STRINGS.auth.verificationRetryCooldown} ${formatResendCountdown(Math.ceil(retry.retryAfterMs / 1000))}`
    : unavailable ? ATLAS_UI_STRINGS.auth.verificationTemporary : ATLAS_UI_STRINGS.auth.verifyingAccount;
  return <div className="mb-atlas-5">
    <Feedback role="status" tone="info">{message}</Feedback>
    {!pending && <Button type="button" variant="secondary" disabled={!canRetry} onClick={onRetry}>{ATLAS_UI_STRINGS.actions.retry}</Button>}
  </div>;
}
