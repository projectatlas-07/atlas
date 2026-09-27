"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/form-controls";
import type { StaffCategory } from "@/features/staff/types";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type AddStaffInput = Readonly<{
  name: string;
  staffCategoryId: string;
  referenceSalary: string;
}>;

export function AddStaffDrawer({
  categories,
  categoriesLoading,
  categoriesError,
  onCreate,
  onClose,
}: Readonly<{
  categories: readonly StaffCategory[];
  categoriesLoading: boolean;
  categoriesError: Error | null;
  onCreate: (input: AddStaffInput) => Promise<string | null>;
  onClose: () => void;
}>) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [name, setName] = useState("");
  const [staffCategoryId, setStaffCategoryId] = useState("");
  const [referenceSalary, setReferenceSalary] = useState("");
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
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

    if (!name.trim()) {
      setSubmitError("Staff name is required.");
      nameInputRef.current?.focus();
      return;
    }
    if (!staffCategoryId) {
      setSubmitError("Choose a Staff category.");
      return;
    }
    const numericReferenceSalary = Number(referenceSalary);
    if (
      !referenceSalary.trim()
      || !Number.isFinite(numericReferenceSalary)
      || numericReferenceSalary <= 0
    ) {
      setSubmitError("Reference salary must be greater than zero.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const mutationError = await onCreate({
        name,
        staffCategoryId,
        referenceSalary,
      });
      if (mutationError) {
        setSubmitError(mutationError);
        return;
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  const cannotCreate = categoriesLoading || Boolean(categoriesError) || categories.length === 0;

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Add Staff" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" disabled={isSubmitting} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-staff-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-start justify-between gap-atlas-3 border-b border-atlas-border px-atlas-5 py-atlas-4">
          <div>
            <h2 id="add-staff-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">Add Staff</h2>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Create an active Staff member with a category and informational reference salary.</p>
          </div>
          <Button variant="ghost" aria-label="Close Add Staff drawer" disabled={isSubmitting} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-6">
            <div className="space-y-atlas-4">
              <FormField label="Staff name">
                <Input
                  ref={nameInputRef}
                  value={name}
                  onChange={(event) => { setName(event.target.value); clearFeedback(); }}
                  disabled={isSubmitting}
                  required
                  aria-invalid={Boolean(submitError && !name.trim())}
                  autoComplete="name"
                  placeholder="Enter full name"
                />
              </FormField>

              <div>
                <FormField label="Category">
                  <Select
                    value={staffCategoryId}
                    onChange={(event) => { setStaffCategoryId(event.target.value); clearFeedback(); }}
                    disabled={isSubmitting || cannotCreate}
                    required
                    aria-invalid={Boolean(submitError && !staffCategoryId)}
                  >
                    <option value="">Select category</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </Select>
                </FormField>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Category is fixed after Staff creation.</p>
              </div>

              <div>
                <FormField label="Reference salary">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={referenceSalary}
                    onChange={(event) => { setReferenceSalary(event.target.value); clearFeedback(); }}
                    disabled={isSubmitting}
                    required
                    aria-invalid={Boolean(submitError && (!referenceSalary.trim() || Number(referenceSalary) <= 0))}
                    autoComplete="off"
                    placeholder="0.00"
                  />
                </FormField>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Informational only. It does not create accrued salary, payable debt, or automatic payroll.</p>
              </div>
            </div>

            <div className="mt-atlas-5 space-y-atlas-3">
              {categoriesLoading && <Feedback role="status" tone="neutral">Loading Staff categories...</Feedback>}
              {categoriesError && <Feedback role="alert" tone="danger">Staff categories are unavailable. Close this drawer and try again.</Feedback>}
              {!categoriesLoading && !categoriesError && categories.length === 0 && <Feedback role="status" tone="warning">Add a Staff category before creating a Staff member.</Feedback>}
              {submitError && <Feedback role="alert" tone="danger">{submitError}</Feedback>}
              <Feedback tone="neutral">Staff name and category cannot be changed after creation. Payments are recorded separately in Account &amp; payment.</Feedback>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-atlas-3 border-t border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
            <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
            <Button type="submit" loading={isSubmitting} loadingLabel="Adding Staff..." disabled={cannotCreate}>Add Staff</Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
