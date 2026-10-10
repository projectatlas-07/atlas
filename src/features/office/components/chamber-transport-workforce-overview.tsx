"use client";

import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { creditFreshnessKey, creditHistoryKey, transportCreditHistoryOptions, isTransportCreditHistoryCurrent, isTransportCreditReadCurrent, sumPostedTransportCredits, type TransportCreditRecovery } from "../transport-wage-credit-office-model";
import { listTransportWageCredits } from "@/features/transport/services/transport-wage-credit-service";
import { Button } from "@/components/ui/button";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
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
  filterTransportOverviewWorkers,
  formatTransportWorkerLastPaid,
  groupTransportMembershipsByWorker,
  sumTransportEarningsByWorker,
  type TransportWorkerLifecycleFilter,
} from "@/features/office/chamber-transport-overview-model";
import { listTransportGroupAssignments } from "@/features/transport/services/transport-crew-assignment-service";
import { listTransportRangeEarningDetails } from "@/features/transport/services/transport-weekly-earning-read-service";
import {
  getTransportWorkerAvailableBalance,
  listLatestTransportWorkerWithdrawalsForFactory,
} from "@/features/transport/services/transport-worker-financial-service";
import type { TransportWorker } from "@/features/transport/types";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  TRANSPORT_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const RANGE_PRESETS: ReadonlyArray<{
  value: WageEarningsDatePreset;
  label: string;
}> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom" },
];

export function ChamberTransportWorkforceOverview({
  factoryId,
  workers,
  workersLoading,
  workersError,
  onManageSetup,
  onOpenAccount,
  recovery,
}: Readonly<{
  factoryId: string;
  workers: readonly TransportWorker[];
  workersLoading: boolean;
  workersError: Error | null;
  onManageSetup: () => void;
  onOpenAccount: (transportWorkerId: string) => void;
  recovery: TransportCreditRecovery;
}>) {
  const client = useQueryClient();
  const recoveryReady = recovery.ready && recovery.factoryId === factoryId && !!recovery.actorId;
  const [localToday] = useState(getLocalDate);
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [workerSearch, setWorkerSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<TransportWorkerLifecycleFilter>("all");
  const earningsRange = resolveWageEarningsDateRange(
    rangePreset,
    localToday,
    customFrom,
    customTo,
  );

  const assignmentsQuery = useQuery({
    queryKey: ["office-transport-overview-assignments", factoryId],
    queryFn: () => listTransportGroupAssignments({ factoryId }),
    refetchInterval: 30_000,
  });
  const periodEarningsQuery = useQuery({
    queryKey: [
      "office-transport-overview-period-earnings",
      factoryId,
      earningsRange?.fromDate,
      earningsRange?.toDate,
    ],
    queryFn: () => listTransportRangeEarningDetails({ factoryId, range: earningsRange! }),
    enabled: earningsRange !== null,
    refetchInterval: 30_000,
  });
  const latestWithdrawalsQuery = useQuery({
    queryKey: ["office-transport-overview-latest-withdrawals", factoryId],
    queryFn: () => listLatestTransportWorkerWithdrawalsForFactory(factoryId),
    refetchInterval: 30_000,
  });
  const credits = useQuery({ ...transportCreditHistoryOptions(recovery, factoryId, listTransportWageCredits), refetchInterval: 30_000 });
  const creditsCurrent = isTransportCreditHistoryCurrent(recovery, factoryId, { ...credits, isInvalidated: client.getQueryState(creditHistoryKey(recovery.context))?.isInvalidated });
  const freshness = useQueries({ queries: workers.map((worker) => ({
    queryKey: creditFreshnessKey(factoryId, worker.id), queryFn: () => "current", staleTime: Infinity,
  })) });
  const balanceQueries = useQueries({
    queries: workers.map((worker) => ({
      queryKey: ["office-transport-worker-balance", factoryId, worker.id, localToday],
      queryFn: () => getTransportWorkerAvailableBalance({
        factoryId,
        transportWorkerId: worker.id,
        asOfDate: localToday,
      }),
      enabled: recoveryReady && !workersLoading && !workersError,
      refetchInterval: 30_000,
    })),
  });

  const memberships = groupTransportMembershipsByWorker(assignmentsQuery.data ?? []);
  const earningsByWorker = sumTransportEarningsByWorker(periodEarningsQuery.data ?? []);
  const latestWithdrawalByWorker = new Map(
    (latestWithdrawalsQuery.data ?? []).map((withdrawal) => [withdrawal.transportWorkerId, withdrawal]),
  );
  const balanceStateByWorker = new Map(
    workers.map((worker, index) => [worker.id, balanceQueries[index]]),
  );
  const activeCount = workers.filter((worker) => worker.isActive).length;
  const inactiveCount = workers.length - activeCount;
  const visibleWorkers = filterTransportOverviewWorkers({
    workers,
    memberships,
    lifecycle: lifecycleFilter,
    search: workerSearch,
  });
  const periodTotal = [...earningsByWorker.values()].reduce((total, amount) => total + amount, 0);
  const balancesLoading = balanceQueries.some((query) => query.isLoading);
  const balancesError = balanceQueries.some((query) => Boolean(query.error));
  const balanceIsCurrent = (index: number) => recoveryReady && freshness[index]?.data === "current"
    && isTransportCreditReadCurrent({ ...balanceQueries[index], isInvalidated: client.getQueryState(["office-transport-worker-balance", factoryId, workers[index].id, localToday])?.isInvalidated });
  const totalAvailableBalance = !recoveryReady || workersLoading || workersError || balancesLoading || balancesError || workers.some((_, index) => !balanceIsCurrent(index))
    ? null
    : balanceQueries.reduce((total, query) => total + (query.data?.availableBalance ?? 0), 0);
  const periodLabel = RANGE_PRESETS.find((option) => option.value === rangePreset)?.label ?? "Selected period";

  function periodEarningsLabel(workerId: string): string {
    if (periodEarningsQuery.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (periodEarningsQuery.error || !earningsRange) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatIndianCurrency(earningsByWorker.get(workerId) ?? 0);
  }

  function availableBalanceLabel(workerId: string): string {
    const query = balanceStateByWorker.get(workerId);
    if (!query || query.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (query.error || !query.data || !balanceIsCurrent(workers.findIndex((worker) => worker.id === workerId))) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatIndianCurrency(query.data.availableBalance);
  }
  function creditLabel(workerId?: string) {
    if (!earningsRange || !credits.data || !creditsCurrent
      || workers.some((worker, index) => (!workerId || worker.id === workerId) && freshness[index]?.data !== "current")) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatIndianCurrency(sumPostedTransportCredits(credits.data, earningsRange.fromDate, earningsRange.toDate, workerId));
  }

  function lastPaidLabel(workerId: string): string {
    if (latestWithdrawalsQuery.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (latestWithdrawalsQuery.error) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatTransportWorkerLastPaid(
      latestWithdrawalByWorker.get(workerId)?.withdrawalDate ?? null,
      localToday,
    );
  }

  return (
    <section aria-labelledby="chamber-transport-overview-heading">
      <header className="border-b border-atlas-border pb-atlas-5">
        <div className="flex flex-col gap-atlas-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Workforce / Chamber Transport
            </p>
            <h3 id="chamber-transport-overview-heading" className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">
              Chamber Transport
            </h3>
            <p className="mt-atlas-2 max-w-3xl text-atlas-sm text-atlas-text-muted">
              Review Transport Group memberships, locked earnings, authoritative balances and real payment history.
            </p>
          </div>
          <Button variant="secondary" onClick={onManageSetup}>Manage setup</Button>
        </div>

        <div className="mt-atlas-5 border-y border-atlas-border py-atlas-4">
          <div className="flex flex-col gap-atlas-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Earnings period</p>
              <div className="mt-atlas-2 flex gap-atlas-2 overflow-x-auto pb-atlas-1">
                {RANGE_PRESETS.map((option) => (
                  <Button
                    key={option.value}
                    variant={rangePreset === option.value ? "primary" : "ghost"}
                    aria-pressed={rangePreset === option.value}
                    onClick={() => setRangePreset(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <dl className="grid gap-atlas-4 text-atlas-sm sm:grid-cols-3 xl:min-w-max">
              <div>
                <dt className="text-atlas-text-subtle">{ATLAS_UI_STRINGS.transportCredit.weekly}</dt>
                <dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">
                  {periodEarningsQuery.isLoading
                    ? ATLAS_UI_STRINGS.feedback.loading
                    : periodEarningsQuery.error || !earningsRange
                      ? ATLAS_UI_STRINGS.feedback.unavailable
                      : formatIndianCurrency(periodTotal)}
                </dd>
              </div>
              <div><dt className="text-atlas-text-subtle">{ATLAS_UI_STRINGS.transportCredit.credited}</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{creditLabel()}</dd></div>
              <div>
                <dt className="text-atlas-text-subtle">Active workers</dt>
                <dd className="mt-atlas-1 font-atlas-semibold text-atlas-text">{formatIndianNumber(activeCount)}</dd>
              </div>
              <div>
                <dt className="text-atlas-text-subtle">Available balance</dt>
                <dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-primary">
                  {balancesLoading
                    ? ATLAS_UI_STRINGS.feedback.loading
                    : balancesError || totalAvailableBalance === null
                      ? ATLAS_UI_STRINGS.feedback.unavailable
                      : formatIndianCurrency(totalAvailableBalance)}
                </dd>
              </div>
            </dl>
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
              {formatDateOnly(earningsRange.fromDate)} — {formatDateOnly(earningsRange.toDate)}, inclusive. Earnings use locked worker-share snapshots only.
            </p>
          )}
          <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">
            Group pools are paya × effective group rate, divided equally among workers recorded present.
          </p>
        </div>
      </header>

      <div className="mt-atlas-5 flex flex-col gap-atlas-3 lg:flex-row lg:items-end lg:justify-between">
        <div aria-label="Filter Chamber Transport workers" className="flex gap-atlas-2 overflow-x-auto pb-atlas-1">
          {([
            ["all", `All ${formatIndianNumber(workers.length)}`],
            ["active", `Active ${formatIndianNumber(activeCount)}`],
            ["inactive", `Inactive ${formatIndianNumber(inactiveCount)}`],
          ] as const).map(([value, label]) => (
            <Button key={value} variant={lifecycleFilter === value ? "primary" : "ghost"} aria-pressed={lifecycleFilter === value} onClick={() => setLifecycleFilter(value)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="w-full lg:max-w-sm">
          <FormField label="Search Chamber Transport workers">
            <Input type="search" value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} placeholder="Search worker or Transport Group" autoComplete="off" />
          </FormField>
        </div>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {workersError && <Feedback role="alert" tone="danger">Could not load Transport Workers.</Feedback>}
        {assignmentsQuery.error && <Feedback role="alert" tone="danger">Could not load Transport Group memberships.</Feedback>}
        {periodEarningsQuery.error && <Feedback role="alert" tone="danger">Could not load locked Chamber Transport earnings for this period.</Feedback>}
        {latestWithdrawalsQuery.error && <Feedback role="alert" tone="danger">Could not load real Chamber Transport payment history.</Feedback>}
        {balancesError && <Feedback role="alert" tone="danger">Could not load one or more authoritative worker balances.</Feedback>}
      </div>

      {workersLoading ? (
        <div className="mt-atlas-4"><Feedback role="status" tone="neutral">Loading Chamber Transport workers...</Feedback></div>
      ) : workersError ? null : visibleWorkers.length === 0 ? (
        <EmptyState
          title={workers.length === 0 ? "No Transport Workers yet" : "No workers match these filters"}
          description={workers.length === 0 ? "Use Manage setup to create the first Transport Worker." : "Clear the search or choose another lifecycle filter."}
        />
      ) : (
        <>
          <div className="mt-atlas-4 hidden md:block">
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Chamber Transport worker overview for {periodLabel}</TableCaption>
                <TableHeader><TableRow>
                  <TableHeaderCell>Worker</TableHeaderCell>
                  <TableHeaderCell>Transport Groups</TableHeaderCell>
                  <TableHeaderCell numeric>{ATLAS_UI_STRINGS.transportCredit.weekly} ({periodLabel})</TableHeaderCell>
                  <TableHeaderCell numeric>{ATLAS_UI_STRINGS.transportCredit.history}</TableHeaderCell>
                  <TableHeaderCell numeric>Available (authoritative)</TableHeaderCell>
                  <TableHeaderCell>Last paid</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                </TableRow></TableHeader>
                <TableBody>{visibleWorkers.map((worker) => {
                  const status = resolveBooleanStatusPresentation(TRANSPORT_WORKER_LIFECYCLE_STATUS, worker.isActive);
                  const workerMemberships = memberships.get(worker.id) ?? [];
                  return <TableRow key={worker.id} hoverable>
                    <TableCell><div className="flex flex-wrap items-center gap-atlas-2"><p className="font-atlas-semibold text-atlas-text">{worker.name}</p><StatusPill label={status.label} tone={status.tone} /></div><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Transport Worker</p></TableCell>
                    <TableCell>{assignmentsQuery.isLoading ? <span className="text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.loading}</span> : assignmentsQuery.error ? <span className="text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.unavailable}</span> : workerMemberships.length === 0 ? <span className="text-atlas-xs text-atlas-text-subtle">No group assigned</span> : <div className="flex max-w-sm flex-wrap gap-atlas-1">{workerMemberships.map((group) => <span key={group.id} className="rounded-atlas-control border border-atlas-border bg-atlas-surface-muted px-atlas-2 py-atlas-1 text-atlas-xs font-atlas-medium text-atlas-text-muted">{group.name}{group.isActive ? "" : " · Inactive"}</span>)}</div>}</TableCell>
                    <TableCell numeric><span className="font-atlas-medium text-atlas-text-muted">{periodEarningsLabel(worker.id)}</span></TableCell>
                    <TableCell numeric>{creditLabel(worker.id)}</TableCell>
                    <TableCell numeric><span className="font-atlas-semibold text-atlas-text">{availableBalanceLabel(worker.id)}</span></TableCell>
                    <TableCell><span className="text-atlas-sm font-atlas-medium text-atlas-text-muted">{lastPaidLabel(worker.id)}</span></TableCell>
                    <TableCell><Button onClick={() => onOpenAccount(worker.id)}>Account &amp; payment</Button></TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
              <div className="flex flex-col gap-atlas-1 border-t border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 text-atlas-xs text-atlas-text-subtle sm:flex-row sm:items-center sm:justify-between">
                <p>Showing {formatIndianNumber(visibleWorkers.length)} of {formatIndianNumber(workers.length)} Transport Workers</p>
                <p>Locked earnings are derived from saved Transport Group paya pools.</p>
              </div>
            </TableContainer>
          </div>

          <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
            {visibleWorkers.map((worker) => {
              const status = resolveBooleanStatusPresentation(TRANSPORT_WORKER_LIFECYCLE_STATUS, worker.isActive);
              const workerMemberships = memberships.get(worker.id) ?? [];
              return <article key={worker.id} className="py-atlas-4">
                <div className="flex items-start justify-between gap-atlas-3"><div className="min-w-0"><h4 className="truncate text-atlas-base font-atlas-semibold text-atlas-text">{worker.name}</h4><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Transport Worker</p></div><StatusPill label={status.label} tone={status.tone} /></div>
                <div className="mt-atlas-3 flex flex-wrap gap-atlas-1">{assignmentsQuery.isLoading ? <span className="text-atlas-xs text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.loading}</span> : assignmentsQuery.error ? <span className="text-atlas-xs text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.unavailable}</span> : workerMemberships.length === 0 ? <span className="text-atlas-xs text-atlas-text-subtle">No group assigned</span> : workerMemberships.map((group) => <span key={group.id} className="rounded-atlas-control border border-atlas-border bg-atlas-surface-muted px-atlas-2 py-atlas-1 text-atlas-xs font-atlas-medium text-atlas-text-muted">{group.name}{group.isActive ? "" : " · Inactive"}</span>)}</div>
                <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 text-atlas-sm"><div><dt className="text-atlas-xs text-atlas-text-subtle">Earned · {periodLabel}</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text-muted">{periodEarningsLabel(worker.id)}</dd></div><div><dt className="text-right text-atlas-xs text-atlas-text-subtle">Available balance</dt><dd className="mt-atlas-1 text-right font-atlas-semibold tabular-nums text-atlas-text">{availableBalanceLabel(worker.id)}</dd></div></dl>
                <p className="mt-atlas-3 text-atlas-xs font-atlas-medium text-atlas-text-muted">{lastPaidLabel(worker.id)}</p>
                <p className="mt-atlas-2 text-atlas-sm tabular-nums text-atlas-text-muted">{ATLAS_UI_STRINGS.transportCredit.credited}: {creditLabel(worker.id)}</p>
                <div className="mt-atlas-3"><Button onClick={() => onOpenAccount(worker.id)}>Account &amp; payment</Button></div>
              </article>;
            })}
          </div>
        </>
      )}
    </section>
  );
}
