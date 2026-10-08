"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { formatPrintableDate, formatPrintableMoney } from "@/features/sales/challan-print-model";
import {
  loadPaymentReceiptDetails,
  type PaymentReceiptLoadState,
  type PrintablePaymentReceipt,
} from "@/features/sales/payment-receipt-model";
import { getCustomerPayment } from "@/features/sales/services/customer-payment-service";
import { formatChallanLabel } from "@/features/sales/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export function PaymentReceiptScreen({ paymentId }: Readonly<{ paymentId: string }>) {
  const [state, setState] = useState<PaymentReceiptLoadState>({ status: "loading" });
  const [retryNumber, setRetryNumber] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadReceipt() {
      setState({ status: "loading" });
      const loaded = await loadPaymentReceiptDetails(paymentId, async () => {
        const factory = await resolveAuthenticatedFactoryId();
        if (!factory.ok) throw new Error("Payment access is unavailable.");
        return getCustomerPayment(factory.factoryId, paymentId);
      });
      if (!cancelled) setState(loaded);
    }
    void loadReceipt();
    return () => { cancelled = true; };
  }, [paymentId, retryNumber]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const previousTitle = document.title;
    document.title = `Payment Receipt ${state.receipt.paymentDate}`;
    return () => { document.title = previousTitle; };
  }, [state]);

  if (state.status === "loading") {
    return <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 text-sm font-medium text-slate-600">Loading payment receipt...</main>;
  }
  if (state.status !== "ready") {
    return <main className="flex min-h-screen items-center justify-center bg-atlas-background px-atlas-4 py-atlas-6">
      <div className="w-full max-w-lg text-center">
        <Card as="section" style={{ color: "inherit" }}>
          <div className="p-atlas-2">
            <h1 className="text-atlas-xl font-atlas-semibold">{state.status === "not-found" ? ATLAS_UI_STRINGS.payment.notFound : "Receipt unavailable"}</h1>
            <p role="alert" className="mt-atlas-3 text-atlas-sm text-atlas-text-muted">{state.message}</p>
            <div className="mt-atlas-4"><Button variant="secondary" onClick={() => setRetryNumber((current) => current + 1)}>{ATLAS_UI_STRINGS.payment.retryDetails}</Button></div>
            <Link href="/office" className="mt-atlas-4 inline-flex min-h-atlas-12 items-center text-atlas-primary">Back to Office</Link>
          </div>
        </Card>
      </div>
    </main>;
  }

  const receipt = state.receipt;
  function printReceipt(pdfMode: boolean) {
    const previousTitle = document.title;
    if (pdfMode) document.title = `Payment-Receipt-${receipt.paymentDate}`;
    try { window.print(); } finally { document.title = previousTitle; }
  }

  return <main className="challan-print-shell min-h-screen bg-stone-100 px-4 py-6 text-slate-950 sm:px-6">
    <nav aria-label="Receipt actions" className="print-hidden mx-auto mb-4 flex max-w-[210mm] flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><Link href="/office" className="text-sm font-semibold text-cyan-800 hover:underline">← Back to Office</Link><p className="mt-1 text-xs text-slate-500">For a PDF, choose “Save as PDF” in the system print dialog.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => printReceipt(false)} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold">Print</button><button type="button" onClick={() => printReceipt(true)} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">Download PDF</button></div>
    </nav>
    <PaymentReceiptDocument receipt={receipt} />
  </main>;
}

export function PaymentReceiptDocument({ receipt }: Readonly<{ receipt: PrintablePaymentReceipt }>) {
  return <article data-customer-facing-payment-receipt className="challan-print-page mx-auto max-w-[210mm] bg-white p-6 shadow-sm sm:p-8">
    <header className="border-2 border-black text-center">
      <div className="px-5 py-4"><h1 className="text-3xl font-black uppercase tracking-wide">{receipt.company.name}</h1><p className="mt-1 text-sm font-semibold">{receipt.company.businessDescription}</p><p className="mt-2 text-sm">{receipt.company.address}</p><p className="mt-1 text-sm font-semibold">Mobile: {receipt.company.mobile}</p></div>
      <div className="border-t-2 border-black px-4 py-2 text-xl font-black uppercase tracking-[0.18em]">Payment Receipt</div>
    </header>
    <section aria-label="Payment details" className="grid grid-cols-2 border-x-2 border-b-2 border-black text-sm"><p className="border-r border-black px-3 py-2"><span className="font-bold">Received from:</span> {receipt.customer.name}</p><p className="px-3 py-2 text-right"><span className="font-bold">Date:</span> {formatPrintableDate(receipt.paymentDate)}</p></section>
    <section aria-label="Customer contact" className="border-x-2 border-b-2 border-black px-3 py-3 text-sm"><div className="grid gap-2 sm:grid-cols-[8rem_1fr]"><p className="font-bold">Address</p><p>{receipt.customer.address || "—"}</p><p className="font-bold">Mobile</p><p>{receipt.customer.mobile || "—"}</p></div></section>
    <section className="grid grid-cols-2 border-x-2 border-b-2 border-black px-3 py-4 text-sm"><p><span className="font-bold">Payment mode:</span> {receipt.paymentMethodDisplay}</p><p className="text-right text-lg"><span className="font-bold">Amount received:</span> <span className="font-black tabular-nums">{formatPrintableMoney(receipt.amount)}</span></p></section>
    <table className="challan-print-table w-full table-fixed border-x-2 border-b-2 border-black text-sm"><thead><tr className="border-b-2 border-black"><th className="w-20 border-r border-black px-2 py-2 text-center">No.</th><th className="border-r border-black px-3 py-2 text-left">Allocated to Challan</th><th className="w-48 px-3 py-2 text-right">Amount</th></tr></thead><tbody>{receipt.allocations.map((allocation, index) => <tr key={index} className="border-b border-black last:border-b-0"><td className="border-r border-black px-2 py-3 text-center">{index + 1}</td><td className="border-r border-black px-3 py-3 font-semibold">{formatChallanLabel(allocation.challanNumber)} · {formatPrintableDate(allocation.challanDate)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{formatPrintableMoney(allocation.amount)}</td></tr>)}</tbody></table>
    {receipt.note && <section aria-label="Payment note" className="border-x-2 border-b-2 border-black px-3 py-3 text-sm"><span className="font-bold">Note:</span> {receipt.note}</section>}
    <section aria-label="Signatures" className="challan-signatures border-x-2 border-b-2 border-black px-4 py-5"><div className="mt-16 grid grid-cols-2 gap-16 text-center text-xs font-semibold"><p className="border-t border-black pt-2">Customer&apos;s Signature</p><p className="border-t border-black pt-2">Manager&apos;s Signature</p></div></section>
  </article>;
}
