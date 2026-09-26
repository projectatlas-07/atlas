"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
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
import { assertCompletedWageWeek } from "@/features/wages/services/completed-wage-week-validation";
import { getLabourGroupAvailableBalance } from "@/features/wages/services/labour-group-available-balance-service";
import {
  CreateLabourGroupWithdrawalError,
  createLabourGroupWithdrawal,
} from "@/features/wages/services/labour-group-withdrawal-create-service";
import { getLabourGroupWithdrawalHistory } from "@/features/wages/services/labour-group-withdrawal-history-service";
import type { LabourGroup } from "@/features/wages/services/labour-group-read-service";
import { calculateInformationalPerMemberShare } from "@/features/wages/services/mud-supply-wage-calculation";
import {
  CalculateMudSupplyWagesError,
  calculateMudSupplyWages,
} from "@/features/wages/services/mud-supply-wage-calculation-service";
import {
  SetMudSupplyRateError,
  setMudSupplyRate,
} from "@/features/wages/services/mud-supply-rate-service";
import {
  getMudSupplyWeeklyEarning,
  type MudSupplyWeeklyEarning,
} from "@/features/wages/services/mud-supply-weekly-earning-read-service";
import type { WageRateHistory } from "@/features/wages/services/wage-rate-service";
import {
  formatDateOnly,
  formatIndianCurrency,
  formatIndianNumber,
} from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type MudGroupAccountDrawerProps = Readonly<{
  factoryId: string;
  group: LabourGroup;
  wageRates: readonly WageRateHistory[];
  ratesLoading: boolean;
  ratesError: boolean;
  onClose: () => void;
}>;

export function MudGroupAccountDrawer({
  factoryId,
  group,
  wageRates,
  ratesLoading,
  ratesError,
  onClose,
}: MudGroupAccountDrawerProps) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const asOfDate = getLocalDate();
  const [paymentDate, setPaymentDate] = useState(asOfDate);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [earning, setEarning] = useState<MudSupplyWeeklyEarning | null>(null);
  const [calculationError, setCalculationError] = useState("");
  const [calculationSuccess, setCalculationSuccess] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [rate, setRate] = useState("");
  const [rateEffectiveFrom, setRateEffectiveFrom] = useState(asOfDate);
  const [rateError, setRateError] = useState("");
  const [rateSuccess, setRateSuccess] = useState("");
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
        'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
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
    queryKey: ["labour-group-available-balance", factoryId, group.groupId, asOfDate],
    queryFn: () => getLabourGroupAvailableBalance({
      factoryId,
      labourGroupId: group.groupId,
      asOfDate,
    }),
  });
  const paymentsQuery = useQuery({
    queryKey: ["labour-group-withdrawal-history", factoryId, group.groupId],
    queryFn: () => getLabourGroupWithdrawalHistory(factoryId, group.groupId),
  });
  const mudRates = wageRates.filter((item) => item.applies_to === "mud_supply");

  function clearPaymentFeedback() {
    setPaymentError("");
    setPaymentSuccess("");
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPaying) return;
    const numericAmount = Number(paymentAmount);
    if (!paymentDate) {
      setPaymentError("Payment date is required.");
      return;
    }
    if (!paymentAmount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setPaymentError("Amount must be greater than zero.");
      return;
    }

    setIsPaying(true);
    clearPaymentFeedback();
    try {
      const saved = await createLabourGroupWithdrawal({
        factoryId,
        labourGroupId: group.groupId,
        withdrawalDate: paymentDate,
        amount: numericAmount,
      });
      setPaymentAmount("");
      setPaymentSuccess(`Payment of ${money(saved.amount)} recorded.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["labour-group-available-balance", factoryId, group.groupId] }),
        queryClient.invalidateQueries({ queryKey: ["labour-group-withdrawal-history", factoryId, group.groupId] }),
      ]);
    } catch (error) {
      setPaymentError(drawerErrorMessage(error, "Could not record Mud group payment."));
    } finally {
      setIsPaying(false);
    }
  }

  async function calculateWeeklyEarning(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCalculating) return;
    try {
      assertCompletedWageWeek(weekStart, getLocalDate());
    } catch (error) {
      setCalculationError(drawerErrorMessage(error, "Choose a completed Monday–Sunday week."));
      return;
    }

    setIsCalculating(true);
    setCalculationError("");
    setCalculationSuccess("");
    setEarning(null);
    try {
      const result = await calculateMudSupplyWages({
        factoryId,
        labourGroupId: group.groupId,
        weekStart,
      });
      setEarning(await getMudSupplyWeeklyEarning({
        factoryId,
        weeklyEarningId: result.weeklyEarningId,
        weekStart,
      }));
      setCalculationSuccess(result.groupsCalculated === 1
        ? "Legacy weekly Mud earning calculated and locked."
        : "Legacy weekly Mud earning was already locked.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["labour-group-available-balance", factoryId, group.groupId] }),
        queryClient.invalidateQueries({ queryKey: ["mud-shadow-certification", factoryId] }),
        queryClient.invalidateQueries({ queryKey: ["mud-cutover-readiness", factoryId] }),
      ]);
    } catch (error) {
      setCalculationError(drawerErrorMessage(error, "Could not calculate legacy weekly Mud wage."));
    } finally {
      setIsCalculating(false);
    }
  }

  async function submitRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingRate) return;
    const numericRate = Number(rate);
    if (!rate || !Number.isFinite(numericRate) || numericRate <= 0) {
      setRateError("Rate per 1,000 bricks must be greater than zero.");
      return;
    }

    setIsSavingRate(true);
    setRateError("");
    setRateSuccess("");
    try {
      await setMudSupplyRate({
        factoryId,
        ratePer1000Bricks: numericRate,
        effectiveFrom: rateEffectiveFrom,
      });
      setRate("");
      setRateSuccess("Legacy financial Mud rate saved.");
      await queryClient.invalidateQueries({ queryKey: ["office-wage-rates", factoryId] });
    } catch (error) {
      setRateError(drawerErrorMessage(error, "Could not set the legacy Mud rate."));
    } finally {
      setIsSavingRate(false);
    }
  }

  const numericPaymentAmount = Number(paymentAmount);
  const paymentButtonLabel = paymentAmount
    && Number.isFinite(numericPaymentAmount)
    && numericPaymentAmount > 0
    ? `Pay ${money(numericPaymentAmount)}`
    : "Record payment";
  const perMemberShare = earning && group.memberCount
    ? calculateInformationalPerMemberShare(earning.amount, group.memberCount)
    : null;

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Mud group account" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="mud-group-account-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-center justify-between border-b border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Mud group account</p>
            <h2 id="mud-group-account-title" className="mt-atlas-1 text-atlas-lg font-atlas-semibold text-atlas-text">Account &amp; payment</h2>
          </div>
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close Mud account drawer" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          <div className="flex items-start gap-atlas-3">
            <div aria-hidden="true" className="flex h-atlas-12 w-atlas-12 shrink-0 items-center justify-center rounded-atlas-card border border-atlas-primary-border bg-atlas-primary-surface text-atlas-lg font-atlas-semibold text-atlas-primary">
              {group.name.trim().charAt(0).toLocaleUpperCase("en-IN") || "M"}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-atlas-xl font-atlas-semibold text-atlas-text">{group.name}</h3>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Legacy weekly financial account</p>
              {group.memberCount !== null && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{formatIndianNumber(group.memberCount)} group members</p>}
            </div>
          </div>

          <div className="mt-atlas-5">
            <Card surface="muted">
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Available to pay</p>
              {accountQuery.isLoading ? (
                <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Loading account...</p>
              ) : accountQuery.error ? (
                <p className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">Account unavailable</p>
              ) : (
                <p className="mt-atlas-1 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">{money(accountQuery.data?.availableBalance ?? 0)}</p>
              )}
            </Card>
          </div>

          <div className="mt-atlas-3"><Feedback role="status" tone="info">This balance comes only from completed locked legacy weeks and real group withdrawals. SHADOW allocation values are excluded.</Feedback></div>
          {accountQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{drawerErrorMessage(accountQuery.error, "Could not load the Mud group account.")}</Feedback></div>}
          {accountQuery.data && <dl className="mt-atlas-4 grid grid-cols-2 gap-atlas-3 border-b border-atlas-border pb-atlas-4 text-atlas-sm">
            <div><dt className="text-atlas-xs text-atlas-text-subtle">Total locked earnings</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{money(accountQuery.data.totalEarned)}</dd></div>
            <div><dt className="text-atlas-xs text-atlas-text-subtle">Total withdrawn</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{money(accountQuery.data.totalWithdrawn)}</dd></div>
          </dl>}

          <section aria-labelledby="mud-payment-details-heading" className="mt-atlas-5">
            <h3 id="mud-payment-details-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Payment details</h3>
            <form id="mud-group-payment-form" className="mt-atlas-3 space-y-atlas-3" onSubmit={(event) => void submitPayment(event)}>
              <FormField label="Amount to pay">
                <Input type="text" inputMode="decimal" autoComplete="off" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); clearPaymentFeedback(); }} aria-invalid={Boolean(paymentError)} disabled={isPaying || accountQuery.isLoading || Boolean(accountQuery.error)} placeholder="0.00" />
              </FormField>
              <FormField label={ATLAS_UI_STRINGS.payment.date}>
                <Input type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); clearPaymentFeedback(); }} required disabled={isPaying} />
              </FormField>
              <p className="text-atlas-xs text-atlas-text-subtle">Records the existing dated group withdrawal. No SHADOW allocation or preview amount is used.</p>
            </form>
          </section>

          {paymentError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{paymentError}</Feedback></div>}
          {paymentSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{paymentSuccess}</Feedback></div>}

          <section aria-labelledby="mud-payment-history-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
            <h3 id="mud-payment-history-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Recent payments</h3>
            {paymentsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading payments...</Feedback></div>}
            {paymentsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{drawerErrorMessage(paymentsQuery.error, "Could not load Mud group payments.")}</Feedback></div>}
            {!paymentsQuery.isLoading && !paymentsQuery.error && paymentsQuery.data?.length === 0 && <EmptyState title="No payments yet" description="Recorded Mud group withdrawals will appear here." />}
            {!paymentsQuery.isLoading && !paymentsQuery.error && (paymentsQuery.data?.length ?? 0) > 0 && <div className="mt-atlas-3">
              <TableContainer><Table>
                <TableCaption visuallyHidden>Payment history for {group.name}</TableCaption>
                <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
                <TableBody>{paymentsQuery.data?.map((payment) => <TableRow key={payment.withdrawalId}><TableCell>{formatDateOnly(payment.withdrawalDate)}</TableCell><TableCell numeric>{money(payment.amount)}</TableCell></TableRow>)}</TableBody>
              </Table></TableContainer>
            </div>}
          </section>

          <details className="mt-atlas-5 border-t border-atlas-border pt-atlas-3">
            <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Weekly earnings calculation</summary>
            <p className="text-atlas-xs text-atlas-text-subtle">Calculate and lock one completed Monday–Sunday week using the existing legacy authority.</p>
            <form className="mt-atlas-3 space-y-atlas-3" onSubmit={(event) => void calculateWeeklyEarning(event)}>
              <FormField label="Week start"><Input type="date" value={weekStart} onChange={(event) => { setWeekStart(event.target.value); setCalculationError(""); setCalculationSuccess(""); setEarning(null); }} required disabled={isCalculating} /></FormField>
              <Button type="submit" variant="secondary" loading={isCalculating} loadingLabel="Calculating...">Calculate Mud wage</Button>
            </form>
            {calculationError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{calculationError}</Feedback></div>}
            {calculationSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{calculationSuccess}</Feedback></div>}
            {earning && <div className="mt-atlas-3"><Card>
              <dl className="space-y-atlas-2 text-atlas-sm">
                <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Week starting</dt><dd className="font-atlas-medium text-atlas-text">{formatDateOnly(earning.weekStart)}</dd></div>
                <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Locked quantity</dt><dd className="font-atlas-medium tabular-nums text-atlas-text">{formatIndianNumber(earning.quantityUsed)}</dd></div>
                <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Locked rate</dt><dd className="font-atlas-medium tabular-nums text-atlas-text">{money(earning.rateUsed)} / 1,000</dd></div>
                <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Locked earning</dt><dd className="font-atlas-semibold tabular-nums text-atlas-text">{money(earning.amount)}</dd></div>
                <div className="flex justify-between gap-atlas-3"><dt className="text-atlas-text-muted">Per-member share</dt><dd className="font-atlas-medium tabular-nums text-atlas-text">{perMemberShare === null ? ATLAS_UI_STRINGS.feedback.unavailable : money(perMemberShare)}</dd></div>
              </dl>
            </Card></div>}
          </details>

          <details className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
            <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Legacy financial rate</summary>
            <form className="space-y-atlas-3" onSubmit={(event) => void submitRate(event)}>
              <FormField label="Rate per 1,000 bricks"><Input type="text" inputMode="decimal" autoComplete="off" value={rate} onChange={(event) => { setRate(event.target.value); setRateError(""); setRateSuccess(""); }} required disabled={isSavingRate} placeholder="0.00" /></FormField>
              <FormField label="Effective from"><Input type="date" value={rateEffectiveFrom} onChange={(event) => { setRateEffectiveFrom(event.target.value); setRateError(""); setRateSuccess(""); }} required disabled={isSavingRate} /></FormField>
              <Button type="submit" variant="secondary" loading={isSavingRate} loadingLabel="Saving rate...">Save legacy rate</Button>
            </form>
            {rateError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{rateError}</Feedback></div>}
            {rateSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{rateSuccess}</Feedback></div>}
            {ratesLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading rate history...</Feedback></div>}
            {ratesError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Rate history is unavailable.</Feedback></div>}
            {!ratesLoading && !ratesError && mudRates.length === 0 && <EmptyState title="No legacy rate history" />}
            {!ratesLoading && !ratesError && mudRates.length > 0 && <div className="mt-atlas-3"><TableContainer><Table>
              <TableCaption visuallyHidden>Legacy Mud financial rate history</TableCaption>
              <TableHeader><TableRow><TableHeaderCell>Effective dates</TableHeaderCell><TableHeaderCell numeric>Rate</TableHeaderCell></TableRow></TableHeader>
              <TableBody>{mudRates.map((item) => <TableRow key={item.id}><TableCell>{formatDateOnly(item.effective_from)} – {item.effective_to ? formatDateOnly(item.effective_to) : "Current"}</TableCell><TableCell numeric>{money(item.rate_per_1000_bricks)} / 1,000</TableCell></TableRow>)}</TableBody>
            </Table></TableContainer></div>}
          </details>
        </div>

        <footer className="flex flex-col border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium">
          <Button type="submit" form="mud-group-payment-form" loading={isPaying} loadingLabel="Recording payment..." disabled={accountQuery.isLoading || Boolean(accountQuery.error)}>{paymentButtonLabel}</Button>
          <div className="mt-atlas-2 flex flex-col"><Button variant="ghost" onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button></div>
        </footer>
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

function drawerErrorMessage(error: unknown, fallback: string): string {
  return error instanceof CreateLabourGroupWithdrawalError
    || error instanceof CalculateMudSupplyWagesError
    || error instanceof SetMudSupplyRateError
    || error instanceof Error
    ? error.message
    : fallback;
}
