"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form-controls";
import { FormField } from "@/components/ui/form-field";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import {
  buildSoilAdjustmentInput,
  buildSoilEarningHistoryItem,
  buildSoilPaymentInput,
  buildSoilRateChangeInput,
  buildSoilWorkerCreateInput,
  canOfferUnusedSoilWorkerDelete,
  insertSoilAdjustmentNewestFirst,
  insertSoilPaymentNewestFirst,
  insertSoilRateNewestFirst,
  mergeSoilPaymentSummary,
  SOIL_SECTION_HEADING,
  soilOfficeErrorMessage,
  splitSoilWorkers,
  sumSoilPeriodEarned,
} from "@/features/office/soil-office-model";
import {
  hasSoilEarningHistory,
  listSoilEarnings,
} from "@/features/soil/services/soil-earning-read-service";
import {
  createSoilFinancialAdjustment,
  listSoilFinancialAdjustments,
} from "@/features/soil/services/soil-financial-adjustment-service";
import {
  createSoilPayment,
  getSoilFinancialSummary,
  listSoilPayments,
} from "@/features/soil/services/soil-payment-service";
import {
  archiveSoilWorker,
  createSoilWorker,
  createSoilWorkerTrolleyRate,
  deleteUnusedSoilWorker,
  listSoilWorkers,
  listSoilWorkerTrolleyRates,
  resolveSoilWorkerTrolleyRate,
  restoreSoilWorker,
} from "@/features/soil/services/soil-worker-rate-service";
import type {
  SoilFinancialAdjustment,
  SoilFinancialAdjustmentType,
  SoilFinancialSummary,
  SoilPayment,
  SoilWorker,
  SoilWorkerTrolleyRate,
} from "@/features/soil/types";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import {
  formatDateOnly,
  formatIndianCurrency,
} from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  SOIL_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const workersKey = (factoryId: string) => ["office-soil-workers", factoryId] as const;
const currentRateKey = (factoryId: string, workerId: string, date: string) =>
  ["office-soil-current-rate", factoryId, workerId, date] as const;
const rateHistoryKey = (factoryId: string, workerId: string) =>
  ["office-soil-rate-history", factoryId, workerId] as const;
const summaryKey = (factoryId: string, workerId: string) =>
  ["office-soil-financial-summary", factoryId, workerId] as const;
const earningsKey = (
  factoryId: string,
  workerId: string,
  fromDate: string | undefined,
  toDate: string | undefined,
) => ["office-soil-earnings", factoryId, workerId, fromDate, toDate] as const;
const earningHistoryExistenceKey = (factoryId: string, workerId: string) =>
  ["office-soil-earning-history-exists", factoryId, workerId] as const;
const paymentsKey = (factoryId: string, workerId: string) =>
  ["office-soil-payments", factoryId, workerId] as const;
const adjustmentsKey = (factoryId: string, workerId: string) =>
  ["office-soil-adjustments", factoryId, workerId] as const;

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100";
const primaryButton = "h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const wageDatePresets: Array<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

export function SoilOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const workersQuery = useQuery({
    queryKey: workersKey(factoryId),
    queryFn: () => listSoilWorkers(factoryId),
  });
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [name, setName] = useState("");
  const [initialRate, setInitialRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(getLocalDate);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  async function submitWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    const input = buildSoilWorkerCreateInput({
      factoryId, name, initialRate, effectiveFrom,
    });
    if (!input) {
      setCreateError("Enter a worker name, positive initial rate, and valid start date.");
      return;
    }

    setIsCreating(true); setCreateError(""); setCreateSuccess("");
    try {
      const worker = await createSoilWorker(input);
      queryClient.setQueryData<SoilWorker[]>(workersKey(factoryId), (current = []) =>
        [...current.filter((item) => item.id !== worker.id), worker].sort(
          (left, right) => left.name.localeCompare(right.name, "en-IN")
            || left.id.localeCompare(right.id),
        ));
      setName(""); setInitialRate(""); setSelectedWorkerId(worker.id);
      setCreateSuccess("Soil worker added. Opened their details below.");
    } catch (error) {
      setCreateError(soilOfficeErrorMessage(error, "Could not add the Soil worker."));
    } finally { setIsCreating(false); }
  }

  const workers = workersQuery.data ?? [];
  const { active, archived } = splitSoilWorkers(workers);
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);

  return (
    <section aria-labelledby="soil-office-heading" className="mt-10 border-t-4 border-amber-300 pt-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-amber-700">{SOIL_SECTION_HEADING}</p>
        <h2 id="soil-office-heading" className="mt-1 text-2xl font-bold">Workers, trolley rates, and finances</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage individual Soil workers and their financial history. Production continues to record trolley quantity only.
        </p>
      </div>

      <form onSubmit={submitWorker} className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <h3 className="text-lg font-bold text-amber-950">Add Soil worker</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-4 md:items-end">
          <LegacyField label="Worker name"><input value={name} onChange={(event) => { setName(event.target.value); setCreateError(""); setCreateSuccess(""); }} disabled={isCreating} className={inputClass} /></LegacyField>
          <LegacyField label="Initial ₹ / trolley"><input type="number" min="0.01" step="any" value={initialRate} onChange={(event) => { setInitialRate(event.target.value); setCreateError(""); setCreateSuccess(""); }} disabled={isCreating} className={inputClass} /></LegacyField>
          <LegacyField label="Effective from"><input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setCreateError(""); setCreateSuccess(""); }} disabled={isCreating} className={inputClass} /></LegacyField>
          <button disabled={isCreating} className={primaryButton}>{isCreating ? "Adding..." : "Add worker"}</button>
        </div>
        <LegacyFeedback error={createError} success={createSuccess} />
      </form>

      <section aria-labelledby="soil-workers-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 id="soil-workers-heading" className="text-xl font-bold">Active Soil workers</h3>
        {workersQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading Soil workers...</p>}
        {workersQuery.error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{soilOfficeErrorMessage(workersQuery.error, "Could not load Soil workers.")}</p>}
        {!workersQuery.isLoading && !workersQuery.error && active.length === 0 && <p className="mt-4 text-sm text-slate-500">No active Soil workers. Add a worker above or restore one below.</p>}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {active.map((worker) => (
            <SoilWorkerOverview
              key={worker.id}
              factoryId={factoryId}
              worker={worker}
              isSelected={worker.id === selectedWorkerId}
              onOpen={() => setSelectedWorkerId(
                worker.id === selectedWorkerId ? "" : worker.id,
              )}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="archived-soil-workers-heading" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h3 id="archived-soil-workers-heading" className="text-xl font-bold">Archived Soil workers</h3>
        <p className="mt-1 text-sm text-slate-600">Archived workers stay available for financial and historical review but cannot receive trolley entries.</p>
        {!workersQuery.isLoading && !workersQuery.error && archived.length === 0 && <p className="mt-4 text-sm text-slate-500">No archived Soil workers.</p>}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {archived.map((worker) => (
            <SoilWorkerOverview
              key={worker.id}
              factoryId={factoryId}
              worker={worker}
              isSelected={worker.id === selectedWorkerId}
              onOpen={() => setSelectedWorkerId(
                worker.id === selectedWorkerId ? "" : worker.id,
              )}
            />
          ))}
        </div>
      </section>

      {selectedWorker && <SoilWorkerDetail key={selectedWorker.id} factoryId={factoryId} worker={selectedWorker} />}
    </section>
  );
}

function SoilWorkerOverview({ factoryId, worker, isSelected, onOpen }: Readonly<{
  factoryId: string;
  worker: SoilWorker;
  isSelected: boolean;
  onOpen: () => void;
}>) {
  const today = getLocalDate();
  const rateQuery = useQuery({
    queryKey: currentRateKey(factoryId, worker.id, today),
    queryFn: () => resolveSoilWorkerTrolleyRate({
      factoryId, soilWorkerId: worker.id, workDate: today,
    }),
  });
  const financialQuery = useQuery({
    queryKey: summaryKey(factoryId, worker.id),
    queryFn: () => getSoilFinancialSummary({ factoryId, soilWorkerId: worker.id }),
  });

  return (
    <article className={`rounded-lg border p-4 ${isSelected ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">{worker.name}</h4>
            {!worker.isActive && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Archived</span>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Current rate: {rateQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : rateQuery.data ? `${formatIndianCurrency(rateQuery.data.ratePerTrolley)} / trolley` : ATLAS_UI_STRINGS.feedback.unavailable}
          </p>
        </div>
        <button type="button" onClick={onOpen} className={secondaryButton}>{isSelected ? "Close" : "Open details"}</button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-200 pt-4">
        <CompactValue label="Total Earned" value={financialQuery.data ? formatIndianCurrency(financialQuery.data.totalEarned) : financialQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : ATLAS_UI_STRINGS.feedback.unavailable} />
        <CompactValue label="Paid" value={financialQuery.data ? formatIndianCurrency(financialQuery.data.totalPaid) : financialQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : ATLAS_UI_STRINGS.feedback.unavailable} />
        <CompactValue label="Available" value={financialQuery.data ? formatIndianCurrency(financialQuery.data.availableBalance) : financialQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : ATLAS_UI_STRINGS.feedback.unavailable} emphasize />
      </div>
      {(rateQuery.error || financialQuery.error) && <p role="alert" className="mt-3 text-xs font-medium text-red-700">Some worker details could not be loaded. Open details to retry.</p>}
    </article>
  );
}

function SoilWorkerDetail({ factoryId, worker }: Readonly<{
  factoryId: string;
  worker: SoilWorker;
}>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(getLocalDate);
  const [earningsPreset, setEarningsPreset] = useState<WageEarningsDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const earningsRange = resolveWageEarningsDateRange(
    earningsPreset,
    localToday,
    customFrom,
    customTo,
  );
  const lifecycleStatus = resolveBooleanStatusPresentation(
    SOIL_WORKER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  const currentRateQuery = useQuery({
    queryKey: currentRateKey(factoryId, worker.id, localToday),
    queryFn: () => resolveSoilWorkerTrolleyRate({
      factoryId,
      soilWorkerId: worker.id,
      workDate: localToday,
    }),
  });
  const rateQuery = useQuery({
    queryKey: rateHistoryKey(factoryId, worker.id),
    queryFn: () => listSoilWorkerTrolleyRates({ factoryId, soilWorkerId: worker.id }),
  });
  const summaryQuery = useQuery({
    queryKey: summaryKey(factoryId, worker.id),
    queryFn: () => getSoilFinancialSummary({ factoryId, soilWorkerId: worker.id }),
  });
  const earningsQuery = useQuery({
    queryKey: earningsKey(
      factoryId,
      worker.id,
      earningsRange?.fromDate,
      earningsRange?.toDate,
    ),
    queryFn: () => listSoilEarnings({
      factoryId,
      soilWorkerId: worker.id,
      range: earningsRange!,
    }),
    enabled: earningsRange !== null,
  });
  const earningHistoryExistenceQuery = useQuery({
    queryKey: earningHistoryExistenceKey(factoryId, worker.id),
    queryFn: () => hasSoilEarningHistory({ factoryId, soilWorkerId: worker.id }),
  });
  const paymentsQuery = useQuery({
    queryKey: paymentsKey(factoryId, worker.id),
    queryFn: () => listSoilPayments({ factoryId, soilWorkerId: worker.id }),
  });
  const adjustmentsQuery = useQuery({
    queryKey: adjustmentsKey(factoryId, worker.id),
    queryFn: () => listSoilFinancialAdjustments({ factoryId, soilWorkerId: worker.id }),
  });

  const [newRate, setNewRate] = useState("");
  const [rateDate, setRateDate] = useState(getLocalDate);
  const [paymentDate, setPaymentDate] = useState(getLocalDate);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<SoilFinancialAdjustmentType | "">("");
  const [adjustmentDate, setAdjustmentDate] = useState(getLocalDate);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [savingAction, setSavingAction] = useState<"rate" | "payment" | "adjustment" | "archive" | "restore" | "delete" | "">("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const summary = summaryQuery.data;
  const periodEarned = earningsRange
    && !earningsQuery.isLoading
    && !earningsQuery.error
    ? sumSoilPeriodEarned(earningsQuery.data ?? [])
    : null;
  const historiesLoaded = !earningHistoryExistenceQuery.isLoading
    && !earningHistoryExistenceQuery.error
    && !paymentsQuery.isLoading && !paymentsQuery.error
    && !adjustmentsQuery.isLoading && !adjustmentsQuery.error;
  const canDelete = canOfferUnusedSoilWorkerDelete({
    historiesLoaded,
    earningCount: earningHistoryExistenceQuery.data ? 1 : 0,
    paymentCount: paymentsQuery.data?.length ?? 0,
    adjustmentCount: adjustmentsQuery.data?.length ?? 0,
  });
  function clearFeedback() { setError(""); setSuccess(""); }

  function cacheWorker(updatedWorker: SoilWorker) {
    queryClient.setQueryData<SoilWorker[]>(workersKey(factoryId), (current = []) =>
      current.map((item) => item.id === updatedWorker.id ? updatedWorker : item));
  }

  async function archiveWorker() {
    setSavingAction("archive"); setConfirmingDelete(false); clearFeedback();
    try {
      cacheWorker(await archiveSoilWorker({ factoryId, soilWorkerId: worker.id }));
      setSuccess("Soil worker archived. Historical and financial records are unchanged.");
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not archive the Soil worker."));
    } finally { setSavingAction(""); }
  }

  async function restoreWorker() {
    setSavingAction("restore"); setConfirmingDelete(false); clearFeedback();
    try {
      cacheWorker(await restoreSoilWorker({ factoryId, soilWorkerId: worker.id }));
      setSuccess("Soil worker restored. Existing trolley-rate history remains authoritative.");
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not restore the Soil worker."));
    } finally { setSavingAction(""); }
  }

  async function deleteWorker() {
    setSavingAction("delete"); clearFeedback();
    try {
      await deleteUnusedSoilWorker({ factoryId, soilWorkerId: worker.id });
      queryClient.setQueryData<SoilWorker[]>(workersKey(factoryId), (current = []) =>
        current.filter((item) => item.id !== worker.id));
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not delete the Soil worker."));
      setConfirmingDelete(false);
    } finally { setSavingAction(""); }
  }

  async function submitRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildSoilRateChangeInput({
      factoryId, soilWorkerId: worker.id, rate: newRate, effectiveFrom: rateDate,
    });
    if (!input) return setError("Enter a positive rate and valid effective date.");
    setSavingAction("rate"); clearFeedback();
    try {
      const rate = await createSoilWorkerTrolleyRate(input);
      queryClient.setQueryData<SoilWorkerTrolleyRate[]>(
        rateHistoryKey(factoryId, worker.id),
        (current = []) => insertSoilRateNewestFirst(current, rate),
      );
      await queryClient.invalidateQueries({
        queryKey: currentRateKey(factoryId, worker.id, getLocalDate()),
      });
      setNewRate(""); setSuccess("Trolley rate added. Past work and earnings are unchanged.");
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not add the trolley rate."));
    } finally { setSavingAction(""); }
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary) return setError("Financial summary is unavailable. Try again.");
    const amount = Number(paymentAmount);
    if (Number.isFinite(amount) && amount > summary.availableBalance) {
      return setError("Payment exceeds this worker's available balance.");
    }
    const input = buildSoilPaymentInput({
      factoryId, soilWorkerId: worker.id, paymentDate,
      amount: paymentAmount, availableBalance: summary.availableBalance,
    });
    if (!input) return setError("Enter a positive amount and valid payment date.");
    setSavingAction("payment"); clearFeedback();
    try {
      const recorded = await createSoilPayment(input);
      queryClient.setQueryData<SoilFinancialSummary>(
        summaryKey(factoryId, worker.id),
        (current) => mergeSoilPaymentSummary(current, recorded),
      );
      queryClient.setQueryData<SoilPayment[]>(
        paymentsKey(factoryId, worker.id),
        (current = []) => insertSoilPaymentNewestFirst(current, recorded),
      );
      await queryClient.invalidateQueries({ queryKey: summaryKey(factoryId, worker.id) });
      setPaymentAmount(""); setSuccess("Payment recorded and balance updated.");
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not record the payment."));
    } finally { setSavingAction(""); }
  }

  async function submitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary) return setError("Financial summary is unavailable. Try again.");
    const amount = Number(adjustmentAmount);
    if (adjustmentType === "DEDUCTION" && Number.isFinite(amount)
      && amount > summary.availableBalance) {
      return setError("Deduction exceeds this worker's available balance.");
    }
    const input = buildSoilAdjustmentInput({
      factoryId, soilWorkerId: worker.id, adjustmentType,
      adjustmentDate, amount: adjustmentAmount, reason: adjustmentReason,
      availableBalance: summary.availableBalance,
    });
    if (!input) return setError("Choose Addition or Deduction, then enter a positive amount, valid date, and reason.");
    setSavingAction("adjustment"); clearFeedback();
    try {
      const created = await createSoilFinancialAdjustment(input);
      queryClient.setQueryData<SoilFinancialSummary>(summaryKey(factoryId, worker.id), {
        totalEarned: created.totalEarned,
        totalAdditions: created.totalAdditions,
        totalDeductions: created.totalDeductions,
        totalPaid: created.totalPaid,
        availableBalance: created.availableBalance,
      });
      queryClient.setQueryData<SoilFinancialAdjustment[]>(
        adjustmentsKey(factoryId, worker.id),
        (current = []) => insertSoilAdjustmentNewestFirst(current, created),
      );
      setAdjustmentAmount(""); setAdjustmentReason("");
      setSuccess(`${created.adjustmentType === "ADDITION" ? "Addition" : "Deduction"} recorded and balance updated.`);
    } catch (failure) {
      setError(soilOfficeErrorMessage(failure, "Could not record the adjustment."));
    } finally { setSavingAction(""); }
  }

  const periodEarnedDisplay = !earningsRange
    ? "—"
    : earningsQuery.isLoading
      ? ATLAS_UI_STRINGS.feedback.loading
      : earningsQuery.error
        ? ATLAS_UI_STRINGS.feedback.unavailable
        : formatIndianCurrency(periodEarned);

  return (
    <article
      aria-labelledby="soil-worker-detail-heading"
      className="mt-atlas-6 border-t border-atlas-border-strong pt-atlas-6 text-atlas-text"
    >
      <header className="flex flex-col gap-atlas-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
            Soil worker account
          </p>
          <div className="mt-atlas-1 flex flex-wrap items-center gap-atlas-2">
            <h3
              id="soil-worker-detail-heading"
              className="text-atlas-2xl font-atlas-semibold text-atlas-text"
            >
              {worker.name}
            </h3>
            <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
          </div>
        </div>
        <p className="max-w-xl text-atlas-sm text-atlas-text-muted">
          Current account, payment action, and immutable financial history.
        </p>
      </header>

      {!worker.isActive && (
        <div className="mt-atlas-4">
          <Feedback tone="warning" role="status">
            This worker is archived. History remains available, but new payments,
            trolley rates, and trolley work require restoring the worker first.
          </Feedback>
        </div>
      )}

      <section aria-labelledby="soil-financial-picture-heading" className="mt-atlas-5">
        <Card as="section" aria-labelledby="soil-financial-picture-heading">
          <h4
            id="soil-financial-picture-heading"
            className="text-atlas-lg font-atlas-semibold"
          >
            Current financial picture
          </h4>
          <dl className="mt-atlas-4 grid gap-atlas-4 sm:grid-cols-2 xl:grid-cols-4">
            <FinancialMetric
              label="Current trolley rate"
              value={currentRateQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : currentRateQuery.data
                  ? `${formatIndianCurrency(currentRateQuery.data.ratePerTrolley)} / trolley`
                  : ATLAS_UI_STRINGS.feedback.unavailable}
            />
            <FinancialMetric
              label="Cumulative earned"
              value={summaryQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : summary
                  ? formatIndianCurrency(summary.totalEarned)
                  : ATLAS_UI_STRINGS.feedback.unavailable}
            />
            <FinancialMetric
              label="Cumulative paid"
              value={summaryQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : summary
                  ? formatIndianCurrency(summary.totalPaid)
                  : ATLAS_UI_STRINGS.feedback.unavailable}
            />
            <FinancialMetric
              label="Available Balance"
              value={summaryQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : summary
                  ? formatIndianCurrency(summary.availableBalance)
                  : ATLAS_UI_STRINGS.feedback.unavailable}
              emphasize
            />
          </dl>
          <p className="mt-atlas-4 border-t border-atlas-border pt-atlas-3 text-atlas-sm text-atlas-text-muted">
            Total Additions: <FinancialInline
              value={summaryQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : summary
                  ? formatIndianCurrency(summary.totalAdditions)
                  : ATLAS_UI_STRINGS.feedback.unavailable}
              tone="success"
            />
            <span aria-hidden="true"> · </span>
            Total Deductions: <FinancialInline
              value={summaryQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : summary
                  ? formatIndianCurrency(summary.totalDeductions)
                  : ATLAS_UI_STRINGS.feedback.unavailable}
              tone="danger"
            />
          </p>
        </Card>
      </section>

      {(currentRateQuery.error || summaryQuery.error) && (
        <div className="mt-atlas-3">
          <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {summaryQuery.error
                  ? soilOfficeErrorMessage(summaryQuery.error, "Could not load the financial summary.")
                  : soilOfficeErrorMessage(currentRateQuery.error, "Could not load the current trolley rate.")}
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  void currentRateQuery.refetch();
                  void summaryQuery.refetch();
                }}
              >
                {ATLAS_UI_STRINGS.actions.retry}
              </Button>
            </div>
          </Feedback>
        </div>
      )}

      {(error || success) && (
        <div className="mt-atlas-4">
          {error && <Feedback tone="danger" role="alert">{error}</Feedback>}
          {success && <Feedback tone="success" role="status">{success}</Feedback>}
        </div>
      )}

      <section aria-labelledby="soil-payment-heading" className="mt-atlas-6">
        <div className="flex flex-col gap-atlas-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 id="soil-payment-heading" className="text-atlas-xl font-atlas-semibold">
              Record payment
            </h4>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
              Record the normal financial action against the authoritative available balance.
            </p>
          </div>
          <p className="text-atlas-sm font-atlas-semibold tabular-nums text-atlas-primary">
            Available now: {summary
              ? formatIndianCurrency(summary.availableBalance)
              : summaryQuery.isLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : ATLAS_UI_STRINGS.feedback.unavailable}
          </p>
        </div>

        <div className="mt-atlas-3">
          {!worker.isActive ? (
            <Feedback tone="warning">
              Record payment is unavailable while this worker is archived. Restore
              the worker from Account controls to continue.
            </Feedback>
          ) : summaryQuery.isLoading ? (
            <Feedback tone="neutral" role="status">
              Loading the financial summary before payment entry.
            </Feedback>
          ) : !summary ? (
            <Feedback tone="danger" role="alert">
              Record payment is unavailable until the financial summary can be loaded.
            </Feedback>
          ) : (
            <Card as="section" aria-label={`${worker.name} payment entry`}>
              <form onSubmit={submitPayment}>
                <div className="grid gap-atlas-4 lg:grid-cols-3 lg:items-end">
                  <FormField label={ATLAS_UI_STRINGS.payment.date} htmlFor="soil-payment-date">
                    <Input
                      id="soil-payment-date"
                      type="date"
                      value={paymentDate}
                      onChange={(event) => {
                        setPaymentDate(event.target.value);
                        clearFeedback();
                      }}
                      disabled={Boolean(savingAction)}
                    />
                  </FormField>
                  <FormField label={ATLAS_UI_STRINGS.fields.amount} htmlFor="soil-payment-amount">
                    <Input
                      id="soil-payment-amount"
                      inputMode="decimal"
                      value={paymentAmount}
                      onChange={(event) => {
                        setPaymentAmount(event.target.value);
                        clearFeedback();
                      }}
                      disabled={Boolean(savingAction)}
                      autoComplete="off"
                    />
                  </FormField>
                  <Button
                    type="submit"
                    loading={savingAction === "payment"}
                    loadingLabel="Recording payment..."
                    disabled={Boolean(savingAction)}
                  >
                    Record payment
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      </section>

      <section aria-labelledby="soil-period-earned-heading" className="mt-atlas-6">
        <Card as="section" surface="muted" aria-labelledby="soil-period-earned-heading">
          <div className="flex flex-col gap-atlas-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h4 id="soil-period-earned-heading" className="text-atlas-lg font-atlas-semibold">
                Earnings period
              </h4>
              <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
                {wageDatePresets.map((option) => (
                  <Button
                    key={option.value}
                    variant={earningsPreset === option.value ? "primary" : "secondary"}
                    aria-pressed={earningsPreset === option.value}
                    onClick={() => setEarningsPreset(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <dl>
              <FinancialMetric label="Period Earned" value={periodEarnedDisplay} emphasize />
            </dl>
          </div>
          {earningsPreset === "custom" && (
            <div className="mt-atlas-4 grid max-w-2xl gap-atlas-3 sm:grid-cols-2">
              <FormField label="From" htmlFor="soil-earnings-from">
                <Input
                  id="soil-earnings-from"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </FormField>
              <FormField label="To" htmlFor="soil-earnings-to">
                <Input
                  id="soil-earnings-to"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </FormField>
            </div>
          )}
          {earningsPreset === "custom" && !earningsRange && (
            <div className="mt-atlas-3">
              <Feedback tone="danger" role="alert">
                Choose a valid inclusive date range. From date cannot be after To date.
              </Feedback>
            </div>
          )}
          {earningsRange && (
            <p className="mt-atlas-3 text-atlas-sm text-atlas-text-muted">
              Showing {formatDateOnly(earningsRange.fromDate)} to {formatDateOnly(earningsRange.toDate)}, inclusive.
            </p>
          )}
        </Card>
      </section>

      <section aria-labelledby="soil-account-controls-heading" className="mt-atlas-7">
        <h4 id="soil-account-controls-heading" className="text-atlas-lg font-atlas-semibold">
          Account controls
        </h4>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
          Corrections and lifecycle actions are secondary to normal payment entry.
        </p>
        <div className="mt-atlas-3 divide-y divide-atlas-border border-y border-atlas-border">
          <details>
            <summary className="flex min-h-atlas-12 cursor-pointer items-center font-atlas-semibold focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
              Change trolley rate
            </summary>
            <div className="pb-atlas-4">
              {!worker.isActive ? (
                <Feedback tone="warning">
                  Rate changes are unavailable while this worker is archived. Restore the worker first.
                </Feedback>
              ) : (
                <form onSubmit={submitRate}>
                  <p className="mb-atlas-3 text-atlas-sm text-atlas-text-muted">
                    The effective date controls new work only. Historical snapshots stay unchanged.
                  </p>
                  <div className="grid gap-atlas-3 md:grid-cols-2 lg:grid-cols-3 lg:items-end">
                    <FormField label="New ₹ / trolley" htmlFor="soil-new-rate">
                      <Input
                        id="soil-new-rate"
                        inputMode="decimal"
                        value={newRate}
                        onChange={(event) => {
                          setNewRate(event.target.value);
                          clearFeedback();
                        }}
                        disabled={Boolean(savingAction)}
                        autoComplete="off"
                      />
                    </FormField>
                    <FormField label="Effective from" htmlFor="soil-rate-date">
                      <Input
                        id="soil-rate-date"
                        type="date"
                        value={rateDate}
                        onChange={(event) => {
                          setRateDate(event.target.value);
                          clearFeedback();
                        }}
                        disabled={Boolean(savingAction)}
                      />
                    </FormField>
                    <Button
                      type="submit"
                      variant="secondary"
                      loading={savingAction === "rate"}
                      loadingLabel={ATLAS_UI_STRINGS.feedback.saving}
                      disabled={Boolean(savingAction)}
                    >
                      Add rate
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </details>

          <details>
            <summary className="flex min-h-atlas-12 cursor-pointer items-center font-atlas-semibold focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
              Record adjustment
            </summary>
            <form onSubmit={submitAdjustment} className="pb-atlas-4">
              <p className="mb-atlas-3 text-atlas-sm text-atlas-text-muted">
                Use only for an exceptional addition or deduction, with a required reason.
              </p>
              <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-4">
                <FormField label="Type" htmlFor="soil-adjustment-type">
                  <Select
                    id="soil-adjustment-type"
                    value={adjustmentType}
                    onChange={(event) => {
                      setAdjustmentType(event.target.value as SoilFinancialAdjustmentType | "");
                      clearFeedback();
                    }}
                    disabled={Boolean(savingAction) || !summary}
                  >
                    <option value="" disabled>Select type</option>
                    <option value="ADDITION">Addition</option>
                    <option value="DEDUCTION">Deduction</option>
                  </Select>
                </FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.date} htmlFor="soil-adjustment-date">
                  <Input
                    id="soil-adjustment-date"
                    type="date"
                    value={adjustmentDate}
                    onChange={(event) => {
                      setAdjustmentDate(event.target.value);
                      clearFeedback();
                    }}
                    disabled={Boolean(savingAction) || !summary}
                  />
                </FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.amount} htmlFor="soil-adjustment-amount">
                  <Input
                    id="soil-adjustment-amount"
                    inputMode="decimal"
                    value={adjustmentAmount}
                    onChange={(event) => {
                      setAdjustmentAmount(event.target.value);
                      clearFeedback();
                    }}
                    disabled={Boolean(savingAction) || !summary}
                    autoComplete="off"
                  />
                </FormField>
                <FormField label="Reason" htmlFor="soil-adjustment-reason">
                  <Input
                    id="soil-adjustment-reason"
                    value={adjustmentReason}
                    onChange={(event) => {
                      setAdjustmentReason(event.target.value);
                      clearFeedback();
                    }}
                    placeholder="Required"
                    disabled={Boolean(savingAction) || !summary}
                  />
                </FormField>
              </div>
              {!summary && (
                <div className="mt-atlas-3">
                  <Feedback tone="warning">
                    Adjustments are unavailable until the financial summary is loaded.
                  </Feedback>
                </div>
              )}
              <div className="mt-atlas-3">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={savingAction === "adjustment"}
                  loadingLabel="Recording adjustment..."
                  disabled={Boolean(savingAction) || !summary}
                >
                  Record adjustment
                </Button>
              </div>
            </form>
          </details>

          <details>
            <summary className="flex min-h-atlas-12 cursor-pointer items-center font-atlas-semibold focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
              Worker management
            </summary>
            <div className="pb-atlas-4">
              <p className="mb-atlas-3 text-atlas-sm text-atlas-text-muted">
                Archive preserves every financial and historical record. Permanent deletion remains limited to unused workers.
              </p>
              <div className="flex flex-wrap gap-atlas-2">
                {worker.isActive ? (
                  <Button
                    variant="ghost"
                    onClick={archiveWorker}
                    loading={savingAction === "archive"}
                    loadingLabel="Archiving..."
                    disabled={Boolean(savingAction)}
                  >
                    {ATLAS_UI_STRINGS.actions.archive}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={restoreWorker}
                    loading={savingAction === "restore"}
                    loadingLabel="Restoring..."
                    disabled={Boolean(savingAction)}
                  >
                    {ATLAS_UI_STRINGS.actions.restore}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setConfirmingDelete(true);
                      clearFeedback();
                    }}
                    disabled={Boolean(savingAction)}
                  >
                    Delete unused worker
                  </Button>
                )}
              </div>
              {confirmingDelete && (
                <div className="mt-atlas-3">
                  <Feedback tone="danger" role="alert">
                    <p className="font-atlas-semibold">
                      Permanently delete {worker.name} and their setup-only trolley rates?
                    </p>
                    <p className="mt-atlas-1">
                      This succeeds only if the database confirms there are no trolley,
                      earning, payment, or adjustment records.
                    </p>
                    <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
                      <Button
                        variant="danger"
                        onClick={deleteWorker}
                        loading={savingAction === "delete"}
                        loadingLabel="Deleting..."
                        disabled={Boolean(savingAction)}
                      >
                        Confirm permanent delete
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmingDelete(false)}
                        disabled={Boolean(savingAction)}
                      >
                        {ATLAS_UI_STRINGS.actions.cancel}
                      </Button>
                    </div>
                  </Feedback>
                </div>
              )}
            </div>
          </details>
        </div>
      </section>

      <section aria-labelledby="soil-histories-heading" className="mt-atlas-7 border-t border-atlas-border pt-atlas-6">
        <h4 id="soil-histories-heading" className="text-atlas-xl font-atlas-semibold">
          Read-only histories
        </h4>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
          Work is shown first; payments, rates, and adjustments remain clearly available without competing with the primary action.
        </p>
        <div className="mt-atlas-4 space-y-atlas-3">
          <HistoryDetails
            title="Work and earnings — selected period"
            initiallyOpen
            loading={earningsQuery.isLoading}
            error={earningsQuery.error}
            empty={!earningsRange || (earningsQuery.data?.length ?? 0) === 0}
            emptyTitle={earningsRange ? "No work in this period" : "Choose a valid earnings period"}
            emptyMessage={earningsRange
              ? "No trolley earnings were recorded in the selected period."
              : "Choose a valid earnings period above."}
            onRetry={() => { void earningsQuery.refetch(); }}
          >
            <EarningsHistory entries={(earningsQuery.data ?? []).map(buildSoilEarningHistoryItem)} />
          </HistoryDetails>

          <HistoryDetails
            title="Payments"
            loading={paymentsQuery.isLoading}
            error={paymentsQuery.error}
            empty={(paymentsQuery.data?.length ?? 0) === 0}
            emptyTitle="No payments recorded"
            emptyMessage={ATLAS_UI_STRINGS.payment.noHistory}
            onRetry={() => { void paymentsQuery.refetch(); }}
          >
            <PaymentHistory payments={paymentsQuery.data ?? []} />
          </HistoryDetails>

          <HistoryDetails
            title="Trolley rate history"
            loading={rateQuery.isLoading}
            error={rateQuery.error}
            empty={(rateQuery.data?.length ?? 0) === 0}
            emptyTitle="No trolley rates recorded"
            emptyMessage="No effective-dated trolley rate is available for this worker."
            onRetry={() => { void rateQuery.refetch(); }}
          >
            <RateHistory rates={rateQuery.data ?? []} />
          </HistoryDetails>

          <HistoryDetails
            title="Adjustments"
            loading={adjustmentsQuery.isLoading}
            error={adjustmentsQuery.error}
            empty={(adjustmentsQuery.data?.length ?? 0) === 0}
            emptyTitle="No adjustments recorded"
            emptyMessage="No financial additions or deductions have been recorded."
            onRetry={() => { void adjustmentsQuery.refetch(); }}
          >
            <AdjustmentHistory adjustments={adjustmentsQuery.data ?? []} />
          </HistoryDetails>
        </div>
      </section>
    </article>
  );
}

function LegacyField({ label, children }: Readonly<{
  label: string;
  children: React.ReactNode;
}>) {
  return <label className="block text-sm font-medium text-slate-700"><span>{label}</span>{children}</label>;
}

function CompactValue({ label, value, emphasize = false }: Readonly<{ label: string; value: string; emphasize?: boolean }>) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-sm font-semibold tabular-nums ${emphasize ? "text-amber-800" : "text-slate-950"}`}>{value}</p></div>;
}

function FinancialMetric({ label, value, emphasize = false }: Readonly<{
  label: string;
  value: string;
  emphasize?: boolean;
}>) {
  return (
    <div>
      <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
        {label}
      </dt>
      <dd
        className={`mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums ${emphasize ? "text-atlas-primary" : "text-atlas-text"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function FinancialInline({ value, tone }: Readonly<{
  value: string;
  tone: "success" | "danger";
}>) {
  return (
    <span
      className={`font-atlas-semibold tabular-nums ${tone === "success" ? "text-atlas-success-text" : "text-atlas-danger-text"}`}
    >
      {value}
    </span>
  );
}

function HistoryDetails({
  title,
  initiallyOpen = false,
  loading,
  error,
  empty,
  emptyTitle,
  emptyMessage,
  onRetry,
  children,
}: Readonly<{
  title: string;
  initiallyOpen?: boolean;
  loading: boolean;
  error: Error | null;
  empty: boolean;
  emptyTitle: string;
  emptyMessage: string;
  onRetry: () => void;
  children: React.ReactNode;
}>) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="rounded-atlas-card border border-atlas-border bg-atlas-surface"
    >
      <summary className="flex min-h-atlas-12 cursor-pointer items-center px-atlas-4 py-atlas-2 font-atlas-semibold focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
        {title}
      </summary>
      <div className="border-t border-atlas-border p-atlas-4">
        {loading && (
          <Feedback tone="neutral" role="status">
            {ATLAS_UI_STRINGS.feedback.loading}
          </Feedback>
        )}
        {!loading && error && (
          <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{soilOfficeErrorMessage(error, `Could not load ${title.toLowerCase()}.`)}</span>
              <Button variant="secondary" onClick={onRetry}>
                {ATLAS_UI_STRINGS.actions.retry}
              </Button>
            </div>
          </Feedback>
        )}
        {!loading && !error && empty && (
          <EmptyState title={emptyTitle} description={emptyMessage} />
        )}
        {!loading && !error && !empty && children}
      </div>
    </details>
  );
}

type EarningHistoryItem = ReturnType<typeof buildSoilEarningHistoryItem>;

function EarningsHistory({ entries }: Readonly<{ entries: readonly EarningHistoryItem[] }>) {
  return (
    <>
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <TableCaption visuallyHidden>Work and earnings for the selected period</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
                <TableHeaderCell>Work</TableHeaderCell>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.date}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.isCorrection ? "Correction" : "Work"}</TableCell>
                  <TableCell numeric>
                    <span className={item.amount.startsWith("−") ? "text-atlas-danger-text" : "text-atlas-success-text"}>
                      {item.amount}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
      <ul className="divide-y divide-atlas-border md:hidden">
        {entries.map((item) => (
          <li key={item.id} className="py-atlas-3">
            <div className="flex items-start justify-between gap-atlas-3">
              <div>
                <p className="font-atlas-medium">{item.date}</p>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{item.description}</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                  {item.isCorrection ? "Correction" : "Work"}
                </p>
              </div>
              <p className={`whitespace-nowrap font-atlas-semibold tabular-nums ${item.amount.startsWith("−") ? "text-atlas-danger-text" : "text-atlas-success-text"}`}>
                {item.amount}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function PaymentHistory({ payments }: Readonly<{ payments: readonly SoilPayment[] }>) {
  return (
    <>
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <TableCaption visuallyHidden>{ATLAS_UI_STRINGS.payment.history}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Payment date</TableHeaderCell>
                <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{formatDateOnly(payment.paymentDate)}</TableCell>
                  <TableCell numeric>{formatIndianCurrency(payment.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
      <ul className="divide-y divide-atlas-border md:hidden">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between gap-atlas-3 py-atlas-3">
            <span>{formatDateOnly(payment.paymentDate)}</span>
            <span className="font-atlas-semibold tabular-nums">{formatIndianCurrency(payment.amount)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function RateHistory({ rates }: Readonly<{ rates: readonly SoilWorkerTrolleyRate[] }>) {
  return (
    <>
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <TableCaption visuallyHidden>Trolley rate history</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Effective from</TableHeaderCell>
                <TableHeaderCell>Effective to</TableHeaderCell>
                <TableHeaderCell numeric>Rate per trolley</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell>{formatDateOnly(rate.effectiveFrom)}</TableCell>
                  <TableCell>{rate.effectiveTo ? formatDateOnly(rate.effectiveTo) : "Current/open"}</TableCell>
                  <TableCell numeric>{formatIndianCurrency(rate.ratePerTrolley)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
      <ul className="divide-y divide-atlas-border md:hidden">
        {rates.map((rate) => (
          <li key={rate.id} className="py-atlas-3">
            <div className="flex items-start justify-between gap-atlas-3">
              <div>
                <p>{formatDateOnly(rate.effectiveFrom)}</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
                  to {rate.effectiveTo ? formatDateOnly(rate.effectiveTo) : "Current/open"}
                </p>
              </div>
              <p className="font-atlas-semibold tabular-nums">
                {formatIndianCurrency(rate.ratePerTrolley)} / trolley
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function AdjustmentHistory({ adjustments }: Readonly<{
  adjustments: readonly SoilFinancialAdjustment[];
}>) {
  return (
    <>
      <div className="hidden md:block">
        <TableContainer>
          <Table>
            <TableCaption visuallyHidden>Financial adjustment history</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adjustment) => {
                const isAddition = adjustment.adjustmentType === "ADDITION";
                return (
                  <TableRow key={adjustment.id}>
                    <TableCell>{formatDateOnly(adjustment.adjustmentDate)}</TableCell>
                    <TableCell>{isAddition ? "Addition" : "Deduction"}</TableCell>
                    <TableCell>{adjustment.reason}</TableCell>
                    <TableCell numeric>
                      <span className={isAddition ? "text-atlas-success-text" : "text-atlas-danger-text"}>
                        {isAddition ? "+" : "−"}{formatIndianCurrency(adjustment.amount)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
      <ul className="divide-y divide-atlas-border md:hidden">
        {adjustments.map((adjustment) => {
          const isAddition = adjustment.adjustmentType === "ADDITION";
          return (
            <li key={adjustment.id} className="py-atlas-3">
              <div className="flex items-start justify-between gap-atlas-3">
                <div>
                  <p className="font-atlas-medium">
                    {formatDateOnly(adjustment.adjustmentDate)} · {isAddition ? "Addition" : "Deduction"}
                  </p>
                  <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{adjustment.reason}</p>
                </div>
                <p className={`whitespace-nowrap font-atlas-semibold tabular-nums ${isAddition ? "text-atlas-success-text" : "text-atlas-danger-text"}`}>
                  {isAddition ? "+" : "−"}{formatIndianCurrency(adjustment.amount)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function LegacyFeedback({ error, success }: Readonly<{ error: string; success: string }>) {
  return <>{error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}{success && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{success}</p>}</>;
}
