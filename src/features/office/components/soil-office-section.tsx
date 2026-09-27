"use client";

import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  AddSoilTrolleyWorkerDrawer,
  type AddSoilTrolleyWorkerInput,
} from "@/features/office/components/add-soil-trolley-worker-drawer";
import { SoilTrolleyAccountDrawer } from "@/features/office/components/soil-trolley-account-drawer";
import { SoilTrolleyManagementDrawer } from "@/features/office/components/soil-trolley-management-drawer";
import {
  buildSoilWorkerCreateInput,
  filterSoilOverviewWorkers,
  formatSoilWorkerLastPaid,
  soilOfficeErrorMessage,
  sumSoilPeriodEarned,
  sumSoilPeriodTrolleys,
  type SoilWorkerLifecycleFilter,
} from "@/features/office/soil-office-model";
import {
  soilCurrentRateQueryKey as currentRateKey,
  soilEarningsQueryKey as earningsKey,
  soilFinancialSummaryQueryKey as summaryKey,
  soilPaymentsQueryKey as paymentsKey,
  soilWorkersQueryKey as workersKey,
} from "@/features/office/soil-office-query-keys";
import { listSoilEarnings } from "@/features/soil/services/soil-earning-read-service";
import {
  getSoilFinancialSummary,
  listSoilPayments,
} from "@/features/soil/services/soil-payment-service";
import {
  createSoilWorker,
  listSoilWorkers,
  resolveSoilWorkerTrolleyRate,
} from "@/features/soil/services/soil-worker-rate-service";
import type { SoilWorker } from "@/features/soil/types";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import {
  formatDateOnly,
  formatIndianCurrency,
  formatIndianNumber,
} from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  SOIL_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

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
    refetchInterval: 30_000,
  });
  const [localToday] = useState(getLocalDate);
  const [accountWorkerId, setAccountWorkerId] = useState("");
  const [managementWorkerId, setManagementWorkerId] = useState("");
  const [isAddWorkerOpen, setIsAddWorkerOpen] = useState(false);
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [workerSearch, setWorkerSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<SoilWorkerLifecycleFilter>("all");

  async function createWorker(input: AddSoilTrolleyWorkerInput): Promise<string | null> {
    const creationInput = buildSoilWorkerCreateInput({
      factoryId,
      name: input.name,
      initialRate: input.initialRate,
      effectiveFrom: input.effectiveFrom,
    });
    if (!creationInput) {
      return "Enter a worker name, positive initial rate, and valid effective-from date.";
    }

    try {
      const worker = await createSoilWorker(creationInput);
      queryClient.setQueryData<SoilWorker[]>(workersKey(factoryId), (current = []) =>
        [...current.filter((item) => item.id !== worker.id), worker].sort(
          (left, right) => left.name.localeCompare(right.name, "en-IN")
            || left.id.localeCompare(right.id),
        ));
      await queryClient.invalidateQueries({ queryKey: workersKey(factoryId) });
      setIsAddWorkerOpen(false);
      setManagementWorkerId(worker.id);
      return null;
    } catch (error) {
      return soilOfficeErrorMessage(error, "Could not add the Soil worker.");
    }
  }

  const workers = workersQuery.data ?? [];
  const earningsRange = resolveWageEarningsDateRange(
    rangePreset,
    localToday,
    customFrom,
    customTo,
  );
  const overviewQueriesEnabled = !workersQuery.isLoading && !workersQuery.error;
  const rateQueries = useQueries({
    queries: workers.map((worker) => ({
      queryKey: currentRateKey(factoryId, worker.id, localToday),
      queryFn: () => resolveSoilWorkerTrolleyRate({
        factoryId,
        soilWorkerId: worker.id,
        workDate: localToday,
      }),
      enabled: overviewQueriesEnabled,
      refetchInterval: 30_000,
    })),
  });
  const earningsQueries = useQueries({
    queries: workers.map((worker) => ({
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
      enabled: overviewQueriesEnabled && earningsRange !== null,
      refetchInterval: 30_000,
    })),
  });
  const summaryQueries = useQueries({
    queries: workers.map((worker) => ({
      queryKey: summaryKey(factoryId, worker.id),
      queryFn: () => getSoilFinancialSummary({
        factoryId,
        soilWorkerId: worker.id,
      }),
      enabled: overviewQueriesEnabled,
      refetchInterval: 30_000,
    })),
  });
  const paymentQueries = useQueries({
    queries: workers.map((worker) => ({
      queryKey: paymentsKey(factoryId, worker.id),
      queryFn: () => listSoilPayments({
        factoryId,
        soilWorkerId: worker.id,
      }),
      enabled: overviewQueriesEnabled,
      refetchInterval: 30_000,
    })),
  });

  const activeCount = workers.filter((worker) => worker.isActive).length;
  const archivedCount = workers.length - activeCount;
  const visibleWorkers = filterSoilOverviewWorkers({
    workers,
    lifecycle: lifecycleFilter,
    search: workerSearch,
  });
  const workerIndexById = new Map(
    workers.map((worker, index) => [worker.id, index]),
  );
  const earningsLoading = workersQuery.isLoading
    || earningsQueries.some((query) => query.isLoading);
  const earningsError = earningsRange === null
    || earningsQueries.some((query) => Boolean(query.error));
  const summariesLoading = workersQuery.isLoading
    || summaryQueries.some((query) => query.isLoading);
  const summariesError = summaryQueries.some((query) => Boolean(query.error));
  const periodTotal = earningsError
    ? null
    : earningsQueries.reduce(
      (total, query) => total + sumSoilPeriodEarned(query.data ?? []),
      0,
    );
  const totalAvailableBalance = summariesError
    ? null
    : summaryQueries.reduce(
      (total, query) => total + (query.data?.availableBalance ?? 0),
      0,
    );
  const accountWorker = workers.find((worker) => worker.id === accountWorkerId);
  const managedWorker = workers.find((worker) => worker.id === managementWorkerId);
  const periodLabel = wageDatePresets.find((option) => option.value === rangePreset)?.label
    ?? "Selected period";

  function openAccount(workerId: string) {
    setIsAddWorkerOpen(false);
    setManagementWorkerId("");
    setAccountWorkerId(workerId);
  }

  function toggleManagement(workerId: string) {
    setIsAddWorkerOpen(false);
    setAccountWorkerId("");
    setManagementWorkerId((current) => current === workerId ? "" : workerId);
  }

  return (
    <section aria-labelledby="soil-office-heading">
      <header className="border-b border-atlas-border pb-atlas-5">
        <div className="flex flex-col gap-atlas-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Workforce / Soil &amp; Trolley
            </p>
            <div className="mt-atlas-1 flex flex-col gap-atlas-3 sm:flex-row sm:items-center">
              <h3 id="soil-office-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">
                Soil / Trolley workers
              </h3>
              <div className="w-full sm:w-44">
                <Select
                  aria-label="Select earnings period"
                  value={rangePreset}
                  onChange={(event) => setRangePreset(event.target.value as WageEarningsDatePreset)}
                >
                  {wageDatePresets.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="mt-atlas-2 flex flex-wrap items-center gap-x-atlas-2 gap-y-atlas-1 text-atlas-sm text-atlas-text-muted">
              <span><strong className="font-atlas-semibold tabular-nums text-atlas-text">{earningsLoading ? ATLAS_UI_STRINGS.feedback.loading : periodTotal === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(periodTotal)}</strong> earned</span>
              <span aria-hidden="true" className="text-atlas-text-subtle">·</span>
              <span><strong className="font-atlas-semibold tabular-nums text-atlas-text">{workersQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : formatIndianNumber(activeCount)}</strong> active workers</span>
              <span aria-hidden="true" className="text-atlas-text-subtle">·</span>
              <span><strong className="font-atlas-semibold tabular-nums text-atlas-text">{summariesLoading ? ATLAS_UI_STRINGS.feedback.loading : totalAvailableBalance === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(totalAvailableBalance)}</strong> available</span>
            </p>
          </div>
          <Button
            aria-expanded={isAddWorkerOpen}
            onClick={() => {
              setAccountWorkerId("");
              setManagementWorkerId("");
              setIsAddWorkerOpen(true);
            }}
          >
            + Add worker
          </Button>
        </div>

        {rangePreset === "custom" && (
          <div className="mt-atlas-4 grid max-w-xl gap-atlas-3 sm:grid-cols-2">
            <FormField label="From"><Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></FormField>
            <FormField label="To"><Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></FormField>
          </div>
        )}
        {rangePreset === "custom" && !earningsRange && (
          <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>
        )}
        {earningsRange && (
          <p className="mt-atlas-3 text-atlas-xs text-atlas-text-subtle">
            {formatDateOnly(earningsRange.fromDate)} — {formatDateOnly(earningsRange.toDate)}, inclusive. Earnings and trolley quantities use saved historical snapshots.
          </p>
        )}
      </header>

      <div className="mt-atlas-5 flex flex-col gap-atlas-3 lg:flex-row lg:items-end lg:justify-between">
        <div aria-label="Filter Soil / Trolley workers by lifecycle" className="flex gap-atlas-2 overflow-x-auto pb-atlas-1">
          {([
            ["all", `All ${formatIndianNumber(workers.length)}`],
            ["active", `Active ${formatIndianNumber(activeCount)}`],
            ["archived", `Archived ${formatIndianNumber(archivedCount)}`],
          ] as const).map(([value, label]) => (
            <Button key={value} variant={lifecycleFilter === value ? "primary" : "ghost"} aria-pressed={lifecycleFilter === value} onClick={() => setLifecycleFilter(value)}>{label}</Button>
          ))}
        </div>
        <div className="w-full lg:max-w-sm">
          <FormField label="Search Soil / Trolley workers">
            <Input type="search" value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} placeholder="Search worker" autoComplete="off" />
          </FormField>
        </div>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {workersQuery.error && <Feedback role="alert" tone="danger">{soilOfficeErrorMessage(workersQuery.error, "Could not load Soil / Trolley workers.")}</Feedback>}
        {rateQueries.some((query) => Boolean(query.error)) && <Feedback role="alert" tone="danger">Could not load one or more current trolley rates.</Feedback>}
        {earningsQueries.some((query) => Boolean(query.error)) && <Feedback role="alert" tone="danger">Could not load one or more workers&apos; saved earnings for this period.</Feedback>}
        {summaryQueries.some((query) => Boolean(query.error)) && <Feedback role="alert" tone="danger">Could not load one or more authoritative balances.</Feedback>}
        {paymentQueries.some((query) => Boolean(query.error)) && <Feedback role="alert" tone="danger">Could not load one or more workers&apos; payment history.</Feedback>}
      </div>

      {workersQuery.isLoading ? (
        <div className="mt-atlas-4"><Feedback role="status" tone="neutral">Loading Soil / Trolley workers...</Feedback></div>
      ) : workersQuery.error ? null : visibleWorkers.length === 0 ? (
        <EmptyState
          title={workers.length === 0 ? "No Soil / Trolley workers yet" : "No workers match these filters"}
          description={workers.length === 0 ? "Use Add worker to create the first Soil / Trolley worker." : "Clear the search or choose another lifecycle filter."}
        />
      ) : (
        <>
          <div className="mt-atlas-4 hidden md:block">
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Soil / Trolley worker overview for {periodLabel}</TableCaption>
                <TableHeader><TableRow>
                  <TableHeaderCell>Worker</TableHeaderCell>
                  <TableHeaderCell numeric>Trolleys</TableHeaderCell>
                  <TableHeaderCell numeric>Earned ({periodLabel})</TableHeaderCell>
                  <TableHeaderCell numeric>Available (authoritative)</TableHeaderCell>
                  <TableHeaderCell>Last paid</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                </TableRow></TableHeader>
                <TableBody>{visibleWorkers.map((worker) => {
                  const index = workerIndexById.get(worker.id)!;
                  const rateQuery = rateQueries[index];
                  const earningsQuery = earningsQueries[index];
                  const summaryQuery = summaryQueries[index];
                  const paymentQuery = paymentQueries[index];
                  const lifecycleStatus = resolveBooleanStatusPresentation(SOIL_WORKER_LIFECYCLE_STATUS, worker.isActive);
                  const periodTrolleys = earningsQuery.error || !earningsRange ? null : sumSoilPeriodTrolleys(earningsQuery.data ?? []);
                  const periodEarned = earningsQuery.error || !earningsRange ? null : sumSoilPeriodEarned(earningsQuery.data ?? []);
                  const latestPayment = paymentQuery.data?.[0] ?? null;
                  return <TableRow key={worker.id} hoverable selected={worker.id === accountWorkerId || worker.id === managementWorkerId}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-atlas-2"><p className="font-atlas-semibold text-atlas-text">{worker.name}</p>{!worker.isActive && <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />}</div>
                      <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{rateQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : rateQuery.error || !rateQuery.data ? ATLAS_UI_STRINGS.feedback.unavailable : `${formatIndianCurrency(rateQuery.data.ratePerTrolley)} / trolley · Effective ${formatDateOnly(rateQuery.data.effectiveFrom)}`}</p>
                    </TableCell>
                    <TableCell numeric><span className="font-atlas-medium text-atlas-text-muted">{earningsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : periodTrolleys === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianNumber(periodTrolleys, { maximumFractionDigits: 3 })}</span></TableCell>
                    <TableCell numeric><span className="font-atlas-medium text-atlas-text-muted">{earningsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : periodEarned === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(periodEarned)}</span></TableCell>
                    <TableCell numeric><span className="font-atlas-semibold text-atlas-text">{summaryQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : summaryQuery.error || !summaryQuery.data ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(summaryQuery.data.availableBalance)}</span></TableCell>
                    <TableCell><span className="text-atlas-sm font-atlas-medium text-atlas-text-muted">{paymentQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : paymentQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : formatSoilWorkerLastPaid(latestPayment?.paymentDate ?? null, localToday)}</span></TableCell>
                    <TableCell><div className="flex flex-wrap gap-atlas-2"><Button aria-expanded={accountWorkerId === worker.id} onClick={() => openAccount(worker.id)}>Account &amp; payment</Button><Button variant="ghost" aria-expanded={managementWorkerId === worker.id} onClick={() => toggleManagement(worker.id)}>{managementWorkerId === worker.id ? "Close management" : "Manage"}</Button></div></TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
              <div className="flex flex-col gap-atlas-1 border-t border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 text-atlas-xs text-atlas-text-subtle sm:flex-row sm:items-center sm:justify-between">
                <p>Showing {formatIndianNumber(visibleWorkers.length)} of {formatIndianNumber(workers.length)} Soil / Trolley workers</p>
                <p>Available balance is authoritative lifetime balance, not period-dependent.</p>
              </div>
            </TableContainer>
          </div>

          <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
            {visibleWorkers.map((worker) => {
              const index = workerIndexById.get(worker.id)!;
              const rateQuery = rateQueries[index];
              const earningsQuery = earningsQueries[index];
              const summaryQuery = summaryQueries[index];
              const paymentQuery = paymentQueries[index];
              const lifecycleStatus = resolveBooleanStatusPresentation(SOIL_WORKER_LIFECYCLE_STATUS, worker.isActive);
              const periodTrolleys = earningsQuery.error || !earningsRange ? null : sumSoilPeriodTrolleys(earningsQuery.data ?? []);
              const periodEarned = earningsQuery.error || !earningsRange ? null : sumSoilPeriodEarned(earningsQuery.data ?? []);
              const latestPayment = paymentQuery.data?.[0] ?? null;
              return <article key={worker.id} className="py-atlas-4">
                <div className="flex items-start justify-between gap-atlas-3"><div className="min-w-0"><h4 className="truncate text-atlas-base font-atlas-semibold text-atlas-text">{worker.name}</h4><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{rateQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : rateQuery.error || !rateQuery.data ? ATLAS_UI_STRINGS.feedback.unavailable : `${formatIndianCurrency(rateQuery.data.ratePerTrolley)} / trolley · Effective ${formatDateOnly(rateQuery.data.effectiveFrom)}`}</p></div>{!worker.isActive && <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />}</div>
                <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 text-atlas-sm">
                  <div><dt className="text-atlas-xs text-atlas-text-subtle">Trolleys · {periodLabel}</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text-muted">{earningsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : periodTrolleys === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianNumber(periodTrolleys, { maximumFractionDigits: 3 })}</dd></div>
                  <div><dt className="text-right text-atlas-xs text-atlas-text-subtle">Earned · {periodLabel}</dt><dd className="mt-atlas-1 text-right font-atlas-medium tabular-nums text-atlas-text-muted">{earningsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : periodEarned === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(periodEarned)}</dd></div>
                  <div><dt className="text-atlas-xs text-atlas-text-subtle">Available balance</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{summaryQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : summaryQuery.error || !summaryQuery.data ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(summaryQuery.data.availableBalance)}</dd></div>
                </dl>
                <p className="mt-atlas-3 text-atlas-xs font-atlas-medium text-atlas-text-muted">{paymentQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : paymentQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : formatSoilWorkerLastPaid(latestPayment?.paymentDate ?? null, localToday)}</p>
                <div className="mt-atlas-3 flex flex-wrap gap-atlas-2"><Button aria-expanded={accountWorkerId === worker.id} onClick={() => openAccount(worker.id)}>Account &amp; payment</Button><Button variant="ghost" aria-expanded={managementWorkerId === worker.id} onClick={() => toggleManagement(worker.id)}>{managementWorkerId === worker.id ? "Close management" : "Manage"}</Button></div>
              </article>;
            })}
          </div>
        </>
      )}

      {managedWorker && (
        <SoilTrolleyManagementDrawer
          key={managedWorker.id}
          factoryId={factoryId}
          worker={managedWorker}
          onClose={() => setManagementWorkerId("")}
        />
      )}
      {accountWorker && (
        <SoilTrolleyAccountDrawer
          key={accountWorker.id}
          factoryId={factoryId}
          worker={accountWorker}
          onClose={() => setAccountWorkerId("")}
        />
      )}
      {isAddWorkerOpen && (
        <AddSoilTrolleyWorkerDrawer
          onCreate={createWorker}
          onClose={() => setIsAddWorkerOpen(false)}
        />
      )}
    </section>
  );
}
