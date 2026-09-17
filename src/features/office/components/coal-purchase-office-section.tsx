"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildCoalSelectivePaymentInput,
  buildCreateCoalPurchaseInput,
  buildUpdateCoalPurchaseInput,
  canChangeCoalPurchase,
  coalPurchaseFormFromSaved,
  emptyCoalSelectivePaymentForm,
  emptyCoalPurchaseForm,
  filterCoalPayments,
  filterCoalPurchases,
  getCoalFinalTotal,
  getCoalSelectivePaymentStatus,
  getDerivedCoalMeasurementField,
  getEligibleCoalSettlementPurchases,
  summarizeCoalPurchases,
  toggleCoalSettlementPurchase,
  updateCoalMeasurement,
  type CoalMeasurementField,
  type CoalPaymentStatusFilter,
  type CoalSelectivePaymentForm,
  type CoalPurchaseForm,
} from "../../coal/coal-purchase-model";
import {
  createCoalSelectivePayment,
  createCoalPurchase,
  createCoalReferenceValue,
  listCoalPayments,
  listCoalPurchases,
  listCoalReferenceValues,
  updateCoalPurchase,
  voidCoalPurchase,
} from "../../coal/services/coal-purchase-service";
import type { CoalPurchase, CoalReferenceKind } from "../../coal/types";
import {
  createOrAssignSupplierRole,
  listSuppliersByRole,
} from "../../expenses/services/supplier-role-service";
import type { Supplier } from "../../expenses/types";
import { formatCustomerPaymentMode, NEW_CUSTOMER_PAYMENT_MODES } from "../../sales/types";
import { formatChallanDate, formatSalesMoney } from "../sales-office-model";
import { getLocalDate } from "../../../lib/local-date";
import { SearchChoice } from "./search-choice";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100";
const primaryButton = "h-10 rounded-lg bg-stone-900 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-10 rounded-lg border border-stone-400 bg-white px-4 text-sm font-bold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50";
const suppliersKey = (factoryId: string) => ["office-suppliers-by-role", factoryId, "COAL_SELLER"] as const;
const referencesKey = (factoryId: string) => ["office-coal-references", factoryId] as const;
const purchasesKey = (factoryId: string) => ["office-coal-purchases", factoryId] as const;
const paymentsKey = (factoryId: string) => ["office-coal-payments", factoryId] as const;

export function CoalPurchaseOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [form, setForm] = useState<CoalPurchaseForm>(() => emptyCoalPurchaseForm(localToday));
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [paymentForm, setPaymentForm] = useState<CoalSelectivePaymentForm>(() => emptyCoalSelectivePaymentForm(localToday));
  const [showPayment, setShowPayment] = useState(false);
  const [sellerDraft, setSellerDraft] = useState({ name: "", address: "", mobile: "" });
  const [showSellerDraft, setShowSellerDraft] = useState(false);
  const [referenceDraft, setReferenceDraft] = useState("");
  const [referenceKind, setReferenceKind] = useState<CoalReferenceKind | null>(null);
  const [fromDate, setFromDate] = useState(`${localToday.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(localToday);
  const [sellerFilter, setSellerFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<CoalPaymentStatusFilter>("all");
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isSavingMaster, setIsSavingMaster] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const suppliersQuery = useQuery({ queryKey: suppliersKey(factoryId), queryFn: () => listSuppliersByRole(factoryId, "COAL_SELLER") });
  const referencesQuery = useQuery({ queryKey: referencesKey(factoryId), queryFn: () => listCoalReferenceValues(factoryId) });
  const purchasesQuery = useQuery({ queryKey: purchasesKey(factoryId), queryFn: () => listCoalPurchases(factoryId) });
  const paymentsQuery = useQuery({ queryKey: paymentsKey(factoryId), queryFn: () => listCoalPayments(factoryId) });
  const suppliers = suppliersQuery.data ?? [];
  const references = referencesQuery.data ?? [];
  const purchases = purchasesQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const coalNames = references.filter((reference) => reference.kind === "coal_name");
  const sources = references.filter((reference) => reference.kind === "source_location");
  const selected = purchases.find((purchase) => purchase.id === selectedId) ?? null;
  const filteredPurchases = filterCoalPurchases(
    purchases, fromDate, toDate, sellerFilter, paymentStatusFilter,
  );
  const filteredPayments = filterCoalPayments(payments, fromDate, toDate, sellerFilter);
  const summary = summarizeCoalPurchases(filteredPurchases);
  const finalTotal = getCoalFinalTotal(form);
  const derivedField = getDerivedCoalMeasurementField(form);
  const payablePurchases = getEligibleCoalSettlementPurchases(
    purchases, paymentForm.sellerId, paymentForm.fromDate, paymentForm.toDate,
  );
  const paymentStatus = getCoalSelectivePaymentStatus(paymentForm, purchases);
  const queryError = suppliersQuery.error || referencesQuery.error
    || purchasesQuery.error || paymentsQuery.error;

  function openCreate() {
    setForm(emptyCoalPurchaseForm(localToday));
    setEditingId("");
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openEdit(purchase: CoalPurchase) {
    if (!canChangeCoalPurchase(purchase)) return;
    setForm(coalPurchaseFormFromSaved(purchase));
    setEditingId(purchase.id);
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openPayment(purchase: CoalPurchase | null = null) {
    const next = emptyCoalSelectivePaymentForm(localToday);
    if (purchase) {
      next.sellerId = purchase.sellerId;
      next.fromDate = purchase.purchaseDate;
      next.toDate = purchase.purchaseDate;
      next.allocations[purchase.id] = String(purchase.outstandingAmount);
    }
    setPaymentForm(next);
    setShowPayment(true);
    setError("");
    setSuccess("");
  }

  async function savePurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      let saved: CoalPurchase;
      if (editingId) {
        const input = buildUpdateCoalPurchaseInput(factoryId, editingId, form);
        if (!input) throw new Error("Complete Seller, Date, Coal Name, Source, Vehicle, and any two calculation values.");
        saved = await updateCoalPurchase(input);
      } else {
        const input = buildCreateCoalPurchaseInput(factoryId, form);
        if (!input) throw new Error("Complete Seller, Date, Coal Name, Source, Vehicle, any two calculation values, and valid payment details.");
        saved = await createCoalPurchase(input);
      }
      queryClient.setQueryData<CoalPurchase[]>(purchasesKey(factoryId), (current = []) =>
        [saved, ...current.filter((purchase) => purchase.id !== saved.id)]);
      setSelectedId(saved.id);
      setShowForm(false);
      setEditingId("");
      setForm(emptyCoalPurchaseForm(localToday));
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: purchasesKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: paymentsKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: ["office-expense-records", factoryId] }),
        queryClient.invalidateQueries({ queryKey: ["office-expense-payments", factoryId] }),
        queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] }),
      ]);
      setSuccess(`Coal Purchase saved. Final Total ${formatSalesMoney(saved.finalTotal)}; Outstanding ${formatSalesMoney(saved.outstandingAmount)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Coal Purchase.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveSeller() {
    if (isSavingMaster || !sellerDraft.name.trim()) return;
    setIsSavingMaster(true);
    setError("");
    try {
      const saved = await createOrAssignSupplierRole({
        factoryId,
        role: "COAL_SELLER",
        name: sellerDraft.name,
        address: sellerDraft.address || null,
        mobile: sellerDraft.mobile || null,
      });
      queryClient.setQueryData<Supplier[]>(suppliersKey(factoryId), (current = []) =>
        [...current.filter((seller) => seller.id !== saved.id), saved]
          .sort((left, right) => left.name.localeCompare(right.name, "en-IN")));
      setForm((current) => ({ ...current, sellerId: saved.id }));
      setSellerDraft({ name: "", address: "", mobile: "" });
      setShowSellerDraft(false);
      await queryClient.invalidateQueries({ queryKey: suppliersKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: ["office-expense-suppliers", factoryId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save seller.");
    } finally {
      setIsSavingMaster(false);
    }
  }

  async function saveReference() {
    if (!referenceKind || isSavingMaster || !referenceDraft.trim()) return;
    setIsSavingMaster(true);
    setError("");
    try {
      const saved = await createCoalReferenceValue(factoryId, referenceKind, referenceDraft);
      queryClient.setQueryData(referencesKey(factoryId), (current: typeof references = []) =>
        [...current.filter((reference) => reference.id !== saved.id), saved]
          .sort((left, right) => left.value.localeCompare(right.value, "en-IN")));
      setForm((current) => ({
        ...current,
        [referenceKind === "coal_name" ? "coalNameReferenceId" : "sourceReferenceId"]: saved.id,
      }));
      setReferenceDraft("");
      setReferenceKind(null);
      await queryClient.invalidateQueries({ queryKey: referencesKey(factoryId) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Coal value.");
    } finally {
      setIsSavingMaster(false);
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPayment) return;
    const input = buildCoalSelectivePaymentInput(factoryId, paymentForm, purchases);
    if (!input) {
      setError(paymentStatus.error || "Complete the selected Coal Purchase allocations.");
      return;
    }
    setIsSavingPayment(true);
    setError("");
    setSuccess("");
    try {
      await createCoalSelectivePayment(input);
      setPaymentForm(emptyCoalSelectivePaymentForm(localToday));
      setShowPayment(false);
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: purchasesKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: paymentsKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: ["office-expense-payments", factoryId] }),
        queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] }),
      ]);
      setSuccess(`Seller payment ${formatSalesMoney(paymentStatus.selectedPayment)} saved with ${input.allocations.length} explicit allocation${input.allocations.length === 1 ? "" : "s"}. Cash Book Money Out updates automatically as one row.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save seller payment.");
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function confirmVoidPurchase() {
    if (!selected || !canChangeCoalPurchase(selected) || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const saved = await voidCoalPurchase(factoryId, selected.id);
      queryClient.setQueryData<CoalPurchase[]>(purchasesKey(factoryId), (current = []) =>
        current.map((purchase) => purchase.id === saved.id ? saved : purchase));
      setConfirmingVoid(false);
      await queryClient.invalidateQueries({ queryKey: purchasesKey(factoryId) });
      setSuccess("Coal Purchase voided. It remains in history and is excluded from active totals.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not void Coal Purchase.");
    } finally {
      setIsSaving(false);
    }
  }

  return <section aria-labelledby="coal-purchase-heading" className="mt-10 border-t-4 border-stone-500 pt-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-wider text-stone-700">Coal Purchase</p><h2 id="coal-purchase-heading" className="mt-1 text-2xl font-bold">Coal purchases and seller dues</h2><p className="mt-1 text-sm text-slate-600">Structured Coal entry with automatic calculation and shared Cash Book payments.</p></div>
      <div className="flex gap-2"><button type="button" onClick={openCreate} className={primaryButton}>New Coal Purchase</button><button type="button" onClick={() => openPayment()} className={secondaryButton}>Pay Seller</button></div>
    </div>
    {queryError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Could not load Coal Purchase data.</p>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    {success && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</p>}

    {showForm && <form onSubmit={savePurchase} className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{editingId ? "Correct Coal Purchase" : "New Coal Purchase"}</h3><button type="button" onClick={() => { setShowForm(false); setEditingId(""); }} className="text-sm font-semibold text-slate-600">Close</button></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SearchChoice label="Seller" options={suppliers.map((seller) => ({ id: seller.id, label: seller.name }))} selectedId={form.sellerId} onSelect={(sellerId) => setForm({ ...form, sellerId })} placeholder="Search seller..." />
        <label className="text-xs font-medium text-slate-600">Purchase date<input type="date" required value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} className={inputClass} /></label>
        <SearchChoice label="Coal Name" options={coalNames.map((reference) => ({ id: reference.id, label: reference.value }))} selectedId={form.coalNameReferenceId} onSelect={(coalNameReferenceId) => setForm({ ...form, coalNameReferenceId })} placeholder="Search Coal Name..." />
        <SearchChoice label="Coal Source / Location" options={sources.map((reference) => ({ id: reference.id, label: reference.value }))} selectedId={form.sourceReferenceId} onSelect={(sourceReferenceId) => setForm({ ...form, sourceReferenceId })} placeholder="Search source..." />
        <label className="text-xs font-medium text-slate-600">Coal Challan No. (optional)<input value={form.coalChallanNumber} onChange={(event) => setForm({ ...form, coalChallanNumber: event.target.value })} maxLength={100} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Vehicle Number<input required value={form.vehicleNumber} onChange={(event) => setForm({ ...form, vehicleNumber: event.target.value.toUpperCase() })} maxLength={100} placeholder="WB58 A 1234" className={inputClass} /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setShowSellerDraft((current) => !current)} className={secondaryButton}>Add Seller</button><button type="button" onClick={() => { setReferenceKind("coal_name"); setReferenceDraft(""); }} className={secondaryButton}>Add Coal Name</button><button type="button" onClick={() => { setReferenceKind("source_location"); setReferenceDraft(""); }} className={secondaryButton}>Add Source</button></div>
      {showSellerDraft && <fieldset className="mt-3 rounded-lg bg-stone-50 p-4"><legend className="font-bold">Add reusable seller</legend><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs">Name<input value={sellerDraft.name} onChange={(event) => setSellerDraft({ ...sellerDraft, name: event.target.value })} className={inputClass} /></label><label className="text-xs">Address (optional)<input value={sellerDraft.address} onChange={(event) => setSellerDraft({ ...sellerDraft, address: event.target.value })} className={inputClass} /></label><label className="text-xs">Mobile (optional)<input value={sellerDraft.mobile} onChange={(event) => setSellerDraft({ ...sellerDraft, mobile: event.target.value })} className={inputClass} /></label></div><button type="button" disabled={isSavingMaster} onClick={() => void saveSeller()} className={`${primaryButton} mt-3`}>Save Seller</button></fieldset>}
      {referenceKind && <fieldset className="mt-3 rounded-lg bg-stone-50 p-4"><legend className="font-bold">Add {referenceKind === "coal_name" ? "Coal Name" : "Coal Source / Location"}</legend><div className="flex max-w-xl items-end gap-2"><label className="flex-1 text-xs">Value<input value={referenceDraft} onChange={(event) => setReferenceDraft(event.target.value)} maxLength={120} className={inputClass} /></label><button type="button" disabled={isSavingMaster} onClick={() => void saveReference()} className={primaryButton}>Save</button><button type="button" onClick={() => setReferenceKind(null)} className={secondaryButton}>Cancel</button></div></fieldset>}
      <div className="mt-5 rounded-lg border border-stone-200 p-4"><h4 className="font-bold">Enter any two values</h4><p className="mt-1 text-xs text-slate-500">Atlas calculates the third. Editing the calculated field makes it an input and recalculates the oldest input.</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{(["quantity", "rate", "coalAmount"] as CoalMeasurementField[]).map((field) => <label key={field} className="text-xs font-medium text-slate-600">{measurementLabel(field)}{derivedField === field ? " (calculated)" : ""}<input inputMode="decimal" value={form[field]} onChange={(event) => setForm(updateCoalMeasurement(form, field, event.target.value))} placeholder="0" className={inputClass} /></label>)}</div></div>
      <div className="mt-4"><button type="button" onClick={() => setForm({ ...form, hasSeparateFreight: !form.hasSeparateFreight, separateFreightAmount: "" })} className={secondaryButton}>{form.hasSeparateFreight ? "Remove separate delivery charge" : "Add separate delivery charge"}</button>{form.hasSeparateFreight && <label className="ml-0 mt-3 block max-w-xs text-xs font-medium text-slate-600 sm:ml-3 sm:inline-block">Separate Delivery Charge<input inputMode="decimal" value={form.separateFreightAmount} onChange={(event) => setForm({ ...form, separateFreightAmount: event.target.value })} className={inputClass} /></label>}</div>
      <div className="mt-5 grid gap-3 rounded-lg bg-stone-50 p-4 sm:grid-cols-3"><Money label="Coal Amount" value={Number(form.coalAmount) || 0} /><Money label="Separate Freight" value={form.hasSeparateFreight ? Number(form.separateFreightAmount) || 0 : 0} /><Money label="Final Total" value={finalTotal ?? 0} /></div>
      {!editingId && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Paid now (blank or 0 = unpaid)<input inputMode="decimal" value={form.initialPaidAmount} onChange={(event) => setForm({ ...form, initialPaidAmount: event.target.value })} placeholder="0" className={inputClass} /></label>{Number(form.initialPaidAmount) > 0 && <label className="text-xs font-medium text-slate-600">Payment mode<select value={form.initialPaymentMode} onChange={(event) => setForm({ ...form, initialPaymentMode: event.target.value })} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label>}</div>}
      <button type="submit" disabled={isSaving} className={`${primaryButton} mt-5`}>{isSaving ? "Saving..." : editingId ? "Save correction" : "Save Coal Purchase"}</button>
    </form>}

    {showPayment && <form onSubmit={savePayment} className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">Settle Coal Seller</h3><p className="mt-1 text-xs text-slate-500">Nothing is selected automatically. Choose purchases and control every allocation.</p></div><button type="button" onClick={() => setShowPayment(false)} className="text-sm font-semibold">Close</button></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SearchChoice label="Coal Seller" options={suppliers.map((seller) => ({ id: seller.id, label: seller.name }))} selectedId={paymentForm.sellerId} onSelect={(sellerId) => setPaymentForm({ ...paymentForm, sellerId, allocations: {} })} placeholder="Search seller..." />
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={paymentForm.fromDate} onChange={(event) => setPaymentForm({ ...paymentForm, fromDate: event.target.value, allocations: {} })} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={paymentForm.toDate} onChange={(event) => setPaymentForm({ ...paymentForm, toDate: event.target.value, allocations: {} })} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Payment date<input type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Payment mode<select value={paymentForm.paymentMode} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMode: event.target.value })} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label>
      </div>
      <div className="mt-4 grid grid-cols-1 rounded-lg bg-stone-50 sm:grid-cols-3"><Money label="Period Outstanding" value={paymentStatus.periodOutstanding} /><div className="p-4"><p className="text-xs uppercase text-slate-500">Selected Purchases</p><p className="mt-1 text-lg font-bold">{paymentStatus.selectedPurchases}</p></div><Money label="Selected Payment" value={paymentStatus.selectedPayment} /></div>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h4 className="text-sm font-bold">Outstanding Coal Purchases</h4><p className="mt-1 text-xs text-slate-500">From and To are inclusive. Only checked rows will receive payment.</p></div>
        {payablePurchases.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">Choose a seller and valid range with outstanding Coal Purchases.</p> : <ul className="divide-y divide-slate-100">{payablePurchases.map((purchase) => {
          const selectedForPayment = Object.prototype.hasOwnProperty.call(paymentForm.allocations, purchase.id);
          return <li key={purchase.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[2rem_minmax(16rem,1fr)_minmax(12rem,auto)_11rem_7rem] lg:items-center">
            <input type="checkbox" aria-label={`Select Coal Purchase ${purchase.coalChallanNumber ?? purchase.id}`} checked={selectedForPayment} onChange={(event) => setPaymentForm(toggleCoalSettlementPurchase(paymentForm, purchase, event.target.checked))} className="h-4 w-4" />
            <div><p className="font-bold">{formatChallanDate(purchase.purchaseDate)}{purchase.coalChallanNumber ? ` · Challan ${purchase.coalChallanNumber}` : ""}</p><p className="mt-1 text-sm text-slate-700">{purchase.coalNameSnapshot} · {purchase.sourceLocationSnapshot} · {purchase.vehicleNumberSnapshot}</p></div>
            <div className="text-sm lg:text-right"><p>Total {formatSalesMoney(purchase.finalTotal)}</p><p className="text-slate-500">Paid {formatSalesMoney(purchase.totalPaid)}</p><p className="font-bold">Outstanding {formatSalesMoney(purchase.outstandingAmount)}</p></div>
            <label className="text-xs font-medium text-slate-600">Pay This Time<input inputMode="decimal" disabled={!selectedForPayment} value={paymentForm.allocations[purchase.id] ?? ""} onChange={(event) => setPaymentForm({ ...paymentForm, allocations: { ...paymentForm.allocations, [purchase.id]: event.target.value } })} className={inputClass} /></label>
            <button type="button" disabled={!selectedForPayment} onClick={() => setPaymentForm({ ...paymentForm, allocations: { ...paymentForm.allocations, [purchase.id]: String(purchase.outstandingAmount) } })} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold disabled:opacity-50">Use full due</button>
          </li>;
        })}</ul>}
      </div>
      <label className="mt-4 block max-w-xl text-xs font-medium text-slate-600">Reference / note (optional)<input value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} maxLength={500} className={inputClass} /></label>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold">Confirm Total Payment: {formatSalesMoney(paymentStatus.selectedPayment)}</p><button type="submit" disabled={!paymentStatus.canSubmit || isSavingPayment} className={primaryButton}>{isSavingPayment ? "Saving..." : "Save Seller Payment"}</button></div>
      {!paymentStatus.canSubmit && (paymentStatus.selectedPurchases > 0 || paymentForm.paymentMode) && <p className="mt-3 text-xs font-medium text-amber-800">{paymentStatus.error}</p>}
    </form>}

    <section aria-labelledby="coal-history-heading" className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <h3 id="coal-history-heading" className="text-xl font-bold">Coal Purchase history and seller statement</h3>
        <p className="mt-1 text-xs text-slate-500">From, To, and Seller apply to both views. Payment Status applies only to Detailed Purchase History.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="text-xs font-medium">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={inputClass} /></label>
          <label className="text-xs font-medium">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={inputClass} /></label>
          <label className="text-xs font-medium">Seller<select value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)} className={inputClass}><option value="">All Sellers</option>{suppliers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
          <label className="text-xs font-medium">Payment Status<select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value as CoalPaymentStatusFilter)} className={inputClass}><option value="all">All</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></select></label>
        </div>
      </div>

      <section aria-labelledby="coal-detailed-history-heading">
        <div className="p-5"><h4 id="coal-detailed-history-heading" className="text-lg font-bold">Detailed Purchase History</h4><p className="mt-1 text-xs text-slate-500">Payment Status filters this table and its totals.</p></div>
        <div className="grid grid-cols-2 bg-stone-50 sm:grid-cols-4"><Money label="Purchased" value={summary.totalPurchased} /><Money label="Paid against purchases" value={summary.totalPaid} /><Money label="Outstanding" value={summary.totalOutstanding} /><div className="p-4"><p className="text-xs uppercase text-slate-500">Active purchases</p><p className="mt-1 text-lg font-bold">{summary.activePurchases}</p></div></div>
        <div className="overflow-auto"><table className="w-full min-w-[90rem] text-left text-sm"><thead className="border-y border-slate-200 bg-white text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">Seller</th><th className="px-3 py-3">Coal</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Challan</th><th className="px-3 py-3">Vehicle</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3 text-right">Coal amount</th><th className="px-3 py-3 text-right">Freight</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Due</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredPurchases.map((purchase) => <tr key={purchase.id} onClick={() => { setSelectedId(purchase.id); setConfirmingVoid(false); }} className="cursor-pointer hover:bg-stone-50"><td className="px-3 py-3">{formatChallanDate(purchase.purchaseDate)}</td><td className="px-3 py-3 font-semibold">{purchase.sellerNameSnapshot}</td><td className="px-3 py-3">{purchase.coalNameSnapshot}</td><td className="px-3 py-3">{purchase.sourceLocationSnapshot}</td><td className="px-3 py-3">{purchase.coalChallanNumber ?? "—"}</td><td className="px-3 py-3">{purchase.vehicleNumberSnapshot}</td><td className="px-3 py-3 text-right">{purchase.quantity.toLocaleString("en-IN")}</td><td className="px-3 py-3 text-right">{formatSalesMoney(purchase.rate)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(purchase.coalAmount)}</td><td className="px-3 py-3 text-right">{purchase.separateFreightAmount ? formatSalesMoney(purchase.separateFreightAmount) : "Included"}</td><td className="px-3 py-3 text-right font-bold">{formatSalesMoney(purchase.finalTotal)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(purchase.totalPaid)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(purchase.outstandingAmount)}</td><td className="px-3 py-3">{purchase.status === "void" ? "Void" : purchase.paymentState === "partially_paid" ? "Partial" : purchase.paymentState === "paid" ? "Paid" : "Unpaid"}</td></tr>)}</tbody></table>{filteredPurchases.length === 0 && <p className="p-6 text-sm text-slate-500">No Coal Purchases match these filters.</p>}</div>
      </section>

      <section aria-labelledby="coal-payment-history-heading" className="border-t border-slate-200 p-5"><h4 id="coal-payment-history-heading" className="text-lg font-bold">Seller Payment History</h4><p className="mt-1 text-xs text-slate-500">From, To, and Seller apply here; Payment Status does not. Each immutable payment appears once.</p>{filteredPayments.length === 0 ? <p className="mt-4 text-sm text-slate-500">No seller payments in this range.</p> : <ul className="mt-4 space-y-3">{filteredPayments.map((payment) => <li key={payment.id} className="rounded-lg border border-slate-200 p-4 text-sm"><div className="flex flex-wrap justify-between gap-3"><span><strong>{payment.sellerNameSnapshot}</strong> · {formatChallanDate(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)} · {payment.allocationCount} purchase{payment.allocationCount === 1 ? "" : "s"}{payment.note ? ` · ${payment.note}` : ""}</span><span className="font-bold">{formatSalesMoney(payment.amount)}</span></div><ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">{payment.allocations.map((allocation) => <li key={allocation.purchaseId} className="flex flex-wrap justify-between gap-3 py-2"><span>{formatChallanDate(allocation.purchaseDate)}{allocation.coalChallanNumber ? ` · Challan ${allocation.coalChallanNumber}` : ""} · {allocation.coalNameSnapshot} · {allocation.vehicleNumberSnapshot}</span><span className="font-semibold">{formatSalesMoney(allocation.allocatedAmount)}</span></li>)}</ul></li>)}</ul>}</section>
    </section>

    {selected && <section className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">{selected.coalNameSnapshot} · {selected.sellerNameSnapshot}</h3><p className="mt-1 text-sm text-slate-600">{formatChallanDate(selected.purchaseDate)} · {selected.sourceLocationSnapshot} · {selected.vehicleNumberSnapshot}</p></div><button type="button" onClick={() => setSelectedId("")} className="text-sm font-semibold">Close</button></div><div className="mt-4 grid gap-3 sm:grid-cols-4"><Money label="Final Total" value={selected.finalTotal} /><Money label="Paid" value={selected.totalPaid} /><Money label="Outstanding" value={selected.outstandingAmount} /><div><p className="text-xs uppercase text-slate-500">Coal Challan</p><p className="mt-1 font-bold">{selected.coalChallanNumber ?? "—"}</p></div></div><div className="mt-4 flex gap-2"><button type="button" disabled={!canChangeCoalPurchase(selected)} onClick={() => openEdit(selected)} className={secondaryButton}>Correct</button><button type="button" disabled={!canChangeCoalPurchase(selected)} onClick={() => setConfirmingVoid(true)} className={secondaryButton}>Void</button><button type="button" disabled={selected.status !== "active" || selected.outstandingAmount <= 0} onClick={() => openPayment(selected)} className={primaryButton}>Pay Seller</button></div>{!canChangeCoalPurchase(selected) && selected.totalPaid > 0 && <p className="mt-3 text-xs text-slate-500">Payment history locks this purchase from correction or voiding.</p>}{confirmingVoid && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm"><p className="font-semibold text-red-800">Void this unpaid Coal Purchase?</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void confirmVoidPurchase()} className="h-9 rounded bg-red-700 px-3 font-bold text-white">Confirm Void</button><button type="button" onClick={() => setConfirmingVoid(false)} className={secondaryButton}>Cancel</button></div></div>}</section>}

  </section>;
}

function measurementLabel(field: CoalMeasurementField): string {
  if (field === "quantity") return "Quantity";
  if (field === "rate") return "Rate";
  return "Coal Amount";
}

function Money({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div className="p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{formatSalesMoney(value)}</p></div>;
}
