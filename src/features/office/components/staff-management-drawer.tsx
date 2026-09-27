"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
import {
  buildStaffReferenceSalaryInput,
  getStaffInitials,
  staffOfficeErrorMessage,
} from "@/features/office/staff-office-model";
import {
  staffPaymentSummaryQueryKey,
  staffWorkersQueryKey,
} from "@/features/office/staff-office-query-keys";
import { getStaffPaymentSummary } from "@/features/staff/services/staff-payment-service";
import {
  archiveStaffWorker,
  deleteStaffWorker,
  restoreStaffWorker,
  updateStaffReferenceSalary,
} from "@/features/staff/services/staff-worker-service";
import type { StaffCategory, StaffWorker } from "@/features/staff/types";
import { formatIndianCurrency } from "@/lib/formatting";
import {
  resolveBooleanStatusPresentation,
  STAFF_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type SavingAction = "reference" | "archive" | "restore" | "delete" | "";

export function StaffManagementDrawer({
  factoryId,
  worker,
  category,
  onClose,
}: Readonly<{
  factoryId: string;
  worker: StaffWorker;
  category: StaffCategory | null;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [isEditingReference, setIsEditingReference] = useState(false);
  const [referenceSalary, setReferenceSalary] = useState(
    worker.referenceSalary.toString(),
  );
  const [savingAction, setSavingAction] = useState<SavingAction>("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const drawer = closeButtonRef.current?.closest('[role="dialog"]');
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

  const paymentSummaryQuery = useQuery({
    queryKey: staffPaymentSummaryQueryKey(factoryId, worker.id),
    queryFn: () => getStaffPaymentSummary({ factoryId, staffWorkerId: worker.id }),
  });
  const lifecycleStatus = resolveBooleanStatusPresentation(
    STAFF_WORKER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  const hasPaymentHistory = (paymentSummaryQuery.data?.totalPaid ?? 0) > 0;
  const canDelete = worker.isActive
    && !paymentSummaryQuery.isLoading
    && !paymentSummaryQuery.error
    && !hasPaymentHistory;

  function clearFeedback() {
    setError("");
    setSuccess("");
  }

  function cacheWorker(updatedWorker: StaffWorker) {
    queryClient.setQueryData<StaffWorker[]>(
      staffWorkersQueryKey(factoryId),
      (current = []) => current.map((item) => (
        item.id === updatedWorker.id ? updatedWorker : item
      )),
    );
  }

  async function saveReferenceSalary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingAction) return;
    if (!worker.isActive) {
      setError("Restore this archived Staff member before changing the reference salary.");
      return;
    }
    const input = buildStaffReferenceSalaryInput({
      factoryId,
      staffWorkerId: worker.id,
      referenceSalary,
    });
    if (!input) {
      setError("Enter a positive reference salary.");
      return;
    }

    setSavingAction("reference");
    clearFeedback();
    try {
      const updatedWorker = await updateStaffReferenceSalary(input);
      cacheWorker(updatedWorker);
      setReferenceSalary(updatedWorker.referenceSalary.toString());
      setIsEditingReference(false);
      setSuccess("Reference salary updated. Payments and payment history are unchanged.");
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not update the reference salary."));
    } finally {
      setSavingAction("");
    }
  }

  async function toggleLifecycle() {
    if (savingAction) return;
    const action = worker.isActive ? "archive" : "restore";
    setSavingAction(action);
    setConfirmingDelete(false);
    clearFeedback();
    try {
      const updatedWorker = worker.isActive
        ? await archiveStaffWorker({ factoryId, staffWorkerId: worker.id })
        : await restoreStaffWorker({ factoryId, staffWorkerId: worker.id });
      cacheWorker(updatedWorker);
      setIsEditingReference(false);
      setSuccess(worker.isActive
        ? "Staff member archived. Existing payments remain unchanged."
        : "Staff member restored.");
    } catch (failure) {
      setError(staffOfficeErrorMessage(
        failure,
        worker.isActive
          ? "Could not archive the Staff member."
          : "Could not restore the Staff member.",
      ));
    } finally {
      setSavingAction("");
    }
  }

  async function deleteWorker() {
    if (savingAction || !canDelete) return;
    setSavingAction("delete");
    clearFeedback();
    try {
      await deleteStaffWorker({ factoryId, staffWorkerId: worker.id });
      queryClient.setQueryData<StaffWorker[]>(
        staffWorkersQueryKey(factoryId),
        (current = []) => current.filter((item) => item.id !== worker.id),
      );
      onClose();
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not delete the Staff member."));
      setConfirmingDelete(false);
    } finally {
      setSavingAction("");
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal management drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Staff management" className="absolute inset-0 bg-atlas-text/15" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-management-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="flex items-start justify-between gap-atlas-3">
            <div className="flex min-w-0 items-start gap-atlas-3">
              <div aria-hidden="true" className="flex h-atlas-12 w-atlas-12 shrink-0 items-center justify-center rounded-atlas-pill bg-atlas-primary-surface text-atlas-base font-atlas-semibold text-atlas-primary">
                {getStaffInitials(worker.name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-atlas-2">
                  <h2 id="staff-management-title" className="truncate text-atlas-xl font-atlas-semibold text-atlas-text">{worker.name}</h2>
                  <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
                </div>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{category?.name ?? "Unknown category"}</p>
              </div>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Staff management drawer" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </div>

          <div className="mt-atlas-4">
            <Card surface="muted">
              <div className="flex items-baseline justify-between gap-atlas-3">
                <p className="text-atlas-sm text-atlas-text-muted">Reference salary</p>
                <p className="text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(worker.referenceSalary)}</p>
              </div>
              <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">
                Reference salary is informational only and does not represent an automatic payable or accrued debt.
              </p>
            </Card>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          <section aria-labelledby="staff-details-heading">
            <h3 id="staff-details-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Staff details</h3>
            <div className="mt-atlas-2 divide-y divide-atlas-border rounded-atlas-card border border-atlas-border bg-atlas-surface">
              <div className="p-atlas-4">
                <p className="text-atlas-xs text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.name}</p>
                <p className="mt-atlas-1 text-atlas-base font-atlas-medium text-atlas-text">{worker.name}</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Staff identity cannot be changed after creation.</p>
              </div>

              <div className="p-atlas-4">
                <p className="text-atlas-xs text-atlas-text-muted">Category</p>
                <p className="mt-atlas-1 text-atlas-base font-atlas-medium text-atlas-text">{category?.name ?? "Unknown category"}</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Category assignment is fixed after Staff creation.</p>
              </div>

              <div className="p-atlas-4">
                <div className="flex items-center justify-between gap-atlas-3">
                  <div className="min-w-0">
                    <p className="text-atlas-xs text-atlas-text-muted">Reference salary</p>
                    <p className="mt-atlas-1 text-atlas-base font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(worker.referenceSalary)}</p>
                  </div>
                  {!isEditingReference && (
                    <Button
                      variant="ghost"
                      disabled={!worker.isActive}
                      onClick={() => {
                        setReferenceSalary(worker.referenceSalary.toString());
                        clearFeedback();
                        setIsEditingReference(true);
                      }}
                    >
                      Change
                    </Button>
                  )}
                </div>

                {isEditingReference && (
                  <form className="mt-atlas-4 border-t border-atlas-border pt-atlas-4" onSubmit={(event) => void saveReferenceSalary(event)}>
                    <FormField label="Change reference salary">
                      <Input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={referenceSalary}
                        onChange={(event) => { setReferenceSalary(event.target.value); clearFeedback(); }}
                        disabled={savingAction === "reference"}
                        aria-invalid={Boolean(error)}
                        placeholder="0.00"
                      />
                    </FormField>
                    <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Informational only. This does not change actual payments.</p>
                    <div className="mt-atlas-3 flex justify-end gap-atlas-2">
                      <Button variant="ghost" disabled={savingAction === "reference"} onClick={() => { setIsEditingReference(false); clearFeedback(); }}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                      <Button type="submit" loading={savingAction === "reference"} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{ATLAS_UI_STRINGS.actions.save}</Button>
                    </div>
                  </form>
                )}
                {!worker.isActive && <div className="mt-atlas-3"><Feedback tone="warning">Restore this Staff member before changing the reference salary.</Feedback></div>}
              </div>
            </div>
          </section>

          {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
          {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}

          {worker.isActive && (
            <section aria-labelledby="staff-delete-heading" className="mt-atlas-6">
              <h3 id="staff-delete-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Permanent deletion</h3>
              <div className="mt-atlas-2">
                <Card surface="muted">
                  {paymentSummaryQuery.isLoading ? (
                    <p className="text-atlas-sm text-atlas-text-muted">Checking deletion eligibility...</p>
                  ) : paymentSummaryQuery.error ? (
                    <Feedback role="alert" tone="warning">Deletion eligibility is unavailable. Try again.</Feedback>
                  ) : hasPaymentHistory ? (
                    <p className="text-atlas-sm text-atlas-text-muted">Payment history exists, so this Staff member cannot be permanently deleted. Archive them instead.</p>
                  ) : (
                    <p className="text-atlas-sm text-atlas-text-muted">Permanent deletion is available only because this Staff member has no payment history. The database verifies this again before deleting.</p>
                  )}

                  {!confirmingDelete ? (
                    <div className="mt-atlas-3 flex justify-end">
                      <Button variant="danger" disabled={!canDelete || Boolean(savingAction)} onClick={() => { clearFeedback(); setConfirmingDelete(true); }}>Delete unused Staff member</Button>
                    </div>
                  ) : (
                    <div className="mt-atlas-3">
                      <Feedback role="alert" tone="danger">
                        <p className="font-atlas-semibold">Permanently delete {worker.name}?</p>
                        <p className="mt-atlas-1">This cannot be undone.</p>
                        <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
                          <Button variant="danger" loading={savingAction === "delete"} loadingLabel="Deleting..." disabled={Boolean(savingAction)} onClick={() => void deleteWorker()}>Confirm permanent delete</Button>
                          <Button variant="secondary" disabled={Boolean(savingAction)} onClick={() => setConfirmingDelete(false)}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                        </div>
                      </Feedback>
                    </div>
                  )}
                </Card>
              </div>
            </section>
          )}
        </div>

        <footer className="border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium">
          <div className="flex items-center justify-between gap-atlas-3">
            <div>
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Staff status</p>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                {worker.isActive
                  ? "Archiving removes this Staff member from active lists while preserving payment history."
                  : "Restoring returns this Staff member to active lists."}
              </p>
            </div>
            <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
          </div>
          <div className="mt-atlas-3 flex flex-col">
            <Button
              variant={worker.isActive ? "danger" : "secondary"}
              loading={savingAction === "archive" || savingAction === "restore"}
              loadingLabel={worker.isActive ? "Archiving..." : "Restoring..."}
              disabled={Boolean(savingAction)}
              onClick={() => void toggleLifecycle()}
            >
              {worker.isActive ? "Archive Staff member" : "Restore Staff member"}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
