"use client";

import { useEffect, useRef, useState } from "react";
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
import { getLabourerAvailableBalance } from "@/features/wages/services/labourer-available-balance-service";
import { getLabourerEarningsHistory } from "@/features/wages/services/labourer-earnings-history-service";
import {
  CreateLabourerWithdrawalError,
  createLabourerWithdrawal,
  getDefaultSettlementCutoff,
} from "@/features/wages/services/labourer-withdrawal-create-service";
import { getLabourerWithdrawalHistory } from "@/features/wages/services/labourer-withdrawal-history-service";
import {
  calculateProductionRangeSummary,
  listLabourerProductionEntriesForRange,
  type ProductionRangeSummary,
} from "@/features/wages/services/production-range-summary-service";
import {
  getCurrentLabourerProductionWageRate,
  type ProductionWageRate,
} from "@/features/wages/services/production-wage-rate-read-service";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  PRODUCTION_LABOURER_LIFECYCLE_STATUS,
  resolveBooleanStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type ProductionWorkerAccountIdentity = {
  id: string;
  name: string;
  originLabel: string | null;
  isActive: boolean;
};

export type ProductionWorkerAccountDrawerProps = Readonly<{
  factoryId: string;
  worker: ProductionWorkerAccountIdentity;
  wageRates: readonly ProductionWageRate[];
  wageRatesLoading: boolean;
  wageRatesError: boolean;
  onClose: () => void;
}>;

const rangeOptions: ReadonlyArray<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom dates" },
];

export function ProductionWorkerAccountDrawer({
  factoryId,
  worker,
  wageRates,
  wageRatesLoading,
  wageRatesError,
  onClose,
}: ProductionWorkerAccountDrawerProps) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const asOfDate = getLocalDate();
  const [rangeToday] = useState(() => getLocalDate());
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(rangeToday);
  const [customTo, setCustomTo] = useState(rangeToday);
  const [withdrawalDate, setWithdrawalDate] = useState(() => getLocalDate());
  const [settlementCutoff, setSettlementCutoff] = useState(() =>
    getDefaultSettlementCutoff(getLocalDate(), null),
  );
  const [amount, setAmount] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const accountQuery = useQuery({
    queryKey: ["labourer-available-balance", factoryId, worker.id, asOfDate],
    queryFn: () => getLabourerAvailableBalance({ factoryId, labourerId: worker.id, asOfDate }),
  });
  const withdrawalsQuery = useQuery({
    queryKey: ["labourer-withdrawal-history", factoryId, worker.id],
    queryFn: () => getLabourerWithdrawalHistory(factoryId, worker.id),
  });
  const earningsQuery = useQuery({
    queryKey: ["labourer-earnings-history", factoryId, worker.id],
    queryFn: () => getLabourerEarningsHistory({ factoryId, labourerId: worker.id }),
  });
  const productionRange = resolveWageEarningsDateRange(
    rangePreset,
    rangeToday,
    customFrom,
    customTo,
  );
  const historicalDataReady = !wageRatesLoading && !wageRatesError;
  const rangeEntriesQuery = useQuery({
    queryKey: [
      "labourer-production-range-summary",
      factoryId,
      worker.id,
      productionRange?.fromDate,
      productionRange?.toDate,
    ],
    queryFn: () => listLabourerProductionEntriesForRange({
      factoryId,
      labourerId: worker.id,
      range: productionRange!,
    }),
    enabled: productionRange !== null && historicalDataReady,
    refetchInterval: 30_000,
  });

  const currentRate = getCurrentLabourerProductionWageRate(wageRates, worker.id, asOfDate);
  const directRateHistory = wageRates.filter(
    (rate) => rate.labourerId === worker.id && rate.productionCrewId === null,
  );
  const lifecycleStatus = resolveBooleanStatusPresentation(
    PRODUCTION_LABOURER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  let rangeSummary: ProductionRangeSummary | null = null;
  let rangeCalculationError = "";
  if (rangeEntriesQuery.data && productionRange && historicalDataReady) {
    try {
      rangeSummary = calculateProductionRangeSummary({
        labourerId: worker.id,
        entries: rangeEntriesQuery.data,
        wageRates,
        range: productionRange,
      });
    } catch (error) {
      rangeCalculationError = error instanceof Error
        ? error.message
        : "Could not calculate Production range earnings.";
    }
  }

  useEffect(() => {
    const latestCutoff = accountQuery.data?.latestSettlementCutoff;
    if (!latestCutoff) return;
    setSettlementCutoff((current) => current >= latestCutoff
      ? current
      : getDefaultSettlementCutoff(withdrawalDate, latestCutoff));
  }, [accountQuery.data?.latestSettlementCutoff, withdrawalDate]);

  function clearSubmitFeedback() {
    setSubmitError("");
    setSuccessMessage("");
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const latestSettlementCutoff = accountQuery.data?.latestSettlementCutoff ?? null;
    if (!withdrawalDate) {
      setSubmitError("Payment date is required.");
      return;
    }
    if (!settlementCutoff) {
      setSubmitError("Settlement cutoff is required.");
      return;
    }
    if (settlementCutoff > withdrawalDate) {
      setSubmitError("Settlement cutoff cannot be after the payment date.");
      return;
    }
    if (latestSettlementCutoff && settlementCutoff < latestSettlementCutoff) {
      setSubmitError(`Settlement cutoff cannot be before ${formatDateOnly(latestSettlementCutoff)}.`);
      return;
    }
    const numericAmount = Number(amount);
    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setSubmitError("Amount must be greater than zero.");
      return;
    }

    setIsSubmitting(true);
    clearSubmitFeedback();
    try {
      const saved = await createLabourerWithdrawal({
        factoryId,
        labourerId: worker.id,
        withdrawalDate,
        settlementCutoff,
        amount: numericAmount,
      });
      setAmount("");
      setSettlementCutoff(saved.settledThrough);
      setSuccessMessage(`Payment of ${money(saved.amount)} recorded.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["labourer-available-balance", factoryId, worker.id, asOfDate] }),
        queryClient.invalidateQueries({ queryKey: ["labourer-earnings-history", factoryId, worker.id] }),
        queryClient.invalidateQueries({ queryKey: ["labourer-withdrawal-history", factoryId, worker.id] }),
        queryClient.invalidateQueries({ queryKey: ["labourer-latest-withdrawals", factoryId] }),
      ]);
    } catch (error) {
      setSubmitError(error instanceof CreateLabourerWithdrawalError || error instanceof Error
        ? error.message
        : "Could not record payment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const numericAmount = Number(amount);
  const paymentButtonLabel = amount && Number.isFinite(numericAmount) && numericAmount > 0
    ? `Pay ${money(numericAmount)}`
    : "Record payment";
  const latestSettlementCutoff = accountQuery.data?.latestSettlementCutoff ?? null;

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Production worker account" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="production-worker-account-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submitPayment(event)}>
          <header className="flex items-center justify-between border-b border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
            <div>
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                Production worker
              </p>
              <h2 id="production-worker-account-title" className="mt-atlas-1 text-atlas-lg font-atlas-semibold text-atlas-text">
                Account &amp; payment
              </h2>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close account drawer" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
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
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
                  Production{worker.originLabel ? ` · ${worker.originLabel}` : ""}
                </p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                  {wageRatesLoading
                    ? "Rate loading..."
                    : wageRatesError
                      ? "Rate unavailable"
                      : currentRate
                        ? `${formatIndianCurrency(currentRate.ratePer1000Bricks)} / 1,000 bricks`
                        : "Rate not set"}
                </p>
              </div>
            </div>

            <div className="mt-atlas-5">
              <Card surface="muted">
                <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                  Available to pay
                </p>
                {accountQuery.isLoading ? (
                  <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Loading account...</p>
                ) : accountQuery.error ? (
                  <p className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">Account unavailable</p>
                ) : (
                  <p className="mt-atlas-1 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">
                    {money(accountQuery.data?.availableBalance ?? 0)}
                  </p>
                )}
              </Card>
            </div>

            {accountQuery.error && (
              <div className="mt-atlas-3">
                <Feedback role="alert" tone="danger">
                  {accountQuery.error instanceof Error ? accountQuery.error.message : "Could not load worker account."}
                </Feedback>
              </div>
            )}

            {accountQuery.data && (
              <dl className="mt-atlas-4 grid grid-cols-2 gap-atlas-3 border-b border-atlas-border pb-atlas-4 text-atlas-sm">
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Settled earned</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{money(accountQuery.data.settledEarned)}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Live earned</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{money(accountQuery.data.liveEarned)}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Total earned</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{money(accountQuery.data.totalEarned)}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Total paid</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{money(accountQuery.data.totalWithdrawn)}</dd></div>
              </dl>
            )}

            <section aria-labelledby="earnings-view-heading" className="mt-atlas-5">
              <h3 id="earnings-view-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                Earnings view
              </h3>
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
              {rangePreset === "custom" && !productionRange && (
                <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>
              )}
              {(wageRatesLoading || rangeEntriesQuery.isLoading) && (
                <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading earnings context...</Feedback></div>
              )}
              {(wageRatesError || rangeEntriesQuery.error || rangeCalculationError) && (
                <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{rangeCalculationError || (rangeEntriesQuery.error instanceof Error ? rangeEntriesQuery.error.message : "Earnings context is unavailable.")}</Feedback></div>
              )}
              {productionRange && rangeSummary && !rangeCalculationError && (
                <div className="mt-atlas-3">
                  <Card>
                    <div className="flex items-start justify-between gap-atlas-3 border-b border-atlas-border pb-atlas-3">
                      <p className="text-atlas-sm font-atlas-medium text-atlas-text">{formatDateOnly(productionRange.fromDate)} – {formatDateOnly(productionRange.toDate)}</p>
                      <p className="text-atlas-xs tabular-nums text-atlas-text-muted">{formatIndianNumber(rangeSummary.rangeProduction)} bricks</p>
                    </div>
                    <dl className="mt-atlas-3 space-y-atlas-2 text-atlas-sm">
                      <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Earned in period</dt><dd className="font-atlas-medium tabular-nums text-atlas-text">{money(rangeSummary.rangeEarned)}</dd></div>
                      <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Rate periods used</dt><dd className="text-right font-atlas-medium tabular-nums text-atlas-text">{formatIndianNumber(rangeSummary.ratePeriods.length)}</dd></div>
                    </dl>
                  </Card>
                  <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Informational only. The available balance remains the authoritative all-time account through today.</p>
                </div>
              )}
            </section>

            <section aria-labelledby="payment-details-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
              <h3 id="payment-details-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                Payment details
              </h3>
              <div className="mt-atlas-3 space-y-atlas-3">
                <FormField label="Amount to pay">
                  <Input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => { setAmount(event.target.value); clearSubmitFeedback(); }}
                    aria-invalid={Boolean(submitError)}
                    disabled={isSubmitting || accountQuery.isLoading || Boolean(accountQuery.error)}
                    placeholder="0.00"
                  />
                </FormField>
                {accountQuery.data && accountQuery.data.availableBalance > 0 && (
                  <Button
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={() => { setAmount(String(accountQuery.data.availableBalance)); clearSubmitFeedback(); }}
                  >
                    Pay full balance ({money(accountQuery.data.availableBalance)})
                  </Button>
                )}
                <FormField label={ATLAS_UI_STRINGS.payment.date}>
                  <Input
                    type="date"
                    max={getLocalDate()}
                    value={withdrawalDate}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setWithdrawalDate(nextDate);
                      setSettlementCutoff(getDefaultSettlementCutoff(nextDate, latestSettlementCutoff));
                      clearSubmitFeedback();
                    }}
                    required
                    disabled={isSubmitting}
                  />
                </FormField>
                <FormField label="Settle Production through">
                  <Input
                    type="date"
                    min={latestSettlementCutoff ?? undefined}
                    max={withdrawalDate || undefined}
                    value={settlementCutoff}
                    onChange={(event) => { setSettlementCutoff(event.target.value); clearSubmitFeedback(); }}
                    required
                    disabled={isSubmitting}
                  />
                </FormField>
                <p className="text-atlas-xs text-atlas-text-subtle">The payment uses the existing settlement authority and locks Production earnings through the selected cutoff.</p>
              </div>
            </section>

            {submitError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{submitError}</Feedback></div>}
            {successMessage && <div className="mt-atlas-3"><Feedback role="status" tone="success">{successMessage}</Feedback></div>}

            <section aria-labelledby="payment-history-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
              <h3 id="payment-history-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Recent payments</h3>
              {withdrawalsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading payments...</Feedback></div>}
              {withdrawalsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{withdrawalsQuery.error instanceof Error ? withdrawalsQuery.error.message : "Could not load payments."}</Feedback></div>}
              {!withdrawalsQuery.isLoading && !withdrawalsQuery.error && withdrawalsQuery.data?.length === 0 && (
                <EmptyState title="No payments yet" description="Recorded Production worker payments will appear here." />
              )}
              {!withdrawalsQuery.isLoading && !withdrawalsQuery.error && (withdrawalsQuery.data?.length ?? 0) > 0 && (
                <div className="mt-atlas-3">
                  <TableContainer>
                    <Table>
                      <TableCaption visuallyHidden>Payment history for {worker.name}</TableCaption>
                      <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
                      <TableBody>
                        {withdrawalsQuery.data?.map((payment) => (
                          <TableRow key={payment.withdrawalId}>
                            <TableCell>{formatDateOnly(payment.withdrawalDate)}</TableCell>
                            <TableCell numeric>{money(payment.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </div>
              )}
            </section>

            <details className="mt-atlas-5 border-t border-atlas-border pt-atlas-3">
              <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Rate history</summary>
              {wageRatesLoading && <Feedback role="status" tone="neutral">Loading rate history...</Feedback>}
              {wageRatesError && <Feedback role="alert" tone="danger">Rate history is unavailable.</Feedback>}
              {!wageRatesLoading && !wageRatesError && directRateHistory.length === 0 && <EmptyState title="No rate history" />}
              {!wageRatesLoading && !wageRatesError && directRateHistory.length > 0 && (
                <TableContainer>
                  <Table>
                    <TableCaption visuallyHidden>Rate history for {worker.name}</TableCaption>
                    <TableHeader><TableRow><TableHeaderCell>Effective dates</TableHeaderCell><TableHeaderCell numeric>Rate</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>
                      {directRateHistory.map((rate) => (
                        <TableRow key={rate.id}>
                          <TableCell>{formatDateOnly(rate.effectiveFrom)} – {rate.effectiveTo ? formatDateOnly(rate.effectiveTo) : "Current"}</TableCell>
                          <TableCell numeric>{formatIndianCurrency(rate.ratePer1000Bricks)} / 1,000</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </details>

            <details className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
              <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Locked earnings history</summary>
              {earningsQuery.isLoading && <Feedback role="status" tone="neutral">Loading locked earnings...</Feedback>}
              {earningsQuery.error && <Feedback role="alert" tone="danger">{earningsQuery.error instanceof Error ? earningsQuery.error.message : "Could not load locked earnings."}</Feedback>}
              {!earningsQuery.isLoading && !earningsQuery.error && earningsQuery.data?.length === 0 && <EmptyState title="No locked earnings yet" />}
              {!earningsQuery.isLoading && !earningsQuery.error && (earningsQuery.data?.length ?? 0) > 0 && (
                <TableContainer>
                  <Table wide>
                    <TableCaption visuallyHidden>Locked earnings history for {worker.name}</TableCaption>
                    <TableHeader><TableRow><TableHeaderCell>Week starting</TableHeaderCell><TableHeaderCell numeric>Quantity</TableHeaderCell><TableHeaderCell numeric>Rate</TableHeaderCell><TableHeaderCell numeric>Earned</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>
                      {earningsQuery.data?.map((earning) => (
                        <TableRow key={earning.id}>
                          <TableCell>{formatDateOnly(earning.week_start)}</TableCell>
                          <TableCell numeric>{formatIndianNumber(earning.quantity_used)}</TableCell>
                          <TableCell numeric>{earning.rate_used === null ? "Multiple rates" : formatIndianCurrency(earning.rate_used)}</TableCell>
                          <TableCell numeric>{money(earning.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </details>
          </div>

          <footer className="flex flex-col border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium">
            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel="Recording payment..."
              disabled={accountQuery.isLoading || Boolean(accountQuery.error)}
            >
              {paymentButtonLabel}
            </Button>
            <div className="mt-atlas-2 flex flex-col">
              <Button variant="ghost" onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
            </div>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function money(value: number): string {
  return formatIndianCurrency(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
