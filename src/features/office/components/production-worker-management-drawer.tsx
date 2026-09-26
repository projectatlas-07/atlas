"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
import {
  ProductionRateConfigurationError,
  setProductionLabourerOrigin,
  setProductionLabourerRates,
} from "@/features/wages/services/production-rate-configuration-service";
import {
  getCurrentLabourerProductionWageRate,
  type ProductionWageRate,
} from "@/features/wages/services/production-wage-rate-read-service";
import { formatDateOnly, formatIndianCurrency } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  PRODUCTION_LABOURER_LIFECYCLE_STATUS,
  WAGE_RATE_HISTORY_STATUS,
  resolveBooleanStatusPresentation,
  resolveStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type ProductionWorkerManagementIdentity = {
  id: string;
  name: string;
  originLabel: string | null;
  isActive: boolean;
};

type MutationResult = Promise<string | null>;

export type ProductionWorkerManagementDrawerProps = Readonly<{
  factoryId: string;
  worker: ProductionWorkerManagementIdentity;
  directRates: readonly ProductionWageRate[];
  wageRatesLoading: boolean;
  wageRatesError: boolean;
  workerUpdating: boolean;
  onSaveName: (worker: ProductionWorkerManagementIdentity, name: string) => MutationResult;
  onToggleLifecycle: (worker: ProductionWorkerManagementIdentity) => MutationResult;
  onWorkerChanged: () => Promise<void>;
  onClose: () => void;
}>;

type EditingSection = "name" | "origin" | "rate" | null;

function rateHistoryStatus(rate: ProductionWageRate, asOfDate: string) {
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

export function ProductionWorkerManagementDrawer({
  factoryId,
  worker,
  directRates,
  wageRatesLoading,
  wageRatesError,
  workerUpdating,
  onSaveName,
  onToggleLifecycle,
  onWorkerChanged,
  onClose,
}: ProductionWorkerManagementDrawerProps) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const asOfDate = getLocalDate();
  const currentRate = getCurrentLabourerProductionWageRate(
    directRates,
    worker.id,
    asOfDate,
  );
  const lifecycleStatus = resolveBooleanStatusPresentation(
    PRODUCTION_LABOURER_LIFECYCLE_STATUS,
    worker.isActive,
  );

  const [editingSection, setEditingSection] = useState<EditingSection>(null);
  const [name, setName] = useState(worker.name);
  const [origin, setOrigin] = useState(worker.originLabel ?? "");
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(asOfDate);
  const [sectionError, setSectionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSavingOrigin, setIsSavingOrigin] = useState(false);
  const [isSavingRate, setIsSavingRate] = useState(false);

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

  function beginEdit(section: Exclude<EditingSection, null>) {
    setName(worker.name);
    setOrigin(worker.originLabel ?? "");
    setRate("");
    setEffectiveFrom(asOfDate);
    setSectionError("");
    setSuccessMessage("");
    setEditingSection(section);
  }

  function cancelEdit() {
    setEditingSection(null);
    setSectionError("");
  }

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workerUpdating) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      setSectionError("Labourer name is required.");
      return;
    }

    setSectionError("");
    const mutationError = await onSaveName(worker, normalizedName);
    if (mutationError) {
      setSectionError(mutationError);
      return;
    }
    setEditingSection(null);
    setSuccessMessage("Worker name updated.");
  }

  async function saveOrigin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingOrigin) return;
    setIsSavingOrigin(true);
    setSectionError("");
    try {
      await setProductionLabourerOrigin({
        factoryId,
        labourerId: worker.id,
        originLabel: origin.trim() || null,
      });
      await onWorkerChanged();
      setEditingSection(null);
      setSuccessMessage("Origin updated.");
    } catch (error) {
      setSectionError(error instanceof Error ? error.message : "Could not save Production origin.");
    } finally {
      setIsSavingOrigin(false);
    }
  }

  async function saveRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingRate) return;
    const numericRate = Number(rate);
    if (!rate || !Number.isFinite(numericRate) || numericRate <= 0) {
      setSectionError("Rate per 1,000 bricks must be greater than zero.");
      return;
    }
    if (!effectiveFrom) {
      setSectionError("Effective-from date is required.");
      return;
    }

    setIsSavingRate(true);
    setSectionError("");
    try {
      await setProductionLabourerRates({
        factoryId,
        labourerIds: [worker.id],
        ratePer1000Bricks: numericRate,
        effectiveFrom,
      });
      await queryClient.invalidateQueries({ queryKey: ["office-production-wage-rates", factoryId] });
      setRate("");
      setEditingSection(null);
      setSuccessMessage("Direct Production rate saved.");
    } catch (error) {
      setSectionError(
        error instanceof ProductionRateConfigurationError || error instanceof Error
          ? error.message
          : "Could not save Production rate.",
      );
    } finally {
      setIsSavingRate(false);
    }
  }

  async function toggleLifecycle() {
    if (workerUpdating) return;
    setSectionError("");
    setSuccessMessage("");
    const mutationError = await onToggleLifecycle(worker);
    if (mutationError) {
      setSectionError(mutationError);
      return;
    }
    setSuccessMessage(worker.isActive ? "Worker archived." : "Worker reactivated.");
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Production worker management" className="absolute inset-0 bg-atlas-text/15" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="production-worker-management-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-center justify-between border-b border-atlas-border px-atlas-5 py-atlas-4">
          <div className="flex items-center gap-atlas-2">
            <span aria-hidden="true" className="h-atlas-2 w-atlas-2 rounded-atlas-pill bg-atlas-primary" />
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Worker management
            </p>
          </div>
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close worker management drawer" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          <Card surface="muted">
            <div className="flex items-start gap-atlas-3">
              <div aria-hidden="true" className="flex h-atlas-12 w-atlas-12 shrink-0 items-center justify-center rounded-atlas-pill bg-atlas-primary text-atlas-xl font-atlas-semibold text-atlas-primary-foreground">
                {worker.name.trim().charAt(0).toLocaleUpperCase("en-IN") || "W"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-atlas-2">
                  <h2 id="production-worker-management-title" className="truncate text-atlas-xl font-atlas-semibold text-atlas-text">
                    {worker.name}
                  </h2>
                  <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
                </div>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
                  Production worker{worker.originLabel ? ` · ${worker.originLabel}` : ""}
                </p>
              </div>
            </div>
          </Card>

          <section aria-labelledby="worker-details-heading" className="mt-atlas-6">
            <div className="flex items-end justify-between gap-atlas-3">
              <h3 id="worker-details-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                Worker details
              </h3>
              <p className="text-atlas-xs text-atlas-text-subtle">Choose a field to revise</p>
            </div>

            <div className="mt-atlas-2 divide-y divide-atlas-border rounded-atlas-card border border-atlas-border bg-atlas-surface">
              <div className="p-atlas-4">
                {editingSection === "name" ? (
                  <form onSubmit={(event) => void saveName(event)}>
                    <FormField label={ATLAS_UI_STRINGS.fields.name}>
                      <Input value={name} onChange={(event) => { setName(event.target.value); setSectionError(""); }} disabled={workerUpdating} aria-invalid={Boolean(sectionError)} autoComplete="off" />
                    </FormField>
                    <div className="mt-atlas-3 flex justify-end gap-atlas-2">
                      <Button variant="ghost" disabled={workerUpdating} onClick={cancelEdit}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                      <Button type="submit" loading={workerUpdating} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{ATLAS_UI_STRINGS.actions.save}</Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-atlas-3">
                    <div className="min-w-0"><p className="text-atlas-xs text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.name}</p><p className="mt-atlas-1 truncate text-atlas-base font-atlas-medium text-atlas-text">{worker.name}</p></div>
                    <Button variant="ghost" onClick={() => beginEdit("name")}>{ATLAS_UI_STRINGS.actions.edit}</Button>
                  </div>
                )}
              </div>

              <div className="p-atlas-4">
                {editingSection === "origin" ? (
                  <form onSubmit={(event) => void saveOrigin(event)}>
                    <FormField label="Origin (optional)">
                      <Input value={origin} maxLength={100} onChange={(event) => { setOrigin(event.target.value); setSectionError(""); }} disabled={isSavingOrigin} placeholder="Jharkhand, Bengal, or blank" autoComplete="off" />
                    </FormField>
                    <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">For identification and filtering only. It never changes wage calculations.</p>
                    <div className="mt-atlas-3 flex justify-end gap-atlas-2">
                      <Button variant="ghost" disabled={isSavingOrigin} onClick={cancelEdit}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                      <Button type="submit" loading={isSavingOrigin} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{ATLAS_UI_STRINGS.actions.save}</Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-atlas-3">
                    <div className="min-w-0"><p className="text-atlas-xs text-atlas-text-muted">Origin</p><p className="mt-atlas-1 truncate text-atlas-base font-atlas-medium text-atlas-text">{worker.originLabel ?? "Not recorded"}</p></div>
                    <Button variant="ghost" onClick={() => beginEdit("origin")}>{ATLAS_UI_STRINGS.actions.edit}</Button>
                  </div>
                )}
              </div>

              <div className="p-atlas-4">
                <div className="flex items-center justify-between gap-atlas-3">
                  <div className="min-w-0">
                    <p className="text-atlas-xs text-atlas-text-muted">Current direct rate</p>
                    <p className="mt-atlas-1 text-atlas-base font-atlas-medium tabular-nums text-atlas-text">
                      {wageRatesLoading ? ATLAS_UI_STRINGS.feedback.loading : wageRatesError ? ATLAS_UI_STRINGS.feedback.unavailable : currentRate ? `${formatIndianCurrency(currentRate.ratePer1000Bricks)} / 1,000 bricks` : "Rate not set"}
                    </p>
                  </div>
                  {editingSection !== "rate" && (
                    <Button variant="ghost" disabled={!worker.isActive || wageRatesLoading || wageRatesError} onClick={() => beginEdit("rate")}>Change rate</Button>
                  )}
                </div>

                {editingSection === "rate" && (
                  <form className="mt-atlas-4 border-t border-atlas-border pt-atlas-4" onSubmit={(event) => void saveRate(event)}>
                    <h4 className="text-atlas-base font-atlas-semibold text-atlas-text">Revise direct rate</h4>
                    <div className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                      <FormField label="Current rate">
                        <Input readOnly value={currentRate ? formatIndianCurrency(currentRate.ratePer1000Bricks) : "Not set"} />
                      </FormField>
                      <FormField label="New rate (₹ / 1,000)">
                        <Input type="text" inputMode="decimal" value={rate} onChange={(event) => { setRate(event.target.value); setSectionError(""); }} disabled={isSavingRate} placeholder="0.00" autoComplete="off" />
                      </FormField>
                    </div>
                    <div className="mt-atlas-3">
                      <FormField label="Effective from">
                        <Input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setSectionError(""); }} disabled={isSavingRate} required />
                      </FormField>
                    </div>
                    {effectiveFrom && effectiveFrom < asOfDate && <div className="mt-atlas-3"><Feedback tone="warning">Backdated changes can alter live historical earnings from this date.</Feedback></div>}
                    <div className="mt-atlas-3 flex justify-end gap-atlas-2">
                      <Button variant="ghost" disabled={isSavingRate} onClick={cancelEdit}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                      <Button type="submit" loading={isSavingRate} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save rate</Button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </section>

          {sectionError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{sectionError}</Feedback></div>}
          {successMessage && <div className="mt-atlas-3"><Feedback role="status" tone="success">{successMessage}</Feedback></div>}

          <section aria-labelledby="rate-history-heading" className="mt-atlas-6">
            <h3 id="rate-history-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Direct rate history</h3>
            {wageRatesLoading && <div className="mt-atlas-2"><Feedback role="status" tone="neutral">Loading rate history...</Feedback></div>}
            {wageRatesError && <div className="mt-atlas-2"><Feedback role="alert" tone="danger">Rate history is unavailable.</Feedback></div>}
            {!wageRatesLoading && !wageRatesError && directRates.length === 0 && <EmptyState title="No rate history" description="Set the worker’s first direct rate above." />}
            {!wageRatesLoading && !wageRatesError && directRates.length > 0 && (
              <div className="mt-atlas-2 divide-y divide-atlas-border rounded-atlas-card border border-atlas-border bg-atlas-surface">
                {directRates.map((historyRate) => {
                  const status = rateHistoryStatus(historyRate, asOfDate);
                  return (
                    <div key={historyRate.id} className="flex items-start justify-between gap-atlas-3 p-atlas-3">
                      <div><p className="font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(historyRate.ratePer1000Bricks)} / 1,000</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{formatDateOnly(historyRate.effectiveFrom)} – {historyRate.effectiveTo ? formatDateOnly(historyRate.effectiveTo) : "Open ended"}</p></div>
                      <StatusPill label={status.label} tone={status.tone} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="worker-status-heading" className="mt-atlas-6">
            <h3 id="worker-status-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Worker status</h3>
            <div className="mt-atlas-2">
              <Card surface="muted">
                <p className="text-atlas-sm text-atlas-text-muted">
                  {worker.isActive
                    ? "Archive this worker to remove them from new daily Production entry. Existing work, earnings and account history remain unchanged."
                    : "Reactivate this worker to make them available for new daily Production entry again."}
                </p>
                <div className="mt-atlas-3 flex justify-end">
                  <Button variant={worker.isActive ? "danger" : "secondary"} loading={workerUpdating} loadingLabel={worker.isActive ? "Archiving..." : "Reactivating..."} onClick={() => void toggleLifecycle()}>
                    {worker.isActive ? "Archive worker" : "Reactivate worker"}
                  </Button>
                </div>
              </Card>
            </div>
          </section>
        </div>

        <footer className="flex justify-end border-t border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-3">
          <Button onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  );
}
