"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form-controls";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { SignupOtpInput } from "@/features/auth/components/signup-otp-input";
import {
  clearPendingSignupEmail,
  consumeSignupOtpRecentlySent,
  readPendingSignupEmail,
  savePendingSignupEmail,
} from "@/features/auth/services/pending-signup-state";
import {
  CURRENT_SIGNUP_OTP_LENGTH,
  SIGNUP_RESEND_COOLDOWN_SECONDS,
  formatResendCountdown,
  nextResendCountdown,
  resendSignupOtp,
  verifySignupOtp,
} from "@/features/auth/services/signup-service";
import { pendingEmailSchema } from "@/features/auth/services/signup-validation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type PendingEmailState = string | null | undefined;

export default function VerifySignupEmailPage() {
  const router = useRouter();
  const isVerifyingRef = useRef(false);
  const isResendingRef = useRef(false);
  const [pendingEmail, setPendingEmail] = useState<PendingEmailState>(undefined);
  const [emailEntry, setEmailEntry] = useState("");
  const [emailError, setEmailError] = useState("");
  const [token, setToken] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [resendFeedback, setResendFeedback] = useState<
    { tone: "success" | "danger"; message: string } | null
  >(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    const savedEmail = readPendingSignupEmail();
    setPendingEmail(savedEmail);
    if (savedEmail && consumeSignupOtpRecentlySent()) {
      setResendSeconds(SIGNUP_RESEND_COOLDOWN_SECONDS);
    }
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timeoutId = window.setTimeout(() => {
      setResendSeconds((seconds) => nextResendCountdown(seconds));
    }, 1_000);
    return () => window.clearTimeout(timeoutId);
  }, [resendSeconds]);

  function recoverPendingEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = pendingEmailSchema.safeParse(emailEntry);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? ATLAS_UI_STRINGS.auth.emailInvalid);
      return;
    }

    savePendingSignupEmail(parsed.data);
    setPendingEmail(parsed.data);
    setEmailError("");
    setResendSeconds(0);
  }

  async function verifyEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingEmail || isVerifyingRef.current) return;
    if (token.length !== CURRENT_SIGNUP_OTP_LENGTH) {
      setVerificationError(ATLAS_UI_STRINGS.auth.otpRequired);
      return;
    }

    isVerifyingRef.current = true;
    let keepSubmissionLocked = false;
    setIsVerifying(true);
    setVerificationError("");
    setResendFeedback(null);
    try {
      const result = await verifySignupOtp(pendingEmail, token);
      if (!result.ok) {
        setVerificationError(result.message);
        return;
      }

      clearPendingSignupEmail();
      keepSubmissionLocked = true;
      setIsRedirecting(true);
      router.replace(result.destination);
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
    setResendFeedback(null);
    try {
      const result = await resendSignupOtp(pendingEmail);
      if (!result.ok) {
        setResendFeedback({ tone: "danger", message: result.message });
        return;
      }

      setToken("");
      setResendSeconds(SIGNUP_RESEND_COOLDOWN_SECONDS);
      setResendFeedback({ tone: "success", message: ATLAS_UI_STRINGS.auth.resendSuccess });
    } finally {
      isResendingRef.current = false;
      setIsResending(false);
    }
  }

  function changeEmail() {
    clearPendingSignupEmail();
    router.push("/signup");
  }

  if (pendingEmail === undefined) {
    return (
      <AuthShell
        title={ATLAS_UI_STRINGS.auth.verifyTitle}
        description={ATLAS_UI_STRINGS.auth.checkingVerification}
      >
        <p className="text-atlas-sm text-atlas-text-muted" role="status">
          {ATLAS_UI_STRINGS.auth.checkingVerification}
        </p>
      </AuthShell>
    );
  }

  if (pendingEmail === null) {
    return (
      <AuthShell
        title={ATLAS_UI_STRINGS.auth.verifyTitle}
        description={ATLAS_UI_STRINGS.auth.missingEmailDescription}
      >
        <form className="flex flex-col" noValidate onSubmit={recoverPendingEmail}>
          <label htmlFor="verification-email" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
            {ATLAS_UI_STRINGS.auth.email}
          </label>
          <Input
            id="verification-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={emailEntry}
            onChange={(event) => {
              setEmailEntry(event.target.value);
              setEmailError("");
            }}
            placeholder="you@example.com"
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "verification-email-error" : undefined}
          />
          {emailError && (
            <p id="verification-email-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
              {emailError}
            </p>
          )}
          <div className="mt-atlas-6">
            <Button type="submit" fullWidth>
              {ATLAS_UI_STRINGS.auth.continueToVerification}
            </Button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.verifyTitle}
      description={(
        <>
          {ATLAS_UI_STRINGS.auth.verifyDescription}{" "}
          <span className="font-atlas-medium text-atlas-text">{pendingEmail}</span>
        </>
      )}
    >
      <form className="flex flex-col" noValidate onSubmit={verifyEmail}>
        {verificationError && (
          <Feedback role="alert" tone="danger">
            {verificationError}
          </Feedback>
        )}
        {resendFeedback && (
          <div className={verificationError ? "mt-atlas-3" : undefined}>
            <Feedback role={resendFeedback.tone === "danger" ? "alert" : "status"} tone={resendFeedback.tone}>
              {resendFeedback.message}
            </Feedback>
          </div>
        )}

        <div className={verificationError || resendFeedback ? "mt-atlas-5" : undefined}>
          <label htmlFor="signup-verification-code" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
            {ATLAS_UI_STRINGS.auth.verificationCode}
          </label>
          <SignupOtpInput
            id="signup-verification-code"
            length={CURRENT_SIGNUP_OTP_LENGTH}
            value={token}
            onValueChange={(value) => {
              setToken(value);
              setVerificationError("");
            }}
            invalid={Boolean(verificationError)}
          />
          <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
            {CURRENT_SIGNUP_OTP_LENGTH}-digit code
          </p>
        </div>

        <div className="mt-atlas-6">
          <Button
            type="submit"
            fullWidth
            disabled={isVerifying || isRedirecting}
            loading={isVerifying || isRedirecting}
            loadingLabel={ATLAS_UI_STRINGS.auth.verifyingEmail}
          >
            {ATLAS_UI_STRINGS.auth.verifyEmail}
          </Button>
        </div>

        <div className="mt-atlas-6 flex flex-col items-center text-center text-atlas-sm text-atlas-text-muted">
          <span>{ATLAS_UI_STRINGS.auth.didntReceiveCode}</span>
          <Button
            type="button"
            variant="ghost"
            disabled={resendSeconds > 0 || isResending}
            loading={isResending}
            loadingLabel={ATLAS_UI_STRINGS.auth.resendingCode}
            onClick={resendCode}
          >
            {resendSeconds > 0
              ? `${ATLAS_UI_STRINGS.auth.resendAvailableIn} ${formatResendCountdown(resendSeconds)}`
              : ATLAS_UI_STRINGS.auth.resendCode}
          </Button>

          <div className="mt-atlas-2 flex flex-wrap items-center justify-center gap-atlas-2">
            <span>{ATLAS_UI_STRINGS.auth.wrongEmail}</span>
            <Button type="button" variant="ghost" onClick={changeEmail}>
              {ATLAS_UI_STRINGS.auth.changeEmail}
            </Button>
          </div>
        </div>
      </form>
    </AuthShell>
  );
}
