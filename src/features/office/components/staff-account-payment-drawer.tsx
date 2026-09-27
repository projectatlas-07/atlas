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
  buildStaffPaymentInput,
  getStaffInitials,
  insertStaffPaymentNewestFirst,
  staffOfficeErrorMessage,
  sumStaffPaymentsInRange,
} from "@/features/office/staff-office-model";
import {
  staffPaymentHistoryQueryKey,
  staffPaymentSummaryQueryKey,
} from "@/features/office/staff-office-query-keys";
import {
  listStaffPayments,
  recordStaffPayment,
} from "@/features/staff/services/staff-payment-service";
import type {
  StaffPayment,
  StaffPaymentSummary,
  StaffWorker,
} from "@/features/staff/types";
import {
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatDateOnly, formatIndianCurrency } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  STAFF_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const rangeOptions: ReadonlyArray<{
  value: WageEarningsDatePreset;
  label: string;
}> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom dates" },
];

export function StaffAccountPaymentDrawer({
  factoryId,
  worker,
  categoryName,
  onClose,
}: Readonly<{
  factoryId: string;
  worker: StaffWorker;
  categoryName: string | null;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [localToday] = useState(getLocalDate);
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>("this_month");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [paymentDate, setPaymentDate] = useState(localToday);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");
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

  const historyKey = staffPaymentHistoryQueryKey(factoryId, worker.id);
  const summaryKey = staffPaymentSummaryQueryKey(factoryId, worker.id);
  const paymentsQuery = useQuery({
    queryKey: historyKey,
    queryFn: () => listStaffPayments({ factoryId, staffWorkerId: worker.id }),
    refetchInterval: 30_000,
  });
  const paymentRange = resolveWageEarningsDateRange(
    rangePreset,
    localToday,
    customFrom,
    customTo,
  );
  const periodPaid = paymentRange && !paymentsQuery.isLoading && !paymentsQuery.error
    ? sumStaffPaymentsInRange(paymentsQuery.data ?? [], paymentRange)
    : null;
  const lifecycleStatus = resolveBooleanStatusPresentation(
    STAFF_WORKER_LIFECYCLE_STATUS,
    worker.isActive,
  );
  const numericAmount = Number(paymentAmount);
  const validPaymentAmount = Boolean(paymentAmount.trim())
    && Number.isFinite(numericAmount)
    && numericAmount > 0;
  const paymentButtonLabel = validPaymentAmount
    ? `Pay ${formatIndianCurrency(numericAmount)}`
    : "Record payment";
  const periodLabel = rangeOptions.find((option) => option.value === rangePreset)?.label
    ?? "Selected period";

  function clearPaymentFeedback() {
    setPaymentError("");
    setPaymentSuccess("");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!worker.isActive) {
      setPaymentError("Restore this archived Staff member before recording a payment.");
      return;
    }

    const input = buildStaffPaymentInput({
      factoryId,
      staffWorkerId: worker.id,
      paymentDate,
      amount: paymentAmount,
      note: paymentNote,
    });
    if (!input) {
      setPaymentError("Enter a positive amount and valid payment date.");
      return;
    }

    setIsSubmitting(true);
    clearPaymentFeedback();
    try {
      const recorded = await recordStaffPayment(input);
      queryClient.setQueryData<StaffPaymentSummary>(summaryKey, {
        totalPaid: recorded.totalPaid,
      });
      queryClient.setQueryData<StaffPayment[]>(historyKey, (current = []) =>
        insertStaffPaymentNewestFirst(current, recorded));
      setPaymentAmount("");
      setPaymentNote("");
      setPaymentSuccess(`Payment of ${formatIndianCurrency(recorded.amount)} recorded.`);
    } catch (error) {
      setPaymentError(staffOfficeErrorMessage(error, "Could not record the Staff payment."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const recentPayments = (paymentsQuery.data ?? []).slice(0, 3);

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal account drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Staff account" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-account-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submitPayment(event)}>
          <header className="flex items-start justify-between gap-atlas-3 border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
            <div className="flex min-w-0 items-start gap-atlas-3">
              <div aria-hidden="true" className="flex h-atlas-12 w-atlas-12 shrink-0 items-center justify-center rounded-atlas-pill border border-atlas-primary-border bg-atlas-primary-surface text-atlas-base font-atlas-semibold text-atlas-primary">
                {getStaffInitials(worker.name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-atlas-2">
                  <h2 id="staff-account-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">{worker.name}</h2>
                  <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
                </div>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{categoryName ?? "Unknown category"}</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                  Reference salary: <span className="font-atlas-medium text-atlas-text-muted">{formatIndianCurrency(worker.referenceSalary)}</span> · informational only
                </p>
              </div>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Staff account drawer" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
            <Card surface="muted">
              <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Payment summary</p>
                <div className="w-full sm:w-40">
                  <Select
                    aria-label="Payment summary period"
                    value={rangePreset}
                    onChange={(event) => setRangePreset(event.target.value as WageEarningsDatePreset)}
                  >
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
              {rangePreset === "custom" && !paymentRange && (
                <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>
              )}
              <div className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                <Card>
                  <p className="text-atlas-xs text-atlas-text-muted">Paid in period</p>
                  <p className="mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums text-atlas-text">
                    {paymentsQuery.isLoading
                      ? ATLAS_UI_STRINGS.feedback.loading
                      : paymentsQuery.error || periodPaid === null
                        ? ATLAS_UI_STRINGS.feedback.unavailable
                        : formatIndianCurrency(periodPaid)}
                  </p>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">
                    {paymentRange ? `${formatDateOnly(paymentRange.fromDate)} – ${formatDateOnly(paymentRange.toDate)}` : periodLabel}
                  </p>
                </Card>
                <Card>
                  <p className="text-atlas-xs text-atlas-text-muted">Reference salary</p>
                  <p className="mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums text-atlas-text-muted">{formatIndianCurrency(worker.referenceSalary)}</p>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Informational only</p>
                </Card>
              </div>
              <p className="mt-atlas-3 text-atlas-xs text-atlas-text-subtle">
                Reference salary is informational only and does not represent an automatic payable or accrued debt.
              </p>
            </Card>

            <section aria-labelledby="staff-record-payment-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
              <h3 id="staff-record-payment-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Record payment</h3>
              {!worker.isActive && (
                <div className="mt-atlas-3"><Feedback role="status" tone="warning">This Staff member is archived. Restore them before recording a new payment.</Feedback></div>
              )}
              <div className="mt-atlas-3 space-y-atlas-3">
                <FormField label="Amount to pay">
                  <Input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={paymentAmount}
                    onChange={(event) => { setPaymentAmount(event.target.value); clearPaymentFeedback(); }}
                    aria-invalid={Boolean(paymentError)}
                    disabled={isSubmitting || !worker.isActive}
                    placeholder="0.00"
                  />
                </FormField>
                <FormField label={ATLAS_UI_STRINGS.payment.date}>
                  <Input
                    type="date"
                    max={localToday}
                    value={paymentDate}
                    onChange={(event) => { setPaymentDate(event.target.value); clearPaymentFeedback(); }}
                    required
                    disabled={isSubmitting || !worker.isActive}
                  />
                </FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.noteOptional}>
                  <Input
                    value={paymentNote}
                    onChange={(event) => { setPaymentNote(event.target.value); clearPaymentFeedback(); }}
                    disabled={isSubmitting || !worker.isActive}
                    placeholder="e.g. Advance or monthly disbursement"
                  />
                </FormField>
              </div>
            </section>

            {paymentError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{paymentError}</Feedback></div>}
            {paymentSuccess && <div className="mt-atlas-3"><Feedback role="status" tone="success">{paymentSuccess}</Feedback></div>}

            <section aria-labelledby="staff-recent-payments-heading" className="mt-atlas-5 border-t border-atlas-border pt-atlas-5">
              <h3 id="staff-recent-payments-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Recent payments</h3>
              {paymentsQuery.isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">{ATLAS_UI_STRINGS.payment.loadingHistory}</Feedback></div>}
              {paymentsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{staffOfficeErrorMessage(paymentsQuery.error, ATLAS_UI_STRINGS.payment.historyLoadError)}</Feedback></div>}
              {!paymentsQuery.isLoading && !paymentsQuery.error && recentPayments.length === 0 && (
                <EmptyState title="No payments yet" description="Recorded Staff payments will appear here." />
              )}
              {!paymentsQuery.isLoading && !paymentsQuery.error && recentPayments.length > 0 && (
                <div className="mt-atlas-3 divide-y divide-atlas-border overflow-hidden rounded-atlas-card border border-atlas-border bg-atlas-surface">
                  {recentPayments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-atlas-3 px-atlas-3 py-atlas-3">
                      <div className="min-w-0">
                        <p className="text-atlas-sm font-atlas-medium text-atlas-text">{formatDateOnly(payment.paymentDate)}</p>
                        <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-subtle">{payment.note ?? "Payment recorded"}</p>
                      </div>
                      <p className="shrink-0 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(payment.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
              {!paymentsQuery.isLoading && !paymentsQuery.error && (paymentsQuery.data?.length ?? 0) > 0 && (
                <details className="mt-atlas-3 border-t border-atlas-border pt-atlas-2">
                  <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-primary">View full payment history</summary>
                  <TableContainer>
                    <Table>
                      <TableCaption visuallyHidden>Payment history for {worker.name}</TableCaption>
                      <TableHeader><TableRow><TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell><TableHeaderCell>{ATLAS_UI_STRINGS.fields.note}</TableHeaderCell><TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell></TableRow></TableHeader>
                      <TableBody>{(paymentsQuery.data ?? []).map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>{formatDateOnly(payment.paymentDate)}</TableCell>
                          <TableCell><span className="text-atlas-text-muted">{payment.note ?? "—"}</span></TableCell>
                          <TableCell numeric><span className="font-atlas-semibold text-atlas-text">{formatIndianCurrency(payment.amount)}</span></TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  </TableContainer>
                </details>
              )}
            </section>
          </div>

          <footer className="flex flex-col border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium">
            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel="Recording payment..."
              disabled={!worker.isActive}
            >
              {paymentButtonLabel}
            </Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
