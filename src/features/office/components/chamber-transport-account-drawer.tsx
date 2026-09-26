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
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { buildTransportWeeklyDetailDisplay } from "@/features/office/transport-weekly-earnings-model";
import {
  buildTransportWithdrawalHistoryItem,
  buildTransportWithdrawalInput,
  getTransportFinanceRefreshQueryKeys,
  sumTransportPeriodEarned,
  transportWorkerFinanceErrorMessage,
} from "@/features/office/transport-worker-finances-model";
import { listTransportGroupAssignments } from "@/features/transport/services/transport-crew-assignment-service";
import { listTransportWorkerEarningDetails } from "@/features/transport/services/transport-weekly-earning-read-service";
import {
  createTransportWorkerWithdrawal,
  getTransportWorkerAvailableBalance,
  listTransportWorkerWithdrawals,
} from "@/features/transport/services/transport-worker-financial-service";
import type { TransportWorker } from "@/features/transport/types";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatDateOnly, formatIndianCurrency } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  TRANSPORT_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const RANGE_OPTIONS: ReadonlyArray<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom" },
];

const balanceQueryKey = (factoryId: string, workerId: string, asOfDate: string) =>
  ["office-transport-worker-balance", factoryId, workerId, asOfDate] as const;
const withdrawalsQueryKey = (factoryId: string, workerId: string) =>
  ["office-transport-worker-withdrawals", factoryId, workerId] as const;
const periodEarningsQueryKey = (
  factoryId: string,
  workerId: string,
  fromDate: string | undefined,
  toDate: string | undefined,
) => ["office-transport-worker-period-earnings", factoryId, workerId, fromDate, toDate] as const;

export function ChamberTransportAccountDrawer({
  factoryId,
  worker,
  onClose,
}: Readonly<{
  factoryId: string;
  worker: TransportWorker;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [localToday] = useState(getLocalDate);
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [paymentDate, setPaymentDate] = useState(localToday);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const earningsRange = resolveWageEarningsDateRange(
    rangePreset,
    localToday,
    customFrom,
    customTo,
  );

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

  const assignmentsQuery = useQuery({
    queryKey: ["office-transport-overview-assignments", factoryId],
    queryFn: () => listTransportGroupAssignments({ factoryId }),
  });
  const currentBalanceQuery = useQuery({
    queryKey: balanceQueryKey(factoryId, worker.id, localToday),
    queryFn: () => getTransportWorkerAvailableBalance({
      factoryId,
      transportWorkerId: worker.id,
      asOfDate: localToday,
    }),
  });
  const paymentDateBalanceQuery = useQuery({
    queryKey: balanceQueryKey(factoryId, worker.id, paymentDate),
    queryFn: () => getTransportWorkerAvailableBalance({
      factoryId,
      transportWorkerId: worker.id,
      asOfDate: paymentDate,
    }),
    enabled: Boolean(paymentDate),
  });
  const withdrawalsQuery = useQuery({
    queryKey: withdrawalsQueryKey(factoryId, worker.id),
    queryFn: () => listTransportWorkerWithdrawals({
      factoryId,
      transportWorkerId: worker.id,
    }),
  });
  const periodEarningsQuery = useQuery({
    queryKey: periodEarningsQueryKey(
      factoryId,
      worker.id,
      earningsRange?.fromDate,
      earningsRange?.toDate,
    ),
    queryFn: () => listTransportWorkerEarningDetails({
      factoryId,
      transportWorkerId: worker.id,
      range: earningsRange!,
    }),
    enabled: earningsRange !== null,
  });

  const lifecycleStatus = resolveBooleanStatusPresentation(
    TRANSPORT_WORKER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  const currentMemberships = (assignmentsQuery.data ?? [])
    .filter((assignment) => assignment.transportWorkerId === worker.id)
    .map((assignment) => assignment.transportGroupName)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right, "en-IN"));
  const periodDetails = periodEarningsQuery.data ?? [];
  const periodEarned = earningsRange && !periodEarningsQuery.isLoading && !periodEarningsQuery.error
    ? sumTransportPeriodEarned(periodDetails)
    : null;
  const periodGroups = periodDetails
    .map((detail) => detail.transportGroupName)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right, "en-IN"));
  const numericPaymentAmount = Number(paymentAmount);
  const validPaymentAmount = Boolean(paymentAmount.trim())
    && Number.isFinite(numericPaymentAmount)
    && numericPaymentAmount > 0;
  const paymentButtonLabel = validPaymentAmount
    ? `Pay ${formatIndianCurrency(numericPaymentAmount, { maximumFractionDigits: 20 })}`
    : "Record payment";

  function clearPaymentFeedback() {
    setPaymentError("");
    setPaymentSuccess("");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPaying) return;

    const input = buildTransportWithdrawalInput({
      factoryId,
      selectedWorkerId: worker.id,
      withdrawalDate: paymentDate,
      amountInput: paymentAmount,
    });
    if (!input) {
      setPaymentError("Enter a valid payment date and an amount greater than zero.");
      return;
    }

    setIsPaying(true);
    clearPaymentFeedback();
    try {
      const saved = await createTransportWorkerWithdrawal(input);
      setPaymentAmount("");
      setPaymentSuccess(`Payment of ${formatIndianCurrency(saved.amount, { maximumFractionDigits: 20 })} recorded.`);
      const exactKeys = getTransportFinanceRefreshQueryKeys({
        factoryId,
        transportWorkerId: worker.id,
        asOfDate: paymentDate,
      });
      await Promise.all([
        ...exactKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        queryClient.invalidateQueries({ queryKey: ["office-transport-worker-balance", factoryId, worker.id] }),
        queryClient.invalidateQueries({ queryKey: ["office-transport-overview-latest-withdrawals", factoryId] }),
      ]);
    } catch (error) {
      setPaymentError(transportWorkerFinanceErrorMessage(
        error,
        "Could not record this Chamber Transport payment.",
      ));
      if (error && typeof error === "object" && "code" in error && error.code === "P0001") {
        await queryClient.invalidateQueries({
          queryKey: ["office-transport-worker-balance", factoryId, worker.id],
        });
      }
    } finally {
      setIsPaying(false);
    }
  }

  function payFullAvailableBalance() {
    const available = paymentDateBalanceQuery.data?.availableBalance;
    if (available === undefined || available <= 0) return;
    setPaymentAmount(String(available));
    clearPaymentFeedback();
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal account drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Chamber Transport account" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="chamber-transport-account-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="flex items-start justify-between gap-atlas-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-atlas-2">
                <h2 id="chamber-transport-account-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">{worker.name}</h2>
                <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
              </div>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Chamber Transport worker</p>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Chamber Transport account" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </div>
          <div className="mt-atlas-3 flex flex-wrap items-center gap-atlas-1">
            <span className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-subtle">Groups</span>
            {assignmentsQuery.isLoading ? (
              <span className="text-atlas-xs text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.loading}</span>
            ) : assignmentsQuery.error ? (
              <span className="text-atlas-xs text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.unavailable}</span>
            ) : currentMemberships.length === 0 ? (
              <span className="text-atlas-xs text-atlas-text-subtle">No current group</span>
            ) : currentMemberships.map((name) => (
              <span key={name} className="rounded-atlas-control border border-atlas-border bg-atlas-surface-muted px-atlas-2 py-atlas-1 text-atlas-xs font-atlas-medium text-atlas-text-muted">{name}</span>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-atlas-5 overflow-y-auto px-atlas-5 py-atlas-5">
          <Card surface="muted">
            <div className="flex items-center justify-between gap-atlas-3">
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Available to pay</p>
              <span className="rounded-atlas-control border border-atlas-border bg-atlas-surface px-atlas-2 py-atlas-1 text-atlas-xs text-atlas-text-subtle">Authoritative</span>
            </div>
            {currentBalanceQuery.isLoading ? (
              <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Loading current balance...</p>
            ) : currentBalanceQuery.error ? (
              <p className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">Balance unavailable</p>
            ) : (
              <p className="mt-atlas-2 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">
                {formatIndianCurrency(currentBalanceQuery.data?.availableBalance ?? 0, { maximumFractionDigits: 20 })}
              </p>
            )}
            <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Current unpaid balance from locked earnings and real withdrawals. Period filters do not change it.</p>
          </Card>

          {currentBalanceQuery.error && (
            <Feedback role="alert" tone="danger">{transportWorkerFinanceErrorMessage(currentBalanceQuery.error, "Could not load the current Chamber Transport balance.")}</Feedback>
          )}
          {currentBalanceQuery.data && (
            <dl className="grid grid-cols-2 gap-atlas-3 border-b border-atlas-border pb-atlas-4 text-atlas-sm">
              <div><dt className="text-atlas-xs text-atlas-text-subtle">Total locked earnings</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(currentBalanceQuery.data.totalEarned, { maximumFractionDigits: 20 })}</dd></div>
              <div><dt className="text-atlas-xs text-atlas-text-subtle">Total withdrawn</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(currentBalanceQuery.data.totalWithdrawn, { maximumFractionDigits: 20 })}</dd></div>
            </dl>
          )}

          <Card>
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-end sm:justify-between">
              <h3 className="text-atlas-base font-atlas-semibold text-atlas-text">Earnings view</h3>
              <div className="sm:w-40"><FormField label="Earnings period"><Select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as WageEarningsDatePreset)}>{RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></FormField></div>
            </div>
            {rangePreset === "custom" && (
              <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-2">
                <FormField label="From"><Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></FormField>
                <FormField label="To"><Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></FormField>
              </div>
            )}
            {rangePreset === "custom" && !earningsRange && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>}
            {earningsRange && <dl className="mt-atlas-3 divide-y divide-atlas-border text-atlas-sm">
              <div className="flex items-start justify-between gap-atlas-3 py-atlas-2"><dt className="text-atlas-text-muted">Selected period</dt><dd className="text-right font-atlas-medium text-atlas-text">{formatDateOnly(earningsRange.fromDate)} — {formatDateOnly(earningsRange.toDate)}</dd></div>
              <div className="flex items-start justify-between gap-atlas-3 py-atlas-2"><dt className="text-atlas-text-muted">Earnings</dt><dd className="font-atlas-semibold tabular-nums text-atlas-text">{periodEarningsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : periodEarningsQuery.error || periodEarned === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(periodEarned, { maximumFractionDigits: 20 })}</dd></div>
              <div className="flex items-start justify-between gap-atlas-3 py-atlas-2"><dt className="text-atlas-text-muted">Transport Groups in period</dt><dd className="max-w-56 text-right font-atlas-medium text-atlas-text">{periodEarningsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : periodEarningsQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : periodGroups.length === 0 ? "No locked work" : periodGroups.join(" · ")}</dd></div>
            </dl>}
            <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Inclusive dates. Earnings use immutable saved worker-share snapshots only.</p>
            <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Group pools are paya × saved group rate, divided equally among workers recorded present.</p>
            {periodEarningsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{transportWorkerFinanceErrorMessage(periodEarningsQuery.error, "Could not load locked earnings for this period.")}</Feedback></div>}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-atlas-2">
              <h3 className="text-atlas-base font-atlas-semibold text-atlas-text">Record payment</h3>
              <Button variant="ghost" disabled={paymentDateBalanceQuery.isLoading || Boolean(paymentDateBalanceQuery.error) || (paymentDateBalanceQuery.data?.availableBalance ?? 0) <= 0 || isPaying} onClick={payFullAvailableBalance}>
                Pay full{paymentDateBalanceQuery.data ? ` ${formatIndianCurrency(paymentDateBalanceQuery.data.availableBalance, { maximumFractionDigits: 20 })}` : ""}
              </Button>
            </div>
            <form id="chamber-transport-payment-form" className="mt-atlas-3 space-y-atlas-3" onSubmit={(event) => void submitPayment(event)}>
              <FormField label="Amount to pay">
                <Input type="text" inputMode="decimal" autoComplete="off" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); clearPaymentFeedback(); }} aria-invalid={Boolean(paymentError)} disabled={isPaying} placeholder="0.00" />
              </FormField>
              <FormField label={ATLAS_UI_STRINGS.payment.date}>
                <Input type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); clearPaymentFeedback(); }} required disabled={isPaying} />
              </FormField>
              <div className="flex items-center justify-between gap-atlas-3 border-t border-atlas-border pt-atlas-2 text-atlas-xs">
                <span className="text-atlas-text-subtle">Available on payment date</span>
                <span className="font-atlas-semibold tabular-nums text-atlas-text">{paymentDateBalanceQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : paymentDateBalanceQuery.error || !paymentDateBalanceQuery.data ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(paymentDateBalanceQuery.data.availableBalance, { maximumFractionDigits: 20 })}</span>
              </div>
            </form>
            {paymentDateBalanceQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{transportWorkerFinanceErrorMessage(paymentDateBalanceQuery.error, "Could not load the balance for this payment date.")}</Feedback></div>}
            {paymentError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{paymentError}</Feedback></div>}
            {paymentSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{paymentSuccess}</Feedback></div>}
          </Card>

          <section aria-labelledby="chamber-transport-payment-history-heading">
            <h3 id="chamber-transport-payment-history-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Recent payments</h3>
            {withdrawalsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading payments...</Feedback></div>}
            {withdrawalsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{transportWorkerFinanceErrorMessage(withdrawalsQuery.error, "Could not load Chamber Transport payment history.")}</Feedback></div>}
            {!withdrawalsQuery.isLoading && !withdrawalsQuery.error && (withdrawalsQuery.data ?? []).length === 0 && <EmptyState title="No payments yet" description="Recorded Chamber Transport withdrawals will appear here." />}
            {!withdrawalsQuery.isLoading && !withdrawalsQuery.error && (withdrawalsQuery.data ?? []).length > 0 && <div className="mt-atlas-3"><TableContainer><Table>
              <TableCaption visuallyHidden>Payment history for {worker.name}</TableCaption>
              <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
              <TableBody>{(withdrawalsQuery.data ?? []).map((withdrawal) => { const item = buildTransportWithdrawalHistoryItem(withdrawal); return <TableRow key={item.withdrawalId}><TableCell>{formatDateOnly(item.withdrawalDate)}</TableCell><TableCell numeric>{item.amount}</TableCell></TableRow>; })}</TableBody>
            </Table></TableContainer></div>}
          </section>

          <details className="border-t border-atlas-border pt-atlas-3">
            <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Locked contribution details</summary>
            <p className="text-atlas-xs text-atlas-text-subtle">Read-only saved group, paya, rate, pool and worker-share snapshots for the selected period.</p>
            {periodEarningsQuery.isLoading ? <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading locked contributions...</Feedback></div> : periodEarningsQuery.error ? null : periodDetails.length === 0 ? <EmptyState title="No locked contributions" description="No immutable Chamber Transport earnings exist in this period." /> : <div className="mt-atlas-3 space-y-atlas-2">{periodDetails.map((detail) => { const item = buildTransportWeeklyDetailDisplay(detail); return <Card key={item.detailId} surface="muted"><div className="flex items-start justify-between gap-atlas-3"><div><p className="text-atlas-sm font-atlas-semibold text-atlas-text">{formatDateOnly(item.workDate)} · {item.groupLabel}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{item.paya} paya · {item.attendanceCount} present</p></div><p className="text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{item.workerShare}</p></div><p className="mt-atlas-2 text-atlas-xs tabular-nums text-atlas-text-subtle">Saved rate {item.ratePerPaya} · Group pool {item.dailyGroupPool}</p></Card>; })}</div>}
          </details>
        </div>

        <footer className="border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="grid gap-atlas-2">
            <Button type="submit" form="chamber-transport-payment-form" loading={isPaying} loadingLabel={ATLAS_UI_STRINGS.feedback.saving} disabled={!validPaymentAmount || !paymentDate || paymentDateBalanceQuery.isLoading || Boolean(paymentDateBalanceQuery.error)}>{paymentButtonLabel}</Button>
            <Button variant="ghost" disabled={isPaying} onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
