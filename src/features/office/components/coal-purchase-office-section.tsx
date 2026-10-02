"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Checkbox, Input, Select } from "@/components/ui/form-controls";
import { FormField } from "@/components/ui/form-field";
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
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { ATLAS_UI_STRINGS } from "@/lib/strings";
import { CoalOfficeWorkspace } from "@/features/office/components/coal-office-workspace";
import {
  getOfficeCoalHash,
  getOfficeCoalPurchasesArchiveHash,
  getOfficeCoalSellerPaymentsArchiveHash,
  resolveOfficeCoalAreaFromHash,
  type OfficeCoalAreaId,
} from "@/features/office/office-navigation";
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
  setCoalSettlementAllocation,
  setCoalSettlementPaymentAmount,
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
import type { CoalPayment, CoalPurchase, CoalReferenceKind } from "../../coal/types";
import {
  createOrAssignSupplierRole,
  listSuppliersByRole,
} from "../../expenses/services/supplier-role-service";
import type { Supplier } from "../../expenses/types";
import { formatCustomerPaymentMode, NEW_CUSTOMER_PAYMENT_MODES } from "../../sales/types";
import { formatSalesMoney } from "../sales-office-model";
import { getLocalDate } from "../../../lib/local-date";
import { SearchChoice } from "./search-choice";
import { CoalSellerPaymentDetailDrawer } from "./coal-seller-payment-detail-drawer";

const suppliersKey = (factoryId: string) => ["office-suppliers-by-role", factoryId, "COAL_SELLER"] as const;
const referencesKey = (factoryId: string) => ["office-coal-references", factoryId] as const;
const purchasesKey = (factoryId: string) => ["office-coal-purchases", factoryId] as const;
const paymentsKey = (factoryId: string) => ["office-coal-payments", factoryId] as const;
type CoalInlineEditor = "seller" | CoalReferenceKind;

export function CoalPurchaseOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [activeArea, setActiveArea] = useState<OfficeCoalAreaId>("coal-purchases");
  const [localToday] = useState(() => getLocalDate());
  const [showPurchaseArchive, setShowPurchaseArchive] = useState(false);
  const [showPaymentArchive, setShowPaymentArchive] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFromDate, setArchiveFromDate] = useState(`${localToday.slice(0, 7)}-01`);
  const [archiveToDate, setArchiveToDate] = useState(localToday);
  const [archiveSellerId, setArchiveSellerId] = useState("");
  const [archivePaymentStatus, setArchivePaymentStatus] = useState<CoalPaymentStatusFilter>("all");
  const [paymentArchiveSearch, setPaymentArchiveSearch] = useState("");
  const [paymentArchiveFromDate, setPaymentArchiveFromDate] = useState(`${localToday.slice(0, 7)}-01`);
  const [paymentArchiveToDate, setPaymentArchiveToDate] = useState(localToday);
  const [paymentArchiveSellerId, setPaymentArchiveSellerId] = useState("");
  const [paymentArchiveMode, setPaymentArchiveMode] = useState<CoalPayment["paymentMode"] | "">("");
  const [form, setForm] = useState<CoalPurchaseForm>(() => emptyCoalPurchaseForm(localToday));
  const [editingId, setEditingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [paymentDetailId, setPaymentDetailId] = useState("");
  const [paymentForm, setPaymentForm] = useState<CoalSelectivePaymentForm>(() => emptyCoalSelectivePaymentForm(localToday));
  const [sellerDraft, setSellerDraft] = useState({ name: "", address: "", mobile: "" });
  const [inlineEditor, setInlineEditor] = useState<CoalInlineEditor | null>(null);
  const [referenceDraft, setReferenceDraft] = useState("");
  const referenceKind = inlineEditor === "coal_name" || inlineEditor === "source_location"
    ? inlineEditor
    : null;
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
  const recentPurchases = purchases.slice(0, 6);
  const archivePurchases = filterCoalPurchases(
    purchases,
    archiveFromDate,
    archiveToDate,
    archiveSellerId,
    archivePaymentStatus,
    archiveSearch,
  );
  const archiveSummary = summarizeCoalPurchases(archivePurchases);
  const selectedSeller = suppliers.find((seller) => seller.id === paymentForm.sellerId) ?? null;
  const sellerSummary = summarizeCoalPurchases(
    purchases.filter((purchase) => purchase.sellerId === paymentForm.sellerId),
  );
  const recentSellerPayments = payments
    .filter((payment) => !paymentForm.sellerId || payment.sellerId === paymentForm.sellerId)
    .slice(0, 6);
  const archivePayments = filterCoalPayments(
    payments,
    paymentArchiveFromDate,
    paymentArchiveToDate,
    paymentArchiveSellerId,
    paymentArchiveMode,
    paymentArchiveSearch,
  );
  const paymentDetail = payments.find((payment) => payment.id === paymentDetailId) ?? null;
  const finalTotal = getCoalFinalTotal(form);
  const derivedField = getDerivedCoalMeasurementField(form);
  const payablePurchases = getEligibleCoalSettlementPurchases(
    purchases, paymentForm.sellerId, paymentForm.fromDate, paymentForm.toDate,
  );
  const paymentStatus = getCoalSelectivePaymentStatus(paymentForm, purchases);
  const queryError = suppliersQuery.error || referencesQuery.error
    || purchasesQuery.error || paymentsQuery.error;

  useEffect(() => {
    function syncCoalAreaFromHash() {
      const area = resolveOfficeCoalAreaFromHash(window.location.hash);
      if (area) setActiveArea(area);
      setShowPurchaseArchive(window.location.hash === getOfficeCoalPurchasesArchiveHash());
      setShowPaymentArchive(window.location.hash === getOfficeCoalSellerPaymentsArchiveHash());
    }

    syncCoalAreaFromHash();
    window.addEventListener("hashchange", syncCoalAreaFromHash);
    return () => window.removeEventListener("hashchange", syncCoalAreaFromHash);
  }, []);

  function selectCoalArea(area: OfficeCoalAreaId) {
    setActiveArea(area);
    setShowPurchaseArchive(false);
    setShowPaymentArchive(false);
    window.location.hash = getOfficeCoalHash(area);
  }

  function openPurchaseArchive() {
    setActiveArea("coal-purchases");
    setShowPurchaseArchive(true);
    setShowPaymentArchive(false);
    window.location.hash = getOfficeCoalPurchasesArchiveHash();
  }

  function closePurchaseArchive() {
    setShowPurchaseArchive(false);
    window.location.hash = getOfficeCoalHash("coal-purchases");
  }

  function openPaymentArchive() {
    setActiveArea("seller-payments");
    setShowPurchaseArchive(false);
    setShowPaymentArchive(true);
    window.location.hash = getOfficeCoalSellerPaymentsArchiveHash();
  }

  function closePaymentArchive() {
    setShowPaymentArchive(false);
    window.location.hash = getOfficeCoalHash("seller-payments");
  }

  function openPurchaseFromPayment(purchaseId: string) {
    if (!canOpenPurchaseFromPayment(purchaseId)) return;
    setPaymentDetailId("");
    openPurchaseDetail(purchaseId);
  }

  function canOpenPurchaseFromPayment(purchaseId: string) {
    return purchases.some((purchase) => purchase.id === purchaseId);
  }

  function openCreate() {
    setForm(emptyCoalPurchaseForm(localToday));
    setEditingId("");
    setSelectedId("");
    setConfirmingVoid(false);
    setError("");
    setSuccess("");
  }

  function toggleInlineEditor(editor: CoalInlineEditor) {
    const opening = inlineEditor !== editor;
    setInlineEditor(opening ? editor : null);
    if (opening && editor !== "seller") setReferenceDraft("");
  }

  function openPurchaseDetail(purchaseId: string) {
    if (!purchases.some((purchase) => purchase.id === purchaseId)) return;
    setSelectedId(purchaseId);
    setEditingId("");
    setConfirmingVoid(false);
    setActiveArea("coal-purchases");
    setShowPurchaseArchive(false);
    setShowPaymentArchive(false);
    setError("");
    setSuccess("");
    window.location.hash = getOfficeCoalHash("coal-purchases");
  }

  function openEdit(purchase: CoalPurchase) {
    if (!canChangeCoalPurchase(purchase)) return;
    setForm(coalPurchaseFormFromSaved(purchase));
    setSelectedId(purchase.id);
    setEditingId(purchase.id);
    closePurchaseArchive();
    setError("");
    setSuccess("");
  }

  function openPayment(purchase: CoalPurchase | null = null) {
    const next = emptyCoalSelectivePaymentForm(localToday);
    if (purchase) {
      next.sellerId = purchase.sellerId;
      next.fromDate = purchase.purchaseDate;
      next.toDate = purchase.purchaseDate;
      next.amount = String(purchase.outstandingAmount);
      next.allocations[purchase.id] = String(purchase.outstandingAmount);
    }
    setPaymentForm(next);
    selectCoalArea("seller-payments");
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
      setInlineEditor((current) => current === "seller" ? null : current);
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
      setInlineEditor((current) => current === referenceKind ? null : current);
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

  return <CoalOfficeWorkspace activeArea={activeArea} onAreaChange={selectCoalArea}>
    <section aria-label="Coal workspace">
    {activeArea === "coal-purchases" && !showPurchaseArchive && <>
      <div>
        <h2 id="coal-purchase-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Coal Purchases</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record a purchase and review the latest saved entries.</p>
      </div>
      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Coal Purchase data.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {selected && <div className="mb-atlas-3 flex flex-wrap items-center justify-end gap-atlas-2" aria-label="Coal Purchase actions">
            {!editingId && <>
              <Button type="button" variant="secondary" disabled={!canChangeCoalPurchase(selected)} onClick={() => openEdit(selected)}>Correct</Button>
              <Button type="button" variant="danger" disabled={!canChangeCoalPurchase(selected)} onClick={() => setConfirmingVoid(true)}>Void</Button>
              <Button type="button" variant="secondary" disabled={selected.status !== "active" || selected.outstandingAmount <= 0} onClick={() => openPayment(selected)}>Pay Seller</Button>
            </>}
            <Button type="button" onClick={openCreate}>New Coal Purchase</Button>
          </div>}
          <Card as="section" aria-label="Coal Purchase work area">
            {(!selected || editingId) && <form onSubmit={savePurchase}>
              <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="new-coal-purchase-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{editingId ? "Correct Coal Purchase" : "New Coal Purchase"}</h3>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Enter the real supplier and delivery details for this purchase.</p>
                </div>
                {editingId && <Button type="button" variant="ghost" onClick={openCreate}>Cancel correction</Button>}
              </div>

              <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
                <SearchChoice v2 label="Seller" options={suppliers.map((seller) => ({ id: seller.id, label: seller.name }))} selectedId={form.sellerId} onSelect={(sellerId) => setForm({ ...form, sellerId })} placeholder="Search seller..." />
                <FormField label="Business date"><Input type="date" required value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} /></FormField>
                <SearchChoice v2 label="Coal" options={coalNames.map((reference) => ({ id: reference.id, label: reference.value }))} selectedId={form.coalNameReferenceId} onSelect={(coalNameReferenceId) => setForm({ ...form, coalNameReferenceId })} placeholder="Search Coal..." />
                <SearchChoice v2 label="Source" options={sources.map((reference) => ({ id: reference.id, label: reference.value }))} selectedId={form.sourceReferenceId} onSelect={(sourceReferenceId) => setForm({ ...form, sourceReferenceId })} placeholder="Search source..." />
                <FormField label="Coal Challan No. (optional)"><Input value={form.coalChallanNumber} onChange={(event) => setForm({ ...form, coalChallanNumber: event.target.value })} maxLength={100} /></FormField>
                <FormField label="Vehicle Number"><Input required value={form.vehicleNumber} onChange={(event) => setForm({ ...form, vehicleNumber: event.target.value.toUpperCase() })} maxLength={100} placeholder="WB58 A 1234" /></FormField>
              </div>

              <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
                <Button type="button" variant="secondary" onClick={() => toggleInlineEditor("seller")}>Add Seller</Button>
                <Button type="button" variant="secondary" onClick={() => toggleInlineEditor("coal_name")}>Add Coal</Button>
                <Button type="button" variant="secondary" onClick={() => toggleInlineEditor("source_location")}>Add Source</Button>
              </div>

              {inlineEditor === "seller" && <fieldset className="mt-atlas-3 rounded-atlas-card border border-atlas-border bg-atlas-surface-muted p-atlas-3">
                <legend className="px-atlas-1 text-atlas-sm font-atlas-semibold text-atlas-text">Add reusable seller</legend>
                <div className="grid gap-atlas-3 sm:grid-cols-3">
                  <FormField label="Name"><Input value={sellerDraft.name} onChange={(event) => setSellerDraft({ ...sellerDraft, name: event.target.value })} /></FormField>
                  <FormField label="Address (optional)"><Input value={sellerDraft.address} onChange={(event) => setSellerDraft({ ...sellerDraft, address: event.target.value })} /></FormField>
                  <FormField label="Mobile (optional)"><Input inputMode="tel" value={sellerDraft.mobile} onChange={(event) => setSellerDraft({ ...sellerDraft, mobile: event.target.value })} /></FormField>
                </div>
                <div className="mt-atlas-3"><Button type="button" loading={isSavingMaster} loadingLabel={ATLAS_UI_STRINGS.feedback.saving} onClick={() => void saveSeller()}>Save Seller</Button></div>
              </fieldset>}

              {referenceKind && <fieldset className="mt-atlas-3 rounded-atlas-card border border-atlas-border bg-atlas-surface-muted p-atlas-3">
                <legend className="px-atlas-1 text-atlas-sm font-atlas-semibold text-atlas-text">Add {referenceKind === "coal_name" ? "Coal" : "Source"}</legend>
                <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1"><FormField label="Value"><Input value={referenceDraft} onChange={(event) => setReferenceDraft(event.target.value)} maxLength={120} /></FormField></div>
                  <Button type="button" loading={isSavingMaster} loadingLabel={ATLAS_UI_STRINGS.feedback.saving} onClick={() => void saveReference()}>{ATLAS_UI_STRINGS.actions.save}</Button>
                  <Button type="button" variant="ghost" onClick={() => setInlineEditor(null)}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                </div>
              </fieldset>}

              <div className="mt-atlas-4">
                <Card surface="muted">
                  <h4 className="text-atlas-sm font-atlas-semibold text-atlas-text">Enter any two values</h4>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Atlas calculates the third. Editing the calculated field makes it an input and recalculates the oldest input.</p>
                  <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-3">
                    {(["quantity", "rate", "coalAmount"] as CoalMeasurementField[]).map((field) => <FormField key={field} label={<>{measurementLabel(field)}{derivedField === field ? " (calculated)" : ""}</>}><Input inputMode="decimal" value={form[field]} onChange={(event) => setForm(updateCoalMeasurement(form, field, event.target.value))} placeholder="0" /></FormField>)}
                  </div>
                </Card>
              </div>

              <div className="mt-atlas-4">
                <label className="flex min-h-atlas-12 items-center gap-atlas-2 text-atlas-sm font-atlas-medium text-atlas-text">
                  <Checkbox checked={form.hasSeparateFreight} onChange={(event) => setForm({ ...form, hasSeparateFreight: event.target.checked, separateFreightAmount: "" })} />
                  Add separate delivery charge
                </label>
                {form.hasSeparateFreight && <div className="mt-atlas-2 max-w-sm"><FormField label="Separate Delivery Charge"><Input inputMode="decimal" value={form.separateFreightAmount} onChange={(event) => setForm({ ...form, separateFreightAmount: event.target.value })} placeholder="0" /></FormField></div>}
              </div>

              <div className="mt-atlas-4">
                <Card surface="muted">
                  <div className="grid gap-atlas-2 sm:grid-cols-3">
                    <CoalTotal label="Coal Amount" value={Number(form.coalAmount) || 0} />
                    <CoalTotal label="Separate Freight" value={form.hasSeparateFreight ? Number(form.separateFreightAmount) || 0 : 0} />
                    <CoalTotal label="Final Total" value={finalTotal ?? 0} emphasized />
                  </div>
                </Card>
              </div>

              {!editingId && <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
                <FormField label="Paid now (blank or 0 = unpaid)"><Input inputMode="decimal" value={form.initialPaidAmount} onChange={(event) => setForm({ ...form, initialPaidAmount: event.target.value })} placeholder="0" /></FormField>
                {Number(form.initialPaidAmount) > 0 && <FormField label="Payment mode"><Select value={form.initialPaymentMode} onChange={(event) => setForm({ ...form, initialPaymentMode: event.target.value })}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>}
              </div>}

              <div className="mt-atlas-5 flex flex-wrap items-center justify-end gap-atlas-2">
                <Button type="button" variant="ghost" onClick={openCreate}>{editingId ? ATLAS_UI_STRINGS.actions.cancel : ATLAS_UI_STRINGS.actions.clear}</Button>
                <Button type="submit" loading={isSaving} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{editingId ? "Save correction" : "Save Coal Purchase"}</Button>
              </div>
            </form>}
            {selected && !editingId && <CoalPurchaseDetail
              purchase={selected}
              confirmingVoid={confirmingVoid}
              isVoiding={isSaving}
              onCancelVoid={() => setConfirmingVoid(false)}
              onConfirmVoid={() => void confirmVoidPurchase()}
            />}
          </Card>
        </div>

        <Card as="section" aria-labelledby="recent-coal-purchases-heading">
          <div className="flex h-96 flex-col">
            <div className="border-b border-atlas-border pb-atlas-3">
              <h3 id="recent-coal-purchases-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Coal Purchases</h3>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Latest 6 saved purchases</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {purchasesQuery.isLoading ? <EmptyState title="Loading purchases..." /> : recentPurchases.length === 0 ? <EmptyState title="No Coal Purchases saved yet." /> : <ul className="divide-y divide-atlas-border">{recentPurchases.map((purchase) => <li key={purchase.id} className="py-atlas-3">
                <div className="flex items-start justify-between gap-atlas-2">
                  <div className="min-w-0">
                    <p className="truncate text-atlas-sm font-atlas-semibold text-atlas-text">{purchase.sellerNameSnapshot}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(purchase.purchaseDate)} · {purchase.coalNameSnapshot}</p>
                    <p className="mt-atlas-1 text-atlas-xs tabular-nums text-atlas-text-muted">{formatIndianNumber(purchase.quantity)} · {formatIndianCurrency(purchase.finalTotal)} · {coalPurchaseStateLabel(purchase)}</p>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => openPurchaseDetail(purchase.id)}>{ATLAS_UI_STRINGS.actions.open}</Button>
                </div>
              </li>)}</ul>}
            </div>
            <div className="border-t border-atlas-border pt-atlas-3">
              <Button type="button" variant="ghost" onClick={openPurchaseArchive}>View all purchases →</Button>
            </div>
          </div>
        </Card>
      </div>
    </>}

    {activeArea === "coal-purchases" && showPurchaseArchive && <>
      <div>
        <Button type="button" variant="ghost" onClick={closePurchaseArchive}>← Back to Coal Purchases</Button>
        <h2 id="all-coal-purchases-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Coal Purchases</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review the authoritative Coal Purchase history.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Coal Purchase history.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4"><Card as="section" aria-labelledby="coal-purchase-archive-filters-heading">
        <h3 id="coal-purchase-archive-filters-heading" className="sr-only">Coal Purchase archive filters</h3>
        <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-5">
          <FormField label="Search purchases"><Input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="Seller, Coal, source, challan or vehicle" /></FormField>
          <FormField label="From"><Input type="date" value={archiveFromDate} onChange={(event) => setArchiveFromDate(event.target.value)} /></FormField>
          <FormField label="To"><Input type="date" value={archiveToDate} onChange={(event) => setArchiveToDate(event.target.value)} /></FormField>
          <FormField label="Seller"><Select value={archiveSellerId} onChange={(event) => setArchiveSellerId(event.target.value)}><option value="">All Sellers</option>{suppliers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</Select></FormField>
          <FormField label="Payment status"><Select value={archivePaymentStatus} onChange={(event) => setArchivePaymentStatus(event.target.value as CoalPaymentStatusFilter)}><option value="all">All</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></Select></FormField>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><Card as="section" surface="muted" aria-label="Filtered Coal Purchase totals">
        <div className="grid grid-cols-2 gap-atlas-3 lg:grid-cols-4">
          <CoalTotal label="Purchased" value={archiveSummary.totalPurchased} />
          <CoalTotal label="Paid" value={archiveSummary.totalPaid} />
          <CoalTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={archiveSummary.totalOutstanding} emphasized />
          <div>
            <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">Active Purchases</p>
            <p className="mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(archiveSummary.activePurchases)}</p>
          </div>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><TableContainer bounded aria-label="All Coal Purchases table">
        <Table wide>
          <TableCaption visuallyHidden>All Coal Purchases matching the selected filters</TableCaption>
          <TableHeader sticky>
            <TableRow>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell>Seller</TableHeaderCell>
              <TableHeaderCell>Coal</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Challan</TableHeaderCell>
              <TableHeaderCell>Vehicle</TableHeaderCell>
              <TableHeaderCell numeric>Quantity</TableHeaderCell>
              <TableHeaderCell numeric>Rate</TableHeaderCell>
              <TableHeaderCell numeric>Coal Amount</TableHeaderCell>
              <TableHeaderCell numeric>Freight</TableHeaderCell>
              <TableHeaderCell numeric>Total</TableHeaderCell>
              <TableHeaderCell numeric>Paid</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.payment.outstanding}</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archivePurchases.map((purchase) => <TableRow key={purchase.id} hoverable selected={selectedId === purchase.id}>
              <TableCell>{formatDateOnly(purchase.purchaseDate)}</TableCell>
              <TableCell><span className="font-atlas-semibold">{purchase.sellerNameSnapshot}</span></TableCell>
              <TableCell>{purchase.coalNameSnapshot}</TableCell>
              <TableCell>{purchase.sourceLocationSnapshot}</TableCell>
              <TableCell>{purchase.coalChallanNumber ?? "—"}</TableCell>
              <TableCell>{purchase.vehicleNumberSnapshot}</TableCell>
              <TableCell numeric>{formatIndianNumber(purchase.quantity)}</TableCell>
              <TableCell numeric>{formatIndianCurrency(purchase.rate)}</TableCell>
              <TableCell numeric>{formatIndianCurrency(purchase.coalAmount)}</TableCell>
              <TableCell numeric>{purchase.separateFreightAmount > 0 ? formatIndianCurrency(purchase.separateFreightAmount) : "Included"}</TableCell>
              <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(purchase.finalTotal)}</span></TableCell>
              <TableCell numeric>{formatIndianCurrency(purchase.totalPaid)}</TableCell>
              <TableCell numeric>{formatIndianCurrency(purchase.outstandingAmount)}</TableCell>
              <TableCell>{coalPurchaseStateLabel(purchase)}</TableCell>
              <TableCell><Button type="button" variant="ghost" onClick={() => openPurchaseDetail(purchase.id)}>{ATLAS_UI_STRINGS.actions.open} →</Button></TableCell>
            </TableRow>)}
            {!purchasesQuery.isLoading && archivePurchases.length === 0 && <TableRow><TableCell colSpan={15}>No Coal Purchases match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer></div>
      {purchasesQuery.isLoading && <EmptyState title="Loading Coal Purchase history..." />}
    </>}

    {activeArea === "seller-payments" && !showPaymentArchive && <>
      <div>
        <h2 className="text-atlas-2xl font-atlas-semibold text-atlas-text">Seller Payments</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record one payment and explicitly allocate it to genuine outstanding Coal purchases.</p>
      </div>
      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Seller Payment data.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
        <form onSubmit={savePayment} className="space-y-atlas-4 lg:col-span-2">
          <Card as="section" aria-labelledby="seller-summary-heading">
            <h3 id="seller-summary-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Seller summary</h3>
            <div className="mt-atlas-3"><SearchChoice v2 label="Coal Seller" options={suppliers.map((seller) => ({ id: seller.id, label: seller.name }))} selectedId={paymentForm.sellerId} onSelect={(sellerId) => setPaymentForm({ ...paymentForm, sellerId, amount: "", allocations: {} })} placeholder="Search seller..." /></div>
            <div className="mt-atlas-4 grid gap-atlas-3 border-t border-atlas-border pt-atlas-3 sm:grid-cols-3">
              <CoalTotal label="Purchased" value={sellerSummary.totalPurchased} />
              <CoalTotal label="Paid" value={sellerSummary.totalPaid} />
              <CoalTotal label="Outstanding" value={sellerSummary.totalOutstanding} emphasized />
            </div>
          </Card>

          <Card as="section" aria-labelledby="seller-payment-details-heading">
            <h3 id="seller-payment-details-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Payment details</h3>
            <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-2">
              <FormField label="Payment date"><Input type="date" value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></FormField>
              <FormField label={ATLAS_UI_STRINGS.payment.amount}><Input inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => setCoalSettlementPaymentAmount(current, event.target.value))} placeholder="0" /></FormField>
              <FormField label="Payment mode"><Select value={paymentForm.paymentMode} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMode: event.target.value })}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
              <FormField label="Reference / note (optional)"><Input value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} maxLength={500} /></FormField>
            </div>
          </Card>

          <Card as="section" aria-labelledby="outstanding-coal-purchases-heading">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="outstanding-coal-purchases-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Outstanding Coal Purchases</h3>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Nothing is selected automatically. Choose each purchase and control its allocation.</p>
              </div>
              <p className="text-atlas-xs tabular-nums text-atlas-text-muted">{paymentStatus.selectedPurchases} selected · {formatIndianCurrency(paymentStatus.periodOutstanding)} due in range</p>
            </div>
            <div className="mt-atlas-3 grid gap-atlas-3 border-t border-atlas-border pt-atlas-3 sm:grid-cols-2">
              <FormField label="Purchases from"><Input type="date" value={paymentForm.fromDate} onChange={(event) => setPaymentForm({ ...paymentForm, fromDate: event.target.value, amount: "", allocations: {} })} /></FormField>
              <FormField label="Purchases to"><Input type="date" value={paymentForm.toDate} onChange={(event) => setPaymentForm({ ...paymentForm, toDate: event.target.value, amount: "", allocations: {} })} /></FormField>
            </div>

            <div className="mt-atlas-3 border-y border-atlas-border">
              {!paymentForm.sellerId ? <EmptyState title="Choose a Coal Seller" description="Outstanding purchases will appear here." /> : payablePurchases.length === 0 ? <EmptyState title="No outstanding Coal Purchases" description="There are no payable purchases for this seller and date range." /> : <ul className="divide-y divide-atlas-border">{payablePurchases.map((purchase) => {
                const selectedForPayment = Object.prototype.hasOwnProperty.call(paymentForm.allocations, purchase.id);
                return <li key={purchase.id} className={selectedForPayment ? "bg-atlas-primary-surface px-atlas-3 py-atlas-3" : "px-atlas-3 py-atlas-3"}>
                  <div className="grid gap-atlas-3 lg:grid-cols-2 lg:items-center">
                    <label className="flex min-w-0 items-start gap-atlas-3">
                      <Checkbox aria-label={`Select Coal Purchase ${purchase.coalChallanNumber ?? purchase.id}`} checked={selectedForPayment} onChange={(event) => setPaymentForm((current) => toggleCoalSettlementPurchase(current, purchase, event.target.checked))} />
                      <span className="min-w-0">
                        <span className="block text-atlas-sm font-atlas-semibold text-atlas-text">{purchase.coalChallanNumber ? `Challan ${purchase.coalChallanNumber}` : purchase.coalNameSnapshot}</span>
                        <span className="mt-atlas-1 block text-atlas-xs text-atlas-text-muted">{formatDateOnly(purchase.purchaseDate)} · {purchase.coalNameSnapshot} · {purchase.vehicleNumberSnapshot}</span>
                        <span className="mt-atlas-1 block text-atlas-xs tabular-nums text-atlas-text-muted">Total {formatIndianCurrency(purchase.finalTotal)} · Paid {formatIndianCurrency(purchase.totalPaid)} · Outstanding {formatIndianCurrency(purchase.outstandingAmount)}</span>
                      </span>
                    </label>
                    <FormField label="Allocation amount"><Input inputMode="decimal" disabled={!selectedForPayment} value={paymentForm.allocations[purchase.id] ?? ""} onChange={(event) => setPaymentForm((current) => setCoalSettlementAllocation(current, purchase.id, event.target.value))} placeholder="0" /></FormField>
                  </div>
                </li>;
              })}</ul>}
            </div>

            <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-3">
              <CoalTotal label="Payment" value={paymentStatus.paymentAmount} />
              <CoalTotal label="Allocated" value={paymentStatus.allocatedAmount} />
              <CoalTotal label="Remaining" value={paymentStatus.remainingAmount} emphasized />
            </div>
            {!paymentStatus.canSubmit && (paymentForm.amount || paymentStatus.selectedPurchases > 0 || paymentForm.paymentMode) && <div className="mt-atlas-3"><Feedback role="alert" tone="warning">{paymentStatus.error}</Feedback></div>}
            <div className="mt-atlas-4 flex flex-wrap items-center justify-end gap-atlas-2 border-t border-atlas-border pt-atlas-3">
              <Button type="button" variant="ghost" onClick={() => setPaymentForm(emptyCoalSelectivePaymentForm(localToday))}>Reset</Button>
              <Button type="submit" disabled={!paymentStatus.canSubmit} loading={isSavingPayment} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save Seller Payment</Button>
            </div>
          </Card>
        </form>

        <Card as="section" aria-labelledby="recent-seller-payments-heading">
          <div className="flex h-96 flex-col">
            <div className="border-b border-atlas-border pb-atlas-3">
              <h3 id="recent-seller-payments-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Seller Payments</h3>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{selectedSeller ? `Latest payments for ${selectedSeller.name}` : "Latest saved Coal seller payments"}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {paymentsQuery.isLoading ? <EmptyState title="Loading payments..." /> : recentSellerPayments.length === 0 ? <EmptyState title="No Seller Payments saved yet." /> : <ul className="divide-y divide-atlas-border">{recentSellerPayments.map((payment) => <li key={payment.id} className="py-atlas-3">
                <div className="flex items-start justify-between gap-atlas-3">
                  <div className="min-w-0">
                    <p className="text-atlas-base font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(payment.amount)}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)}</p>
                    <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-muted">{payment.sellerNameSnapshot} · {payment.allocationCount} purchase{payment.allocationCount === 1 ? "" : "s"}</p>
                    {payment.note && <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-subtle">{payment.note}</p>}
                  </div>
                  <Button type="button" variant="ghost" onClick={() => setSelectedPaymentId((current) => current === payment.id ? "" : payment.id)}>{selectedPaymentId === payment.id ? ATLAS_UI_STRINGS.actions.close : ATLAS_UI_STRINGS.actions.open}</Button>
                </div>
                {selectedPaymentId === payment.id && <ul className="mt-atlas-2 divide-y divide-atlas-border border-t border-atlas-border">{payment.allocations.map((allocation) => <li key={allocation.purchaseId} className="py-atlas-2 text-atlas-xs text-atlas-text-muted"><div className="flex items-start justify-between gap-atlas-2"><span>{formatDateOnly(allocation.purchaseDate)}{allocation.coalChallanNumber ? ` · Challan ${allocation.coalChallanNumber}` : ""}<span className="mt-atlas-1 block">{allocation.coalNameSnapshot} · {allocation.vehicleNumberSnapshot}</span></span><span className="shrink-0 font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(allocation.allocatedAmount)}</span></div></li>)}</ul>}
              </li>)}</ul>}
            </div>
            <div className="border-t border-atlas-border pt-atlas-3">
              <Button type="button" variant="ghost" onClick={openPaymentArchive}>View all payments →</Button>
            </div>
          </div>
        </Card>
      </div>
    </>}

    {activeArea === "seller-payments" && showPaymentArchive && <>
      <div>
        <Button type="button" variant="ghost" onClick={closePaymentArchive}>← Back to Seller Payments</Button>
        <h2 id="all-seller-payments-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Seller Payments</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review immutable payments made to Coal sellers.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Seller Payment history.</Feedback>}
      </div>

      <div className="mt-atlas-4"><Card as="section" aria-labelledby="seller-payment-archive-filters-heading">
        <h3 id="seller-payment-archive-filters-heading" className="sr-only">Seller Payment archive filters</h3>
        <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-5">
          <FormField label="Search payments"><Input value={paymentArchiveSearch} onChange={(event) => setPaymentArchiveSearch(event.target.value)} placeholder="Seller, note, challan, Coal or vehicle" /></FormField>
          <FormField label="From"><Input type="date" value={paymentArchiveFromDate} onChange={(event) => setPaymentArchiveFromDate(event.target.value)} /></FormField>
          <FormField label="To"><Input type="date" value={paymentArchiveToDate} onChange={(event) => setPaymentArchiveToDate(event.target.value)} /></FormField>
          <FormField label="Seller"><Select value={paymentArchiveSellerId} onChange={(event) => setPaymentArchiveSellerId(event.target.value)}><option value="">All Sellers</option>{suppliers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</Select></FormField>
          <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select value={paymentArchiveMode} onChange={(event) => setPaymentArchiveMode(event.target.value as CoalPayment["paymentMode"] | "")}><option value="">All modes</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><TableContainer bounded aria-label="All Seller Payments table">
        <Table wide>
          <TableCaption visuallyHidden>All Seller Payments matching the selected filters</TableCaption>
          <TableHeader sticky>
            <TableRow>
              <TableHeaderCell>{ATLAS_UI_STRINGS.payment.date}</TableHeaderCell>
              <TableHeaderCell>Seller</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.payment.mode}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.note}</TableHeaderCell>
              <TableHeaderCell numeric>Allocated Purchases</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archivePayments.map((payment) => <TableRow key={payment.id} hoverable selected={paymentDetailId === payment.id}>
              <TableCell>{formatDateOnly(payment.paymentDate)}</TableCell>
              <TableCell><span className="font-atlas-semibold">{payment.sellerNameSnapshot}</span></TableCell>
              <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(payment.amount)}</span></TableCell>
              <TableCell>{formatCustomerPaymentMode(payment.paymentMode)}</TableCell>
              <TableCell>{payment.note ?? "—"}</TableCell>
              <TableCell numeric>{formatIndianNumber(payment.allocationCount)}</TableCell>
              <TableCell><Button type="button" variant="ghost" onClick={() => setPaymentDetailId(payment.id)}>Open payment →</Button></TableCell>
            </TableRow>)}
            {!paymentsQuery.isLoading && archivePayments.length === 0 && <TableRow><TableCell colSpan={7}>No Seller Payments match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer></div>
      {paymentsQuery.isLoading && <EmptyState title="Loading Seller Payment history..." />}
    </>}

    {paymentDetail && <CoalSellerPaymentDetailDrawer payment={paymentDetail} onClose={() => setPaymentDetailId("")} canOpenPurchase={canOpenPurchaseFromPayment} onOpenPurchase={openPurchaseFromPayment} />}

    </section>
  </CoalOfficeWorkspace>;
}

function measurementLabel(field: CoalMeasurementField): string {
  if (field === "quantity") return "Quantity";
  if (field === "rate") return "Rate";
  return "Coal Amount";
}

function coalPurchaseStateLabel(purchase: CoalPurchase): string {
  if (purchase.status === "void") return "Void";
  if (purchase.paymentState === "partially_paid") return "Partial";
  if (purchase.paymentState === "paid") return "Paid";
  return "Unpaid";
}

function CoalTotal({
  label,
  value,
  emphasized = false,
}: Readonly<{ label: string; value: number; emphasized?: boolean }>) {
  return <div>
    <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">{label}</p>
    <p className={`mt-atlas-1 tabular-nums ${emphasized ? "text-atlas-lg font-atlas-semibold text-atlas-primary" : "text-atlas-base font-atlas-semibold text-atlas-text"}`}>{formatIndianCurrency(value)}</p>
  </div>;
}

function CoalPurchaseDetail({
  purchase,
  confirmingVoid,
  isVoiding,
  onCancelVoid,
  onConfirmVoid,
}: Readonly<{
  purchase: CoalPurchase;
  confirmingVoid: boolean;
  isVoiding: boolean;
  onCancelVoid: () => void;
  onConfirmVoid: () => void;
}>) {
  return <article aria-labelledby="saved-coal-purchase-heading" className="text-atlas-text">
    <header className="border-b border-atlas-border-strong pb-atlas-5">
      <div className="flex flex-col gap-atlas-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Saved Coal Purchase</p>
          <h3 id="saved-coal-purchase-heading" className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">{purchase.coalNameSnapshot}</h3>
          <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">{formatDateOnly(purchase.purchaseDate)} · {purchase.sellerNameSnapshot}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Final Total</p>
          <p className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(purchase.finalTotal)}</p>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{coalPurchaseStateLabel(purchase)}</p>
        </div>
      </div>
      {!canChangeCoalPurchase(purchase) && purchase.totalPaid > 0 && <p className="mt-atlas-3 text-atlas-xs text-atlas-text-muted">Payment history locks this purchase from correction or voiding.</p>}
    </header>

    {confirmingVoid && canChangeCoalPurchase(purchase) && <div className="mt-atlas-4"><Feedback role="alert" tone="danger">
      <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
        <span>Void this unpaid Coal Purchase? It will remain in history and stop affecting active totals.</span>
        <div className="flex flex-wrap gap-atlas-2">
          <Button type="button" variant="danger" loading={isVoiding} loadingLabel="Voiding..." onClick={onConfirmVoid}>Confirm Void</Button>
          <Button type="button" variant="secondary" disabled={isVoiding} onClick={onCancelVoid}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
        </div>
      </div>
    </Feedback></div>}

    {purchase.status === "void" && <div className="mt-atlas-4"><Feedback role="status" tone="neutral">This Coal Purchase is Void. Its saved information remains in history.</Feedback></div>}

    <section aria-labelledby="saved-coal-purchase-context-heading" className="mt-atlas-6">
      <h4 id="saved-coal-purchase-context-heading" className="text-atlas-xl font-atlas-semibold text-atlas-text">Purchase and delivery</h4>
      <dl className="mt-atlas-3 grid gap-atlas-4 border-y border-atlas-border py-atlas-4 sm:grid-cols-2">
        <CoalPurchaseDetailValue label="Seller snapshot" value={purchase.sellerNameSnapshot} />
        <CoalPurchaseDetailValue label="Business date" value={formatDateOnly(purchase.purchaseDate)} numeric />
        <CoalPurchaseDetailValue label="Coal snapshot" value={purchase.coalNameSnapshot} />
        <CoalPurchaseDetailValue label="Source snapshot" value={purchase.sourceLocationSnapshot} />
        <CoalPurchaseDetailValue label="Vehicle Number" value={purchase.vehicleNumberSnapshot} />
        <CoalPurchaseDetailValue label="Coal Challan No." value={purchase.coalChallanNumber ?? "Not recorded"} />
        {purchase.sellerAddressSnapshot && <CoalPurchaseDetailValue label="Seller address snapshot" value={purchase.sellerAddressSnapshot} />}
        {purchase.sellerMobileSnapshot && <CoalPurchaseDetailValue label="Seller mobile snapshot" value={purchase.sellerMobileSnapshot} />}
      </dl>
    </section>

    <div className="mt-atlas-6"><Card as="section" surface="muted" aria-labelledby="saved-coal-purchase-financial-heading">
      <h4 id="saved-coal-purchase-financial-heading" className="text-atlas-xl font-atlas-semibold text-atlas-text">Quantity and financial summary</h4>
      <dl className="mt-atlas-4 grid gap-atlas-4 sm:grid-cols-2 lg:grid-cols-4">
        <CoalPurchaseDetailValue label="Quantity" value={formatIndianNumber(purchase.quantity)} numeric />
        <CoalPurchaseDetailValue label="Rate" value={formatIndianCurrency(purchase.rate)} numeric />
        <CoalPurchaseDetailValue label="Coal Amount" value={formatIndianCurrency(purchase.coalAmount)} numeric />
        <CoalPurchaseDetailValue label="Separate Freight" value={purchase.separateFreightAmount > 0 ? formatIndianCurrency(purchase.separateFreightAmount) : "Included"} numeric={purchase.separateFreightAmount > 0} />
        <CoalPurchaseDetailValue label="Final Total" value={formatIndianCurrency(purchase.finalTotal)} numeric emphasize />
        <CoalPurchaseDetailValue label="Paid" value={formatIndianCurrency(purchase.totalPaid)} numeric />
        <CoalPurchaseDetailValue label={ATLAS_UI_STRINGS.payment.outstanding} value={formatIndianCurrency(purchase.outstandingAmount)} numeric emphasize={purchase.outstandingAmount > 0} />
      </dl>
    </Card></div>
  </article>;
}

function CoalPurchaseDetailValue({
  label,
  value,
  numeric = false,
  emphasize = false,
}: Readonly<{
  label: string;
  value: string;
  numeric?: boolean;
  emphasize?: boolean;
}>) {
  return <div>
    <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">{label}</dt>
    <dd className={`mt-atlas-1 text-atlas-sm text-atlas-text ${numeric ? "tabular-nums" : ""} ${emphasize ? "font-atlas-semibold" : "font-atlas-medium"}`}>{value}</dd>
  </div>;
}
