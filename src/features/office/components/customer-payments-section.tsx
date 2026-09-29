"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Checkbox, Input, Select } from "@/components/ui/form-controls";
import { FormField } from "@/components/ui/form-field";
import {
  buildCustomerPaymentInput,
  clearCustomerPaymentAllocations,
  clearCustomerPaymentMethodAmounts,
  emptyCustomerPaymentForm,
  filterCustomersForPaymentSelection,
  getCustomerPaymentFormStatus,
  resolveCustomerDuesDateFilter,
  setCustomerPaymentMethodAmount,
  setPaymentAllocation,
  setPaymentAmount,
  sortCustomerOutstandingChallans,
  toggleCustomerPaymentMode,
  togglePaymentAllocation,
  type CustomerDuesDatePreset,
  type CustomerDuesSortOrder,
  type CustomerPaymentForm,
  type CustomerPaymentFormStatus,
} from "@/features/office/customer-payment-office-model";
import {
  createCustomerPaymentWithMethods,
  getCustomerSalesSummary,
  listCustomerOutstandingChallans,
  listCustomerPayments,
} from "@/features/sales/services/customer-payment-service";
import {
  formatChallanLabel,
  formatCustomerPaymentMethods,
  formatCustomerPaymentMode,
  NEW_CUSTOMER_PAYMENT_MODES,
  type Customer,
  type CustomerPayment,
  type NewCustomerPaymentMode,
} from "@/features/sales/types";
import {
  formatDateOnly,
  formatIndianCurrency,
  formatIndianNumber,
} from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const summaryKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-summary", factoryId, customerId] as const;
const candidatesKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-candidates", factoryId, customerId] as const;
const historyKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-history", factoryId, customerId] as const;
const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;
const duesDatePresets: Array<{ value: CustomerDuesDatePreset; label: string }> = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

export function CustomerPaymentsSection({
  factoryId,
  customers,
  onPaymentSaved,
  onViewAll,
}: Readonly<{
  factoryId: string;
  customers: readonly Customer[];
  onPaymentSaved: (payment: CustomerPayment) => void;
  onViewAll: () => void;
}>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [customerId, setCustomerId] = useState("");
  const [form, setForm] = useState<CustomerPaymentForm>(() => emptyCustomerPaymentForm(localToday));
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [duesSortOrder, setDuesSortOrder] = useState<CustomerDuesSortOrder>("newest");
  const [duesDatePreset, setDuesDatePreset] = useState<CustomerDuesDatePreset>("all");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const noteInputId = useId();
  const duesDateFilter = resolveCustomerDuesDateFilter(
    duesDatePreset,
    localToday,
    customFrom,
    customTo,
  );
  const enabled = Boolean(customerId);

  const summaryQuery = useQuery({
    queryKey: summaryKey(factoryId, customerId),
    queryFn: () => getCustomerSalesSummary(factoryId, customerId),
    enabled,
  });
  const candidatesQuery = useQuery({
    queryKey: [
      ...candidatesKey(factoryId, customerId),
      duesDatePreset,
      duesDateFilter.range?.fromDate ?? "",
      duesDateFilter.range?.toDate ?? "",
    ],
    queryFn: () => listCustomerOutstandingChallans(
      factoryId,
      customerId,
      duesDateFilter.range ?? undefined,
    ),
    enabled: enabled && duesDateFilter.error === "",
  });
  const historyQuery = useQuery({
    queryKey: historyKey(factoryId, customerId),
    queryFn: () => listCustomerPayments(factoryId, customerId),
    enabled,
  });
  const candidates = sortCustomerOutstandingChallans(
    candidatesQuery.data ?? [],
    duesSortOrder,
  );
  const history = historyQuery.data ?? [];
  const status = getCustomerPaymentFormStatus(form, candidates);

  function clearDraftAllocations() {
    setForm((current) => clearCustomerPaymentAllocations(current));
    setError("");
  }

  function changeDuesDatePreset(nextPreset: CustomerDuesDatePreset) {
    if (nextPreset === duesDatePreset) return;
    setDuesDatePreset(nextPreset);
    clearDraftAllocations();
  }

  function changeCustomFrom(nextFrom: string) {
    if (nextFrom === customFrom) return;
    setCustomFrom(nextFrom);
    clearDraftAllocations();
  }

  function changeCustomTo(nextTo: string) {
    if (nextTo === customTo) return;
    setCustomTo(nextTo);
    clearDraftAllocations();
  }

  function selectCustomer(nextCustomerId: string) {
    setCustomerId(nextCustomerId);
    setForm(emptyCustomerPaymentForm(localToday));
    setIsNoteOpen(false);
    setError("");
    setSuccess("");
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const input = buildCustomerPaymentInput(factoryId, customerId, form, candidates);
    if (!input) {
      setError(status.error || "Complete the payment and allocations before saving.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      const payment = await createCustomerPaymentWithMethods(input);
      onPaymentSaved(payment);
      setForm(emptyCustomerPaymentForm(localToday));
      setIsNoteOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: summaryKey(factoryId, customerId) }),
        queryClient.invalidateQueries({ queryKey: candidatesKey(factoryId, customerId) }),
        queryClient.invalidateQueries({ queryKey: historyKey(factoryId, customerId) }),
        queryClient.invalidateQueries({ queryKey: ["office-sales-register", factoryId] }),
      ]);
      setSuccess(`Payment ${formatIndianCurrency(payment.amount, MONEY_WITH_PAISE)} saved. Receipt is ready.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this customer payment.");
    } finally {
      setIsSaving(false);
    }
  }

  const queryError = summaryQuery.error || candidatesQuery.error || historyQuery.error;
  const queryErrorMessage = queryError instanceof Error
    ? queryError.message
    : "Could not load customer payment details.";

  function retryCustomerPaymentQueries() {
    void Promise.all([
      summaryQuery.refetch(),
      candidatesQuery.refetch(),
      historyQuery.refetch(),
    ]);
  }

  return (
    <section aria-labelledby="customer-payments-heading" className="text-atlas-text">
      <div className="grid gap-atlas-6 xl:grid-cols-4 xl:items-start">
        <div className="space-y-atlas-4 xl:col-span-3">
          <Card as="section" aria-labelledby="customer-payments-heading">
            <div className="grid gap-atlas-4 lg:grid-cols-3 lg:items-end">
              <div className="lg:col-span-2">
                <div>
                  <h2 id="customer-payments-heading" className="text-atlas-xl font-atlas-semibold">
                    Customer payments
                  </h2>
                  <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
                    Record one receipt and explicitly choose the Challans it pays.
                  </p>
                </div>
              </div>
              <CustomerCombobox
                customers={customers}
                selectedCustomerId={customerId}
                onSelect={selectCustomer}
              />
            </div>

            {customerId && (
              <div className="mt-atlas-4">
                {summaryQuery.isLoading && (
                  <p role="status" className="mb-atlas-2 text-atlas-xs text-atlas-text-subtle">
                    Loading customer balances...
                  </p>
                )}
                <dl className="grid overflow-hidden rounded-atlas-control border border-atlas-border sm:grid-cols-3">
                  <PaymentSummary label="Active sales" value={summaryQuery.data?.totalActiveSales} />
                  <PaymentSummary label="Paid / allocated" value={summaryQuery.data?.totalPaymentsAllocated} />
                  <PaymentSummary label={ATLAS_UI_STRINGS.payment.outstanding} value={summaryQuery.data?.totalOutstanding} emphasized />
                </dl>
              </div>
            )}
          </Card>

          {!customerId && (
            <Card surface="muted">
              <EmptyState
                title="Select a customer"
                description="Choose a customer to see outstanding Challans and payment history."
              />
            </Card>
          )}

          {customerId && queryError && (
            <Feedback role="alert" tone="danger">
              <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{queryErrorMessage}</span>
                <Button variant="secondary" onClick={retryCustomerPaymentQueries}>
                  {ATLAS_UI_STRINGS.actions.retry}
                </Button>
              </div>
            </Feedback>
          )}

          {customerId && !queryError && (
            <form onSubmit={savePayment} className="space-y-atlas-4">
              <Card as="section" aria-labelledby="payment-parameters-heading">
                <h3 id="payment-parameters-heading" className="mb-atlas-3 text-atlas-lg font-atlas-semibold">
                  Receipt parameters
                </h3>
                <div className="grid gap-atlas-3 sm:grid-cols-2 lg:grid-cols-6">
                  <FormField label={ATLAS_UI_STRINGS.payment.date}>
                    <Input type="date" required value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} />
                  </FormField>
                  <FormField label={ATLAS_UI_STRINGS.payment.amount}>
                    <Input inputMode="decimal" placeholder="0.00" required value={form.amount} onChange={(event) => setForm((current) => setPaymentAmount(current, event.target.value))} />
                  </FormField>
                  <PaymentModeMultiSelect
                    selectedModes={form.paymentModes}
                    splitAmounts={form.paymentMethodAmounts}
                    splitError={status.methodSplitError}
                    isNoteOpen={isNoteOpen}
                    hasNote={Boolean(form.note.trim())}
                    noteInputId={noteInputId}
                    disabled={isSaving}
                    onToggle={(mode) => setForm((current) => {
                      const next = toggleCustomerPaymentMode(current, mode);
                      return next.paymentModes.length < 2
                        ? clearCustomerPaymentMethodAmounts(next)
                        : next;
                    })}
                    onAmountChange={(mode, amount) => setForm((current) => (
                      setCustomerPaymentMethodAmount(current, mode, amount)
                    ))}
                    onRemoveSplit={() => setForm((current) => clearCustomerPaymentMethodAmounts(current))}
                    onToggleNote={() => setIsNoteOpen((current) => !current)}
                  />
                  {isNoteOpen && (
                    <div className="sm:col-span-2 lg:col-span-6">
                      <FormField label={ATLAS_UI_STRINGS.fields.noteOptional}>
                        <Input id={noteInputId} maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
                      </FormField>
                    </div>
                  )}
                </div>
              </Card>

              <Card as="section" aria-labelledby="outstanding-challans-heading">
                <div className="flex flex-col gap-atlas-4 border-b border-atlas-border pb-atlas-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-atlas-2">
                      <h3 id="outstanding-challans-heading" className="text-atlas-lg font-atlas-semibold">
                        Outstanding Challans
                      </h3>
                      {!candidatesQuery.isLoading && (
                        <span className="text-atlas-xs font-atlas-medium text-atlas-text-muted">
                          ({candidates.length})
                        </span>
                      )}
                    </div>
                    <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
                      Nothing is selected automatically.
                    </p>
                  </div>
                  <div className="grid gap-atlas-3 sm:grid-cols-2 lg:min-w-96" aria-label="Customer Dues date filters">
                    <FormField label="Period">
                      <Select value={duesDatePreset} onChange={(event) => changeDuesDatePreset(event.target.value as CustomerDuesDatePreset)}>
                        {duesDatePresets.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Sort">
                      <Select value={duesSortOrder} onChange={(event) => setDuesSortOrder(event.target.value as CustomerDuesSortOrder)}>
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                      </Select>
                    </FormField>
                  </div>
                </div>

                {duesDatePreset === "custom" && (
                  <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
                    <FormField label={ATLAS_UI_STRINGS.fields.fromDate}>
                      <Input type="date" value={customFrom} onChange={(event) => changeCustomFrom(event.target.value)} />
                    </FormField>
                    <FormField label={ATLAS_UI_STRINGS.fields.toDate}>
                      <Input type="date" value={customTo} onChange={(event) => changeCustomTo(event.target.value)} />
                    </FormField>
                  </div>
                )}
                {duesDateFilter.error && (
                  <div className="mt-atlas-3">
                    <Feedback role="alert" tone="danger">{duesDateFilter.error}</Feedback>
                  </div>
                )}
                {duesDateFilter.range && (
                  <p className="mt-atlas-3 text-atlas-xs text-atlas-text-subtle">
                    Showing {formatDateOnly(duesDateFilter.range.fromDate)} to {formatDateOnly(duesDateFilter.range.toDate)}, inclusive.
                  </p>
                )}

                <div className="mt-atlas-2 overflow-hidden rounded-atlas-control border border-atlas-border">
                  {candidatesQuery.isLoading && (
                    <Feedback role="status" tone="neutral">Loading outstanding Challans...</Feedback>
                  )}
                  {!candidatesQuery.isLoading && !duesDateFilter.error && candidates.length === 0 && (
                    <EmptyState
                      title={duesDatePreset === "all" ? "No outstanding Challans" : "No Challans in this period"}
                      description={duesDatePreset === "all" ? "This customer has no active Challan with an outstanding balance." : "No outstanding Challans in this date range."}
                    />
                  )}
                  {candidates.length > 0 && (
                    <ul className="divide-y divide-atlas-border">
                      {candidates.map((challan) => {
                        const selected = Object.prototype.hasOwnProperty.call(form.allocations, challan.challanId);
                        return (
                          <li key={challan.challanId}>
                            <div
                              className={`flex cursor-pointer items-start gap-atlas-3 border-l-4 p-atlas-4 transition-colors ${selected ? "border-l-atlas-primary bg-atlas-primary-surface" : "border-l-transparent bg-atlas-surface hover:bg-atlas-surface-hover"}`}
                              onClick={(event) => {
                                if (isInteractivePaymentRowTarget(event.target)) return;
                                setForm((current) => {
                                  const isCurrentlySelected = Object.prototype.hasOwnProperty.call(
                                    current.allocations,
                                    challan.challanId,
                                  );
                                  return togglePaymentAllocation(
                                    current,
                                    challan,
                                    !isCurrentlySelected,
                                  );
                                });
                              }}
                            >
                              <label className="flex min-h-atlas-12 cursor-pointer items-center">
                                <Checkbox
                                  aria-label={`Allocate payment to ${formatChallanLabel(challan.challanNumber)}`}
                                  checked={selected}
                                  onChange={(event) => setForm((current) => togglePaymentAllocation(current, challan, event.target.checked))}
                                />
                              </label>
                              <div className="grid min-w-0 flex-1 gap-atlas-3 lg:grid-cols-12 lg:items-end">
                                <div className="lg:col-span-6">
                                  <p className="text-atlas-xs text-atlas-text-subtle">{formatDateOnly(challan.challanDate)}</p>
                                  {challan.challanNumber && <p className="mt-atlas-1 font-atlas-semibold">Challan No. {challan.challanNumber}</p>}
                                  {challan.brickLines.length > 0 ? (
                                    <ul className="mt-atlas-2 space-y-atlas-1 text-atlas-sm">
                                      {challan.brickLines.map((line) => (
                                        <li key={line.itemId} className="flex w-fit max-w-full items-baseline gap-atlas-2">
                                          <span className="truncate text-atlas-text-muted">{line.particularsSnapshot}</span>
                                          <span aria-hidden="true" className="text-atlas-text-subtle">—</span>
                                          <span className="shrink-0 font-atlas-semibold tabular-nums">{formatIndianNumber(line.quantity)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">No brick goods on this Challan.</p>}
                                </div>
                                <div className="text-right lg:col-span-3">
                                  <p className="whitespace-nowrap font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(challan.outstandingAmount, MONEY_WITH_PAISE)} due</p>
                                  {challan.totalPaid > 0 && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Original {formatIndianCurrency(challan.saleTotal, MONEY_WITH_PAISE)} · Paid {formatIndianCurrency(challan.totalPaid, MONEY_WITH_PAISE)}</p>}
                                </div>
                                <div className="lg:col-span-3">
                                  <FormField label="Allocation">
                                    <Input
                                      inputMode="decimal"
                                      aria-label={`Allocation for ${formatChallanLabel(challan.challanNumber)}`}
                                      disabled={!selected}
                                      value={form.allocations[challan.challanId] ?? ""}
                                      onChange={(event) => setForm((current) => setPaymentAllocation(current, challan.challanId, event.target.value))}
                                    />
                                  </FormField>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {!status.canSubmit && form.amount && !status.methodSplitError && <div className="mt-atlas-3"><Feedback tone="warning">{status.error}</Feedback></div>}
                {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
                {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}
                <PaymentReconciliation status={status} isSaving={isSaving} />
              </Card>
            </form>
          )}
        </div>

        <aside className="xl:sticky xl:top-atlas-8">
          <Card as="section" aria-labelledby="customer-payment-history-heading">
            <div className="flex flex-wrap items-start justify-between gap-atlas-3 border-b border-atlas-border pb-atlas-4">
              <h3 id="customer-payment-history-heading" className="text-atlas-lg font-atlas-semibold">{ATLAS_UI_STRINGS.payment.history}</h3>
              <Button variant="ghost" onClick={onViewAll}>View all payments</Button>
            </div>
            {!customerId && <EmptyState title="No customer selected" description="Select a customer to review their saved receipts." />}
            {customerId && queryError && <div className="pt-atlas-4"><Feedback role="alert" tone="danger">{queryErrorMessage}</Feedback></div>}
            {customerId && !queryError && historyQuery.isLoading && <div className="pt-atlas-4"><Feedback role="status" tone="neutral">{ATLAS_UI_STRINGS.payment.loadingHistory}</Feedback></div>}
            {customerId && !queryError && !historyQuery.isLoading && history.length === 0 && <EmptyState title="No payments recorded" description="Saved customer payments will appear here." />}
            {customerId && !queryError && history.length > 0 && (
              <ul className="divide-y divide-atlas-border xl:max-h-screen xl:overflow-y-auto">
                {history.map((payment) => (
                  <li key={payment.id} className="py-atlas-4 first:pt-atlas-4 last:pb-atlas-0">
                    <div className="flex flex-wrap items-start justify-between gap-atlas-2">
                      <div>
                        <p className="text-atlas-lg font-atlas-semibold tabular-nums">{formatIndianCurrency(payment.amount, MONEY_WITH_PAISE)}</p>
                        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(payment.paymentDate)} · {formatCustomerPaymentMethods(payment.methods, payment.paymentMode)}</p>
                      </div>
                      <Link
                        href={`/office/payments/${payment.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-atlas-12 items-center rounded-atlas-button px-atlas-2 py-atlas-2 text-atlas-sm font-atlas-semibold text-atlas-primary hover:bg-atlas-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus"
                      >
                        Open receipt ↗
                      </Link>
                    </div>
                    {payment.note && <p className="mt-atlas-2 text-atlas-xs text-atlas-text-muted">{payment.note}</p>}
                    <ul className="mt-atlas-3 space-y-atlas-2">
                      {payment.allocations.map((allocation) => (
                        <li key={allocation.id} className="flex flex-col gap-atlas-1 rounded-atlas-control bg-atlas-surface-muted px-atlas-3 py-atlas-2 text-atlas-xs sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-atlas-text-muted">{formatChallanLabel(allocation.challanNumber)} · {formatDateOnly(allocation.challanDate)}</span>
                          <span className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(allocation.allocatedAmount, MONEY_WITH_PAISE)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </section>
  );
}

function isInteractivePaymentRowTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(
    "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [contenteditable='true']",
  ) !== null;
}

function PaymentModeMultiSelect({
  selectedModes,
  splitAmounts,
  splitError,
  isNoteOpen,
  hasNote,
  noteInputId,
  disabled,
  onToggle,
  onAmountChange,
  onRemoveSplit,
  onToggleNote,
}: Readonly<{
  selectedModes: readonly NewCustomerPaymentMode[];
  splitAmounts: Readonly<Partial<Record<NewCustomerPaymentMode, string>>>;
  splitError: string;
  isNoteOpen: boolean;
  hasNote: boolean;
  noteInputId: string;
  disabled: boolean;
  onToggle: (mode: NewCustomerPaymentMode) => void;
  onAmountChange: (mode: NewCustomerPaymentMode, amount: string) => void;
  onRemoveSplit: () => void;
  onToggleNote: () => void;
}>) {
  const splitErrorId = useId();
  const [isSplitMode, setIsSplitMode] = useState(false);

  useEffect(() => {
    if (selectedModes.length < 2) setIsSplitMode(false);
  }, [selectedModes.length]);

  function toggleSplitMode() {
    if (isSplitMode) {
      onRemoveSplit();
      setIsSplitMode(false);
      return;
    }
    setIsSplitMode(true);
  }

  return (
    <div className="min-w-0 sm:col-span-2 lg:col-span-4">
      <div className="flex flex-wrap items-end gap-atlas-1">
        <fieldset
          aria-required="true"
          aria-describedby={splitError ? splitErrorId : undefined}
          className="min-w-0 flex-1"
        >
          <legend className="mb-atlas-1 text-atlas-sm font-atlas-medium text-atlas-text-muted">
            {ATLAS_UI_STRINGS.payment.modes}
          </legend>
          <div className="flex flex-wrap items-center gap-atlas-1">
            <div className="flex flex-wrap gap-atlas-1">
              {NEW_CUSTOMER_PAYMENT_MODES.map((mode) => {
                const selected = selectedModes.includes(mode);
                return (
                  <Button
                    key={mode}
                    variant={selected ? "primary" : "secondary"}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onToggle(mode)}
                  >
                    {formatCustomerPaymentMode(mode)}
                  </Button>
                );
              })}
            </div>
            {selectedModes.length >= 2 && (
              <Button
                variant="ghost"
                aria-expanded={isSplitMode}
                disabled={disabled}
                onClick={toggleSplitMode}
              >
                {isSplitMode ? ATLAS_UI_STRINGS.payment.removeSplit : ATLAS_UI_STRINGS.payment.addSplit}
              </Button>
            )}
          </div>
        </fieldset>
        <Button
          variant={isNoteOpen || hasNote ? "secondary" : "ghost"}
          aria-expanded={isNoteOpen}
          aria-controls={noteInputId}
          disabled={disabled}
          onClick={onToggleNote}
        >
          {ATLAS_UI_STRINGS.fields.note}
        </Button>
      </div>
      {isSplitMode && selectedModes.length >= 2 && (
        <div className="mt-atlas-2 rounded-atlas-control border border-atlas-border bg-atlas-surface-muted p-atlas-2">
          <div className="grid gap-atlas-2 sm:grid-cols-2 lg:grid-cols-3">
            {selectedModes.map((mode) => (
              <label key={mode} className="flex min-w-0 items-center gap-atlas-2 text-atlas-sm font-atlas-medium text-atlas-text-muted">
                <span className="shrink-0">{formatCustomerPaymentMode(mode)}</span>
                <span aria-hidden="true" className="shrink-0 text-atlas-text-subtle">₹</span>
                <span className="min-w-0 flex-1">
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={splitAmounts[mode] ?? ""}
                    aria-label={`${formatCustomerPaymentMode(mode)} split amount`}
                    aria-invalid={Boolean(splitError)}
                    disabled={disabled}
                    onChange={(event) => onAmountChange(mode, event.target.value)}
                  />
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {splitError && (
        <p id={splitErrorId} role="alert" className="mt-atlas-2 text-atlas-sm font-atlas-medium text-atlas-danger-text">
          {splitError}
        </p>
      )}
    </div>
  );
}

function PaymentSummary({ emphasized = false, label, value }: Readonly<{ emphasized?: boolean; label: string; value: number | undefined }>) {
  return (
    <div className={emphasized ? "bg-atlas-primary-surface px-atlas-4 py-atlas-3" : "border-b border-atlas-border px-atlas-4 py-atlas-3 sm:border-b-0 sm:border-r"}>
      <dt className="text-atlas-xs font-atlas-medium uppercase tracking-atlas-wide text-atlas-text-muted">{label}</dt>
      <dd className={emphasized ? "mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-primary" : "mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text"}>
        {value === undefined ? "—" : formatIndianCurrency(value, MONEY_WITH_PAISE)}
      </dd>
    </div>
  );
}

function CustomerCombobox({
  customers,
  selectedCustomerId,
  onSelect,
}: Readonly<{
  customers: readonly Customer[];
  selectedCustomerId: string;
  onSelect: (customerId: string) => void;
}>) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const options = filterCustomersForPaymentSelection(customers, searchText);
  const highlightedCustomer = options[highlightedIndex];

  useEffect(() => {
    setSearchText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSearchText("");
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  function openList() {
    const selectedIndex = customers.findIndex((customer) => customer.id === selectedCustomerId);
    setSearchText("");
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : customers.length > 0 ? 0 : -1);
    setIsOpen(true);
  }

  function selectCustomer(customerId: string) {
    onSelect(customerId);
    setSearchText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
      setSearchText("");
      setIsOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setHighlightedIndex((current) => options.length === 0
        ? -1
        : Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setHighlightedIndex((current) => options.length === 0
        ? -1
        : current <= 0 ? options.length - 1 : current - 1);
      return;
    }
    if (event.key === "Enter" && isOpen && highlightedCustomer) {
      event.preventDefault();
      selectCustomer(highlightedCustomer.id);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      data-customer-combobox
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setSearchText("");
        setIsOpen(false);
        setHighlightedIndex(-1);
      }}
    >
      <label htmlFor={inputId} className="mb-atlas-1 block text-atlas-sm font-atlas-medium text-atlas-text-muted">
        Customer
      </label>
      <Input
        id={inputId}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={highlightedCustomer ? `${listboxId}-${highlightedCustomer.id}` : undefined}
        autoComplete="off"
        placeholder="Search customer by name or mobile..."
        value={isOpen ? searchText : selectedCustomer?.name ?? ""}
        onFocus={openList}
        onClick={() => {
          if (!isOpen) openList();
        }}
        onChange={(event) => {
          setSearchText(event.target.value);
          setHighlightedIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Customers"
          className="absolute z-30 mt-atlas-1 max-h-64 w-full min-w-0 overflow-y-auto rounded-atlas-control border border-atlas-border-strong bg-atlas-surface py-atlas-1 text-atlas-sm shadow-atlas-medium"
        >
          {options.length === 0 ? (
            <p className="px-atlas-3 py-atlas-3 text-atlas-text-muted">No customer matches.</p>
          ) : options.map((customer, index) => {
            // ui-exception: listbox options belong to the specialized customer combobox
            return <button className={`flex min-h-atlas-12 w-full min-w-0 items-center justify-between gap-atlas-3 px-atlas-3 py-atlas-2 text-left focus-visible:outline-none focus-visible:ring-atlas-focus ${index === highlightedIndex ? "bg-atlas-primary-surface text-atlas-primary" : "text-atlas-text hover:bg-atlas-surface-hover"}`}
                key={customer.id}
                id={`${listboxId}-${customer.id}`}
                type="button"
                role="option"
                aria-selected={customer.id === selectedCustomerId}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectCustomer(customer.id)}
              >
                <span className="min-w-0 truncate font-atlas-semibold">{customer.name}</span>
                {customer.mobile && <span className="shrink-0 text-atlas-xs tabular-nums text-atlas-text-muted">{customer.mobile}</span>}
              </button>;
          })}
        </div>
      )}
    </div>
  );
}

function MoneyTotal({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div>
      <dt className="text-atlas-xs text-atlas-text-muted">{label}</dt>
      <dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(value, MONEY_WITH_PAISE)}</dd>
    </div>
  );
}

function PaymentReconciliation({
  status,
  isSaving,
}: Readonly<{
  status: CustomerPaymentFormStatus;
  isSaving: boolean;
}>) {
  return (
    <section
      aria-label="Payment reconciliation"
      className="sticky bottom-atlas-0 z-20 mt-atlas-4 flex flex-col gap-atlas-3 border-t border-atlas-border-strong bg-atlas-surface py-atlas-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <dl className="grid grid-cols-3 gap-atlas-3 text-atlas-sm">
        <MoneyTotal label="Payment" value={status.paymentAmount} />
        <MoneyTotal label="Allocated" value={status.allocatedAmount} />
        <MoneyTotal label="Remaining" value={status.remainingAmount} />
      </dl>
      <div className="grid sm:block">
        <Button type="submit" disabled={!status.canSubmit} loading={isSaving} loadingLabel="Saving payment...">Save payment</Button>
      </div>
    </section>
  );
}
