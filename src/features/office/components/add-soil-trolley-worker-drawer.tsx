"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type AddSoilTrolleyWorkerInput = Readonly<{
  name: string;
  initialRate: string;
  effectiveFrom: string;
}>;

export type AddSoilTrolleyWorkerDrawerProps = Readonly<{
  onCreate: (input: AddSoilTrolleyWorkerInput) => Promise<string | null>;
  onClose: () => void;
}>;

export function AddSoilTrolleyWorkerDrawer({
  onCreate,
  onClose,
}: AddSoilTrolleyWorkerDrawerProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [name, setName] = useState("");
  const [initialRate, setInitialRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(getLocalDate);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameInputRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isSubmittingRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const drawer = nameInputRef.current?.closest('[role="dialog"]');
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  function clearFeedback() {
    setSubmitError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedName = name.trim().replace(/\s+/g, " ");
    if (!normalizedName) {
      setSubmitError("Worker name is required.");
      nameInputRef.current?.focus();
      return;
    }

    const numericRate = Number(initialRate);
    if (!initialRate.trim() || !Number.isFinite(numericRate) || numericRate <= 0) {
      setSubmitError("Initial trolley rate must be greater than zero.");
      return;
    }
    if (!effectiveFrom) {
      setSubmitError("Effective-from date is required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const mutationError = await onCreate({
        name: normalizedName,
        initialRate,
        effectiveFrom,
      });
      if (mutationError) setSubmitError(mutationError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Add Soil / Trolley worker" className="absolute inset-0 bg-atlas-text/15" disabled={isSubmitting} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-soil-trolley-worker-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-center justify-between border-b border-atlas-border px-atlas-5 py-atlas-4">
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Workforce directory</p>
          <Button variant="ghost" aria-label="Close Add Soil / Trolley worker" disabled={isSubmitting} onClick={onClose}>
            {ATLAS_UI_STRINGS.actions.close}
          </Button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="flex-1 overflow-y-auto px-atlas-5 py-atlas-6">
            <h2 id="add-soil-trolley-worker-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">Add Soil / Trolley worker</h2>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Create an active individual worker with their first effective-dated trolley rate.</p>

            <div className="mt-atlas-6 space-y-atlas-4">
              <FormField label="Worker name">
                <Input
                  ref={nameInputRef}
                  value={name}
                  onChange={(event) => { setName(event.target.value); clearFeedback(); }}
                  disabled={isSubmitting}
                  required
                  aria-invalid={Boolean(submitError && !name.trim())}
                  autoComplete="name"
                  placeholder="Enter worker full name"
                />
              </FormField>

              <FormField label="Initial ₹ / trolley">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={initialRate}
                  onChange={(event) => { setInitialRate(event.target.value); clearFeedback(); }}
                  disabled={isSubmitting}
                  required
                  aria-invalid={Boolean(submitError && (!initialRate.trim() || Number(initialRate) <= 0))}
                  autoComplete="off"
                  placeholder="0.00"
                />
              </FormField>

              <FormField label="Effective from">
                <Input
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => { setEffectiveFrom(event.target.value); clearFeedback(); }}
                  disabled={isSubmitting}
                  required
                  aria-invalid={Boolean(submitError && !effectiveFrom)}
                />
              </FormField>
            </div>

            <div className="mt-atlas-5 space-y-atlas-3">
              {submitError && <Feedback role="alert" tone="danger">{submitError}</Feedback>}
              <Feedback tone="neutral">The worker and initial trolley rate are created together. If either fails, nothing is created.</Feedback>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-atlas-3 border-t border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
            <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
            <Button type="submit" loading={isSubmitting} loadingLabel="Adding worker...">Add worker</Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
