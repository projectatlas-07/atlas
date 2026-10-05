"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { PasswordField } from "@/features/auth/components/password-field";
import {
  clearPendingRecoveryState,
  readPendingRecoverySession,
  savePendingRecoverySession,
  type PendingRecoverySession,
} from "@/features/auth/services/pending-recovery-state";
import {
  signOutAfterRecovery,
  updateRecoveryPassword,
  validateRecoverySession,
} from "@/features/auth/services/recovery-service";
import {
  recoveryPasswordSchema,
  type RecoveryPasswordValues,
} from "@/features/auth/services/recovery-validation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type RecoveryContext = PendingRecoverySession | null | undefined;

export default function NewPasswordPage() {
  const router = useRouter();
  const isUpdatingRef = useRef(false);
  const [recoveryContext, setRecoveryContext] = useState<RecoveryContext>(undefined);
  const [submissionError, setSubmissionError] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isLeavingRecovery, setIsLeavingRecovery] = useState(false);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<RecoveryPasswordValues>({
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let isCancelled = false;
    async function checkRecoveryContext() {
      const savedContext = readPendingRecoverySession();
      if (!savedContext || !await validateRecoverySession(savedContext.userId)) {
        clearPendingRecoveryState();
        await signOutAfterRecovery();
        if (!isCancelled) setRecoveryContext(null);
        return;
      }
      if (!isCancelled) setRecoveryContext(savedContext);
    }
    void checkRecoveryContext();
    return () => { isCancelled = true; };
  }, []);

  async function setNewPassword(values: RecoveryPasswordValues) {
    if (!recoveryContext || isUpdatingRef.current) return;
    const parsed = recoveryPasswordSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      if (fieldErrors.password?.[0]) setError("password", { message: fieldErrors.password[0] });
      if (fieldErrors.confirmPassword?.[0]) setError("confirmPassword", { message: fieldErrors.confirmPassword[0] });
      return;
    }

    isUpdatingRef.current = true;
    setSubmissionError("");
    try {
      const updateResult = await updateRecoveryPassword(parsed.data.password);
      if (!updateResult.ok) {
        setSubmissionError(updateResult.message);
        return;
      }

      clearPendingRecoveryState();
      const signOutResult = await signOutAfterRecovery();
      if (!signOutResult.ok) {
        savePendingRecoverySession(recoveryContext.userId);
        setSubmissionError(signOutResult.message);
        return;
      }

      setIsRedirecting(true);
      router.replace("/login?password=updated");
      router.refresh();
    } finally {
      isUpdatingRef.current = false;
    }
  }

  async function leaveRecovery() {
    if (!recoveryContext || isLeavingRecovery) return;
    setIsLeavingRecovery(true);
    setSubmissionError("");
    clearPendingRecoveryState();
    const signOutResult = await signOutAfterRecovery();
    if (!signOutResult.ok) {
      savePendingRecoverySession(recoveryContext.userId);
      setSubmissionError(signOutResult.message);
      setIsLeavingRecovery(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  async function restartRecovery() {
    if (isLeavingRecovery) return;
    setIsLeavingRecovery(true);
    setSubmissionError("");
    const signOutResult = await signOutAfterRecovery();
    if (!signOutResult.ok) {
      setSubmissionError(signOutResult.message);
      setIsLeavingRecovery(false);
      return;
    }
    router.replace("/forgot-password");
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

  return (
    <AuthShell title={ATLAS_UI_STRINGS.auth.newPasswordTitle} description={ATLAS_UI_STRINGS.auth.newPasswordDescription}>
      <form className="flex flex-col" noValidate onSubmit={handleSubmit(setNewPassword)}>
        {submissionError && <Feedback role="alert" tone="danger">{submissionError}</Feedback>}
        <div className={submissionError ? "mt-atlas-5" : undefined}>
          <PasswordField
            {...register("password", { onChange: () => setSubmissionError("") })}
            id="recovery-new-password"
            label={ATLAS_UI_STRINGS.auth.newPassword}
            autoComplete="new-password"
            help={ATLAS_UI_STRINGS.auth.passwordHelp}
            error={errors.password?.message}
          />
        </div>
        <div className="mt-atlas-5">
          <PasswordField
            {...register("confirmPassword", { onChange: () => setSubmissionError("") })}
            id="recovery-confirm-password"
            label={ATLAS_UI_STRINGS.auth.confirmNewPassword}
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
          />
        </div>
        <div className="mt-atlas-6">
          <Button type="submit" fullWidth disabled={isSubmitting || isRedirecting} loading={isSubmitting || isRedirecting} loadingLabel={ATLAS_UI_STRINGS.auth.resettingPassword}>{ATLAS_UI_STRINGS.auth.resetPassword}</Button>
        </div>
        <div className="mt-atlas-6 text-center">
          <Button type="button" variant="ghost" loading={isLeavingRecovery} loadingLabel={ATLAS_UI_STRINGS.auth.loggingOut} onClick={() => { void leaveRecovery(); }}>{ATLAS_UI_STRINGS.auth.backToLogin}</Button>
        </div>
      </form>
    </AuthShell>
  );
}
