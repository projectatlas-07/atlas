"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { PasswordField } from "@/features/auth/components/password-field";
import {
  signOutAfterRecovery,
  updateRecoveryPassword,
  validateRecoverySession,
  getRecoveryContext,
  getRecoveryAttemptState,
  canPublishRecovery,
  subscribeRecoveryOwnership,
  type RecoveryContext,
  type RecoveryCompletion,
  type RecoveryAttemptState,
} from "@/features/auth/services/recovery-service";
import {
  recoveryPasswordSchema,
  type RecoveryPasswordValues,
} from "@/features/auth/services/recovery-validation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export default function NewPasswordPage() {
  const router = useRouter();
  const isUpdatingRef = useRef(false);
  const lifetimeRef = useRef<{ active: boolean } | null>(null);
  const [recoveryContext, setRecoveryContext] = useState<RecoveryContext | null | undefined>(undefined);
  const [completion, setCompletion] = useState<RecoveryCompletion | null>(null);
  const [attemptState, setAttemptState] = useState<RecoveryAttemptState | null>(null);
  const [outcomeLocked, setOutcomeLocked] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [isLeavingRecovery, setIsLeavingRecovery] = useState(false);
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm<RecoveryPasswordValues>({
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    // A new effect gets a new lease; cleanup never reactivates an older one.
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    const active = () => lifetime.active;
    async function checkRecoveryContext() {
      const savedContext = getRecoveryContext();
      if (!savedContext) {
        if (active()) { setRecoveryContext(null); setCompletion(null); }
        return;
      }
      const state = getRecoveryAttemptState(savedContext);
      // Pending/sent/terminal evidence survives remount without another write
      // or reconstruction of credentials from the application's shared Auth.
      if ((state.status === "ready" || state.status === "rejected") && !await validateRecoverySession(savedContext, active)) {
        if (active()) setRecoveryContext(null);
        return;
      }
      if (!active()) return;
      const latest = getRecoveryAttemptState(savedContext);
      if (latest.status === "unavailable") { setRecoveryContext(null); setCompletion(null); return; }
      setRecoveryContext(savedContext);
      setAttemptState(latest);
      setCompletion(latest.completion);
      setOutcomeLocked(latest.status === "unknown" || latest.status === "complete");
      if (latest.status === "unknown") setSubmissionError(ATLAS_UI_STRINGS.auth.recoveryUpdateUnknown);
      if (latest.status === "rejected") setSubmissionError(ATLAS_UI_STRINGS.auth.passwordUpdateError);
    }
    const unsubscribe = subscribeRecoveryOwnership(() => { void checkRecoveryContext(); });
    void checkRecoveryContext();
    return () => { lifetime.active = false; unsubscribe(); };
  }, []);

  async function setNewPassword(values: RecoveryPasswordValues) {
    if (!recoveryContext || isUpdatingRef.current || isLeavingRecovery || outcomeLocked || completion) return;
    const parsed = recoveryPasswordSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      if (fieldErrors.password?.[0]) setError("password", { message: fieldErrors.password[0] });
      if (fieldErrors.confirmPassword?.[0]) setError("confirmPassword", { message: fieldErrors.confirmPassword[0] });
      return;
    }

    isUpdatingRef.current = true;
    const lifetime = lifetimeRef.current;
    setSubmissionError("");
    try {
      const updateResult = await updateRecoveryPassword(recoveryContext, parsed.data.password, () => lifetime?.active === true);
      if (!lifetime?.active || !canPublishRecovery(recoveryContext)) return;
      if (!updateResult.ok) {
        setSubmissionError(updateResult.message);
        if ("unknown" in updateResult) setOutcomeLocked(true);
        else if (updateResult.message === ATLAS_UI_STRINGS.auth.recoverySessionError) setRecoveryContext(null);
        return;
      }
      reset();
      setOutcomeLocked(true);
      setCompletion(updateResult.completion);
    } finally {
      isUpdatingRef.current = false;
    }
  }

  async function leaveRecovery() {
    if (!recoveryContext || isLeavingRecovery || isUpdatingRef.current || outcomeLocked) return;
    setIsLeavingRecovery(true);
    setSubmissionError("");
    const lifetime = lifetimeRef.current;
    const left = await signOutAfterRecovery(recoveryContext, () => lifetime?.active === true);
    if (!lifetime?.active) return;
    if (!left) {
      setSubmissionError(ATLAS_UI_STRINGS.auth.recoverySessionError);
      setIsLeavingRecovery(false);
      return;
    }
    if (!canPublishRecovery(recoveryContext)) return;
    router.replace("/login");
    router.refresh();
  }

  async function restartRecovery() {
    if (isLeavingRecovery) return;
    setIsLeavingRecovery(true);
    setSubmissionError("");
    // Missing memory context is never authority to sign out a shared account.
    router.replace("/forgot-password");
  }

  if (completion) {
    return (
      <AuthShell title={ATLAS_UI_STRINGS.auth.newPasswordTitle} description={ATLAS_UI_STRINGS.auth.newPasswordDescription}>
        <Feedback role="status" tone={completion.revocation === "confirmed" ? "success" : "neutral"}>
          {completion.revocation === "confirmed" ? ATLAS_UI_STRINGS.auth.recoveryCompleted : ATLAS_UI_STRINGS.auth.recoveryRevocationUnknown}
        </Feedback>
        <p className="mt-atlas-5 text-atlas-sm text-atlas-text-muted">{ATLAS_UI_STRINGS.auth.recoveryLocalSessionNotice}</p>
      </AuthShell>
    );
  }

  if (recoveryContext === undefined) {
    return (
      <AuthShell title={ATLAS_UI_STRINGS.auth.newPasswordTitle} description={ATLAS_UI_STRINGS.auth.checkingRecovery}>
        <p className="text-atlas-sm text-atlas-text-muted" role="status">{ATLAS_UI_STRINGS.auth.checkingRecovery}</p>
      </AuthShell>
    );
  }

  if (recoveryContext === null) {
    return (
      <AuthShell title={ATLAS_UI_STRINGS.auth.newPasswordTitle} description={ATLAS_UI_STRINGS.auth.newPasswordDescription}>
        <Feedback role="alert" tone="danger">{ATLAS_UI_STRINGS.auth.recoverySessionError}</Feedback>
        {submissionError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{submissionError}</Feedback></div>}
        <div className="mt-atlas-6">
          <Button type="button" fullWidth loading={isLeavingRecovery} loadingLabel={ATLAS_UI_STRINGS.auth.loggingOut} onClick={() => { void restartRecovery(); }}>{ATLAS_UI_STRINGS.auth.restartRecovery}</Button>
        </div>
      </AuthShell>
    );
  }

  if (attemptState?.status === "updating") {
    return (
      <AuthShell title={ATLAS_UI_STRINGS.auth.newPasswordTitle} description={ATLAS_UI_STRINGS.auth.newPasswordDescription}>
        <p className="text-atlas-sm text-atlas-text-muted" role="status">{ATLAS_UI_STRINGS.auth.resettingPassword}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={ATLAS_UI_STRINGS.auth.newPasswordTitle} description={ATLAS_UI_STRINGS.auth.newPasswordDescription}>
      <form className="flex flex-col" noValidate onSubmit={handleSubmit(setNewPassword)}>
        {submissionError && <Feedback role="alert" tone="danger">{submissionError}</Feedback>}
        <div className={submissionError ? "mt-atlas-5" : undefined}>
          <PasswordField
            {...register("password", { onChange: () => { if (!outcomeLocked) setSubmissionError(""); } })}
            id="recovery-new-password"
            label={ATLAS_UI_STRINGS.auth.newPassword}
            autoComplete="new-password"
            help={ATLAS_UI_STRINGS.auth.passwordHelp}
            error={errors.password?.message}
          />
        </div>
        <div className="mt-atlas-5">
          <PasswordField
            {...register("confirmPassword", { onChange: () => { if (!outcomeLocked) setSubmissionError(""); } })}
            id="recovery-confirm-password"
            label={ATLAS_UI_STRINGS.auth.confirmNewPassword}
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
          />
        </div>
        <div className="mt-atlas-6">
          <Button type="submit" fullWidth disabled={isSubmitting || isLeavingRecovery || outcomeLocked} loading={isSubmitting} loadingLabel={ATLAS_UI_STRINGS.auth.resettingPassword}>{ATLAS_UI_STRINGS.auth.resetPassword}</Button>
        </div>
        <div className="mt-atlas-6 text-center">
          {outcomeLocked ? (
            <Button type="button" variant="ghost" onClick={() => { void restartRecovery(); }}>{ATLAS_UI_STRINGS.auth.restartRecovery}</Button>
          ) : (
            <Button type="button" variant="ghost" disabled={isSubmitting} loading={isLeavingRecovery} loadingLabel={ATLAS_UI_STRINGS.auth.loggingOut} onClick={() => { void leaveRecovery(); }}>{ATLAS_UI_STRINGS.auth.backToLogin}</Button>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
