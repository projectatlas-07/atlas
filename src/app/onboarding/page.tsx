"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form-controls";
import { AccountAccessDisabled } from "@/features/auth/components/account-access-disabled";
import { AuthShell } from "@/features/auth/components/auth-shell";
import {
  clearPendingSignupEmail,
  savePendingSignupEmail,
} from "@/features/auth/services/pending-signup-state";
import {
  FACTORY_NAME_MAX_LENGTH,
  factoryNameSchema,
  provisionFirstFactory,
  resolveOnboardingAccess,
  type OnboardingAccessResult,
} from "@/features/auth/services/onboarding-service";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type OnboardingViewState =
  | { status: "loading" }
  | { status: "eligible"; email: string | null }
  | { status: "disabled" }
  | { status: "error"; message: string };

export default function OnboardingPage() {
  const router = useRouter();
  const isSubmittingRef = useRef(false);
  const [resolutionAttempt, setResolutionAttempt] = useState(0);
  const [viewState, setViewState] = useState<OnboardingViewState>({ status: "loading" });
  const [factoryName, setFactoryName] = useState("");
  const [factoryNameError, setFactoryNameError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    function routeToVerification(email: string | null) {
      if (email) savePendingSignupEmail(email);
      else clearPendingSignupEmail();
      router.replace("/signup/verify");
      router.refresh();
    }

    function applyAccessResult(result: OnboardingAccessResult) {
      if (result.state === "login") {
        router.replace("/login");
        router.refresh();
        return;
      }
      if (result.state === "verification") {
        routeToVerification(result.email);
        return;
      }
      if (result.state === "office") {
        router.replace("/office");
        router.refresh();
        return;
      }
      if (result.state === "eligible") {
        setViewState({ status: "eligible", email: result.email });
        return;
      }
      if (result.state === "disabled") {
        setViewState({ status: "disabled" });
        return;
      }
      setViewState({ status: "error", message: result.message });
    }

    setViewState({ status: "loading" });
    void resolveOnboardingAccess().then((result) => {
      if (!isCancelled) applyAccessResult(result);
    });

    return () => { isCancelled = true; };
  }, [resolutionAttempt, router]);

  async function createFactory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (viewState.status !== "eligible" || isSubmittingRef.current) return;

    const parsed = factoryNameSchema.safeParse(factoryName);
    if (!parsed.success) {
      setFactoryNameError(parsed.error.issues[0]?.message ?? ATLAS_UI_STRINGS.auth.factoryNameRequired);
      return;
    }

    isSubmittingRef.current = true;
    let keepSubmissionLocked = false;
    setIsSubmitting(true);
    setFactoryNameError("");
    setSubmissionError("");
    try {
      const result = await provisionFirstFactory(parsed.data);
      if (result.ok) {
        keepSubmissionLocked = true;
        setIsRedirecting(true);
        router.replace("/office");
        router.refresh();
        return;
      }

      if (result.reason === "unauthenticated") {
        keepSubmissionLocked = true;
        router.replace("/login");
        router.refresh();
        return;
      }
      if (result.reason === "email_unconfirmed") {
        keepSubmissionLocked = true;
        if (viewState.email) savePendingSignupEmail(viewState.email);
        else clearPendingSignupEmail();
        router.replace("/signup/verify");
        router.refresh();
        return;
      }
      if (result.reason === "membership_inactive") {
        setViewState({ status: "disabled" });
        return;
      }
      if (result.reason === "invalid_name") {
        setFactoryNameError(result.message);
        return;
      }
      setSubmissionError(result.message);
    } finally {
      if (!keepSubmissionLocked) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  }

  if (viewState.status === "loading") {
    return (
      <AuthShell
        title={ATLAS_UI_STRINGS.auth.onboardingTitle}
        description={ATLAS_UI_STRINGS.auth.checkingAccount}
      >
        <p role="status" className="text-atlas-sm text-atlas-text-muted">
          {ATLAS_UI_STRINGS.auth.checkingAccount}
        </p>
      </AuthShell>
    );
  }

  if (viewState.status === "disabled") return <AccountAccessDisabled />;

  if (viewState.status === "error") {
    return (
      <AuthShell
        title={ATLAS_UI_STRINGS.auth.onboardingTitle}
        description={ATLAS_UI_STRINGS.auth.onboardingDescription}
      >
        <Feedback role="alert" tone="danger">{viewState.message}</Feedback>
        <div className="mt-atlas-6">
          <Button
            type="button"
            fullWidth
            onClick={() => setResolutionAttempt((attempt) => attempt + 1)}
          >
            {ATLAS_UI_STRINGS.actions.retry}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={ATLAS_UI_STRINGS.auth.onboardingTitle}
      description={ATLAS_UI_STRINGS.auth.onboardingDescription}
    >
      <form className="flex flex-col" noValidate onSubmit={createFactory}>
        {submissionError && (
          <Feedback role="alert" tone="danger">{submissionError}</Feedback>
        )}

        <div className={submissionError ? "mt-atlas-5" : undefined}>
          <label htmlFor="factory-name" className="mb-atlas-2 block text-atlas-sm font-atlas-medium text-atlas-text">
            {ATLAS_UI_STRINGS.auth.factoryName}
          </label>
          <Input
            id="factory-name"
            name="factoryName"
            type="text"
            autoComplete="organization"
            maxLength={FACTORY_NAME_MAX_LENGTH}
            value={factoryName}
            disabled={isSubmitting || isRedirecting}
            onChange={(event) => {
              setFactoryName(event.target.value);
              setFactoryNameError("");
              setSubmissionError("");
            }}
            placeholder={ATLAS_UI_STRINGS.auth.factoryNamePlaceholder}
            aria-invalid={Boolean(factoryNameError)}
            aria-describedby={factoryNameError ? "factory-name-error" : undefined}
          />
          {factoryNameError && (
            <p id="factory-name-error" role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
              {factoryNameError}
            </p>
          )}
        </div>

        <div className="mt-atlas-6">
          <Button
            type="submit"
            fullWidth
            disabled={isSubmitting || isRedirecting}
            loading={isSubmitting || isRedirecting}
            loadingLabel={ATLAS_UI_STRINGS.auth.creatingFactory}
          >
            {ATLAS_UI_STRINGS.auth.createFactory}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
