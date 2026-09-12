"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatChallanDate, formatSalesMoney } from "@/features/office/sales-office-model";
import {
  getChallanBrickQuantity,
  getSalesRegisterPaymentLabel,
  resolveSalesDateRange,
  summarizeSalesRegister,
  type SalesDatePreset,
} from "@/features/sales/sales-register-model";
import { listSalesRegister } from "@/features/sales/services/sales-register-service";
import { getLocalDate } from "@/lib/local-date";

const presets: Array<{ value: SalesDatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

export function SalesRegisterSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const [localToday] = useState(() => getLocalDate());
  const [preset, setPreset] = useState<SalesDatePreset>("today");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const range = resolveSalesDateRange(preset, localToday, customFrom, customTo);
  const registerQuery = useQuery({
    queryKey: ["office-sales-register", factoryId, range?.fromDate, range?.toDate],
    queryFn: () => listSalesRegister(factoryId, range!),
    enabled: range !== null,
  });
  const entries = registerQuery.data ?? [];
  const summary = summarizeSalesRegister(entries);

  return (
    <section aria-labelledby="sales-register-heading" className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 id="sales-register-heading" className="text-xl font-bold">Sales Register</h3>
            <p className="mt-1 text-sm text-slate-600">Saved Challans are the sale records. Void Challans remain visible but do not count toward totals.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Sales Register date filters">
            {presets.map((option) => <button
              key={option.value}
              type="button"
              aria-pressed={preset === option.value}
              onClick={() => setPreset(option.value)}
              className={`h-9 rounded-lg border px-3 text-sm font-semibold ${preset === option.value ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
            >{option.label}</button>)}
          </div>
        </div>

        {preset === "custom" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">From date<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label>
          <label className="text-xs font-medium text-slate-600">To date<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label>
        </div>}
        {preset === "custom" && !range && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Choose a valid start and end date. The start date cannot be after the end date.</p>}
        {range && <p className="mt-3 text-xs text-slate-500">Showing {formatChallanDate(range.fromDate)} to {formatChallanDate(range.toDate)}, inclusive.</p>}
      </div>

      <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryValue label="Brick Revenue" value={formatSalesMoney(summary.brickRevenue)} />
        <SummaryValue label="Other Revenue" value={formatSalesMoney(summary.otherRevenue)} />
        <SummaryValue label="Total Revenue" value={formatSalesMoney(summary.totalRevenue)} />
        <SummaryValue label="Active Challans" value={summary.activeChallans.toLocaleString("en-IN")} />
        <SummaryValue label="Brick quantity" value={summary.totalBrickQuantity.toLocaleString("en-IN")} />
        <SummaryValue label="Void Challans" value={summary.voidChallans.toLocaleString("en-IN")} />
      </div>

      {registerQuery.isLoading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading Sales Register...</p>}
      {registerQuery.error && <p role="alert" className="px-5 py-10 text-center text-sm font-semibold text-red-700">{registerQuery.error instanceof Error ? registerQuery.error.message : "Could not load the Sales Register."}</p>}
      {!registerQuery.isLoading && !registerQuery.error && range && entries.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No Challans in this date range.</p>}

      {!registerQuery.isLoading && !registerQuery.error && entries.length > 0 && <div className="max-h-[44rem] overflow-auto">
        <table className="w-full min-w-[68rem] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-500 shadow-sm">
            <tr>
              <th className="px-4 py-3">Challan</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Brick particulars</th>
              <th className="px-4 py-3 text-right">Quantity</th>
              <th className="px-4 py-3 text-right">Total Revenue</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3 text-right">Document</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => <tr key={entry.challanId} className={entry.status === "void" ? "bg-slate-50 text-slate-500" : "bg-white"}>
              <td className="px-4 py-3 font-bold text-slate-900">{entry.challanNumber ?? ""}</td>
              <td className="whitespace-nowrap px-4 py-3">{formatChallanDate(entry.challanDate)}</td>
              <td className="px-4 py-3 font-medium text-slate-900">{entry.customerNameSnapshot}</td>
              <td className="px-4 py-3">{entry.items.length > 0 ? <ul className="space-y-1">{entry.items.map((item) => <li key={item.linePosition}><span className="font-medium text-slate-800">{item.particularsSnapshot}</span> <span className="text-xs">· {item.quantity.toLocaleString("en-IN")}</span></li>)}</ul> : <span className="text-slate-400">No brick revenue</span>}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{getChallanBrickQuantity(entry).toLocaleString("en-IN")}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">{formatSalesMoney(entry.totalRevenue)}</td>
              <td className="px-4 py-3 font-medium">{entry.vehicleNumber || "—"}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${entry.status === "void" ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800"}`}>{entry.status === "void" ? "Void" : "Active"}</span></td>
              <td className="px-4 py-3">
                <span className="text-xs font-bold text-slate-800">{getSalesRegisterPaymentLabel(entry)}</span>
                {entry.status === "active" && <div className="mt-1 space-y-0.5 whitespace-nowrap text-xs text-slate-500"><p>Paid {formatSalesMoney(entry.paidAmount)}</p><p>Due {formatSalesMoney(entry.outstandingAmount)}</p></div>}
              </td>
              <td className="px-4 py-3 text-right"><Link href={`/office/challans/${entry.challanId}`} target="_blank" rel="noreferrer" className="font-semibold text-cyan-800 hover:underline">Open Challan</Link></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function SummaryValue({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="border-r border-t border-slate-200 px-4 py-4 first:border-t-0 sm:border-t-0"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p></div>;
}
