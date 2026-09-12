"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatChallanDate, formatSalesMoney } from "@/features/office/sales-office-model";
import {
  applyVehicleWagePaymentReversal,
  buildVehicleWageAccounts,
  buildVehicleWagePaymentInput,
  buildVehicleWagePaymentReversalInput,
  insertVehicleWagePaymentNewestFirst,
  resolveVehicleWageDateRange,
  summarizeVehicleWageRange,
  type VehicleWageDatePreset,
  type VehicleWageLifetimeAccount,
  type VehicleWagePayment,
} from "@/features/sales/vehicle-wage-model";
import { buildVehicleTripHistories } from "@/features/sales/vehicle-trip-model";
import {
  getVehicleWageLifetimeAccount,
  listVehicleWagePayments,
  listVehicleWageTrips,
  recordVehicleWagePayment,
  reverseVehicleWagePayment,
} from "@/features/sales/services/vehicle-wage-service";
import { listVehicleTrips } from "@/features/sales/services/vehicle-trip-service";
import type { Vehicle } from "@/features/sales/types";
import { DEFAULT_WAGE_EARNINGS_DATE_PRESET } from "@/features/wages/wage-earnings-date-range";
import { getLocalDate } from "@/lib/local-date";

const presets: Array<{ value: VehicleWageDatePreset; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

const dateInputClass =
  "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950";
const accountKey = (factoryId: string, vehicleId: string) =>
  ["office-vehicle-wages", factoryId, "account", vehicleId] as const;
const paymentHistoryKey = (factoryId: string, vehicleId: string) =>
  ["office-vehicle-wages", factoryId, "payments", vehicleId] as const;

export function VehicleWageAccountsSection({
  factoryId,
  vehicles,
}: Readonly<{
  factoryId: string;
  vehicles: readonly Vehicle[];
}>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [preset, setPreset] = useState<VehicleWageDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [paymentDate, setPaymentDate] = useState(localToday);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const [confirmingReversalPaymentId, setConfirmingReversalPaymentId] = useState("");
  const [reversalDate, setReversalDate] = useState(localToday);
  const [reversalReason, setReversalReason] = useState("");
  const [isReversingPayment, setIsReversingPayment] = useState(false);
  const [reversalError, setReversalError] = useState("");
  const [reversalSuccess, setReversalSuccess] = useState("");
  const range = resolveVehicleWageDateRange(preset, localToday, customFrom, customTo);
  const wageTripsQuery = useQuery({
    queryKey: ["office-vehicle-wages", factoryId, "trips", range?.fromDate, range?.toDate],
    queryFn: () => listVehicleWageTrips(factoryId, range!),
    enabled: range !== null,
  });
  const tripHistoryQuery = useQuery({
    queryKey: ["office-vehicle-trips", factoryId],
    queryFn: () => listVehicleTrips(factoryId),
  });
  const accounts = buildVehicleWageAccounts(vehicles, wageTripsQuery.data ?? []);
  const tripHistories = buildVehicleTripHistories(vehicles, tripHistoryQuery.data ?? []);
  const tripHistoryByVehicleId = new Map(
    tripHistories.map((history) => [history.vehicleId, history]),
  );
  const rangeSummary = summarizeVehicleWageRange(accounts);
  const selectedAccount = accounts.find((account) => account.vehicleId === selectedVehicleId)
    ?? accounts.find((account) => (
      tripHistoryByVehicleId.get(account.vehicleId)?.tripCount ?? 0
    ) > 0)
    ?? accounts.find((account) => account.qualifyingTripCount > 0)
    ?? accounts[0];
  const activeVehicleId = selectedAccount?.vehicleId ?? "";
  const selectedTripHistory = tripHistoryByVehicleId.get(activeVehicleId);
  const lifetimeQuery = useQuery({
    queryKey: accountKey(factoryId, activeVehicleId),
    queryFn: () => getVehicleWageLifetimeAccount(factoryId, activeVehicleId),
    enabled: Boolean(activeVehicleId),
  });
  const paymentsQuery = useQuery({
    queryKey: paymentHistoryKey(factoryId, activeVehicleId),
    queryFn: () => listVehicleWagePayments(factoryId, activeVehicleId),
    enabled: Boolean(activeVehicleId),
  });

  function selectVehicle(vehicleId: string) {
    setSelectedVehicleId(vehicleId);
    setPaymentAmount("");
    setPaymentNote("");
    setPaymentError("");
    setPaymentSuccess("");
    setConfirmingReversalPaymentId("");
    setReversalReason("");
    setReversalError("");
    setReversalSuccess("");
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount || isSavingPayment) return;
    const input = buildVehicleWagePaymentInput(
      factoryId,
      selectedAccount.vehicleId,
      paymentDate,
      paymentAmount,
      paymentNote,
    );
    if (!input) {
      setPaymentError("Enter a valid date, positive amount, and optional note up to 500 characters.");
      return;
    }
    setIsSavingPayment(true);
    setPaymentError("");
    setPaymentSuccess("");
    try {
      const payment = await recordVehicleWagePayment(input);
      queryClient.setQueryData<VehicleWageLifetimeAccount>(
        accountKey(factoryId, selectedAccount.vehicleId),
        {
          totalEarned: payment.totalEarned,
          totalPaid: payment.totalPaid,
          availableBalance: payment.availableBalance,
        },
      );
      queryClient.setQueryData<VehicleWagePayment[]>(
        paymentHistoryKey(factoryId, selectedAccount.vehicleId),
        (current = []) => insertVehicleWagePaymentNewestFirst(current, payment),
      );
      void queryClient.invalidateQueries({
        queryKey: ["office-cash-book-day", factoryId],
      });
      setPaymentAmount("");
      setPaymentNote("");
      setPaymentSuccess(`Payment ${formatSalesMoney(payment.amount)} recorded.`);
    } catch (error) {
      void queryClient.invalidateQueries({
        queryKey: accountKey(factoryId, selectedAccount.vehicleId),
      });
      void queryClient.invalidateQueries({
        queryKey: paymentHistoryKey(factoryId, selectedAccount.vehicleId),
      });
      setPaymentError(error instanceof Error ? error.message : "Could not record this payment.");
    } finally {
      setIsSavingPayment(false);
    }
  }

  function askToReversePayment(payment: VehicleWagePayment) {
    setConfirmingReversalPaymentId(payment.id);
    setReversalDate(payment.paymentDate > localToday ? payment.paymentDate : localToday);
    setReversalReason("");
    setReversalError("");
    setReversalSuccess("");
  }

  async function saveReversal(
    event: React.FormEvent<HTMLFormElement>,
    payment: VehicleWagePayment,
  ) {
    event.preventDefault();
    if (payment.reversal || isReversingPayment) return;
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
    setIsReversingPayment(true);
    setReversalError("");
    setReversalSuccess("");
    try {
      const reversal = await reverseVehicleWagePayment(input);
      queryClient.setQueryData<VehicleWageLifetimeAccount>(
        accountKey(factoryId, payment.vehicleId),
        {
          totalEarned: reversal.totalEarned,
          totalPaid: reversal.totalPaid,
          availableBalance: reversal.availableBalance,
        },
      );
      queryClient.setQueryData<VehicleWagePayment[]>(
        paymentHistoryKey(factoryId, payment.vehicleId),
        (current = []) => applyVehicleWagePaymentReversal(current, reversal),
      );
      void queryClient.invalidateQueries({
        queryKey: ["office-cash-book-day", factoryId],
      });
      setConfirmingReversalPaymentId("");
      setReversalReason("");
      setReversalSuccess(`Payment ${formatSalesMoney(payment.amount)} reversed.`);
    } catch (error) {
      void queryClient.invalidateQueries({
        queryKey: accountKey(factoryId, payment.vehicleId),
      });
      void queryClient.invalidateQueries({
        queryKey: paymentHistoryKey(factoryId, payment.vehicleId),
      });
      setReversalError(error instanceof Error ? error.message : "Could not reverse this payment.");
    } finally {
      setIsReversingPayment(false);
    }
  }

  return (
    <section aria-labelledby="vehicle-wage-accounts-heading" className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-cyan-800">Vehicle Wages</p>
            <h3 id="vehicle-wage-accounts-heading" className="mt-1 text-xl font-bold">Delivery Labour Wage accounts</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">Lifetime account balances and immutable payments, with selected-range wage reporting and all-time trip history. Current tracking and archive settings do not rewrite history.</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-600">Earnings period</p>
            <div className="flex flex-wrap gap-2" aria-label="Vehicle wage earnings period">
              {presets.map((option) => <button
                key={option.value}
                type="button"
                aria-pressed={preset === option.value}
                onClick={() => setPreset(option.value)}
                className={`h-9 rounded-lg border px-3 text-sm font-semibold ${preset === option.value ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              >{option.label}</button>)}
            </div>
          </div>
        </div>

        {preset === "custom" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">From date<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className={dateInputClass} /></label>
          <label className="text-xs font-medium text-slate-600">To date<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className={dateInputClass} /></label>
        </div>}
        {preset === "custom" && !range && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Choose a valid inclusive date range. From date cannot be after To date.</p>}
        {range && <p className="mt-3 text-xs text-slate-500">Showing {formatChallanDate(range.fromDate)} to {formatChallanDate(range.toDate)}, inclusive.</p>}
      </div>

      <div className="grid border-b border-slate-200 bg-slate-50 sm:grid-cols-3">
        <SummaryValue label="Period Earned" value={range ? formatSalesMoney(rangeSummary.earnedAmount) : "—"} />
        <SummaryValue label="Wage-earning Trips" value={range ? rangeSummary.qualifyingTripCount.toLocaleString("en-IN") : "—"} />
        <SummaryValue label="Vehicles with Earnings" value={range ? rangeSummary.vehicleCountWithEarnings.toLocaleString("en-IN") : "—"} />
      </div>

      {wageTripsQuery.isLoading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading Vehicle wage earnings...</p>}
      {wageTripsQuery.error && <p role="alert" className="px-5 py-10 text-center text-sm font-semibold text-red-700">{wageTripsQuery.error instanceof Error ? wageTripsQuery.error.message : "Could not load Vehicle wage earnings."}</p>}
      {!wageTripsQuery.isLoading && !wageTripsQuery.error && vehicles.length === 0 && accounts.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No Vehicles exist yet. Wage earnings will appear automatically from eligible Challans.</p>}

      {!wageTripsQuery.isLoading && !wageTripsQuery.error && accounts.length > 0 && <div className="grid lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.5fr)]">
        <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          <h4 className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-700">Vehicle accounts</h4>
          <ul className="max-h-[48rem] divide-y divide-slate-100 overflow-y-auto">
            {accounts.map((account) => {
              const recordedTripCount = tripHistoryByVehicleId.get(account.vehicleId)?.tripCount ?? 0;
              return <li key={account.vehicleId} className={selectedAccount?.vehicleId === account.vehicleId ? "bg-cyan-50" : "bg-white"}>
              <button type="button" onClick={() => selectVehicle(account.vehicleId)} className="w-full px-4 py-4 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-600">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-950">{account.vehicleNumber}</p>
                    <p className="mt-1 text-xs text-slate-500">{account.isActive ? "Active" : "Archived"} · Tracking {account.deliveryWageTrackingEnabled ? "ON" : "OFF"} now</p>
                  </div>
                  <div className="text-right"><p className="font-bold tabular-nums text-slate-950">{range ? formatSalesMoney(account.earnedAmount) : "—"}</p><p className="text-[11px] text-slate-500">period earned</p></div>
                </div>
                <p className="mt-2 text-xs font-semibold text-cyan-800">{recordedTripCount.toLocaleString("en-IN")} recorded {recordedTripCount === 1 ? "trip" : "trips"}</p>
              </button>
            </li>})}
          </ul>
        </div>

        {selectedAccount && <div>
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-lg font-bold">{selectedAccount.vehicleNumber}</h4>
                <p className="mt-1 text-xs text-slate-500">{selectedAccount.isActive ? "Active" : "Archived"} · Tracking {selectedAccount.deliveryWageTrackingEnabled ? "ON" : "OFF"} now. Settlement remains available against historical earnings.</p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Period Earned</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{range ? formatSalesMoney(selectedAccount.earnedAmount) : "—"}</p>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50">
            {lifetimeQuery.isLoading && <p className="px-5 py-6 text-sm text-slate-500">Loading lifetime Vehicle wage account...</p>}
            {lifetimeQuery.error && <p role="alert" className="px-5 py-6 text-sm font-semibold text-red-700">{lifetimeQuery.error instanceof Error ? lifetimeQuery.error.message : "Could not load the lifetime account."}</p>}
            {lifetimeQuery.data && <div className="grid sm:grid-cols-3">
              <SummaryValue label="Total Earned" value={formatSalesMoney(lifetimeQuery.data.totalEarned)} />
              <SummaryValue label="Paid" value={formatSalesMoney(lifetimeQuery.data.totalPaid)} />
              <SummaryValue label="Available" value={formatSalesMoney(lifetimeQuery.data.availableBalance)} />
            </div>}
          </div>

          <div className="grid border-b border-slate-200 lg:grid-cols-2">
            <form onSubmit={savePayment} className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
              <h5 className="font-bold">Record Payment</h5>
              <p className="mt-1 text-xs text-slate-600">Current lifetime Available: {lifetimeQuery.data ? formatSalesMoney(lifetimeQuery.data.availableBalance) : "Loading..."}. The database rechecks this balance when saving.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">Payment Date<input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className={dateInputClass} /></label>
                <label className="text-xs font-medium text-slate-600">Amount<input inputMode="decimal" required placeholder="0.00" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className={dateInputClass} /></label>
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">Note (optional)<input maxLength={500} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} className={dateInputClass} /></label>
              </div>
              <button type="submit" disabled={isSavingPayment || !lifetimeQuery.data || lifetimeQuery.data.availableBalance <= 0} className="mt-4 h-10 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{isSavingPayment ? "Recording..." : "Record Payment"}</button>
              {lifetimeQuery.data?.availableBalance === 0 && <p className="mt-2 text-xs font-semibold text-slate-600">Available ₹0.00 — this Vehicle wage account is settled.</p>}
              {paymentError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{paymentError}</p>}
              {paymentSuccess && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{paymentSuccess}</p>}
            </form>

            <section aria-label={`${selectedAccount.vehicleNumber} payment history`} className="min-w-0 p-5">
              <h5 className="font-bold">Payment History</h5>
              <p className="mt-1 text-xs text-slate-500">Immutable payments and full reversals, newest payment date first.</p>
              {reversalError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{reversalError}</p>}
              {reversalSuccess && <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{reversalSuccess}</p>}
              {paymentsQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading payment history...</p>}
              {paymentsQuery.error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{paymentsQuery.error instanceof Error ? paymentsQuery.error.message : "Could not load payment history."}</p>}
              {!paymentsQuery.isLoading && !paymentsQuery.error && (paymentsQuery.data?.length ?? 0) === 0 && <p className="mt-4 text-sm text-slate-500">No payments recorded yet.</p>}
              <ul className="mt-2 max-h-72 divide-y divide-slate-200 overflow-y-auto">
                {(paymentsQuery.data ?? []).map((payment) => <li key={payment.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><span>{formatChallanDate(payment.paymentDate)}</span><span className="flex items-center gap-2"><span className="font-bold tabular-nums">{formatSalesMoney(payment.amount)}</span>{payment.reversal && <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-800">Reversed</span>}</span></div>
                  {payment.note && <p className="mt-1 text-xs text-slate-600">{payment.note}</p>}
                  {payment.reversal && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-bold">Reversed on {formatChallanDate(payment.reversal.reversalDate)}</p>
                    <p className="mt-1">Reason: {payment.reversal.reason}</p>
                  </div>}
                  {!payment.reversal && confirmingReversalPaymentId !== payment.id && <button type="button" onClick={() => askToReversePayment(payment)} disabled={isReversingPayment} className="mt-2 text-xs font-bold text-red-700 hover:underline disabled:opacity-50">Reverse Payment</button>}
                  {!payment.reversal && confirmingReversalPaymentId === payment.id && <form onSubmit={(event) => saveReversal(event, payment)} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-bold text-red-900">Reverse this full payment? The original stays in history and Cash Book receives an equal Money In correction.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-medium text-slate-700">Reversal Date<input type="date" required min={payment.paymentDate} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} disabled={isReversingPayment} className={dateInputClass} /></label>
                      <label className="text-xs font-medium text-slate-700">Reason<input required maxLength={500} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} disabled={isReversingPayment} className={dateInputClass} /></label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="submit" disabled={isReversingPayment} className="h-9 rounded-lg bg-red-700 px-3 text-xs font-bold text-white disabled:opacity-50">{isReversingPayment ? "Reversing..." : "Confirm Reversal"}</button>
                      <button type="button" onClick={() => { setConfirmingReversalPaymentId(""); setReversalError(""); }} disabled={isReversingPayment} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-50">Cancel</button>
                    </div>
                  </form>}
                </li>)}
              </ul>
            </section>
          </div>

          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3"><div><h5 className="font-bold">Trip History</h5><p className="mt-1 text-xs text-slate-500">All active Challans recorded with this Vehicle. Wage filters above do not limit this list.</p></div><p className="whitespace-nowrap text-sm font-bold text-cyan-800">{(selectedTripHistory?.tripCount ?? 0).toLocaleString("en-IN")} {(selectedTripHistory?.tripCount ?? 0) === 1 ? "trip" : "trips"}</p></div>
          {tripHistoryQuery.isLoading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading Vehicle trip history...</p>}
          {tripHistoryQuery.error && <p role="alert" className="px-5 py-10 text-center text-sm font-semibold text-red-700">{tripHistoryQuery.error instanceof Error ? tripHistoryQuery.error.message : "Could not load Vehicle trip history."}</p>}
          {!tripHistoryQuery.isLoading && !tripHistoryQuery.error && (selectedTripHistory?.tripCount ?? 0) === 0
            ? <p className="px-5 py-10 text-center text-sm text-slate-500">No active Challan trips recorded for this Vehicle.</p>
            : null}
          {!tripHistoryQuery.isLoading && !tripHistoryQuery.error && (selectedTripHistory?.tripCount ?? 0) > 0 && <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto">
            {selectedTripHistory!.trips.map((trip) => <li key={trip.challanId} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-950">{formatChallanDate(trip.challanDate)}</p>
                  <p className="mt-1 font-semibold text-slate-800">{trip.customerNameSnapshot}</p>
                  {trip.challanNumber && <p className="mt-1 text-xs text-slate-600">Challan No. {trip.challanNumber}</p>}
                  {trip.destinationSnapshot && <p className="mt-1 text-xs text-slate-600">Destination: {trip.destinationSnapshot}</p>}
                  <p className="mt-1 text-xs text-slate-500">Historical Vehicle: {trip.vehicleNumberSnapshot}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-700">{trip.deliveryWageApplicableSnapshot && trip.tripLabourWage !== null ? `Wage ${formatSalesMoney(trip.tripLabourWage)}` : "No Vehicle wage"}</p>
                  <Link href={`/office/challans/${trip.challanId}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-cyan-800 hover:underline">Open Challan</Link>
                </div>
              </div>
            </li>)}
          </ul>}
        </div>}
      </div>}
    </section>
  );
}

function SummaryValue({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="border-r border-t border-slate-200 px-4 py-4 first:border-t-0 sm:border-t-0"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p></div>;
}
