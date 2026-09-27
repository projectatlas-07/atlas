"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
import {
  buildSoilAdjustmentInput,
  buildSoilRateChangeInput,
  canOfferUnusedSoilWorkerDelete,
  insertSoilAdjustmentNewestFirst,
  insertSoilRateNewestFirst,
  soilOfficeErrorMessage,
} from "@/features/office/soil-office-model";
import {
  soilAdjustmentsQueryKey,
  soilCurrentRateQueryKey,
  soilEarningHistoryExistenceQueryKey,
  soilFinancialSummaryQueryKey,
  soilPaymentsQueryKey,
  soilRateHistoryQueryKey,
  soilWorkersQueryKey,
} from "@/features/office/soil-office-query-keys";
import { hasSoilEarningHistory } from "@/features/soil/services/soil-earning-read-service";
import {
  createSoilFinancialAdjustment,
  listSoilFinancialAdjustments,
} from "@/features/soil/services/soil-financial-adjustment-service";
import {
  getSoilFinancialSummary,
  listSoilPayments,
} from "@/features/soil/services/soil-payment-service";
import {
  archiveSoilWorker,
  createSoilWorkerTrolleyRate,
  deleteUnusedSoilWorker,
  listSoilWorkerTrolleyRates,
  resolveSoilWorkerTrolleyRate,
  restoreSoilWorker,
} from "@/features/soil/services/soil-worker-rate-service";
import type {
  SoilFinancialAdjustment,
  SoilFinancialAdjustmentType,
  SoilFinancialSummary,
  SoilWorker,
  SoilWorkerTrolleyRate,
} from "@/features/soil/types";
import { formatDateOnly, formatIndianCurrency } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  resolveStatusPresentation,
  SOIL_WORKER_LIFECYCLE_STATUS,
  WAGE_RATE_HISTORY_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type SavingAction = "rate" | "adjustment" | "archive" | "restore" | "delete" | "";

function rateHistoryStatus(rate: SoilWorkerTrolleyRate, asOfDate: string) {
  if (
    rate.effectiveFrom <= asOfDate
    && (rate.effectiveTo === null || rate.effectiveTo >= asOfDate)
  ) {
    return resolveStatusPresentation(WAGE_RATE_HISTORY_STATUS, "current");
  }
  return resolveStatusPresentation(
    WAGE_RATE_HISTORY_STATUS,
    rate.effectiveFrom > asOfDate ? "future" : "historical",
  );
}

export function SoilTrolleyManagementDrawer({
  factoryId,
  worker,
  onClose,
}: Readonly<{
  factoryId: string;
  worker: SoilWorker;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [asOfDate] = useState(getLocalDate);
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [newRate, setNewRate] = useState("");
  const [rateDate, setRateDate] = useState(asOfDate);
  const [adjustmentType, setAdjustmentType] = useState<SoilFinancialAdjustmentType | "">("");
  const [adjustmentDate, setAdjustmentDate] = useState(asOfDate);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
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
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
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

  const currentRateQuery = useQuery({
    queryKey: soilCurrentRateQueryKey(factoryId, worker.id, asOfDate),
    queryFn: () => resolveSoilWorkerTrolleyRate({
      factoryId,
      soilWorkerId: worker.id,
      workDate: asOfDate,
    }),
  });
  const rateHistoryQuery = useQuery({
    queryKey: soilRateHistoryQueryKey(factoryId, worker.id),
    queryFn: () => listSoilWorkerTrolleyRates({
      factoryId,
      soilWorkerId: worker.id,
    }),
  });
  const adjustmentsQuery = useQuery({
    queryKey: soilAdjustmentsQueryKey(factoryId, worker.id),
    queryFn: () => listSoilFinancialAdjustments({
      factoryId,
      soilWorkerId: worker.id,
    }),
  });
  const summaryQuery = useQuery({
    queryKey: soilFinancialSummaryQueryKey(factoryId, worker.id),
    queryFn: () => getSoilFinancialSummary({ factoryId, soilWorkerId: worker.id }),
  });
  const earningHistoryExistenceQuery = useQuery({
    queryKey: soilEarningHistoryExistenceQueryKey(factoryId, worker.id),
    queryFn: () => hasSoilEarningHistory({ factoryId, soilWorkerId: worker.id }),
  });
  const paymentsQuery = useQuery({
    queryKey: soilPaymentsQueryKey(factoryId, worker.id),
    queryFn: () => listSoilPayments({ factoryId, soilWorkerId: worker.id }),
  });

  const lifecycleStatus = resolveBooleanStatusPresentation(
    SOIL_WORKER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  const historiesLoaded = !earningHistoryExistenceQuery.isLoading
    && !earningHistoryExistenceQuery.error
    && !paymentsQuery.isLoading
    && !paymentsQuery.error
    && !adjustmentsQuery.isLoading
    && !adjustmentsQuery.error;
  const canDelete = canOfferUnusedSoilWorkerDelete({
    historiesLoaded,
    earningCount: earningHistoryExistenceQuery.data ? 1 : 0,
    paymentCount: paymentsQuery.data?.length ?? 0,
    adjustmentCount: adjustmentsQuery.data?.length ?? 0,
  });

  function clearFeedback() {
    setError("");
    setSuccess("");
  }

  function cacheWorker(updatedWorker: SoilWorker) {
    queryClient.setQueryData<SoilWorker[]>(
      soilWorkersQueryKey(factoryId),
      (current = []) => current.map((item) => (
        item.id === updatedWorker.id ? updatedWorker : item
      )),
    );
  }

  async function submitRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingAction) return;
    if (!worker.isActive) {
      setError("Restore this archived worker before changing their trolley rate.");
      return;
    }
    const input = buildSoilRateChangeInput({
      factoryId,
      soilWorkerId: worker.id,
      rate: newRate,
      effectiveFrom: rateDate,
    });
    if (!input) {
      setError("Enter a positive rate and valid effective date.");
      return;
    }

    setSavingAction("rate");
    clearFeedback();
    try {
      const rate = await createSoilWorkerTrolleyRate(input);
      queryClient.setQueryData<SoilWorkerTrolleyRate[]>(
        soilRateHistoryQueryKey(factoryId, worker.id),
        (current = []) => insertSoilRateNewestFirst(current, rate),
      );
      await queryClient.invalidateQueries({
        queryKey: soilRateHistoryQueryKey(factoryId, worker.id),
      });
      await queryClient.invalidateQueries({
        queryKey: soilCurrentRateQueryKey(factoryId, worker.id, asOfDate),
      });
      setNewRate("");
      setIsEditingRate(false);
      setSuccess("Trolley rate added. Past recorded work and earnings are unchanged.");
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not add the trolley rate."));
    } finally {
      setSavingAction("");
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingAction) return;
    const summary = summaryQuery.data;
    if (!summary) {
      setError("Adjustment validation is unavailable. Try again.");
      return;
    }
    const numericAmount = Number(adjustmentAmount);
    if (
      adjustmentType === "DEDUCTION"
      && Number.isFinite(numericAmount)
      && numericAmount > summary.availableBalance
    ) {
      setError("Deduction exceeds this worker's authoritative available balance.");
      return;
    }
    const input = buildSoilAdjustmentInput({
      factoryId,
      soilWorkerId: worker.id,
      adjustmentType,
      adjustmentDate,
      amount: adjustmentAmount,
      reason: adjustmentReason,
      availableBalance: summary.availableBalance,
    });
    if (!input) {
      setError("Choose Addition or Deduction, then enter a positive amount, valid date, and reason.");
      return;
    }

    setSavingAction("adjustment");
    clearFeedback();
    try {
      const created = await createSoilFinancialAdjustment(input);
      queryClient.setQueryData<SoilFinancialSummary>(
        soilFinancialSummaryQueryKey(factoryId, worker.id),
        {
          totalEarned: created.totalEarned,
          totalAdditions: created.totalAdditions,
          totalDeductions: created.totalDeductions,
          totalPaid: created.totalPaid,
          availableBalance: created.availableBalance,
        },
      );
      queryClient.setQueryData<SoilFinancialAdjustment[]>(
        soilAdjustmentsQueryKey(factoryId, worker.id),
        (current = []) => insertSoilAdjustmentNewestFirst(current, created),
      );
      setAdjustmentAmount("");
      setAdjustmentReason("");
      setSuccess(`${created.adjustmentType === "ADDITION" ? "Addition" : "Deduction"} recorded.`);
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not record the adjustment."));
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
        ? await archiveSoilWorker({ factoryId, soilWorkerId: worker.id })
        : await restoreSoilWorker({ factoryId, soilWorkerId: worker.id });
      cacheWorker(updatedWorker);
      setSuccess(worker.isActive
        ? "Soil worker archived. Existing records are unchanged."
        : "Soil worker restored. Existing trolley-rate history remains authoritative.");
    } catch (failure) {
      setError(soilOfficeErrorMessage(
        failure,
        worker.isActive ? "Could not archive the Soil worker." : "Could not restore the Soil worker.",
      ));
    } finally {
      setSavingAction("");
    }
  }

  async function deleteWorker() {
    if (savingAction) return;
    setSavingAction("delete");
    clearFeedback();
    try {
      await deleteUnusedSoilWorker({ factoryId, soilWorkerId: worker.id });
      queryClient.setQueryData<SoilWorker[]>(
        soilWorkersQueryKey(factoryId),
        (current = []) => current.filter((item) => item.id !== worker.id),
      );
      onClose();
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not delete the Soil worker."));
      setConfirmingDelete(false);
    } finally {
      setSavingAction("");
    }
  }

  const adjustmentUnavailable = summaryQuery.isLoading
    || Boolean(summaryQuery.error)
    || !summaryQuery.data;

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal management drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Soil / Trolley worker management" className="absolute inset-0 bg-atlas-text/15" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="soil-trolley-management-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-center justify-between border-b border-atlas-border px-atlas-5 py-atlas-4">
          <div className="flex items-center gap-atlas-2">
            <span aria-hidden="true" className="h-atlas-2 w-atlas-2 rounded-atlas-pill bg-atlas-primary" />
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Worker management</p>
          </div>
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close Soil / Trolley management drawer" onClick={onClose}><span aria-hidden="true">×</span></Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          <Card surface="muted">
            <div className="flex items-start gap-atlas-3">
              <div aria-hidden="true" className="flex h-atlas-12 w-atlas-12 shrink-0 items-center justify-center rounded-atlas-pill bg-atlas-primary text-atlas-xl font-atlas-semibold text-atlas-primary-foreground">
                {worker.name.trim().charAt(0).toLocaleUpperCase("en-IN") || "W"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-atlas-2">
                  <h2 id="soil-trolley-management-title" className="truncate text-atlas-xl font-atlas-semibold text-atlas-text">{worker.name}</h2>
                  <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
                </div>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Soil / Trolley worker</p>
              </div>
            </div>
          </Card>

          <section aria-labelledby="soil-rate-management-heading" className="mt-atlas-6">
            <div className="flex items-end justify-between gap-atlas-3">
              <h3 id="soil-rate-management-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Trolley rate</h3>
              <p className="text-atlas-xs text-atlas-text-subtle">Effective-dated</p>
            </div>
            <div className="mt-atlas-2">
              <Card>
              <div className="flex items-center justify-between gap-atlas-3">
                <div className="min-w-0">
                  <p className="text-atlas-xs text-atlas-text-muted">Current rate</p>
                  <p className="mt-atlas-1 text-atlas-base font-atlas-medium tabular-nums text-atlas-text">
                    {currentRateQuery.isLoading
                      ? ATLAS_UI_STRINGS.feedback.loading
                      : currentRateQuery.error || !currentRateQuery.data
                        ? ATLAS_UI_STRINGS.feedback.unavailable
                        : `${formatIndianCurrency(currentRateQuery.data.ratePerTrolley)} / trolley`}
                  </p>
                  {currentRateQuery.data && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Effective {formatDateOnly(currentRateQuery.data.effectiveFrom)}</p>}
                </div>
                {!isEditingRate && <Button variant="ghost" disabled={!worker.isActive || currentRateQuery.isLoading} onClick={() => { clearFeedback(); setIsEditingRate(true); }}>Change rate</Button>}
              </div>

              {isEditingRate && (
                <form className="mt-atlas-4 border-t border-atlas-border pt-atlas-4" onSubmit={(event) => void submitRate(event)}>
                  <h4 className="text-atlas-base font-atlas-semibold text-atlas-text">Revise trolley rate</h4>
                  <div className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                    <FormField label="Current rate">
                      <Input readOnly value={currentRateQuery.data ? formatIndianCurrency(currentRateQuery.data.ratePerTrolley) : "Not available"} />
                    </FormField>
                    <FormField label="New ₹ / trolley">
                      <Input type="text" inputMode="decimal" autoComplete="off" value={newRate} onChange={(event) => { setNewRate(event.target.value); clearFeedback(); }} disabled={savingAction === "rate"} placeholder="0.00" />
                    </FormField>
                  </div>
                  <div className="mt-atlas-3">
                    <FormField label="Effective from">
                      <Input type="date" value={rateDate} onChange={(event) => { setRateDate(event.target.value); clearFeedback(); }} disabled={savingAction === "rate"} required />
                    </FormField>
                  </div>
                  <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">The existing rate service preserves the effective-dated history. Recorded work and earnings are not recalculated.</p>
                  <div className="mt-atlas-3 flex justify-end gap-atlas-2">
                    <Button variant="ghost" disabled={savingAction === "rate"} onClick={() => { setIsEditingRate(false); setNewRate(""); clearFeedback(); }}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                    <Button type="submit" loading={savingAction === "rate"} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save rate</Button>
                  </div>
                </form>
              )}
              {!worker.isActive && <div className="mt-atlas-3"><Feedback tone="warning">Restore this worker before adding a new trolley rate.</Feedback></div>}
              </Card>
            </div>
          </section>

          {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
          {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}

          <section aria-labelledby="soil-rate-history-heading" className="mt-atlas-6">
            <h3 id="soil-rate-history-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Trolley rate history</h3>
            {rateHistoryQuery.isLoading && <div className="mt-atlas-2"><Feedback role="status" tone="neutral">Loading rate history...</Feedback></div>}
            {rateHistoryQuery.error && <div className="mt-atlas-2"><Feedback role="alert" tone="danger">{soilOfficeErrorMessage(rateHistoryQuery.error, "Could not load trolley rate history.")}</Feedback></div>}
            {!rateHistoryQuery.isLoading && !rateHistoryQuery.error && rateHistoryQuery.data?.length === 0 && <EmptyState title="No trolley rate history" />}
            {!rateHistoryQuery.isLoading && !rateHistoryQuery.error && (rateHistoryQuery.data?.length ?? 0) > 0 && (
              <div className="mt-atlas-2 divide-y divide-atlas-border rounded-atlas-card border border-atlas-border bg-atlas-surface">
                {rateHistoryQuery.data?.map((rate) => {
                  const status = rateHistoryStatus(rate, asOfDate);
                  return <div key={rate.id} className="flex items-start justify-between gap-atlas-3 p-atlas-3"><div><p className="font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(rate.ratePerTrolley)} / trolley</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{formatDateOnly(rate.effectiveFrom)} – {rate.effectiveTo ? formatDateOnly(rate.effectiveTo) : "Open ended"}</p></div><StatusPill label={status.label} tone={status.tone} /></div>;
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="soil-adjustment-management-heading" className="mt-atlas-6">
            <h3 id="soil-adjustment-management-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Office adjustments</h3>
            <div className="mt-atlas-2">
              <Card>
                <form onSubmit={(event) => void submitAdjustment(event)}>
                <p className="text-atlas-sm text-atlas-text-muted">Record an exceptional addition or deduction as a separate immutable event.</p>
                <div className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                  <FormField label="Type">
                    <Select value={adjustmentType} onChange={(event) => { setAdjustmentType(event.target.value as SoilFinancialAdjustmentType | ""); clearFeedback(); }} disabled={Boolean(savingAction) || adjustmentUnavailable}>
                      <option value="" disabled>Select type</option>
                      <option value="ADDITION">Addition</option>
                      <option value="DEDUCTION">Deduction</option>
                    </Select>
                  </FormField>
                  <FormField label={ATLAS_UI_STRINGS.fields.date}>
                    <Input type="date" value={adjustmentDate} onChange={(event) => { setAdjustmentDate(event.target.value); clearFeedback(); }} disabled={Boolean(savingAction) || adjustmentUnavailable} />
                  </FormField>
                </div>
                <div className="mt-atlas-3">
                  <FormField label={ATLAS_UI_STRINGS.fields.amount}>
                    <Input type="text" inputMode="decimal" autoComplete="off" value={adjustmentAmount} onChange={(event) => { setAdjustmentAmount(event.target.value); clearFeedback(); }} disabled={Boolean(savingAction) || adjustmentUnavailable} placeholder="0.00" />
                  </FormField>
                </div>
                <div className="mt-atlas-3">
                  <FormField label="Reason">
                    <Input value={adjustmentReason} onChange={(event) => { setAdjustmentReason(event.target.value); clearFeedback(); }} disabled={Boolean(savingAction) || adjustmentUnavailable} placeholder="Required" />
                  </FormField>
                </div>
                {summaryQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Adjustment validation is unavailable. Try again.</Feedback></div>}
                <div className="mt-atlas-3 flex justify-end">
                  <Button type="submit" variant="secondary" loading={savingAction === "adjustment"} loadingLabel="Recording..." disabled={Boolean(savingAction) || adjustmentUnavailable}>Record adjustment</Button>
                </div>
                </form>
              </Card>
            </div>

            <details className="mt-atlas-3 rounded-atlas-card border border-atlas-border bg-atlas-surface">
              <summary className="flex min-h-atlas-12 cursor-pointer items-center px-atlas-4 py-atlas-2 text-atlas-sm font-atlas-semibold text-atlas-text focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">Adjustment history</summary>
              <div className="border-t border-atlas-border p-atlas-4">
                {adjustmentsQuery.isLoading && <Feedback role="status" tone="neutral">Loading adjustments...</Feedback>}
                {adjustmentsQuery.error && <Feedback role="alert" tone="danger">{soilOfficeErrorMessage(adjustmentsQuery.error, "Could not load Office adjustments.")}</Feedback>}
                {!adjustmentsQuery.isLoading && !adjustmentsQuery.error && adjustmentsQuery.data?.length === 0 && <EmptyState title="No adjustments recorded" />}
                {!adjustmentsQuery.isLoading && !adjustmentsQuery.error && (adjustmentsQuery.data?.length ?? 0) > 0 && (
                  <ul className="divide-y divide-atlas-border">
                    {adjustmentsQuery.data?.map((adjustment) => {
                      const isAddition = adjustment.adjustmentType === "ADDITION";
                      return <li key={adjustment.id} className="py-atlas-3"><div className="flex items-start justify-between gap-atlas-3"><div><p className="text-atlas-sm font-atlas-medium text-atlas-text">{formatDateOnly(adjustment.adjustmentDate)} · {isAddition ? "Addition" : "Deduction"}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{adjustment.reason}</p></div><p className={`whitespace-nowrap font-atlas-semibold tabular-nums ${isAddition ? "text-atlas-success-text" : "text-atlas-danger-text"}`}>{isAddition ? "+" : "−"}{formatIndianCurrency(adjustment.amount)}</p></div></li>;
                    })}
                  </ul>
                )}
              </div>
            </details>
          </section>

          <section aria-labelledby="soil-worker-status-heading" className="mt-atlas-6">
            <h3 id="soil-worker-status-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Worker status</h3>
            <div className="mt-atlas-2">
              <Card surface="muted">
                <p className="text-atlas-sm text-atlas-text-muted">
                  {worker.isActive
                    ? "Archive this worker to remove them from new trolley entry. Existing records and rate history remain unchanged."
                    : "Restore this worker to make them available for new trolley entry again."}
                </p>
                <div className="mt-atlas-3 flex justify-end">
                  <Button variant={worker.isActive ? "danger" : "secondary"} loading={savingAction === "archive" || savingAction === "restore"} loadingLabel={worker.isActive ? "Archiving..." : "Restoring..."} disabled={Boolean(savingAction)} onClick={() => void toggleLifecycle()}>
                    {worker.isActive ? "Archive worker" : "Restore worker"}
                  </Button>
                </div>
              </Card>
            </div>
          </section>

          {canDelete && (
            <section aria-labelledby="soil-delete-worker-heading" className="mt-atlas-6">
              <h3 id="soil-delete-worker-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Unused worker</h3>
              <div className="mt-atlas-2">
                <Card surface="muted">
                  <p className="text-atlas-sm text-atlas-text-muted">Permanent deletion is available only because no work, payment, or adjustment history exists. The database verifies this again before deleting.</p>
                  {!confirmingDelete ? (
                    <div className="mt-atlas-3 flex justify-end"><Button variant="danger" disabled={Boolean(savingAction)} onClick={() => { clearFeedback(); setConfirmingDelete(true); }}>Delete unused worker</Button></div>
                  ) : (
                    <div className="mt-atlas-3"><Feedback role="alert" tone="danger"><p className="font-atlas-semibold">Permanently delete {worker.name} and their setup-only trolley rates?</p><p className="mt-atlas-1">This cannot be undone.</p><div className="mt-atlas-3 flex flex-wrap gap-atlas-2"><Button variant="danger" loading={savingAction === "delete"} loadingLabel="Deleting..." disabled={Boolean(savingAction)} onClick={() => void deleteWorker()}>Confirm permanent delete</Button><Button variant="secondary" disabled={Boolean(savingAction)} onClick={() => setConfirmingDelete(false)}>{ATLAS_UI_STRINGS.actions.cancel}</Button></div></Feedback></div>
                  )}
                </Card>
              </div>
            </section>
          )}
        </div>

        <footer className="flex justify-end border-t border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-3">
          <Button onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  );
}
