"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildCashBookInitializationInput,
  buildCashBookManualEntryInput,
  cashBookOfficeErrorMessage,
  emptyCashBookInitializationForm,
  emptyCashBookManualEntryForm,
  getCashBookNavigationDate,
  getCashBookReceiptHref,
  isCashBookInitializationRequired,
  type CashBookInitializationForm,
  type CashBookManualEntryForm,
} from "@/features/office/cash-book-office-model";
import {
  createCashBookManualEntry,
  getCashBookDay,
  initializeCashBook,
  voidCashBookManualEntry,
} from "@/features/cash-book/services/cash-book-service";
import type {
  CashBookDay,
  CashBookDirection,
  CashBookMovement,
} from "@/features/cash-book/types";
import { formatChallanDate, formatSalesMoney } from "@/features/office/sales-office-model";
import {
  formatCustomerPaymentMode,
  NEW_CUSTOMER_PAYMENT_MODES,
} from "@/features/sales/types";
import { getLocalDate } from "@/lib/local-date";

const cashBookDayKey = (factoryId: string, businessDate: string) =>
  ["office-cash-book-day", factoryId, businessDate] as const;
const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100";
const secondaryButton = "h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

export function CashBookOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [selectedDate, setSelectedDate] = useState(localToday);
  const [manualDirection, setManualDirection] = useState<CashBookDirection | null>(null);
  const [manualRequestId, setManualRequestId] = useState("");
  const [manualForm, setManualForm] = useState<CashBookManualEntryForm>(() =>
    emptyCashBookManualEntryForm(localToday));
  const [isSaving, setIsSaving] = useState(false);
  const [voidingEntryId, setVoidingEntryId] = useState("");
  const [confirmingVoidId, setConfirmingVoidId] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");

  const dayQuery = useQuery({
    queryKey: cashBookDayKey(factoryId, selectedDate),
    queryFn: () => getCashBookDay(factoryId, selectedDate),
    retry: false,
  });

  function selectDate(date: string) {
    setSelectedDate(date);
    setManualDirection(null);
    setConfirmingVoidId("");
    setActionError("");
    setSuccess("");
  }

  function navigate(action: "previous" | "today" | "next") {
    const date = getCashBookNavigationDate(action, selectedDate, localToday);
    if (date) selectDate(date);
  }

  function openManualEntry(direction: CashBookDirection) {
    setManualDirection(direction);
    setManualRequestId(globalThis.crypto.randomUUID());
    setManualForm(emptyCashBookManualEntryForm(selectedDate));
    setConfirmingVoidId("");
    setActionError("");
    setSuccess("");
  }

  async function saveManualEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || !manualDirection) return;
    const input = buildCashBookManualEntryInput(
      factoryId, manualRequestId, manualDirection, manualForm,
    );
    if (!input) {
      setActionError("Enter a valid date, positive amount, payment mode, and details.");
      return;
    }

    setIsSaving(true);
    setActionError("");
    setSuccess("");
    try {
      await createCashBookManualEntry(input);
      setSelectedDate(input.businessDate);
      setManualDirection(null);
      setManualRequestId("");
      setSuccess(`${input.direction === "in" ? "Money In" : "Money Out"} saved.`);
      await queryClient.invalidateQueries({
        queryKey: ["office-cash-book-day", factoryId],
      });
    } catch (error) {
      setActionError(cashBookOfficeErrorMessage(error, "Could not save this Cash Book entry."));
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmVoid(entry: CashBookMovement) {
    if (voidingEntryId) return;
    setVoidingEntryId(entry.sourceId);
    setActionError("");
    setSuccess("");
    try {
      await voidCashBookManualEntry(factoryId, entry.sourceId);
      setConfirmingVoidId("");
      setSuccess("Entry voided. Its original details remain in Cash Book history.");
      await queryClient.invalidateQueries({
        queryKey: ["office-cash-book-day", factoryId],
      });
    } catch (error) {
      setActionError(cashBookOfficeErrorMessage(error, "Could not void this Cash Book entry."));
    } finally {
      setVoidingEntryId("");
    }
  }

  const initializationRequired = isCashBookInitializationRequired(dayQuery.error);

  return (
    <section aria-labelledby="cash-book-heading" className="mt-10 border-t-4 border-emerald-300 pt-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-emerald-800">Cash Book</p>
        <h2 id="cash-book-heading" className="mt-1 text-2xl font-bold">Daily money in and money out</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Customer receipts, supplier payments, and Vehicle wage payments appear automatically. Record only other direct money movements here.
        </p>
      </div>

      {dayQuery.isLoading && <CashBookMessage>Loading Cash Book...</CashBookMessage>}
      {initializationRequired && <CashBookInitializationSetup
        factoryId={factoryId}
        localToday={localToday}
        onInitialized={(startDate) => {
          setSelectedDate(startDate);
          void queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] });
        }}
      />}
      {dayQuery.error && !initializationRequired && <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p role="alert" className="text-sm font-semibold text-red-800">
          {cashBookOfficeErrorMessage(dayQuery.error, "Could not load Cash Book.")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void dayQuery.refetch()} className={secondaryButton}>Try again</button>
          <button type="button" onClick={() => navigate("today")} className={secondaryButton}>Go to today</button>
          <label className="text-xs font-medium text-slate-600">
            <span className="sr-only">Choose another Cash Book date</span>
            <input type="date" value={selectedDate} onChange={(event) => {
              if (event.target.value) selectDate(event.target.value);
            }} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950" />
          </label>
        </div>
      </div>}

      {dayQuery.data && <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-bold">{formatChallanDate(selectedDate)}</h3>
              <p className="mt-1 text-xs text-slate-500">Opening + Money In − Money Out = Closing</p>
            </div>
            <div className="flex flex-wrap items-center gap-2" aria-label="Cash Book date navigation">
              <button type="button" onClick={() => navigate("previous")} className={secondaryButton}>← Previous day</button>
              <button type="button" onClick={() => navigate("today")} className={secondaryButton}>Today</button>
              <button type="button" onClick={() => navigate("next")} className={secondaryButton}>Next day →</button>
              <label className="text-xs font-medium text-slate-600">
                <span className="sr-only">Cash Book business date</span>
                <input type="date" value={selectedDate} onChange={(event) => {
                  if (event.target.value) selectDate(event.target.value);
                }} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950" />
              </label>
            </div>
          </div>
        </div>

        <CashBookSummary day={dayQuery.data} />

        <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openManualEntry("in")} className="h-9 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white">+ Add Money In</button>
            <button type="button" onClick={() => openManualEntry("out")} className="h-9 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white">+ Add Money Out</button>
          </div>
          {manualDirection && <ManualCashBookEntryForm
            direction={manualDirection}
            form={manualForm}
            isSaving={isSaving}
            onChange={(next) => { setManualForm(next); setActionError(""); setSuccess(""); }}
            onSubmit={saveManualEntry}
            onCancel={() => { setManualDirection(null); setManualRequestId(""); setActionError(""); }}
          />}
          {actionError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{actionError}</p>}
          {success && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{success}</p>}
        </div>

        <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
          <CashBookColumn
            direction="in"
            entries={dayQuery.data.moneyIn}
            confirmingVoidId={confirmingVoidId}
            voidingEntryId={voidingEntryId}
            onAskVoid={(entryId) => { setConfirmingVoidId(entryId); setActionError(""); setSuccess(""); }}
            onCancelVoid={() => setConfirmingVoidId("")}
            onConfirmVoid={(entry) => void confirmVoid(entry)}
          />
          <CashBookColumn
            direction="out"
            entries={dayQuery.data.moneyOut}
            confirmingVoidId={confirmingVoidId}
            voidingEntryId={voidingEntryId}
            onAskVoid={(entryId) => { setConfirmingVoidId(entryId); setActionError(""); setSuccess(""); }}
            onCancelVoid={() => setConfirmingVoidId("")}
            onConfirmVoid={(entry) => void confirmVoid(entry)}
          />
        </div>
      </div>}
    </section>
  );
}

function CashBookInitializationSetup({ factoryId, localToday, onInitialized }: Readonly<{
  factoryId: string;
  localToday: string;
  onInitialized: (startDate: string) => void;
}>) {
  const [form, setForm] = useState<CashBookInitializationForm>(() =>
    emptyCashBookInitializationForm(localToday));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const input = buildCashBookInitializationInput(factoryId, form);
    if (!input) {
      setError("Enter a valid start date and opening balance with at most two decimal places.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await initializeCashBook(input);
      onInitialized(saved.startDate);
    } catch (failure) {
      setError(cashBookOfficeErrorMessage(failure, "Could not initialize Cash Book."));
    } finally {
      setIsSaving(false);
    }
  }

  return <form onSubmit={submit} className="max-w-xl rounded-xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
    <h3 className="text-xl font-bold">Start Cash Book</h3>
    <p className="mt-2 text-sm text-slate-600">
      Opening balance is the amount the factory already has when beginning Atlas Cash Book. This starting point becomes permanent.
    </p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Cash Book start date<input type="date" required value={form.startDate} onChange={(event) => { setForm({ ...form, startDate: event.target.value }); setError(""); }} disabled={isSaving} className={inputClass} /></label>
      <label className="text-sm font-medium text-slate-700">Opening balance<input inputMode="decimal" required placeholder="0.00" value={form.openingBalance} onChange={(event) => { setForm({ ...form, openingBalance: event.target.value }); setError(""); }} disabled={isSaving} className={inputClass} /></label>
    </div>
    {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
    <button disabled={isSaving} className="mt-5 h-10 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? "Starting..." : "Start Cash Book"}</button>
  </form>;
}

function CashBookSummary({ day }: Readonly<{ day: CashBookDay }>) {
  return <dl className="grid grid-cols-2 border-b border-slate-200 sm:grid-cols-4">
    <CashBookSummaryValue label="Opening Balance" value={day.summary.openingBalance} />
    <CashBookSummaryValue label="Money In" value={day.summary.totalMoneyIn} tone="in" />
    <CashBookSummaryValue label="Money Out" value={day.summary.totalMoneyOut} tone="out" />
    <CashBookSummaryValue label="Closing Balance" value={day.summary.closingBalance} emphasize />
  </dl>;
}

function CashBookSummaryValue({ label, value, tone, emphasize = false }: Readonly<{
  label: string;
  value: number;
  tone?: CashBookDirection;
  emphasize?: boolean;
}>) {
  const color = tone === "in" ? "text-emerald-700" : tone === "out" ? "text-red-700" : "text-slate-950";
  return <div className={`border-r border-t border-slate-200 px-4 py-4 first:border-t-0 sm:border-t-0 ${emphasize ? "bg-slate-50" : "bg-white"}`}>
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`mt-1 tabular-nums ${emphasize ? "text-xl font-extrabold" : "text-lg font-bold"} ${color}`}>{formatSalesMoney(value)}</dd>
  </div>;
}

function ManualCashBookEntryForm({ direction, form, isSaving, onChange, onSubmit, onCancel }: Readonly<{
  direction: CashBookDirection;
  form: CashBookManualEntryForm;
  isSaving: boolean;
  onChange: (form: CashBookManualEntryForm) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}>) {
  const title = direction === "in" ? "Add Money In" : "Add Money Out";
  return <form onSubmit={onSubmit} className={`mt-4 rounded-lg border p-4 ${direction === "in" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
    <h4 className="font-bold">{title}</h4>
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <label className="text-xs font-medium text-slate-700">Date<input type="date" required value={form.businessDate} onChange={(event) => onChange({ ...form, businessDate: event.target.value })} disabled={isSaving} className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-700">Amount<input inputMode="decimal" required placeholder="0.00" value={form.amount} onChange={(event) => onChange({ ...form, amount: event.target.value })} disabled={isSaving} className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-700">Payment mode<select required value={form.paymentMode} onChange={(event) => onChange({ ...form, paymentMode: event.target.value })} disabled={isSaving} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label>
      <label className="text-xs font-medium text-slate-700">{direction === "in" ? "Details / from" : "Details / paid to"}<input required maxLength={200} value={form.partyDetails} onChange={(event) => onChange({ ...form, partyDetails: event.target.value })} disabled={isSaving} className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-700">Note (optional)<input maxLength={500} value={form.note} onChange={(event) => onChange({ ...form, note: event.target.value })} disabled={isSaving} className={inputClass} /></label>
    </div>
    <div className="mt-4 flex gap-2">
      <button disabled={isSaving} className="h-9 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? "Saving..." : `Save ${title}`}</button>
      <button type="button" onClick={onCancel} disabled={isSaving} className={secondaryButton}>Cancel</button>
    </div>
  </form>;
}

function CashBookColumn({ direction, entries, confirmingVoidId, voidingEntryId, onAskVoid, onCancelVoid, onConfirmVoid }: Readonly<{
  direction: CashBookDirection;
  entries: readonly CashBookMovement[];
  confirmingVoidId: string;
  voidingEntryId: string;
  onAskVoid: (entryId: string) => void;
  onCancelVoid: () => void;
  onConfirmVoid: (entry: CashBookMovement) => void;
}>) {
  const isMoneyIn = direction === "in";
  return <section aria-label={isMoneyIn ? "Money In / Receipts" : "Money Out / Payments"} className="min-w-0">
    <div className={`border-b border-slate-200 px-4 py-3 sm:px-5 ${isMoneyIn ? "bg-emerald-50" : "bg-red-50"}`}>
      <h4 className={`font-bold ${isMoneyIn ? "text-emerald-900" : "text-red-900"}`}>{isMoneyIn ? "Money In / Receipts" : "Money Out / Payments"}</h4>
    </div>
    {entries.length === 0 && <p className="px-5 py-8 text-sm text-slate-500">
      {isMoneyIn ? "No money received on this date." : "No money paid out on this date."} Opening and closing still carry forward.
    </p>}
    {entries.length > 0 && <ul className="divide-y divide-slate-100">
      {entries.map((entry) => <CashBookEntryRow
        key={`${entry.sourceType}-${entry.sourceId}`}
        entry={entry}
        confirmingVoid={confirmingVoidId === entry.sourceId}
        isVoiding={voidingEntryId === entry.sourceId}
        onAskVoid={() => onAskVoid(entry.sourceId)}
        onCancelVoid={onCancelVoid}
        onConfirmVoid={() => onConfirmVoid(entry)}
      />)}
    </ul>}
  </section>;
}

function CashBookEntryRow({ entry, confirmingVoid, isVoiding, onAskVoid, onCancelVoid, onConfirmVoid }: Readonly<{
  entry: CashBookMovement;
  confirmingVoid: boolean;
  isVoiding: boolean;
  onAskVoid: () => void;
  onCancelVoid: () => void;
  onConfirmVoid: () => void;
}>) {
  const isVoid = entry.sourceStatus === "void";
  const isManual = entry.sourceType === "manual_cash_entry";
  const isVehicleWageMovement = entry.sourceType === "vehicle_wage_payment"
    || entry.sourceType === "vehicle_wage_payment_reversal";
  const receiptHref = getCashBookReceiptHref(entry);
  const sourceLabel = entry.sourceType === "customer_payment"
    ? "Customer Payment"
    : entry.sourceType === "expense_payment"
      ? "Expense / Purchase Payment"
      : entry.sourceType === "vehicle_wage_payment"
        ? "Vehicle Wage Payment"
        : entry.sourceType === "vehicle_wage_payment_reversal"
          ? "Vehicle Wage Payment Reversal"
          : entry.direction === "in" ? "Manual Money In" : "Manual Money Out";

  return <li className={`px-4 py-4 sm:px-5 ${isVoid ? "bg-slate-50 text-slate-500" : "bg-white"}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-bold ${isVoid ? "text-slate-600" : "text-slate-950"}`}>{entry.counterparty}</p>
          {isVoid && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-extrabold text-slate-700">VOID</span>}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {isVehicleWageMovement
            ? sourceLabel
            : <>{sourceLabel} · {formatCustomerPaymentMode(entry.paymentMode)}
              {entry.sourceType !== "manual_cash_entry" ? ` · ${entry.description}` : ""}</>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {formatChallanDate(entry.businessDate)}{entry.note ? ` · ${entry.note}` : ""}
        </p>
      </div>
      <p className={`shrink-0 text-lg font-extrabold tabular-nums ${isVoid ? "text-slate-500 line-through" : entry.direction === "in" ? "text-emerald-700" : "text-red-700"}`}>{formatSalesMoney(entry.amount)}</p>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {receiptHref && <Link href={receiptHref} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cyan-800 hover:underline">Open receipt</Link>}
      {isManual && !isVoid && !confirmingVoid && <button type="button" onClick={onAskVoid} disabled={Boolean(isVoiding)} className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50">Void Entry</button>}
      {isManual && !isVoid && confirmingVoid && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
        <span className="font-semibold text-red-800">Void this entry? It will stay in history and stop affecting totals.</span>
        <button type="button" onClick={onConfirmVoid} disabled={isVoiding} className="h-8 rounded bg-red-700 px-3 font-bold text-white disabled:opacity-50">{isVoiding ? "Voiding..." : "Confirm void"}</button>
        <button type="button" onClick={onCancelVoid} disabled={isVoiding} className="h-8 rounded border border-slate-300 bg-white px-3 font-bold text-slate-700 disabled:opacity-50">Cancel</button>
      </div>}
      {isVoid && <span className="text-xs font-semibold text-slate-500">Original amount shown; excluded from active totals.</span>}
    </div>
  </li>;
}

function CashBookMessage({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">{children}</div>;
}
