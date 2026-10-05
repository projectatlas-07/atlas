"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form-controls";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { PasswordField } from "@/features/auth/components/password-field";
import {
  markSignupOtpRecentlySent,
  savePendingSignupEmail,
} from "@/features/auth/services/pending-signup-state";
import { signupWithPassword } from "@/features/auth/services/signup-service";
import {
  signupFormSchema,
  type SignupFormValues,
} from "@/features/auth/services/signup-validation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export default function SignupPage() {
  const router = useRouter();
  const isCreatingRef = useRef(false);
  const [signupError, setSignupError] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<SignupFormValues>({
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  async function createAccount(values: SignupFormValues) {
    if (isCreatingRef.current) return;

    const parsed = signupFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      if (fieldErrors.email?.[0]) setError("email", { message: fieldErrors.email[0] });
      if (fieldErrors.password?.[0]) setError("password", { message: fieldErrors.password[0] });
      if (fieldErrors.confirmPassword?.[0]) {
        setError("confirmPassword", { message: fieldErrors.confirmPassword[0] });
      }
      return;
    }

    isCreatingRef.current = true;
    let keepSubmissionLocked = false;
    setSignupError("");
    try {
      const result = await signupWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (!result.ok) {
        setSignupError(result.message);
        return;
      }

      savePendingSignupEmail(parsed.data.email);
      markSignupOtpRecentlySent();
      keepSubmissionLocked = true;
      setIsRedirecting(true);
      router.push("/signup/verify");
    } finally {
      if (!keepSubmissionLocked) isCreatingRef.current = false;
    }
  }

  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.signupTitle}
      description={ATLAS_UI_STRINGS.auth.signupDescription}
    >
      <form className="flex flex-col" noValidate onSubmit={handleSubmit(createAccount)}>
        {signupError && (
          <Feedback role="alert" tone="danger">
            {signupError}
          </Feedback>
        )}

        <div className={signupError ? "mt-atlas-5" : undefined}>
          <label htmlFor="signup-email" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
            {ATLAS_UI_STRINGS.auth.email}
          </label>
          <Input
            {...register("email", { onChange: () => setSignupError("") })}
            id="signup-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "signup-email-error" : undefined}
          />
          {errors.email && (
            <p id="signup-email-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="mt-atlas-5">
          <PasswordField
            {...register("password", { onChange: () => setSignupError("") })}
            id="signup-password"
            label={ATLAS_UI_STRINGS.auth.password}
            autoComplete="new-password"
            help={ATLAS_UI_STRINGS.auth.passwordHelp}
            error={errors.password?.message}
          />
        </div>

        <div className="mt-atlas-5">
          <PasswordField
            {...register("confirmPassword", { onChange: () => setSignupError("") })}
            id="signup-confirm-password"
            label={ATLAS_UI_STRINGS.auth.confirmPassword}
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
          />
        </div>

        <div className="mt-atlas-6">
          <Button
            type="submit"
            fullWidth
            disabled={isSubmitting || isRedirecting}
            loading={isSubmitting || isRedirecting}
            loadingLabel={ATLAS_UI_STRINGS.auth.creatingAccount}
          >
            {ATLAS_UI_STRINGS.auth.createAccount}
          </Button>
        </div>

        <p className="mt-atlas-6 flex flex-wrap items-center justify-center gap-atlas-2 text-center text-atlas-sm text-atlas-text-muted sm:mt-atlas-8">
          <span>{ATLAS_UI_STRINGS.auth.alreadyHaveAccount}</span>
          <Link href="/login" className="inline-flex min-h-atlas-12 items-center rounded-atlas-control font-atlas-medium text-atlas-primary hover:text-atlas-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
            {ATLAS_UI_STRINGS.auth.login}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
