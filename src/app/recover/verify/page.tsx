"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form-controls";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { AuthOtpInput } from "@/features/auth/components/signup-otp-input";
import { AUTH_EMAIL_OTP_LENGTH } from "@/features/auth/services/auth-config";
import {
  clearPendingRecoveryEmail,
  clearPendingRecoveryState,
  consumeRecoveryOtpRecentlySent,
  markRecoveryOtpRecentlySent,
  readPendingRecoveryEmail,
  savePendingRecoveryEmail,
  savePendingRecoverySession,
} from "@/features/auth/services/pending-recovery-state";
import {
  RECOVERY_RESEND_COOLDOWN_SECONDS,
  requestPasswordRecovery,
  resendRecoveryCode,
  verifyRecoveryOtp,
} from "@/features/auth/services/recovery-service";
import { recoveryEmailSchema } from "@/features/auth/services/recovery-validation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type PendingEmailState = string | null | undefined;

export default function RecoveryCodePage() {
  const router = useRouter();
  const isVerifyingRef = useRef(false);
  const isResendingRef = useRef(false);
  const isRecoveringEmailRef = useRef(false);
  const [pendingEmail, setPendingEmail] = useState<PendingEmailState>(undefined);
  const [emailEntry, setEmailEntry] = useState("");
  const [emailError, setEmailError] = useState("");
  const [token, setToken] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "neutral" | "danger"; message: string } | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isRecoveringEmail, setIsRecoveringEmail] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    const savedEmail = readPendingRecoveryEmail();
    setPendingEmail(savedEmail);
    if (savedEmail && consumeRecoveryOtpRecentlySent()) {
      setResendSeconds(RECOVERY_RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: "neutral", message: ATLAS_UI_STRINGS.auth.recoveryRequestSuccess });
    }
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timeoutId = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearTimeout(timeoutId);
  }, [resendSeconds]);

  async function recoverPendingEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecoveringEmailRef.current) return;
    const parsed = recoveryEmailSchema.safeParse(emailEntry);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? ATLAS_UI_STRINGS.auth.emailInvalid);
      return;
    }

    isRecoveringEmailRef.current = true;
    setIsRecoveringEmail(true);
    await requestPasswordRecovery(parsed.data);
    savePendingRecoveryEmail(parsed.data);
    markRecoveryOtpRecentlySent();
    setPendingEmail(parsed.data);
    setFeedback({ tone: "neutral", message: ATLAS_UI_STRINGS.auth.recoveryRequestSuccess });
    setResendSeconds(RECOVERY_RESEND_COOLDOWN_SECONDS);
    setEmailError("");
    isRecoveringEmailRef.current = false;
    setIsRecoveringEmail(false);
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingEmail || isVerifyingRef.current) return;
    if (token.length !== AUTH_EMAIL_OTP_LENGTH) {
      setVerificationError(ATLAS_UI_STRINGS.auth.otpRequired);
      return;
    }

    isVerifyingRef.current = true;
    let keepSubmissionLocked = false;
    setIsVerifying(true);
    setVerificationError("");
    setFeedback(null);
    try {
      const result = await verifyRecoveryOtp(pendingEmail, token);
      if (!result.ok) {
        setVerificationError(result.message);
        return;
      }

      savePendingRecoverySession(result.userId);
      clearPendingRecoveryEmail();
      keepSubmissionLocked = true;
      setIsRedirecting(true);
      router.replace("/recover/new-password");
      router.refresh();
    } finally {
      if (!keepSubmissionLocked) {
        isVerifyingRef.current = false;
        setIsVerifying(false);
      }
    }
  }

  async function resendCode() {
    if (!pendingEmail || resendSeconds > 0 || isResendingRef.current) return;
    isResendingRef.current = true;
    setIsResending(true);
    setVerificationError("");
    setFeedback(null);
    try {
      const result = await resendRecoveryCode(pendingEmail);
      if (!result.ok) {
        setFeedback({ tone: "danger", message: result.message });
        return;
      }
      setToken("");
      setResendSeconds(RECOVERY_RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: "neutral", message: ATLAS_UI_STRINGS.auth.recoveryRequestSuccess });
    } finally {
      isResendingRef.current = false;
      setIsResending(false);
    }
  }

  function changeEmail() {
    clearPendingRecoveryState();
    router.push("/forgot-password");
  }

  if (pendingEmail === undefined) {
    return (
      <AuthShell title={ATLAS_UI_STRINGS.auth.recoveryVerifyTitle} description={ATLAS_UI_STRINGS.auth.checkingRecovery}>
        <p className="text-atlas-sm text-atlas-text-muted" role="status">{ATLAS_UI_STRINGS.auth.checkingRecovery}</p>
      </AuthShell>
    );
  }

  if (pendingEmail === null) {
    return (
      <AuthShell title={ATLAS_UI_STRINGS.auth.recoveryVerifyTitle} description={ATLAS_UI_STRINGS.auth.recoveryMissingEmail}>
        <form className="flex flex-col" noValidate onSubmit={recoverPendingEmail}>
          <label htmlFor="recovery-email-entry" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">{ATLAS_UI_STRINGS.auth.email}</label>
          <Input
            id="recovery-email-entry"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={emailEntry}
            onChange={(event) => { setEmailEntry(event.target.value); setEmailError(""); }}
            placeholder="you@example.com"
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "recovery-email-entry-error" : undefined}
          />
          {emailError && <p id="recovery-email-entry-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">{emailError}</p>}
          <div className="mt-atlas-6">
            <Button type="submit" fullWidth loading={isRecoveringEmail} loadingLabel={ATLAS_UI_STRINGS.auth.sendingRecoveryCode}>{ATLAS_UI_STRINGS.auth.sendRecoveryCode}</Button>
          </div>
          <div className="mt-atlas-6 text-center">
            <Link href="/login" className="inline-flex min-h-atlas-12 items-center rounded-atlas-control font-atlas-medium text-atlas-primary hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">{ATLAS_UI_STRINGS.auth.backToLogin}</Link>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.recoveryVerifyTitle}
      description={<>{ATLAS_UI_STRINGS.auth.recoveryVerifyDescription} <span className="font-atlas-medium text-atlas-text">{pendingEmail}</span></>}
    >
      <form className="flex flex-col" noValidate onSubmit={verifyCode}>
        {verificationError && <Feedback role="alert" tone="danger">{verificationError}</Feedback>}
        {feedback && (
          <div className={verificationError ? "mt-atlas-3" : undefined}>
            <Feedback role={feedback.tone === "danger" ? "alert" : "status"} tone={feedback.tone}>{feedback.message}</Feedback>
          </div>
        )}

        <div className={verificationError || feedback ? "mt-atlas-5" : undefined}>
          <label htmlFor="recovery-code" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">{ATLAS_UI_STRINGS.auth.recoveryCode}</label>
          <AuthOtpInput
            id="recovery-code"
            length={AUTH_EMAIL_OTP_LENGTH}
            value={token}
            onValueChange={(value) => { setToken(value); setVerificationError(""); }}
            invalid={Boolean(verificationError)}
          />
          <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">{AUTH_EMAIL_OTP_LENGTH}-digit code</p>
        </div>

        <div className="mt-atlas-6">
          <Button type="submit" fullWidth disabled={isVerifying || isRedirecting} loading={isVerifying || isRedirecting} loadingLabel={ATLAS_UI_STRINGS.auth.verifyingRecoveryCode}>{ATLAS_UI_STRINGS.auth.verifyRecoveryCode}</Button>
        </div>

        <div className="mt-atlas-6 flex flex-col items-center text-center text-atlas-sm text-atlas-text-muted">
          <span>{ATLAS_UI_STRINGS.auth.didntReceiveCode}</span>
          <Button type="button" variant="ghost" disabled={resendSeconds > 0 || isResending} loading={isResending} loadingLabel={ATLAS_UI_STRINGS.auth.resendingCode} onClick={resendCode}>
            {resendSeconds > 0 ? `${ATLAS_UI_STRINGS.auth.resendAvailableIn} ${formatCountdown(resendSeconds)}` : ATLAS_UI_STRINGS.auth.resendCode}
          </Button>
          <div className="mt-atlas-2 flex flex-wrap items-center justify-center gap-atlas-2">
            <span>{ATLAS_UI_STRINGS.auth.wrongEmail}</span>
            <Button type="button" variant="ghost" onClick={changeEmail}>{ATLAS_UI_STRINGS.auth.changeEmail}</Button>
          </div>
          <Link href="/login" className="mt-atlas-2 inline-flex min-h-atlas-12 items-center rounded-atlas-control font-atlas-medium text-atlas-primary hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">{ATLAS_UI_STRINGS.auth.backToLogin}</Link>
        </div>
      </form>
    </AuthShell>
  );
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
