"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type AddProductionLabourerInput = Readonly<{
  name: string;
  originLabel: string | null;
}>;

export type AddProductionLabourerDrawerProps = Readonly<{
  onCreate: (input: AddProductionLabourerInput) => Promise<string | null>;
  onClose: () => void;
}>;

export function AddProductionLabourerDrawer({
  onCreate,
  onClose,
}: AddProductionLabourerDrawerProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
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
    setSuccessMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedName = name.trim();
    if (!normalizedName) {
      setSubmitError("Labourer name is required.");
      setSuccessMessage("");
      nameInputRef.current?.focus();
      return;
    }

    const normalizedOrigin = origin.trim() || null;
    setIsSubmitting(true);
    clearFeedback();
    try {
      const mutationError = await onCreate({
        name: normalizedName,
        originLabel: normalizedOrigin,
      });
      if (mutationError) {
        setSubmitError(mutationError);
        return;
      }

      setName("");
      setOrigin("");
      setSuccessMessage("Labourer added.");
      requestAnimationFrame(() => nameInputRef.current?.focus());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Add Production labourer" className="absolute inset-0 bg-atlas-text/15" disabled={isSubmitting} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-production-labourer-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-center justify-between border-b border-atlas-border px-atlas-5 py-atlas-4">
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
            Workforce directory
          </p>
          <Button
            variant="ghost"
            aria-label="Close Add Production labourer"
            disabled={isSubmitting}
            onClick={onClose}
          >
            {ATLAS_UI_STRINGS.actions.close}
          </Button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="flex-1 overflow-y-auto px-atlas-5 py-atlas-6">
            <h2 id="add-production-labourer-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">
              Add labourer
            </h2>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
              Create an active worker for daily Production recording.
            </p>

            <div className="mt-atlas-6 space-y-atlas-4">
              <FormField label="Labourer name">
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

              <div>
                <FormField label="Origin (optional)">
                  <Input
                    value={origin}
                    onChange={(event) => { setOrigin(event.target.value); clearFeedback(); }}
                    disabled={isSubmitting}
                    maxLength={100}
                    autoComplete="off"
                    placeholder="For example, Bengal or Bihar"
                  />
                </FormField>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                  Used only for identification and filtering. It does not affect wages.
                </p>
              </div>
            </div>

            <div className="mt-atlas-5 space-y-atlas-3">
              {submitError && <Feedback role="alert" tone="danger">{submitError}</Feedback>}
              {successMessage && <Feedback role="status" tone="success">{successMessage}</Feedback>}
              <Feedback tone="neutral">
                Set the worker&apos;s first direct rate later from Manage. Rate history remains a separate effective-dated action.
              </Feedback>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-atlas-3 border-t border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
            <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {ATLAS_UI_STRINGS.actions.cancel}
            </Button>
            <Button type="submit" loading={isSubmitting} loadingLabel="Adding...">
              Add labourer
            </Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
