"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildSoilAdjustmentInput,
  buildSoilEarningHistoryItem,
  buildSoilPaymentInput,
  buildSoilRateChangeInput,
  buildSoilWorkerCreateInput,
  canOfferUnusedSoilWorkerDelete,
  formatSoilDate,
  formatSoilMoney,
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
import { getLocalDate } from "@/lib/local-date";

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
          <Field label="Worker name"><input value={name} onChange={(event) => { setName(event.target.value); setCreateError(""); setCreateSuccess(""); }} disabled={isCreating} className={inputClass} /></Field>
          <Field label="Initial ₹ / trolley"><input type="number" min="0.01" step="any" value={initialRate} onChange={(event) => { setInitialRate(event.target.value); setCreateError(""); setCreateSuccess(""); }} disabled={isCreating} className={inputClass} /></Field>
          <Field label="Effective from"><input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setCreateError(""); setCreateSuccess(""); }} disabled={isCreating} className={inputClass} /></Field>
          <button disabled={isCreating} className={primaryButton}>{isCreating ? "Adding..." : "Add worker"}</button>
        </div>
        <Feedback error={createError} success={createSuccess} />
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
            Current rate: {rateQuery.isLoading ? "Loading..." : rateQuery.data ? `${formatSoilMoney(rateQuery.data.ratePerTrolley)} / trolley` : "Unavailable"}
          </p>
        </div>
        <button type="button" onClick={onOpen} className={secondaryButton}>{isSelected ? "Close" : "Open details"}</button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-200 pt-4">
        <CompactValue label="Total Earned" value={financialQuery.data ? formatSoilMoney(financialQuery.data.totalEarned) : financialQuery.isLoading ? "Loading..." : "Unavailable"} />
        <CompactValue label="Paid" value={financialQuery.data ? formatSoilMoney(financialQuery.data.totalPaid) : financialQuery.isLoading ? "Loading..." : "Unavailable"} />
        <CompactValue label="Available" value={financialQuery.data ? formatSoilMoney(financialQuery.data.availableBalance) : financialQuery.isLoading ? "Loading..." : "Unavailable"} emphasize />
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

  return (
    <article aria-labelledby="soil-worker-detail-heading" className="mt-6 rounded-xl border border-amber-300 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">{worker.isActive ? "Active worker" : "Archived worker"}</p>
          <h3 id="soil-worker-detail-heading" className="mt-1 text-2xl font-bold">{worker.name}</h3>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {worker.isActive
            ? <button type="button" onClick={archiveWorker} disabled={Boolean(savingAction)} className={secondaryButton}>{savingAction === "archive" ? "Archiving..." : "Archive"}</button>
            : <button type="button" onClick={restoreWorker} disabled={Boolean(savingAction)} className={secondaryButton}>{savingAction === "restore" ? "Restoring..." : "Restore"}</button>}
          {canDelete && <button type="button" onClick={() => { setConfirmingDelete(true); clearFeedback(); }} disabled={Boolean(savingAction)} className="h-10 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 disabled:opacity-50">Delete unused worker</button>}
        </div>
      </div>

      {confirmingDelete && <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4"><p className="text-sm font-semibold text-red-900">Permanently delete {worker.name} and their setup-only trolley rates?</p><p className="mt-1 text-sm text-red-800">This succeeds only if the database confirms there are no trolley, earning, payment, or adjustment records.</p><div className="mt-3 flex gap-2"><button type="button" onClick={deleteWorker} disabled={Boolean(savingAction)} className="h-9 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{savingAction === "delete" ? "Deleting..." : "Confirm permanent delete"}</button><button type="button" onClick={() => setConfirmingDelete(false)} disabled={Boolean(savingAction)} className={secondaryButton}>Cancel</button></div></div>}

      <section aria-label={`${worker.name} earnings period`} className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium text-amber-900">Earnings period</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {wageDatePresets.map((option) => <button key={option.value} type="button" aria-pressed={earningsPreset === option.value} onClick={() => setEarningsPreset(option.value)} className={`h-9 rounded-lg border px-3 text-sm font-semibold ${earningsPreset === option.value ? "border-amber-700 bg-amber-700 text-white" : "border-amber-300 bg-white text-slate-700"}`}>{option.label}</button>)}
            </div>
          </div>
          <SummaryValue label="Period Earned" value={periodEarned === null ? "—" : formatSoilMoney(periodEarned)} />
        </div>
        {earningsPreset === "custom" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="From"><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className={inputClass} /></Field>
          <Field label="To"><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className={inputClass} /></Field>
        </div>}
        {earningsPreset === "custom" && !earningsRange && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Choose a valid inclusive date range. From date cannot be after To date.</p>}
        {earningsRange && <p className="mt-3 text-xs text-amber-900">Showing {formatSoilDate(earningsRange.fromDate)} to {formatSoilDate(earningsRange.toDate)}, inclusive.</p>}
      </section>

      <section aria-label={`${worker.name} financial summary`} className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryValue label="Total Earned" value={summaryQuery.isLoading ? "Loading..." : summary ? formatSoilMoney(summary.totalEarned) : "Unavailable"} />
        <SummaryValue label="Total Additions" value={summary ? formatSoilMoney(summary.totalAdditions) : "—"} tone="positive" />
        <SummaryValue label="Total Deductions" value={summary ? formatSoilMoney(summary.totalDeductions) : "—"} tone="negative" />
        <SummaryValue label="Total Paid" value={summary ? formatSoilMoney(summary.totalPaid) : "—"} />
        <SummaryValue label="Available Balance" value={summary ? formatSoilMoney(summary.availableBalance) : "—"} tone="available" />
      </section>
      {summaryQuery.error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{soilOfficeErrorMessage(summaryQuery.error, "Could not load the financial summary.")}</p>}

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <form onSubmit={submitRate} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h4 className="font-semibold">Change trolley rate</h4>
          <p className="mt-1 text-xs text-slate-600">The effective date controls new work only. Historical snapshots stay unchanged.</p>
          <div className="mt-3 space-y-3">
            <Field label="New ₹ / trolley"><input type="number" min="0.01" step="any" value={newRate} onChange={(event) => { setNewRate(event.target.value); clearFeedback(); }} disabled={!worker.isActive || Boolean(savingAction)} className={inputClass} /></Field>
            <Field label="Effective from"><input type="date" value={rateDate} onChange={(event) => { setRateDate(event.target.value); clearFeedback(); }} disabled={!worker.isActive || Boolean(savingAction)} className={inputClass} /></Field>
            <button disabled={Boolean(savingAction) || !worker.isActive} className={secondaryButton}>{savingAction === "rate" ? "Saving..." : worker.isActive ? "Add rate" : "Restore to add rate"}</button>
          </div>
        </form>

        <form onSubmit={submitPayment} className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <h4 className="font-semibold text-indigo-950">Record payment</h4>
          <p className="mt-1 text-xs text-indigo-800">Available now: {summary ? formatSoilMoney(summary.availableBalance) : "Unavailable"}</p>
          <div className="mt-3 space-y-3">
            <Field label="Payment date"><input type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); clearFeedback(); }} className={inputClass} /></Field>
            <Field label="Amount"><input type="number" min="0.01" step="any" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); clearFeedback(); }} className={inputClass} /></Field>
            <button disabled={Boolean(savingAction) || !summary} className={primaryButton}>{savingAction === "payment" ? "Recording..." : "Record payment"}</button>
          </div>
        </form>

        <form onSubmit={submitAdjustment} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-semibold text-emerald-950">Adjustment</h4>
          <div className="mt-3 space-y-3">
            <Field label="Type"><select value={adjustmentType} onChange={(event) => { setAdjustmentType(event.target.value as SoilFinancialAdjustmentType | ""); clearFeedback(); }} className={inputClass}><option value="" disabled>Select type</option><option value="ADDITION">Addition</option><option value="DEDUCTION">Deduction</option></select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" value={adjustmentDate} onChange={(event) => { setAdjustmentDate(event.target.value); clearFeedback(); }} className={inputClass} /></Field>
              <Field label="Amount"><input type="number" min="0.01" step="any" value={adjustmentAmount} onChange={(event) => { setAdjustmentAmount(event.target.value); clearFeedback(); }} className={inputClass} /></Field>
            </div>
            <Field label="Reason"><input value={adjustmentReason} onChange={(event) => { setAdjustmentReason(event.target.value); clearFeedback(); }} placeholder="Required" className={inputClass} /></Field>
            <button disabled={Boolean(savingAction) || !summary} className={primaryButton}>{savingAction === "adjustment" ? "Recording..." : "Record adjustment"}</button>
          </div>
        </form>
      </div>
      <Feedback error={error} success={success} />

      <section aria-labelledby="soil-histories-heading" className="mt-7 border-t border-slate-200 pt-6">
        <h4 id="soil-histories-heading" className="text-lg font-bold">Read-only histories</h4>
        <div className="mt-4 space-y-3">
          <HistoryDetails title="Trolley rate history" loading={rateQuery.isLoading} error={rateQuery.error} empty={(rateQuery.data?.length ?? 0) === 0} emptyMessage="No trolley rates recorded.">
            <ul className="divide-y divide-slate-100">{(rateQuery.data ?? []).map((rate) => <li key={rate.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="font-semibold">{formatSoilMoney(rate.ratePerTrolley)} / trolley</span><span className="text-slate-600">{formatSoilDate(rate.effectiveFrom)}{rate.effectiveTo ? ` — ${formatSoilDate(rate.effectiveTo)}` : " — Current/open"}</span></li>)}</ul>
          </HistoryDetails>

          <HistoryDetails title="Work and earnings — selected period" loading={earningsQuery.isLoading} error={earningsQuery.error} empty={!earningsRange || (earningsQuery.data?.length ?? 0) === 0} emptyMessage={earningsRange ? "No trolley earnings in the selected period." : "Choose a valid earnings period above."}>
            <ul className="divide-y divide-slate-100">{(earningsQuery.data ?? []).map(buildSoilEarningHistoryItem).map((item) => <li key={item.id} className="py-3 text-sm"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-medium">{item.date}</span><span className="ml-2 text-slate-600">{item.description}</span>{item.isCorrection && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Correction</span>}</div><span className={`font-semibold tabular-nums ${item.amount.startsWith("−") ? "text-red-700" : "text-emerald-700"}`}>{item.amount}</span></div></li>)}</ul>
          </HistoryDetails>

          <HistoryDetails title="Adjustments" loading={adjustmentsQuery.isLoading} error={adjustmentsQuery.error} empty={(adjustmentsQuery.data?.length ?? 0) === 0} emptyMessage="No adjustments recorded yet.">
            <ul className="divide-y divide-slate-100">{(adjustmentsQuery.data ?? []).map((adjustment) => <li key={adjustment.id} className="py-3 text-sm"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-medium">{formatSoilDate(adjustment.adjustmentDate)}</span><span className="ml-2 text-slate-600">{adjustment.reason}</span></div><span className={`font-semibold ${adjustment.adjustmentType === "ADDITION" ? "text-emerald-700" : "text-red-700"}`}>{adjustment.adjustmentType === "ADDITION" ? "+" : "−"}{formatSoilMoney(adjustment.amount)} · {adjustment.adjustmentType === "ADDITION" ? "Addition" : "Deduction"}</span></div></li>)}</ul>
          </HistoryDetails>

          <HistoryDetails title="Payments" loading={paymentsQuery.isLoading} error={paymentsQuery.error} empty={(paymentsQuery.data?.length ?? 0) === 0} emptyMessage="No payments recorded yet.">
            <ul className="divide-y divide-slate-100">{(paymentsQuery.data ?? []).map((payment) => <li key={payment.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{formatSoilDate(payment.paymentDate)}</span><span className="font-semibold">{formatSoilMoney(payment.amount)}</span></li>)}</ul>
          </HistoryDetails>
        </div>
      </section>
    </article>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return <label className="block text-sm font-medium text-slate-700"><span>{label}</span>{children}</label>;
}

function CompactValue({ label, value, emphasize = false }: Readonly<{ label: string; value: string; emphasize?: boolean }>) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-sm font-semibold tabular-nums ${emphasize ? "text-amber-800" : "text-slate-950"}`}>{value}</p></div>;
}

function SummaryValue({ label, value, tone = "default" }: Readonly<{
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "available";
}>) {
  const toneClass = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : tone === "available" ? "text-amber-800" : "text-slate-950";
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${toneClass}`}>{value}</p></div>;
}

function HistoryDetails({ title, loading, error, empty, emptyMessage, children }: Readonly<{
  title: string;
  loading: boolean;
  error: Error | null;
  empty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}>) {
  return <details className="rounded-lg border border-slate-200 px-4 py-3"><summary className="cursor-pointer font-semibold">{title}</summary>{loading && <p className="mt-3 text-sm text-slate-500">Loading...</p>}{error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{soilOfficeErrorMessage(error, `Could not load ${title.toLowerCase()}.`)}</p>}{!loading && !error && empty && <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>}{!loading && !error && !empty && <div className="mt-2">{children}</div>}</details>;
}

function Feedback({ error, success }: Readonly<{ error: string; success: string }>) {
  return <>{error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}{success && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{success}</p>}</>;
}
