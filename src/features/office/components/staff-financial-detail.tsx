"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildStaffDeductionHistoryItem,
  buildStaffDeductionInput,
  buildStaffEarningHistoryItem,
  buildStaffWithdrawalHistoryItem,
  buildStaffWithdrawalInput,
  formatStaffMoney,
  staffDeductionsKey,
  staffEarningsKey,
  staffFinancialErrorMessage,
  staffFinancialSummaryKey,
  staffWithdrawalsKey,
  summaryFromFinancialMutation,
} from "@/features/office/staff-financial-office-model";
import {
  createStaffSalaryDeduction,
  createStaffWithdrawal,
  getStaffFinancialSummary,
  listStaffMonthlyEarnings,
  listStaffSalaryDeductions,
  listStaffWithdrawals,
} from "@/features/staff/services/staff-salary-service";
import type { StaffFinancialSummary, StaffWorker } from "@/features/staff/types";
import { getLocalDate } from "@/lib/local-date";

const inputClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950";
const primaryButton = "h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

export function StaffFinancialDetail({ factoryId, worker }: Readonly<{
  factoryId: string;
  worker: StaffWorker;
}>) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalDate, setWithdrawalDate] = useState(() => getLocalDate());
  const [deductionAmount, setDeductionAmount] = useState("");
  const [deductionDate, setDeductionDate] = useState(() => getLocalDate());
  const [deductionReason, setDeductionReason] = useState("");
  const [savingAction, setSavingAction] = useState<"withdrawal" | "deduction" | "">("");
  const [withdrawalError, setWithdrawalError] = useState("");
  const [deductionError, setDeductionError] = useState("");
  const [success, setSuccess] = useState("");

  const summaryQuery = useQuery({
    queryKey: staffFinancialSummaryKey(factoryId, worker.id),
    queryFn: () => getStaffFinancialSummary({ factoryId, staffWorkerId: worker.id }),
  });
  const earningsQuery = useQuery({
    queryKey: [...staffEarningsKey(factoryId, worker.id), summaryQuery.dataUpdatedAt],
    queryFn: () => listStaffMonthlyEarnings({ factoryId, staffWorkerId: worker.id }),
    enabled: isOpen,
  });
  const withdrawalsQuery = useQuery({
    queryKey: staffWithdrawalsKey(factoryId, worker.id),
    queryFn: () => listStaffWithdrawals({ factoryId, staffWorkerId: worker.id }),
    enabled: isOpen,
  });
  const deductionsQuery = useQuery({
    queryKey: staffDeductionsKey(factoryId, worker.id),
    queryFn: () => listStaffSalaryDeductions({ factoryId, staffWorkerId: worker.id }),
    enabled: isOpen,
  });

  async function refreshAfterMutation(kind: "withdrawal" | "deduction", summary: StaffFinancialSummary) {
    queryClient.setQueryData(staffFinancialSummaryKey(factoryId, worker.id), summary);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: staffFinancialSummaryKey(factoryId, worker.id) }),
      queryClient.invalidateQueries({
        queryKey: kind === "withdrawal"
          ? staffWithdrawalsKey(factoryId, worker.id)
          : staffDeductionsKey(factoryId, worker.id),
      }),
      queryClient.invalidateQueries({ queryKey: staffEarningsKey(factoryId, worker.id) }),
    ]);
  }

  async function saveWithdrawal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingAction) return;
    const input = buildStaffWithdrawalInput({
      factoryId, staffWorkerId: worker.id, amount: withdrawalAmount, withdrawalDate,
    });
    if (!input) return setWithdrawalError("Enter a positive withdrawal amount and a valid date.");
    setSavingAction("withdrawal"); setWithdrawalError(""); setDeductionError(""); setSuccess("");
    try {
      const result = await createStaffWithdrawal(input);
      setWithdrawalAmount("");
      setSuccess(`Withdrawal recorded for ${worker.name}.`);
      await refreshAfterMutation("withdrawal", summaryFromFinancialMutation(result));
    } catch (error) {
      setWithdrawalError(staffFinancialErrorMessage(error, "Could not record the Staff withdrawal."));
    } finally { setSavingAction(""); }
  }

  async function saveDeduction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingAction) return;
    const input = buildStaffDeductionInput({
      factoryId, staffWorkerId: worker.id, amount: deductionAmount,
      deductionDate, reason: deductionReason,
    });
    if (!input) return setDeductionError("Enter a positive deduction amount and a valid date.");
    setSavingAction("deduction"); setWithdrawalError(""); setDeductionError(""); setSuccess("");
    try {
      const result = await createStaffSalaryDeduction(input);
      setDeductionAmount(""); setDeductionReason("");
      setSuccess(`Manual deduction recorded for ${worker.name}.`);
      await refreshAfterMutation("deduction", summaryFromFinancialMutation(result));
    } catch (error) {
      setDeductionError(staffFinancialErrorMessage(error, "Could not record the manual deduction."));
    } finally { setSavingAction(""); }
  }

  return (
    <section aria-label={`${worker.name} financials`} className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Available balance</p>
          {summaryQuery.isLoading && <p className="mt-1 text-sm text-slate-500">Loading balance...</p>}
          {summaryQuery.error && <p role="alert" className="mt-1 max-w-xl text-sm font-medium text-red-700">{staffFinancialErrorMessage(summaryQuery.error, "Balance unavailable.")}</p>}
          {summaryQuery.data && <p className="mt-1 text-lg font-bold tabular-nums">{formatStaffMoney(summaryQuery.data.availableBalance)}</p>}
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`staff-financial-detail-${worker.id}`}
          onClick={() => setIsOpen((open) => !open)}
          className={secondaryButton}
        >
          {isOpen ? "Close financials" : "Manage financials"}
        </button>
      </div>

      {isOpen && (
        <div id={`staff-financial-detail-${worker.id}`} className="mt-4 border-t border-slate-200 pt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h5 className="font-bold">{worker.name}&apos;s financials</h5>
              {!worker.isActive && <p className="mt-1 text-xs font-medium text-amber-700">Inactive Staff — existing balance and history remain available.</p>}
            </div>
            {summaryQuery.error && <button type="button" onClick={() => summaryQuery.refetch()} className={secondaryButton}>Try again</button>}
          </div>

          {summaryQuery.isLoading && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Loading financial summary...</p>}
          {summaryQuery.error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">{staffFinancialErrorMessage(summaryQuery.error, "Could not load Staff financial summary.")}</p>}
          {summaryQuery.data && <FinancialSummary summary={summaryQuery.data} />}

          {summaryQuery.data && (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <form onSubmit={saveWithdrawal} className="min-w-0 rounded-lg border border-slate-200 p-4">
                <h6 className="font-semibold">Record withdrawal</h6>
                <p className="mt-1 text-xs text-slate-600">Available now: {formatStaffMoney(summaryQuery.data.availableBalance)}. No advance salary.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Amount"><input type="number" min="0.01" step="0.01" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} className={inputClass} /></Field>
                  <Field label="Withdrawal date"><input type="date" value={withdrawalDate} onChange={(event) => setWithdrawalDate(event.target.value)} className={inputClass} /></Field>
                </div>
                <button disabled={Boolean(savingAction)} className={`${primaryButton} mt-3`}>{savingAction === "withdrawal" ? "Saving..." : "Record withdrawal"}</button>
                <Feedback error={withdrawalError} />
              </form>

              <form onSubmit={saveDeduction} className="min-w-0 rounded-lg border border-slate-200 p-4">
                <h6 className="font-semibold">Manual deduction</h6>
                <p className="mt-1 text-xs text-slate-600">Record an occasional fixed adjustment. This does not change salary rates.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Amount"><input type="number" min="0.01" step="0.01" value={deductionAmount} onChange={(event) => setDeductionAmount(event.target.value)} className={inputClass} /></Field>
                  <Field label="Deduction date"><input type="date" value={deductionDate} onChange={(event) => setDeductionDate(event.target.value)} className={inputClass} /></Field>
                  <div className="sm:col-span-2"><Field label="Reason (optional)"><input value={deductionReason} onChange={(event) => setDeductionReason(event.target.value)} placeholder="Example: Absent for several days" className={inputClass} /></Field></div>
                </div>
                <button disabled={Boolean(savingAction)} className={`${primaryButton} mt-3`}>{savingAction === "deduction" ? "Saving..." : "Record manual deduction"}</button>
                <Feedback error={deductionError} />
              </form>
            </div>
          )}

          {success && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{success}</p>}

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <HistorySection title="Salary earnings" isLoading={earningsQuery.isLoading} error={earningsQuery.error} empty={(earningsQuery.data?.length ?? 0) === 0}>
              {earningsQuery.data?.map((earning) => {
                const item = buildStaffEarningHistoryItem(earning);
                return <li key={item.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{item.month}</span><span className="font-semibold tabular-nums">{item.amount}</span></div><p className="mt-1 text-xs text-slate-600">{item.source}{item.source === "First month custom" ? ` · Normal salary ${item.normalSalary}` : ""}</p></li>;
              })}
            </HistorySection>
            <HistorySection title="Withdrawals" isLoading={withdrawalsQuery.isLoading} error={withdrawalsQuery.error} empty={(withdrawalsQuery.data?.length ?? 0) === 0}>
              {withdrawalsQuery.data?.map((withdrawal) => {
                const item = buildStaffWithdrawalHistoryItem(withdrawal);
                return <li key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span>{item.date}</span><span className="font-semibold tabular-nums">{item.amount}</span></li>;
              })}
            </HistorySection>
            <HistorySection title="Manual deductions" isLoading={deductionsQuery.isLoading} error={deductionsQuery.error} empty={(deductionsQuery.data?.length ?? 0) === 0}>
              {deductionsQuery.data?.map((deduction) => {
                const item = buildStaffDeductionHistoryItem(deduction);
                return <li key={item.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><span>{item.date}</span><span className="font-semibold tabular-nums">{item.amount}</span></div><p className="mt-1 text-xs text-slate-600">{item.reason}</p></li>;
              })}
            </HistorySection>
          </div>
        </div>
      )}
    </section>
  );
}

function FinancialSummary({ summary }: Readonly<{ summary: StaffFinancialSummary }>) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryValue label="Available balance" amount={summary.availableBalance} highlight /><SummaryValue label="Total salary earned" amount={summary.totalEarnings} /><SummaryValue label="Total deducted" amount={summary.totalDeductions} /><SummaryValue label="Total withdrawn" amount={summary.totalWithdrawn} /></div>;
}

function SummaryValue({ label, amount, highlight = false }: Readonly<{ label: string; amount: number; highlight?: boolean }>) {
  return <div className={`rounded-lg p-3 ${highlight ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-xs text-slate-600">{label}</p><p className="mt-1 font-bold tabular-nums">{formatStaffMoney(amount)}</p></div>;
}

function HistorySection({ title, isLoading, error, empty, children }: Readonly<{
  title: string; isLoading: boolean; error: Error | null; empty: boolean; children: React.ReactNode;
}>) {
  return <section className="min-w-0 rounded-lg border border-slate-200 p-4"><h6 className="font-semibold">{title}</h6>{isLoading && <p className="mt-3 text-sm text-slate-500">Loading history...</p>}{error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{staffFinancialErrorMessage(error, `Could not load ${title.toLowerCase()}.`)}</p>}{!isLoading && !error && empty && <p className="mt-3 text-sm text-slate-500">No history yet.</p>}{!isLoading && !error && !empty && <ul className="mt-2 divide-y divide-slate-100">{children}</ul>}</section>;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return <label className="min-w-0 text-sm font-medium text-slate-700"><span className="mb-1 block">{label}</span>{children}</label>;
}

function Feedback({ error }: Readonly<{ error: string }>) {
  return error ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p> : null;
}
