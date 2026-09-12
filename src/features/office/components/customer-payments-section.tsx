"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildCustomerPaymentInput,
  clearCustomerPaymentAllocations,
  emptyCustomerPaymentForm,
  getCustomerPaymentFormStatus,
  resolveCustomerDuesDateFilter,
  sortCustomerOutstandingChallans,
  togglePaymentAllocation,
  fillOutstandingAllocation,
  type CustomerDuesDatePreset,
  type CustomerDuesSortOrder,
  type CustomerPaymentForm,
} from "@/features/office/customer-payment-office-model";
import { formatChallanDate, formatSalesMoney } from "@/features/office/sales-office-model";
import {
  createCustomerPayment,
  getCustomerSalesSummary,
  listCustomerOutstandingChallans,
  listCustomerPayments,
} from "@/features/sales/services/customer-payment-service";
import {
  formatChallanLabel,
  formatCustomerPaymentMode,
  NEW_CUSTOMER_PAYMENT_MODES,
  type Customer,
  type CustomerPayment,
} from "@/features/sales/types";
import { getLocalDate } from "@/lib/local-date";

const summaryKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-summary", factoryId, customerId] as const;
const candidatesKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-candidates", factoryId, customerId] as const;
const historyKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-history", factoryId, customerId] as const;
const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100";
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
}: Readonly<{
  factoryId: string;
  customers: readonly Customer[];
  onPaymentSaved: (payment: CustomerPayment) => void;
}>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [customerId, setCustomerId] = useState("");
  const [form, setForm] = useState<CustomerPaymentForm>(() => emptyCustomerPaymentForm(localToday));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [duesSortOrder, setDuesSortOrder] = useState<CustomerDuesSortOrder>("newest");
  const [duesDatePreset, setDuesDatePreset] = useState<CustomerDuesDatePreset>("all");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
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
      const payment = await createCustomerPayment(input);
      onPaymentSaved(payment);
      setForm(emptyCustomerPaymentForm(localToday));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: summaryKey(factoryId, customerId) }),
        queryClient.invalidateQueries({ queryKey: candidatesKey(factoryId, customerId) }),
        queryClient.invalidateQueries({ queryKey: historyKey(factoryId, customerId) }),
        queryClient.invalidateQueries({ queryKey: ["office-sales-register", factoryId] }),
      ]);
      setSuccess(`Payment ${formatSalesMoney(payment.amount)} saved. Receipt is ready.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this customer payment.");
    } finally {
      setIsSaving(false);
    }
  }

  const queryError = summaryQuery.error || candidatesQuery.error || historyQuery.error;

  return (
    <section aria-labelledby="customer-payments-heading" className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <h3 id="customer-payments-heading" className="text-xl font-bold">Customer payments</h3>
        <p className="mt-1 text-sm text-slate-600">Record one receipt and explicitly choose the Challans it pays.</p>
        <label className="mt-4 block max-w-xl text-xs font-medium text-slate-600">
          Customer
          <select value={customerId} onChange={(event) => selectCustomer(event.target.value)} className={inputClass}>
            <option value="">Select customer</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
      </div>

      {!customerId && <p className="px-5 py-8 text-sm text-slate-500">Select a customer to see outstanding Challans and payment history.</p>}
      {customerId && queryError && <p role="alert" className="px-5 py-6 text-sm font-semibold text-red-700">{queryError instanceof Error ? queryError.message : "Could not load customer payment details."}</p>}
      {customerId && !queryError && <>
        <div className="grid grid-cols-1 border-b border-slate-200 bg-slate-50 sm:grid-cols-3">
          <PaymentSummary label="Active sales" value={summaryQuery.data?.totalActiveSales} />
          <PaymentSummary label="Paid / allocated" value={summaryQuery.data?.totalPaymentsAllocated} />
          <PaymentSummary label="Outstanding" value={summaryQuery.data?.totalOutstanding} />
        </div>

        <form onSubmit={savePayment} className="border-b border-slate-200 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">Payment date<input type="date" required value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} className={inputClass} /></label>
            <label className="text-xs font-medium text-slate-600">Payment amount<input inputMode="decimal" placeholder="0.00" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={inputClass} /></label>
            <label className="text-xs font-medium text-slate-600">Payment mode<select required value={form.paymentMode} onChange={(event) => setForm({ ...form, paymentMode: event.target.value })} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-600">Note (optional)<input maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className={inputClass} /></label>
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold">Allocate to outstanding Challans</h4>
                  <p className="mt-1 text-xs text-slate-500">Nothing is selected automatically.</p>
                </div>
                <label className="text-xs font-medium text-slate-600">Sort
                  <select value={duesSortOrder} onChange={(event) => setDuesSortOrder(event.target.value as CustomerDuesSortOrder)} className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Customer Dues date filters">
                <span className="mr-1 text-xs font-medium text-slate-600">Date</span>
                {duesDatePresets.map((option) => <button key={option.value} type="button" aria-pressed={duesDatePreset === option.value} onClick={() => changeDuesDatePreset(option.value)} className={`h-8 rounded-lg border px-3 text-xs font-semibold ${duesDatePreset === option.value ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{option.label}</button>)}
              </div>
              {duesDatePreset === "custom" && <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">From<input type="date" value={customFrom} onChange={(event) => changeCustomFrom(event.target.value)} className={inputClass} /></label>
                <label className="text-xs font-medium text-slate-600">To<input type="date" value={customTo} onChange={(event) => changeCustomTo(event.target.value)} className={inputClass} /></label>
              </div>}
              {duesDateFilter.error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{duesDateFilter.error}</p>}
              {duesDateFilter.range && <p className="mt-3 text-xs text-slate-500">Showing {formatChallanDate(duesDateFilter.range.fromDate)} to {formatChallanDate(duesDateFilter.range.toDate)}, inclusive.</p>}
            </div>
            {candidatesQuery.isLoading && <p className="px-4 py-6 text-sm text-slate-500">Loading outstanding Challans...</p>}
            {!candidatesQuery.isLoading && !duesDateFilter.error && candidates.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">{duesDatePreset === "all" ? "This customer has no active Challan with an outstanding balance." : "No outstanding Challans in this date range."}</p>}
            {candidates.length > 0 && <ul className="divide-y divide-slate-100">
              {candidates.map((challan) => {
                const selected = Object.prototype.hasOwnProperty.call(form.allocations, challan.challanId);
                return <li key={challan.challanId} className="grid gap-3 px-4 py-4 lg:grid-cols-[2rem_minmax(0,1fr)_minmax(9rem,auto)_10rem_7rem] lg:items-center">
                  <input type="checkbox" aria-label={`Allocate payment to ${formatChallanLabel(challan.challanNumber)}`} checked={selected} onChange={(event) => setForm(togglePaymentAllocation(form, challan.challanId, event.target.checked))} className="h-4 w-4" />
                  <div>
                    <p className="text-xs text-slate-500">{formatChallanDate(challan.challanDate)}</p>
                    {challan.challanNumber && <p className="mt-1 font-bold">Challan No. {challan.challanNumber}</p>}
                    {challan.brickLines.length > 0
                      ? <ul className="mt-2 space-y-1 text-sm">{challan.brickLines.map((line) => <li key={line.itemId} className="grid w-fit max-w-full grid-cols-[minmax(0,auto)_auto_auto] items-baseline gap-x-2"><span className="text-slate-700">{line.particularsSnapshot}</span><span aria-hidden="true" className="text-slate-400">—</span><span className="font-semibold tabular-nums">{line.quantity.toLocaleString("en-IN")}</span></li>)}</ul>
                      : <p className="mt-2 text-xs text-slate-500">No brick goods on this Challan.</p>}
                  </div>
                  <div className="lg:text-right">
                    <p className="font-bold tabular-nums text-slate-950">{formatSalesMoney(challan.outstandingAmount)} due</p>
                    {challan.totalPaid > 0 && <p className="mt-1 text-xs text-slate-500">Original {formatSalesMoney(challan.saleTotal)} · Paid {formatSalesMoney(challan.totalPaid)}</p>}
                  </div>
                  <label className="text-xs font-medium text-slate-600">Allocation<input inputMode="decimal" aria-label={`Allocation for ${formatChallanLabel(challan.challanNumber)}`} disabled={!selected} value={form.allocations[challan.challanId] ?? ""} onChange={(event) => setForm({ ...form, allocations: { ...form.allocations, [challan.challanId]: event.target.value } })} className={inputClass} /></label>
                  <button type="button" onClick={() => setForm(fillOutstandingAllocation(form, challan))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold">Use outstanding</button>
                </li>;
              })}
            </ul>}
          </div>

          <div className="mt-4 flex flex-col gap-4 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-end sm:justify-between">
            <dl className="grid grid-cols-3 gap-5 text-sm">
              <MoneyTotal label="Payment" value={status.paymentAmount} />
              <MoneyTotal label="Allocated" value={status.allocatedAmount} />
              <MoneyTotal label="Remaining" value={status.remainingAmount} />
            </dl>
            <button type="submit" disabled={!status.canSubmit || isSaving} className="h-10 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? "Saving payment..." : "Save payment"}</button>
          </div>
          {!status.canSubmit && form.amount && <p className="mt-3 text-xs font-medium text-amber-800">{status.error}</p>}
          {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
          {success && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{success}</p>}
        </form>

        <section aria-labelledby="customer-payment-history-heading" className="p-5 sm:p-6">
          <h4 id="customer-payment-history-heading" className="font-bold">Payment history</h4>
          <p className="mt-1 text-xs text-slate-500">Saved receipts and allocations are permanent.</p>
          {historyQuery.isLoading && <p className="py-6 text-sm text-slate-500">Loading payment history...</p>}
          {!historyQuery.isLoading && history.length === 0 && <p className="py-6 text-sm text-slate-500">No payments recorded for this customer.</p>}
          {history.length > 0 && <ul className="mt-4 space-y-3">
            {history.map((payment) => <li key={payment.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-bold">{formatSalesMoney(payment.amount)}</p><p className="mt-1 text-xs text-slate-500">{formatChallanDate(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)}{payment.note ? ` · ${payment.note}` : ""}</p></div>
                <Link href={`/office/payments/${payment.id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cyan-800 hover:underline">Open receipt</Link>
              </div>
              <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {payment.allocations.map((allocation) => <li key={allocation.id} className="flex justify-between gap-4 py-2"><span>{formatChallanLabel(allocation.challanNumber)}</span><span className="font-semibold tabular-nums">{formatSalesMoney(allocation.allocatedAmount)}</span></li>)}
              </ul>
            </li>)}
          </ul>}
        </section>
      </>}
    </section>
  );
}

function PaymentSummary({ label, value }: Readonly<{ label: string; value: number | undefined }>) {
  return <div className="border-r border-slate-200 px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value === undefined ? "—" : formatSalesMoney(value)}</p></div>;
}

function MoneyTotal({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-bold tabular-nums">{formatSalesMoney(value)}</dd></div>;
}
