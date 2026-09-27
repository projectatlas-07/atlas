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
  vehicleWageAccountQueryKey,
  vehicleWagePaymentsQueryKey,
} from "@/features/office/vehicle-wage-office-query-keys";
import {
  applyVehicleWagePaymentReversal,
  buildVehicleWageAccounts,
  buildVehicleWagePaymentInput,
  buildVehicleWagePaymentReversalInput,
  insertVehicleWagePaymentNewestFirst,
  resolveVehicleWageDateRange,
  type VehicleWageDatePreset,
  type VehicleWageLifetimeAccount,
  type VehicleWagePayment,
} from "@/features/sales/vehicle-wage-model";
import {
  getVehicleWageLifetimeAccount,
  listAllVehicleWageTrips,
  listVehicleWagePayments,
  listVehicleWageTrips,
  recordVehicleWagePayment,
  reverseVehicleWagePayment,
} from "@/features/sales/services/vehicle-wage-service";
import type { Vehicle } from "@/features/sales/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type VehicleWageDrawerPreset = VehicleWageDatePreset | "all_time";
type DrawerView = "account" | "history";

const rangeOptions: ReadonlyArray<{ value: VehicleWageDrawerPreset; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom" },
  { value: "all_time", label: "All Time" },
];

export function VehicleWageAccountDrawer({
  factoryId,
  vehicle,
  onClose,
}: Readonly<{
  factoryId: string;
  vehicle: Vehicle;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [localToday] = useState(getLocalDate);
  const [view, setView] = useState<DrawerView>("account");
  const [rangePreset, setRangePreset] = useState<VehicleWageDrawerPreset>("this_week");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [paymentDate, setPaymentDate] = useState(localToday);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [reversingPaymentId, setReversingPaymentId] = useState("");
  const [reversalDate, setReversalDate] = useState(localToday);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState("");
  const [reversalSuccess, setReversalSuccess] = useState("");
  const [isReversing, setIsReversing] = useState(false);

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
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  const earningsRange = rangePreset === "all_time"
    ? null
    : resolveVehicleWageDateRange(rangePreset, localToday, customFrom, customTo);
  const rangeIsValid = rangePreset === "all_time" || earningsRange !== null;
  const accountQuery = useQuery({
    queryKey: vehicleWageAccountQueryKey(factoryId, vehicle.id),
    queryFn: () => getVehicleWageLifetimeAccount(factoryId, vehicle.id),
  });
  const paymentsQuery = useQuery({
    queryKey: vehicleWagePaymentsQueryKey(factoryId, vehicle.id),
    queryFn: () => listVehicleWagePayments(factoryId, vehicle.id),
  });
  const earningsQuery = useQuery({
    queryKey: [
      "office-vehicle-wages",
      factoryId,
      "drawer-trips",
      vehicle.id,
      rangePreset,
      earningsRange?.fromDate,
      earningsRange?.toDate,
    ],
    queryFn: () => rangePreset === "all_time"
      ? listAllVehicleWageTrips(factoryId)
      : listVehicleWageTrips(factoryId, earningsRange!),
    enabled: rangeIsValid,
  });

  const periodAccount = buildVehicleWageAccounts(
    [vehicle],
    (earningsQuery.data ?? []).filter((trip) => trip.vehicleId === vehicle.id),
  )[0];
  const availableBalance = accountQuery.data?.availableBalance;
  const paymentInput = buildVehicleWagePaymentInput(
    factoryId,
    vehicle.id,
    paymentDate,
    paymentAmount,
    paymentNote,
  );
  const paymentExceedsAvailable = Boolean(
    paymentInput && availableBalance !== undefined && paymentInput.amount > availableBalance,
  );
  const remainingAfterPayment = paymentInput && availableBalance !== undefined && !paymentExceedsAvailable
    ? Math.round((availableBalance - paymentInput.amount) * 100) / 100
    : null;
  const paymentUnavailable = accountQuery.isLoading
    || Boolean(accountQuery.error)
    || availableBalance === undefined
    || availableBalance <= 0;
  const paymentButtonLabel = paymentInput && !paymentExceedsAvailable
    ? `Pay ${formatIndianCurrency(paymentInput.amount)}`
    : "Record payment";
  const recentPayments = (paymentsQuery.data ?? []).slice(0, 3);

  function clearPaymentFeedback() {
    setPaymentError("");
    setPaymentSuccess("");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPaying) return;
    if (!accountQuery.data) {
      setPaymentError("The authoritative Vehicle wage account is unavailable. Try again.");
      return;
    }
    if (!paymentInput) {
      setPaymentError("Enter a valid payment date, positive amount, and optional note up to 500 characters.");
      return;
    }
    if (paymentInput.amount > accountQuery.data.availableBalance) {
      setPaymentError("Payment exceeds the authoritative available balance.");
      return;
    }

    setIsPaying(true);
    clearPaymentFeedback();
    try {
      const payment = await recordVehicleWagePayment(paymentInput);
      queryClient.setQueryData<VehicleWageLifetimeAccount>(
        vehicleWageAccountQueryKey(factoryId, vehicle.id),
        {
          totalEarned: payment.totalEarned,
          totalPaid: payment.totalPaid,
          availableBalance: payment.availableBalance,
        },
      );
      queryClient.setQueryData<VehicleWagePayment[]>(
        vehicleWagePaymentsQueryKey(factoryId, vehicle.id),
        (current = []) => insertVehicleWagePaymentNewestFirst(current, payment),
      );
      void queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] });
      setPaymentAmount("");
      setPaymentNote("");
      setPaymentSuccess(`Payment of ${formatIndianCurrency(payment.amount)} recorded.`);
    } catch (error) {
      void queryClient.invalidateQueries({
        queryKey: vehicleWageAccountQueryKey(factoryId, vehicle.id),
      });
      void queryClient.invalidateQueries({
        queryKey: vehicleWagePaymentsQueryKey(factoryId, vehicle.id),
      });
      setPaymentError(error instanceof Error ? error.message : "Could not record this payment.");
    } finally {
      setIsPaying(false);
    }
  }

  function beginReversal(payment: VehicleWagePayment) {
    setReversingPaymentId(payment.id);
    setReversalDate(payment.paymentDate > localToday ? payment.paymentDate : localToday);
    setReversalReason("");
    setReversalError("");
    setReversalSuccess("");
  }

  async function submitReversal(
    event: FormEvent<HTMLFormElement>,
    payment: VehicleWagePayment,
  ) {
    event.preventDefault();
    if (isReversing || payment.reversal) return;
    const input = buildVehicleWagePaymentReversalInput(
      factoryId,
      payment.id,
      payment.paymentDate,
      reversalDate,
      reversalReason,
    );
    if (!input) {
      setReversalError("Choose a date on or after the payment date and enter a reason up to 500 characters.");
      return;
    }

    setIsReversing(true);
    setReversalError("");
    setReversalSuccess("");
    try {
      const reversal = await reverseVehicleWagePayment(input);
      queryClient.setQueryData<VehicleWageLifetimeAccount>(
        vehicleWageAccountQueryKey(factoryId, vehicle.id),
        {
          totalEarned: reversal.totalEarned,
          totalPaid: reversal.totalPaid,
          availableBalance: reversal.availableBalance,
        },
      );
      queryClient.setQueryData<VehicleWagePayment[]>(
        vehicleWagePaymentsQueryKey(factoryId, vehicle.id),
        (current = []) => applyVehicleWagePaymentReversal(current, reversal),
      );
      void queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] });
      setReversingPaymentId("");
      setReversalReason("");
      setReversalSuccess(`Payment of ${formatIndianCurrency(payment.amount)} reversed.`);
    } catch (error) {
      void queryClient.invalidateQueries({
        queryKey: vehicleWageAccountQueryKey(factoryId, vehicle.id),
      });
      void queryClient.invalidateQueries({
        queryKey: vehicleWagePaymentsQueryKey(factoryId, vehicle.id),
      });
      setReversalError(error instanceof Error ? error.message : "Could not reverse this payment.");
    } finally {
      setIsReversing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal account drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Vehicle wage account" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="vehicle-wage-account-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-surface shadow-atlas-high sm:max-w-lg"
      >
        <header className="flex items-start justify-between border-b border-atlas-border bg-atlas-background-muted px-atlas-5 py-atlas-4">
          <div className="min-w-0">
            <div className="flex items-center gap-atlas-2">
              {view === "history" && <Button variant="ghost" onClick={() => { setView("account"); setReversingPaymentId(""); }}>Back</Button>}
              <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                {view === "history" ? "Vehicle wage payment history" : "Vehicle wage account"}
              </p>
            </div>
            <h2 id="vehicle-wage-account-title" className="mt-atlas-1 truncate text-atlas-xl font-atlas-semibold text-atlas-text">
              {vehicle.vehicleNumber}
            </h2>
            <div className="mt-atlas-2 flex flex-wrap items-center gap-atlas-2">
              <span className="flex items-center gap-atlas-2 text-atlas-xs font-atlas-semibold text-atlas-text-muted">
                <span aria-hidden="true" className={vehicle.deliveryWageTrackingEnabled ? "h-atlas-2 w-atlas-2 rounded-atlas-pill bg-atlas-success" : "h-atlas-2 w-atlas-2 rounded-atlas-pill bg-atlas-text-disabled"} />
                Wage {vehicle.deliveryWageTrackingEnabled ? "ON" : "OFF"}
              </span>
              {!vehicle.isActive && <StatusPill label="Archived" tone="archive" />}
            </div>
          </div>
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close Vehicle wage account drawer" onClick={onClose}><span aria-hidden="true">×</span></Button>
        </header>

        {view === "account" ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
              <Card surface="muted">
                <div className="flex items-center justify-between gap-atlas-3">
                  <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Available to pay</p>
                  <span className="rounded-atlas-control border border-atlas-border bg-atlas-surface px-atlas-2 py-atlas-1 text-atlas-xs text-atlas-text-subtle">Authoritative</span>
                </div>
                {accountQuery.isLoading ? (
                  <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Loading account...</p>
                ) : accountQuery.error || !accountQuery.data ? (
                  <p className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">Account unavailable</p>
                ) : (
                  <p className="mt-atlas-2 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(accountQuery.data.availableBalance)}</p>
                )}
                <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Current lifetime unpaid balance from the account authority. Period filters do not change it.</p>
              </Card>

              {accountQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{accountQuery.error instanceof Error ? accountQuery.error.message : "Could not load the Vehicle wage account."}</Feedback></div>}

              <section aria-labelledby="vehicle-earnings-view-heading" className="mt-atlas-5">
                <div className="flex items-end justify-between gap-atlas-3">
                  <h3 id="vehicle-earnings-view-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Earnings view</h3>
                  <div className="w-40">
                    <Select aria-label="Earnings period" value={rangePreset} onChange={(event) => setRangePreset(event.target.value as VehicleWageDrawerPreset)}>
                      {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </Select>
                  </div>
                </div>
                {rangePreset === "custom" && (
                  <div className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                    <FormField label="From"><Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></FormField>
                    <FormField label="To"><Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></FormField>
                  </div>
                )}
                {rangePreset === "custom" && !earningsRange && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>}
                {earningsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading Challan wage earnings...</Feedback></div>}
                {earningsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{earningsQuery.error instanceof Error ? earningsQuery.error.message : "Could not load Vehicle wage earnings."}</Feedback></div>}
                {rangeIsValid && !earningsQuery.isLoading && !earningsQuery.error && periodAccount && (
                  <div className="mt-atlas-3">
                    <Card>
                      <p className="text-atlas-sm font-atlas-medium text-atlas-text">{rangePreset === "all_time" ? "All recorded eligible Challans" : `${formatDateOnly(earningsRange!.fromDate)} – ${formatDateOnly(earningsRange!.toDate)}`}</p>
                      <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 border-t border-atlas-border pt-atlas-3 text-atlas-sm">
                        <div><dt className="text-atlas-xs text-atlas-text-subtle">Wage trips</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(periodAccount.qualifyingTripCount)} {periodAccount.qualifyingTripCount === 1 ? "trip" : "trips"}</dd></div>
                        <div><dt className="text-right text-atlas-xs text-atlas-text-subtle">Earnings</dt><dd className="mt-atlas-1 text-right font-atlas-semibold tabular-nums text-atlas-primary">{formatIndianCurrency(periodAccount.earnedAmount)}</dd></div>
                      </dl>
                    </Card>
                    <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">Informational Challan-derived summary only. Individual trip evidence remains in the overview.</p>
                  </div>
                )}
              </section>

              <form id="vehicle-wage-payment-form" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5" onSubmit={(event) => void submitPayment(event)}>
                <h3 className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Record payment</h3>
                <div className="mt-atlas-3 space-y-atlas-3">
                  <FormField label="Amount to pay">
                    <Input type="text" inputMode="decimal" autoComplete="off" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); clearPaymentFeedback(); }} aria-invalid={Boolean(paymentError || paymentExceedsAvailable)} disabled={isPaying || paymentUnavailable} placeholder="0.00" />
                  </FormField>
                  {availableBalance !== undefined && availableBalance > 0 && (
                    <Button variant="secondary" disabled={isPaying} onClick={() => { setPaymentAmount(String(availableBalance)); clearPaymentFeedback(); }}>Pay Full {formatIndianCurrency(availableBalance)}</Button>
                  )}
                  <p className="text-atlas-xs text-atlas-text-muted">Remaining after payment: <span className="font-atlas-semibold tabular-nums text-atlas-text">{remainingAfterPayment === null ? "—" : formatIndianCurrency(remainingAfterPayment)}</span></p>
                  {paymentExceedsAvailable && <Feedback role="alert" tone="danger">Payment cannot exceed Available to Pay.</Feedback>}
                  <FormField label={ATLAS_UI_STRINGS.payment.date}>
                    <Input type="date" required value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); clearPaymentFeedback(); }} disabled={isPaying || paymentUnavailable} />
                  </FormField>
                  <FormField label={ATLAS_UI_STRINGS.fields.noteOptional}>
                    <Input value={paymentNote} maxLength={500} onChange={(event) => { setPaymentNote(event.target.value); clearPaymentFeedback(); }} disabled={isPaying || paymentUnavailable} placeholder="Settlement note" />
                  </FormField>
                </div>
              </form>

              {paymentError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{paymentError}</Feedback></div>}
              {paymentSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{paymentSuccess}</Feedback></div>}

              <section aria-labelledby="vehicle-recent-payments-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
                <div className="flex items-center justify-between gap-atlas-3">
                  <h3 id="vehicle-recent-payments-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Recent payments</h3>
                  {(paymentsQuery.data?.length ?? 0) > 0 && <Button variant="ghost" onClick={() => setView("history")}>View history</Button>}
                </div>
                {paymentsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading payments...</Feedback></div>}
                {paymentsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{paymentsQuery.error instanceof Error ? paymentsQuery.error.message : ATLAS_UI_STRINGS.payment.historyLoadError}</Feedback></div>}
                {!paymentsQuery.isLoading && !paymentsQuery.error && recentPayments.length === 0 && <EmptyState title="No payments yet" description="Recorded Vehicle wage payments will appear here." />}
                {!paymentsQuery.isLoading && !paymentsQuery.error && recentPayments.length > 0 && <div className="mt-atlas-3 space-y-atlas-2">{recentPayments.map((payment) => <PaymentCard key={payment.id} payment={payment} />)}</div>}
              </section>
            </div>

            <footer className="flex flex-col gap-atlas-2 border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium sm:flex-row-reverse">
              <Button type="submit" form="vehicle-wage-payment-form" loading={isPaying} loadingLabel="Recording payment..." disabled={paymentUnavailable || !paymentInput || paymentExceedsAvailable}>{paymentButtonLabel}</Button>
              <Button variant="secondary" onClick={onClose}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
            </footer>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
              <div className="flex items-center justify-between gap-atlas-3">
                <div>
                  <h3 className="text-atlas-lg font-atlas-semibold text-atlas-text">{ATLAS_UI_STRINGS.payment.history}</h3>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Immutable payments and full reversals, newest payment date first.</p>
                </div>
                <Button variant="secondary" onClick={() => { setView("account"); setReversingPaymentId(""); }}>Back to account</Button>
              </div>
              {reversalError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{reversalError}</Feedback></div>}
              {reversalSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{reversalSuccess}</Feedback></div>}
              {paymentsQuery.isLoading && <div className="mt-atlas-4"><Feedback role="status" tone="neutral">{ATLAS_UI_STRINGS.payment.loadingHistory}</Feedback></div>}
              {paymentsQuery.error && <div className="mt-atlas-4"><Feedback role="alert" tone="danger">{paymentsQuery.error instanceof Error ? paymentsQuery.error.message : ATLAS_UI_STRINGS.payment.historyLoadError}</Feedback></div>}
              {!paymentsQuery.isLoading && !paymentsQuery.error && (paymentsQuery.data?.length ?? 0) === 0 && <EmptyState title="No payments yet" />}
              {!paymentsQuery.isLoading && !paymentsQuery.error && (paymentsQuery.data?.length ?? 0) > 0 && (
                <div className="mt-atlas-4 space-y-atlas-3">
                  {(paymentsQuery.data ?? []).map((payment) => (
                    <Card key={payment.id}>
                      <PaymentCard payment={payment} />
                      {!payment.reversal && reversingPaymentId !== payment.id && <div className="mt-atlas-3"><Button variant="danger" disabled={isReversing} onClick={() => beginReversal(payment)}>Reverse payment</Button></div>}
                      {!payment.reversal && reversingPaymentId === payment.id && (
                        <form className="mt-atlas-4 border-t border-atlas-danger-border pt-atlas-4" onSubmit={(event) => void submitReversal(event, payment)}>
                          <Feedback tone="warning">Reverse this full payment? The original stays in history and Cash Book receives an equal Money In correction.</Feedback>
                          <div className="mt-atlas-3 space-y-atlas-3">
                            <FormField label="Reversal date"><Input type="date" required min={payment.paymentDate} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} disabled={isReversing} /></FormField>
                            <FormField label="Reason"><Input required maxLength={500} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} disabled={isReversing} /></FormField>
                          </div>
                          <div className="mt-atlas-3 flex flex-col gap-atlas-2 sm:flex-row">
                            <Button type="submit" variant="danger" loading={isReversing} loadingLabel="Reversing...">Confirm reversal</Button>
                            <Button variant="secondary" disabled={isReversing} onClick={() => { setReversingPaymentId(""); setReversalError(""); }}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                          </div>
                        </form>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
            <footer className="flex flex-col gap-atlas-2 border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium sm:flex-row-reverse">
              <Button onClick={() => { setView("account"); setReversingPaymentId(""); }}>Back to account</Button>
              <Button variant="secondary" onClick={onClose}>{ATLAS_UI_STRINGS.actions.close}</Button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function PaymentCard({ payment }: Readonly<{ payment: VehicleWagePayment }>) {
  return (
    <div>
      <div className="flex items-start justify-between gap-atlas-3">
        <div>
          <p className="text-atlas-sm font-atlas-semibold text-atlas-text">{formatDateOnly(payment.paymentDate)} · {formatIndianCurrency(payment.amount)}</p>
          {payment.note && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{payment.note}</p>}
        </div>
        {payment.reversal && <StatusPill label="Reversed" tone="warning" />}
      </div>
      {payment.reversal ? (
        <div className="mt-atlas-2"><Feedback tone="warning">
          <p className="font-atlas-semibold">Reversed on {formatDateOnly(payment.reversal.reversalDate)}</p>
          <p className="mt-atlas-1">Reason: {payment.reversal.reason}</p>
        </Feedback></div>
      ) : !payment.note ? <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Immutable payment record</p> : null}
    </div>
  );
}
