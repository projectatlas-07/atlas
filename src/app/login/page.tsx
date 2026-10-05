"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form-controls";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { readPendingRecoverySession } from "@/features/auth/services/pending-recovery-state";
import {
  loginWithPassword,
  resolvePostLoginDestination,
  type LoginDestinationResult,
} from "@/features/auth/services/login-service";
import { ATLAS_UI_STRINGS } from "@/lib/strings";
import { supabase } from "@/lib/supabase/client";

const loginFormSchema = z.object({
  email: z.string().trim()
    .min(1, ATLAS_UI_STRINGS.auth.emailRequired)
    .email(ATLAS_UI_STRINGS.auth.emailInvalid),
  password: z.string().min(1, ATLAS_UI_STRINGS.auth.passwordRequired),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export default function LoginPage() {
  const router = useRouter();
  const isSigningInRef = useRef(false);
  const [authenticationError, setAuthenticationError] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    defaultValues: { email: "", password: "" },
  });

  const followDestination = useCallback((result: LoginDestinationResult) => {
    if (!result.ok) {
      setAuthenticationError(result.message);
      return;
    }

    setIsRedirecting(true);
    router.replace(result.destination);
    router.refresh();
  }, [router]);

  useEffect(() => {
    let isCancelled = false;

    async function redirectExistingSession() {
      if (readPendingRecoverySession()) {
        setIsRedirecting(true);
        router.replace("/recover/new-password");
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (isCancelled) return;

      if (error || !data.session) {
        setIsCheckingSession(false);
        return;
      }

      const destination = await resolvePostLoginDestination();
      if (isCancelled) return;
      setIsCheckingSession(false);
      followDestination(destination);
    }

    void redirectExistingSession();
    setPasswordUpdated(new URLSearchParams(window.location.search).get("password") === "updated");
    return () => { isCancelled = true; };
  }, [followDestination, router]);

  async function signIn(values: LoginFormValues) {
    if (isSigningInRef.current) return;

    const parsed = loginFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      if (fieldErrors.email?.[0]) setError("email", { message: fieldErrors.email[0] });
      if (fieldErrors.password?.[0]) setError("password", { message: fieldErrors.password[0] });
      return;
    }

    isSigningInRef.current = true;
    setAuthenticationError("");
    try {
      followDestination(await loginWithPassword(parsed.data));
    } finally {
      isSigningInRef.current = false;
    }
  }

  const isBusy = isCheckingSession || isSubmitting || isRedirecting;
  const passwordToggleLabel = showPassword
    ? ATLAS_UI_STRINGS.auth.hidePassword
    : ATLAS_UI_STRINGS.auth.showPassword;

  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.loginTitle}
      description={ATLAS_UI_STRINGS.auth.loginDescription}
    >
      <form className="flex flex-col" noValidate onSubmit={handleSubmit(signIn)}>
        {passwordUpdated && (
          <Feedback role="status" tone="success">
            {ATLAS_UI_STRINGS.auth.passwordUpdated}
          </Feedback>
        )}
        {authenticationError && (
          <div className={passwordUpdated ? "mt-atlas-3" : undefined}>
            <Feedback role="alert" tone="danger">
              {authenticationError}
            </Feedback>
          </div>
        )}

        <div className={authenticationError || passwordUpdated ? "mt-atlas-5" : undefined}>
          <label htmlFor="login-email" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
            {ATLAS_UI_STRINGS.auth.email}
          </label>
          <Input
            {...register("email", { onChange: () => setAuthenticationError("") })}
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "login-email-error" : undefined}
          />
          {errors.email && (
            <p id="login-email-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="mt-atlas-5">
          <div className="flex items-center justify-between gap-atlas-4">
            <label htmlFor="login-password" className="text-atlas-sm font-atlas-medium text-atlas-text">
              {ATLAS_UI_STRINGS.auth.password}
            </label>
            <Link href="/forgot-password" className="inline-flex min-h-atlas-12 items-center rounded-atlas-control text-atlas-sm font-atlas-medium text-atlas-primary hover:text-atlas-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
              {ATLAS_UI_STRINGS.auth.forgotPassword}
            </Link>
          </div>
          <div className="relative">
            <Input
              {...register("password", { onChange: () => setAuthenticationError("") })}
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              withTrailingAction
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "login-password-error" : undefined}
            />
            <div className="absolute inset-y-atlas-0 right-atlas-0 flex items-center">
              <Button
                type="button"
                variant="ghost"
                aria-label={passwordToggleLabel}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((isVisible) => !isVisible)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
            </div>
          </div>
          {errors.password && (
            <p id="login-password-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="mt-atlas-6">
          <Button
            type="submit"
            fullWidth
            disabled={isBusy}
            loading={isSubmitting || isRedirecting}
            loadingLabel={ATLAS_UI_STRINGS.auth.loggingIn}
          >
            {ATLAS_UI_STRINGS.auth.login}
          </Button>
        </div>

        <p className="mt-atlas-6 flex flex-wrap items-center justify-center gap-atlas-2 text-center text-atlas-sm text-atlas-text-muted sm:mt-atlas-8">
          <span>{ATLAS_UI_STRINGS.auth.newToAtlas}</span>
          <Link href="/signup" className="inline-flex min-h-atlas-12 items-center rounded-atlas-control font-atlas-medium text-atlas-primary hover:text-atlas-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
            {ATLAS_UI_STRINGS.auth.createAccount}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-atlas-5 w-atlas-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.04 12.32a1.01 1.01 0 0 1 0-.64C3.42 7.51 7.36 4.5 12 4.5s8.57 3.01 9.96 7.18c.07.21.07.43 0 .64C20.58 16.49 16.64 19.5 12 19.5S3.42 16.49 2.04 12.32Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="h-atlas-5 w-atlas-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.22A10.48 10.48 0 0 0 1.93 12C3.23 16.34 7.24 19.5 12 19.5c.99 0 1.95-.14 2.86-.4M6.23 6.23A10.45 10.45 0 0 1 12 4.5c4.76 0 8.77 3.16 10.07 7.5a10.52 10.52 0 0 1-4.3 5.77M6.23 6.23 3 3m3.23 3.23 3.65 3.65m7.89 7.89L21 21m-3.23-3.23-3.65-3.65m0 0a3 3 0 1 0-4.24-4.24m4.24 4.24L9.88 9.88" />
    </svg>
  );
}
