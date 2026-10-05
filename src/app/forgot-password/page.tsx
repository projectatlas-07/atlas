"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { AuthShell } from "@/features/auth/components/auth-shell";
import {
  markRecoveryOtpRecentlySent,
  savePendingRecoveryEmail,
} from "@/features/auth/services/pending-recovery-state";
import { requestPasswordRecovery } from "@/features/auth/services/recovery-service";
import { recoveryEmailSchema } from "@/features/auth/services/recovery-validation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type ForgotPasswordForm = { email: string };

export default function ForgotPasswordPage() {
  const router = useRouter();
  const isRequestingRef = useRef(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ForgotPasswordForm>({
    defaultValues: { email: "" },
  });

  async function sendRecoveryCode(values: ForgotPasswordForm) {
    if (isRequestingRef.current) return;
    const parsed = recoveryEmailSchema.safeParse(values.email);
    if (!parsed.success) {
      setError("email", { message: parsed.error.issues[0]?.message ?? ATLAS_UI_STRINGS.auth.emailInvalid });
      return;
    }

    isRequestingRef.current = true;
    await requestPasswordRecovery(parsed.data);
    savePendingRecoveryEmail(parsed.data);
    markRecoveryOtpRecentlySent();
    setIsRedirecting(true);
    router.push("/recover/verify");
  }

  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.forgotPasswordTitle}
      description={ATLAS_UI_STRINGS.auth.forgotPasswordDescription}
    >
      <form className="flex flex-col" noValidate onSubmit={handleSubmit(sendRecoveryCode)}>
        <label htmlFor="recovery-email" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
          {ATLAS_UI_STRINGS.auth.email}
        </label>
        <Input
          {...register("email")}
          id="recovery-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "recovery-email-error" : undefined}
        />
        {errors.email && (
          <p id="recovery-email-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
            {errors.email.message}
          </p>
        )}

        <div className="mt-atlas-6">
          <Button
            type="submit"
            fullWidth
            disabled={isSubmitting || isRedirecting}
            loading={isSubmitting || isRedirecting}
            loadingLabel={ATLAS_UI_STRINGS.auth.sendingRecoveryCode}
          >
            {ATLAS_UI_STRINGS.auth.sendRecoveryCode}
          </Button>
        </div>

        <div className="mt-atlas-6 text-center">
          <Link href="/login" className="inline-flex min-h-atlas-12 items-center rounded-atlas-control font-atlas-medium text-atlas-primary hover:text-atlas-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
            {ATLAS_UI_STRINGS.auth.backToLogin}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
