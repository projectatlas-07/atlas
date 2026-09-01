"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import {
  buildPrintableChallan,
  formatPrintableDate,
  formatPrintableMoney,
  formatPrintableQuantity,
  type PrintableChallan,
} from "@/features/sales/challan-print-model";
import { getChallan } from "@/features/sales/services/challan-service";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; challan: PrintableChallan };

export function ChallanPrintScreen({ challanId }: Readonly<{ challanId: string }>) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let isCancelled = false;

    async function loadChallan() {
      setState({ status: "loading" });
      try {
        const factory = await resolveAuthenticatedFactoryId();
        if (isCancelled) return;
        if (!factory.ok) {
          setState({ status: "error", message: factory.error.message });
          return;
        }
        const saved = await getChallan(factory.factoryId, challanId);
        if (!isCancelled) setState({ status: "ready", challan: buildPrintableChallan(saved) });
      } catch (error) {
        if (!isCancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load this Challan.",
          });
        }
      }
    }

    void loadChallan();
    return () => { isCancelled = true; };
  }, [challanId]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const previousTitle = document.title;
    document.title = `Road Challan ${state.challan.challanNumber}`;
    return () => { document.title = previousTitle; };
  }, [state]);

  if (state.status === "loading") {
    return <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 text-sm font-medium text-slate-600">Loading Challan...</main>;
  }

  if (state.status === "error") {
    return <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold">Challan unavailable</h1>
        <p role="alert" className="mt-3 text-sm text-red-700">{state.message}</p>
        <Link href="/office" className="mt-5 inline-flex h-10 items-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">Back to Office</Link>
      </section>
    </main>;
  }

  const challan = state.challan;

  function openPrintDialog(pdfMode: boolean) {
    const previousTitle = document.title;
    if (pdfMode) document.title = `Road-Challan-${challan.challanNumber}`;
    try {
      window.print();
    } finally {
      document.title = previousTitle;
    }
  }

  return (
    <main className="challan-print-shell min-h-screen bg-stone-100 px-4 py-6 text-slate-950 sm:px-6">
      <nav aria-label="Challan actions" className="print-hidden mx-auto mb-4 flex max-w-[210mm] flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/office" className="text-sm font-semibold text-cyan-800 hover:underline">← Back to Office</Link>
          <p className="mt-1 text-xs text-slate-500">For a PDF, choose “Save as PDF” in the system print dialog.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openPrintDialog(false)} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold">Print</button>
          <button type="button" onClick={() => openPrintDialog(true)} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">Download PDF</button>
        </div>
      </nav>

      <RoadChallanDocument challan={challan} />
    </main>
  );
}

export function RoadChallanDocument({ challan }: Readonly<{ challan: PrintableChallan }>) {
  return (
    <article data-customer-facing-challan className="challan-print-page mx-auto max-w-[210mm] bg-white p-6 shadow-sm sm:p-8">
      {challan.isVoid && <div className="mb-4 border-4 border-black py-2 text-center text-3xl font-black tracking-[0.35em]">VOID</div>}

      <header className="border-2 border-black text-center">
        <div className="px-5 py-4">
          <h1 className="text-3xl font-black uppercase tracking-wide">{challan.company.name}</h1>
          <p className="mt-1 text-sm font-semibold">{challan.company.businessDescription}</p>
          {challan.company.addressKind === "structured"
            ? <>
                <p className="mt-2 text-sm"><span className="font-semibold">Village</span> {challan.company.village} · <span className="font-semibold">P.O.</span> {challan.company.postOffice} · <span className="font-semibold">P.S.</span> {challan.company.policeStation}</p>
                <p className="mt-1 text-sm"><span className="font-semibold">District</span> {challan.company.district} · <span className="font-semibold">State</span> {challan.company.state}</p>
              </>
            : <p className="mt-2 text-sm">{challan.company.address}</p>}
          <p className="mt-1 text-sm font-semibold">Mob: {challan.company.mobile}</p>
        </div>
        <div className="border-t-2 border-black px-4 py-2 text-xl font-black uppercase tracking-[0.18em]">Road Challan</div>
      </header>

      <section aria-label="Challan transaction" className="grid grid-cols-2 border-x-2 border-b-2 border-black text-sm">
        <p className="border-r border-black px-3 py-2"><span className="font-bold">Challan No.:</span> {challan.challanNumber}</p>
        <p className="px-3 py-2 text-right"><span className="font-bold">Date:</span> {formatPrintableDate(challan.challanDate)}</p>
      </section>

      <section aria-label="Customer details" className="border-x-2 border-b-2 border-black px-3 py-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <p className="font-bold">Customer</p><p>{challan.customer.name}</p>
          <p className="font-bold">Delivery address</p><p>{challan.customer.address || "—"}</p>
          <p className="font-bold">Mobile</p><p>{challan.customer.mobile || "—"}</p>
        </div>
      </section>

      <table className="challan-print-table w-full table-fixed border-x-2 border-b-2 border-black text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="w-[8%] border-r border-black px-2 py-2 text-center">No.</th>
            <th className="w-[20%] border-r border-black px-2 py-2 text-right">Quantity</th>
            <th className="border-r border-black px-3 py-2 text-left">Particulars</th>
            <th className="w-[20%] border-r border-black px-2 py-2 text-right">Rate</th>
            <th className="w-[20%] px-2 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {challan.lines.map((line, index) => line.lineKind === "NOTE"
            ? <tr key={`note-${index}-${line.particulars}`} data-challan-line="note" className="border-b border-black last:border-b-0">
                <td className="border-r border-black px-2 py-3 text-center">{index + 1}</td>
                <td colSpan={4} className="break-words px-3 py-3"><span className="font-bold">Note:</span> {line.particulars}</td>
              </tr>
            : <tr key={`${line.lineKind}-${index}-${line.particulars}`} data-challan-line={line.lineKind === "BRICK" ? "brick" : "extra-charge"} className="border-b border-black last:border-b-0">
                <td className="border-r border-black px-2 py-3 text-center">{index + 1}</td>
                <td className="border-r border-black px-2 py-3 text-right tabular-nums">{line.quantity === null ? "" : formatPrintableQuantity(line.quantity)}</td>
                <td className="break-words border-r border-black px-3 py-3 font-medium">{line.particulars}</td>
                <td className="border-r border-black px-2 py-3 text-right tabular-nums">
                  {line.rate === null ? "" : <>{formatPrintableMoney(line.rate)}{line.lineKind === "BRICK" && <span className="block text-[10px] font-normal">per 1,000</span>}</>}
                </td>
                <td className="px-2 py-3 text-right font-semibold tabular-nums">{formatPrintableMoney(line.amount)}</td>
              </tr>)}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black">
            <td colSpan={4} className="border-r border-black px-3 py-3 text-right text-base font-black">Challan Total</td>
            <td className="px-2 py-3 text-right text-base font-black tabular-nums">{formatPrintableMoney(challan.total)}</td>
          </tr>
        </tfoot>
      </table>

      <section aria-label="Delivery details" className="border-x-2 border-b-2 border-black px-3 py-3 text-sm">
        <span className="font-bold">Vehicle No.:</span> <span className="font-semibold tracking-wide">{challan.vehicleNumber ?? "—"}</span>
      </section>

      <section aria-label="Acknowledgement and signatures" className="challan-signatures border-x-2 border-b-2 border-black px-4 py-5">
        <p className="text-center text-sm font-bold">Received the goods in good condition</p>
        <div className="mt-16 grid grid-cols-3 gap-5 text-center text-xs font-semibold">
          <p className="border-t border-black pt-2">Signature of Driver</p>
          <p className="border-t border-black pt-2">Customer&apos;s Signature</p>
          <p className="border-t border-black pt-2">Manager&apos;s Signature</p>
        </div>
      </section>
    </article>
  );
}
