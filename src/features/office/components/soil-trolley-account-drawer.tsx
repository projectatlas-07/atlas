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
import {
  buildSoilEarningHistoryItem,
  buildSoilPaymentInput,
  insertSoilPaymentNewestFirst,
  mergeSoilPaymentSummary,
  soilOfficeErrorMessage,
  sumSoilPeriodEarned,
  sumSoilPeriodTrolleys,
} from "@/features/office/soil-office-model";
import {
  soilAdjustmentsQueryKey,
  soilCurrentRateQueryKey,
  soilEarningsQueryKey,
  soilFinancialSummaryQueryKey,
  soilPaymentsQueryKey,
} from "@/features/office/soil-office-query-keys";
import { listSoilEarnings } from "@/features/soil/services/soil-earning-read-service";
import { listSoilFinancialAdjustments } from "@/features/soil/services/soil-financial-adjustment-service";
import {
  createSoilPayment,
  getSoilFinancialSummary,
  listSoilPayments,
} from "@/features/soil/services/soil-payment-service";
import { resolveSoilWorkerTrolleyRate } from "@/features/soil/services/soil-worker-rate-service";
import type {
  SoilFinancialAdjustment,
  SoilFinancialSummary,
  SoilPayment,
  SoilWorker,
} from "@/features/soil/types";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  SOIL_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const rangeOptions: ReadonlyArray<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom dates" },
];

export function SoilTrolleyAccountDrawer({
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

  const earningsRange = resolveWageEarningsDateRange(
    rangePreset,
    localToday,
    customFrom,
    customTo,
  );
  const currentRateQuery = useQuery({
    queryKey: soilCurrentRateQueryKey(factoryId, worker.id, localToday),
    queryFn: () => resolveSoilWorkerTrolleyRate({
      factoryId,
      soilWorkerId: worker.id,
      workDate: localToday,
    }),
  });
  const summaryQuery = useQuery({
    queryKey: soilFinancialSummaryQueryKey(factoryId, worker.id),
    queryFn: () => getSoilFinancialSummary({ factoryId, soilWorkerId: worker.id }),
  });
  const earningsQuery = useQuery({
    queryKey: soilEarningsQueryKey(
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
  const paymentsQuery = useQuery({
    queryKey: soilPaymentsQueryKey(factoryId, worker.id),
    queryFn: () => listSoilPayments({ factoryId, soilWorkerId: worker.id }),
  });
  const adjustmentsQuery = useQuery({
    queryKey: soilAdjustmentsQueryKey(factoryId, worker.id),
    queryFn: () => listSoilFinancialAdjustments({
      factoryId,
      soilWorkerId: worker.id,
    }),
  });

  const lifecycleStatus = resolveBooleanStatusPresentation(
    SOIL_WORKER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  const summary = summaryQuery.data;
  const periodEarned = earningsRange && !earningsQuery.isLoading && !earningsQuery.error
    ? sumSoilPeriodEarned(earningsQuery.data ?? [])
    : null;
  const periodTrolleys = earningsRange && !earningsQuery.isLoading && !earningsQuery.error
    ? sumSoilPeriodTrolleys(earningsQuery.data ?? [])
    : null;
  const numericPaymentAmount = Number(paymentAmount);
  const validPaymentAmount = Boolean(paymentAmount.trim())
    && Number.isFinite(numericPaymentAmount)
    && numericPaymentAmount > 0;
  const paymentButtonLabel = validPaymentAmount
    ? `Pay ${formatIndianCurrency(numericPaymentAmount)}`
    : "Record payment";
  const paymentUnavailable = !worker.isActive
    || summaryQuery.isLoading
    || Boolean(summaryQuery.error)
    || !summary;

  function clearPaymentFeedback() {
    setPaymentError("");
    setPaymentSuccess("");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPaying) return;
    if (!worker.isActive) {
      setPaymentError("Restore this archived worker before recording a payment.");
      return;
    }
    if (!summary) {
      setPaymentError("The authoritative financial summary is unavailable. Try again.");
      return;
    }
    if (Number.isFinite(numericPaymentAmount)
      && numericPaymentAmount > summary.availableBalance) {
      setPaymentError("Payment exceeds this worker's available balance.");
      return;
    }

    const input = buildSoilPaymentInput({
      factoryId,
      soilWorkerId: worker.id,
      paymentDate,
      amount: paymentAmount,
      availableBalance: summary.availableBalance,
    });
    if (!input) {
      setPaymentError("Enter a valid payment date and an amount greater than zero.");
      return;
    }

    setIsPaying(true);
    clearPaymentFeedback();
    try {
      const recorded = await createSoilPayment(input);
      queryClient.setQueryData<SoilFinancialSummary>(
        soilFinancialSummaryQueryKey(factoryId, worker.id),
        (current) => mergeSoilPaymentSummary(current, recorded),
      );
      queryClient.setQueryData<SoilPayment[]>(
        soilPaymentsQueryKey(factoryId, worker.id),
        (current = []) => insertSoilPaymentNewestFirst(current, recorded),
      );
      await queryClient.invalidateQueries({
        queryKey: soilFinancialSummaryQueryKey(factoryId, worker.id),
      });
      setPaymentAmount("");
      setPaymentSuccess(`Payment of ${formatIndianCurrency(recorded.amount)} recorded.`);
    } catch (error) {
      setPaymentError(soilOfficeErrorMessage(error, "Could not record this Soil / Trolley payment."));
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal account drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Soil / Trolley account" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="soil-trolley-account-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submitPayment(event)}>
          <header className="flex items-center justify-between border-b border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
            <div>
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Soil / Trolley worker</p>
              <h2 id="soil-trolley-account-title" className="mt-atlas-1 text-atlas-lg font-atlas-semibold text-atlas-text">Account &amp; payment</h2>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Soil / Trolley account drawer" onClick={onClose}><span aria-hidden="true">×</span></Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
            <div className="flex items-start gap-atlas-3">
              <div aria-hidden="true" className="flex h-atlas-12 w-atlas-12 shrink-0 items-center justify-center rounded-atlas-card border border-atlas-primary-border bg-atlas-primary-surface text-atlas-lg font-atlas-semibold text-atlas-primary">
                {worker.name.trim().charAt(0).toLocaleUpperCase("en-IN") || "W"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-atlas-2">
                  <h3 className="text-atlas-xl font-atlas-semibold text-atlas-text">{worker.name}</h3>
                  <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
                </div>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Soil / Trolley worker</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                  {currentRateQuery.isLoading
                    ? "Rate loading..."
                    : currentRateQuery.error || !currentRateQuery.data
                      ? "Rate unavailable"
                      : `${formatIndianCurrency(currentRateQuery.data.ratePerTrolley)} / trolley · Effective ${formatDateOnly(currentRateQuery.data.effectiveFrom)}`}
                </p>
              </div>
            </div>

            <div className="mt-atlas-5">
              <Card surface="muted">
                <div className="flex items-center justify-between gap-atlas-3">
                  <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Available to pay</p>
                  <span className="rounded-atlas-control border border-atlas-border bg-atlas-surface px-atlas-2 py-atlas-1 text-atlas-xs text-atlas-text-subtle">Authoritative</span>
                </div>
                {summaryQuery.isLoading ? (
                  <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Loading account...</p>
                ) : summaryQuery.error || !summary ? (
                  <p className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">Account unavailable</p>
                ) : (
                  <p className="mt-atlas-2 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(summary.availableBalance)}</p>
                )}
                <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Lifetime earnings, payments, and Office adjustments determine this balance. Period filters do not change it.</p>
              </Card>
            </div>

            {summaryQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{soilOfficeErrorMessage(summaryQuery.error, "Could not load the authoritative financial summary.")}</Feedback></div>}
            {summary && (
              <dl className="mt-atlas-4 grid grid-cols-2 gap-atlas-3 border-b border-atlas-border pb-atlas-4 text-atlas-sm">
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Total earned</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(summary.totalEarned)}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Total paid</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(summary.totalPaid)}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Office additions</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-success-text">+{formatIndianCurrency(summary.totalAdditions)}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Office deductions</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-danger-text">−{formatIndianCurrency(summary.totalDeductions)}</dd></div>
              </dl>
            )}

            <section aria-labelledby="soil-earnings-view-heading" className="mt-atlas-5">
              <h3 id="soil-earnings-view-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Earnings view</h3>
              <div className="mt-atlas-2">
                <FormField label="Period">
                  <Select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as WageEarningsDatePreset)}>
                    {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </FormField>
              </div>
              {rangePreset === "custom" && (
                <div className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                  <FormField label="From"><Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></FormField>
                  <FormField label="To"><Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></FormField>
                </div>
              )}
              {rangePreset === "custom" && !earningsRange && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>}
              {earningsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading saved Soil / Trolley earnings...</Feedback></div>}
              {earningsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{soilOfficeErrorMessage(earningsQuery.error, "Could not load saved Soil / Trolley earnings.")}</Feedback></div>}
              {earningsRange && periodEarned !== null && periodTrolleys !== null && (
                <div className="mt-atlas-3">
                  <Card>
                    <p className="text-atlas-sm font-atlas-medium text-atlas-text">{formatDateOnly(earningsRange.fromDate)} – {formatDateOnly(earningsRange.toDate)}</p>
                    <dl className="mt-atlas-3 space-y-atlas-2 border-t border-atlas-border pt-atlas-3 text-atlas-sm">
                      <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Saved trolley quantity</dt><dd className="font-atlas-medium tabular-nums text-atlas-text">{formatIndianNumber(periodTrolleys, { maximumFractionDigits: 3 })}</dd></div>
                      <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Earned in period</dt><dd className="font-atlas-medium tabular-nums text-atlas-text">{formatIndianCurrency(periodEarned)}</dd></div>
                    </dl>
                  </Card>
                  <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Informational only. Values use immutable BASE/CORRECTION snapshots; the available balance remains the authoritative lifetime account.</p>
                </div>
              )}
            </section>

            <section aria-labelledby="soil-payment-details-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
              <h3 id="soil-payment-details-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Payment details</h3>
              {!worker.isActive && <div className="mt-atlas-3"><Feedback role="status" tone="warning">This worker is archived. Restore the worker before recording a new payment.</Feedback></div>}
              <div className="mt-atlas-3 space-y-atlas-3">
                <FormField label="Amount to pay">
                  <Input type="text" inputMode="decimal" autoComplete="off" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); clearPaymentFeedback(); }} aria-invalid={Boolean(paymentError)} disabled={isPaying || paymentUnavailable} placeholder="0.00" />
                </FormField>
                {summary && summary.availableBalance > 0 && worker.isActive && (
                  <Button variant="secondary" disabled={isPaying} onClick={() => { setPaymentAmount(String(summary.availableBalance)); clearPaymentFeedback(); }}>Pay full balance ({formatIndianCurrency(summary.availableBalance)})</Button>
                )}
                <FormField label={ATLAS_UI_STRINGS.payment.date}>
                  <Input type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); clearPaymentFeedback(); }} required disabled={isPaying || paymentUnavailable} />
                </FormField>
                <p className="text-atlas-xs text-atlas-text-subtle">The existing Soil payment service validates the amount against the authoritative available balance.</p>
              </div>
            </section>

            {paymentError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{paymentError}</Feedback></div>}
            {paymentSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{paymentSuccess}</Feedback></div>}

            <section aria-labelledby="soil-payment-history-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
              <h3 id="soil-payment-history-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Recent payments</h3>
              {paymentsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading payments...</Feedback></div>}
              {paymentsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{soilOfficeErrorMessage(paymentsQuery.error, "Could not load Soil / Trolley payments.")}</Feedback></div>}
              {!paymentsQuery.isLoading && !paymentsQuery.error && paymentsQuery.data?.length === 0 && <EmptyState title="No payments yet" description="Recorded Soil / Trolley payments will appear here." />}
              {!paymentsQuery.isLoading && !paymentsQuery.error && (paymentsQuery.data?.length ?? 0) > 0 && (
                <div className="mt-atlas-3"><PaymentHistory payments={paymentsQuery.data ?? []} workerName={worker.name} /></div>
              )}
            </section>

            <details className="mt-atlas-5 border-t border-atlas-border pt-atlas-3">
              <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Work &amp; earnings history · selected period</summary>
              {earningsQuery.isLoading && <Feedback role="status" tone="neutral">Loading saved earnings...</Feedback>}
              {earningsQuery.error && <Feedback role="alert" tone="danger">{soilOfficeErrorMessage(earningsQuery.error, "Could not load saved earnings.")}</Feedback>}
              {!earningsQuery.isLoading && !earningsQuery.error && earningsQuery.data?.length === 0 && <EmptyState title="No earnings in this period" />}
              {!earningsQuery.isLoading && !earningsQuery.error && (earningsQuery.data?.length ?? 0) > 0 && (
                <TableContainer>
                  <Table wide>
                    <TableCaption visuallyHidden>Soil / Trolley earnings history for {worker.name}</TableCaption>
                    <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell>Saved work</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>{earningsQuery.data?.map((earning) => {
                      const item = buildSoilEarningHistoryItem(earning);
                      return <TableRow key={item.id}><TableCell>{item.date}</TableCell><TableCell>{item.description}</TableCell><TableCell numeric><span className={item.isCorrection ? "text-atlas-warning-text" : "text-atlas-text"}>{item.amount}</span></TableCell></TableRow>;
                    })}</TableBody>
                  </Table>
                </TableContainer>
              )}
            </details>

            <details className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
              <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Office adjustment history</summary>
              {adjustmentsQuery.isLoading && <Feedback role="status" tone="neutral">Loading adjustments...</Feedback>}
              {adjustmentsQuery.error && <Feedback role="alert" tone="danger">{soilOfficeErrorMessage(adjustmentsQuery.error, "Could not load Office adjustments.")}</Feedback>}
              {!adjustmentsQuery.isLoading && !adjustmentsQuery.error && adjustmentsQuery.data?.length === 0 && <EmptyState title="No adjustments recorded" />}
              {!adjustmentsQuery.isLoading && !adjustmentsQuery.error && (adjustmentsQuery.data?.length ?? 0) > 0 && <AdjustmentHistory adjustments={adjustmentsQuery.data ?? []} workerName={worker.name} />}
            </details>
          </div>

          <footer className="flex flex-col border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium">
            <Button type="submit" loading={isPaying} loadingLabel="Recording payment..." disabled={paymentUnavailable}>{paymentButtonLabel}</Button>
            <div className="mt-atlas-2"><Button variant="ghost" onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button></div>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function PaymentHistory({ payments, workerName }: Readonly<{
  payments: readonly SoilPayment[];
  workerName: string;
}>) {
  return (
    <TableContainer>
      <Table>
        <TableCaption visuallyHidden>Payment history for {workerName}</TableCaption>
        <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{payments.map((payment) => <TableRow key={payment.id}><TableCell>{formatDateOnly(payment.paymentDate)}</TableCell><TableCell numeric>{formatIndianCurrency(payment.amount)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </TableContainer>
  );
}

function AdjustmentHistory({ adjustments, workerName }: Readonly<{
  adjustments: readonly SoilFinancialAdjustment[];
  workerName: string;
}>) {
  return (
    <TableContainer>
      <Table wide>
        <TableCaption visuallyHidden>Office adjustment history for {workerName}</TableCaption>
        <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell>Type and reason</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{adjustments.map((adjustment) => {
          const isAddition = adjustment.adjustmentType === "ADDITION";
          return <TableRow key={adjustment.id}><TableCell>{formatDateOnly(adjustment.adjustmentDate)}</TableCell><TableCell><p className="font-atlas-medium text-atlas-text">{isAddition ? "Addition" : "Deduction"}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{adjustment.reason}</p></TableCell><TableCell numeric><span className={isAddition ? "text-atlas-success-text" : "text-atlas-danger-text"}>{isAddition ? "+" : "−"}{formatIndianCurrency(adjustment.amount)}</span></TableCell></TableRow>;
        })}</TableBody>
      </Table>
    </TableContainer>
  );
}
