"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Checkbox, Input, Select } from "@/components/ui/form-controls";
import { FormField } from "@/components/ui/form-field";
import { StatusPill } from "@/components/ui/status-pill";
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
import {
  getOfficeCostsArchiveHash,
  getOfficeCostsOutgoingsHash,
  getOfficeOutgoingPaymentsArchiveHash,
  resolveOfficeCostsOutgoingsAreaFromHash,
  type OfficeAreaId,
  type OfficeCostsOutgoingsAreaId,
} from "@/features/office/office-navigation";
import { CostsOutgoingsOfficeWorkspace } from "@/features/office/components/costs-outgoings-office-workspace";
import { ExpensePaymentDetailDrawer } from "@/features/office/components/expense-payment-detail-drawer";
import {
  applyExpensePaymentStates,
  buildExpensePaymentInput,
  buildExpenseRecordInput,
  buildSupplierInput,
  emptyExpensePaymentForm,
  emptyExpenseRecordForm,
  emptySupplierForm,
  expenseKindLabel,
  expenseOfficeErrorMessage,
  expensePaymentStateLabel,
  expenseRecordFormFromSaved,
  filterExpenseArchiveRecords,
  filterExpensePayments,
  getExpensePaymentCandidates,
  getExpensePaymentFormStatus,
  getExpenseRecordEligibility,
  getPaymentsForExpenseRecord,
  summarizeExpenseRecords,
  setExpensePaymentAllocation,
  setExpensePaymentAmount,
  toggleExpensePaymentAllocation,
  type ExpenseArchiveStateFilter,
  type ExpenseKindFilter,
  type ExpensePaymentForm,
  type ExpenseRecordForm,
  type SupplierForm,
} from "../expense-office-model";
import {
  createExpensePayment,
  createExpenseRecord,
  createSupplier,
  getExpenseRecordPaymentState,
  listExpensePayments,
  listExpenseRecords,
  listSuppliers,
  updateExpenseRecord,
  updateSupplier,
  voidExpenseRecord,
} from "../../expenses/services/expense-service";
import type {
  ExpensePayment,
  ExpenseRecord,
  ExpenseRecordKind,
  Supplier,
} from "../../expenses/types";
import {
  formatCustomerPaymentMode,
  NEW_CUSTOMER_PAYMENT_MODES,
} from "../../sales/types";
import { formatChallanDate, formatSalesMoney } from "../sales-office-model";
import { formatDateOnly, formatIndianCurrency } from "@/lib/formatting";
import { getLocalDate, isLocalDate } from "../../../lib/local-date";
import {
  EXPENSE_PAYMENT_STATUS,
  EXPENSE_RECORD_STATUS,
  resolveStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export const expenseRecordsKey = (factoryId: string) =>
  ["office-expense-records", factoryId] as const;
export const expenseSuppliersKey = (factoryId: string) =>
  ["office-expense-suppliers", factoryId] as const;
export const expensePaymentsKey = (factoryId: string) =>
  ["office-expense-payments", factoryId] as const;

export function ExpensesOfficeSection({
  activeArea,
  factoryId,
  showCostsOutgoings = true,
}: Readonly<{
  activeArea: OfficeAreaId;
  factoryId: string;
  showCostsOutgoings?: boolean;
}>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [recordForm, setRecordForm] = useState<ExpenseRecordForm>(() => emptyExpenseRecordForm(localToday));
  const [editingRecordId, setEditingRecordId] = useState("");
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(emptySupplierForm);
  const [supplierEditor, setSupplierEditor] = useState<"create" | "edit" | null>(null);
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [paymentForm, setPaymentForm] = useState<ExpensePaymentForm>(() => emptyExpensePaymentForm(localToday));
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [confirmingVoidId, setConfirmingVoidId] = useState("");
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [supplierError, setSupplierError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [success, setSuccess] = useState("");
  const [costsOutgoingsArea, setCostsOutgoingsArea] = useState<OfficeCostsOutgoingsAreaId>("costs");
  const [showCostsArchive, setShowCostsArchive] = useState(false);
  const [showPaymentsArchive, setShowPaymentsArchive] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFromDate, setArchiveFromDate] = useState("");
  const [archiveToDate, setArchiveToDate] = useState("");
  const [archiveKind, setArchiveKind] = useState<ExpenseKindFilter>("all");
  const [archiveCounterparty, setArchiveCounterparty] = useState("");
  const [archiveState, setArchiveState] = useState<ExpenseArchiveStateFilter>("all");
  const [paymentArchiveSearch, setPaymentArchiveSearch] = useState("");
  const [paymentArchiveFromDate, setPaymentArchiveFromDate] = useState("");
  const [paymentArchiveToDate, setPaymentArchiveToDate] = useState("");
  const [paymentArchiveKind, setPaymentArchiveKind] = useState<ExpenseKindFilter>("all");
  const [paymentArchiveMode, setPaymentArchiveMode] = useState<ExpensePayment["paymentMode"] | "">("");

  useEffect(() => {
    function syncCostsOutgoingsAreaFromHash() {
      const area = resolveOfficeCostsOutgoingsAreaFromHash(window.location.hash);
      if (area) setCostsOutgoingsArea(area);
      setShowCostsArchive(window.location.hash === getOfficeCostsArchiveHash());
      setShowPaymentsArchive(window.location.hash === getOfficeOutgoingPaymentsArchiveHash());
    }

    syncCostsOutgoingsAreaFromHash();
    window.addEventListener("hashchange", syncCostsOutgoingsAreaFromHash);
    return () => window.removeEventListener("hashchange", syncCostsOutgoingsAreaFromHash);
  }, []);

  const suppliersQuery = useQuery({
    queryKey: expenseSuppliersKey(factoryId),
    queryFn: () => listSuppliers(factoryId),
  });
  const recordsQuery = useQuery({
    queryKey: expenseRecordsKey(factoryId),
    queryFn: () => listExpenseRecords(factoryId),
  });
  const paymentsQuery = useQuery({
    queryKey: expensePaymentsKey(factoryId),
    queryFn: () => listExpensePayments(factoryId),
  });
  const suppliers = suppliersQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const candidates = getExpensePaymentCandidates(records);
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;
  const selectedPayment = payments.find((payment) => payment.id === selectedPaymentId) ?? null;
  const selectedSupplier = suppliers.find((supplier) => supplier.id === recordForm.supplierId) ?? null;
  const editingSupplier = suppliers.find((supplier) => supplier.id === editingSupplierId) ?? null;
  const recentRecords = records.slice(0, 10);
  const recentPayments = payments.slice(0, 10);
  const archiveCounterparties = [...new Set(records.map((record) => record.counterpartyNameSnapshot))]
    .sort((left, right) => left.localeCompare(right, "en-IN"));
  const archiveRecords = filterExpenseArchiveRecords(records, {
    search: archiveSearch,
    fromDate: archiveFromDate,
    toDate: archiveToDate,
    kind: archiveKind,
    counterparty: archiveCounterparty,
    state: archiveState,
  });
  const archiveSummary = summarizeExpenseRecords(archiveRecords);
  const archiveDatesValid = (!archiveFromDate || isLocalDate(archiveFromDate))
    && (!archiveToDate || isLocalDate(archiveToDate))
    && (!archiveFromDate || !archiveToDate || archiveFromDate <= archiveToDate);
  const paymentArchivePayments = filterExpensePayments(payments, {
    search: paymentArchiveSearch,
    fromDate: paymentArchiveFromDate,
    toDate: paymentArchiveToDate,
    kind: paymentArchiveKind,
    paymentMode: paymentArchiveMode,
  });
  const paymentArchiveDatesValid = (!paymentArchiveFromDate || isLocalDate(paymentArchiveFromDate))
    && (!paymentArchiveToDate || isLocalDate(paymentArchiveToDate))
    && (!paymentArchiveFromDate || !paymentArchiveToDate || paymentArchiveFromDate <= paymentArchiveToDate);
  const paymentStatus = getExpensePaymentFormStatus(paymentForm, candidates);
  const queryError = suppliersQuery.error || recordsQuery.error || paymentsQuery.error;

  function openNewRecord(kind: ExpenseRecordKind) {
    setRecordForm(emptyExpenseRecordForm(localToday, kind));
    setEditingRecordId("");
    setSupplierEditor(null);
    setRecordError("");
    setSupplierError("");
    setSuccess("");
  }

  function openEditRecord(record: ExpenseRecord) {
    if (!getExpenseRecordEligibility(record).canEdit) return;
    setRecordForm(expenseRecordFormFromSaved(record));
    setEditingRecordId(record.id);
    setSupplierEditor(null);
    setRecordError("");
    setSuccess("");
    if (showCostsArchive) closeCostsArchive();
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingRecord) return;
    const input = buildExpenseRecordInput(factoryId, recordForm);
    if (!input) {
      setRecordError("Complete the date, counterparty, particulars, and positive amount.");
      return;
    }
    setIsSavingRecord(true);
    setRecordError("");
    setSuccess("");
    try {
      const saved = editingRecordId
        ? await updateExpenseRecord({ ...input, expenseRecordId: editingRecordId })
        : await createExpenseRecord(input);
      queryClient.setQueryData<ExpenseRecord[]>(expenseRecordsKey(factoryId), (current = []) =>
        editingRecordId
          ? current.map((record) => record.id === saved.id ? saved : record)
          : [saved, ...current]);
      setSelectedRecordId(saved.id);
      setEditingRecordId("");
      setRecordForm(emptyExpenseRecordForm(localToday));
      await queryClient.invalidateQueries({ queryKey: expenseRecordsKey(factoryId) });
      setSuccess(`${expenseKindLabel(saved.kind)} saved. Cost ${formatSalesMoney(saved.totalAmount)}; no Cash Book payment was created.`);
    } catch (error) {
      setRecordError(expenseOfficeErrorMessage(error, "Could not save this Expense/Purchase."));
    } finally {
      setIsSavingRecord(false);
    }
  }

  function openSupplierCreate() {
    setSupplierForm(emptySupplierForm());
    setSupplierEditor("create");
    setEditingSupplierId("");
    setSupplierError("");
  }

  function openSupplierEdit(supplier: Supplier) {
    setSupplierForm({ name: supplier.name, address: supplier.address ?? "", mobile: supplier.mobile ?? "" });
    setSupplierEditor("edit");
    setEditingSupplierId(supplier.id);
    setSupplierError("");
  }

  async function saveSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingSupplier) return;
    const input = buildSupplierInput(factoryId, supplierForm);
    if (!input) {
      setSupplierError("Supplier name is required. Check the optional address and mobile.");
      return;
    }
    if (supplierEditor === "edit" && !editingSupplier) {
      setSupplierError("Choose an existing supplier before saving changes.");
      return;
    }
    setIsSavingSupplier(true);
    setSupplierError("");
    try {
      const saved = supplierEditor === "edit"
        ? await updateSupplier({ ...input, supplierId: editingSupplier!.id })
        : await createSupplier(input);
      queryClient.setQueryData<Supplier[]>(expenseSuppliersKey(factoryId), (current = []) => {
        const next = current.some((supplier) => supplier.id === saved.id)
          ? current.map((supplier) => supplier.id === saved.id ? saved : supplier)
          : [...current, saved];
        return next.sort((left, right) => left.name.localeCompare(right.name, "en-IN"));
      });
      setSupplierEditor(null);
      setEditingSupplierId("");
      setSupplierForm(emptySupplierForm());
      await queryClient.invalidateQueries({ queryKey: expenseSuppliersKey(factoryId) });
    } catch (error) {
      setSupplierError(expenseOfficeErrorMessage(error, "Could not save this supplier."));
    } finally {
      setIsSavingSupplier(false);
    }
  }

  async function confirmVoid(record: ExpenseRecord) {
    if (isVoiding || !getExpenseRecordEligibility(record).canVoid) return;
    setIsVoiding(true);
    setRecordError("");
    setSuccess("");
    try {
      const saved = await voidExpenseRecord(factoryId, record.id);
      queryClient.setQueryData<ExpenseRecord[]>(expenseRecordsKey(factoryId), (current = []) =>
        current.map((item) => item.id === saved.id ? saved : item));
      setConfirmingVoidId("");
      await queryClient.invalidateQueries({ queryKey: expenseRecordsKey(factoryId) });
      setSuccess(`${expenseKindLabel(saved.kind)} voided. It remains in history and is excluded from active totals.`);
    } catch (error) {
      setRecordError(expenseOfficeErrorMessage(error, "Could not void this Expense/Purchase."));
    } finally {
      setIsVoiding(false);
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPayment) return;
    const input = buildExpensePaymentInput(factoryId, paymentForm, candidates);
    if (!input) {
      setPaymentError(paymentStatus.error || "Complete the payment and explicit allocations.");
      return;
    }
    setIsSavingPayment(true);
    setPaymentError("");
    setSuccess("");
    try {
      const payment = await createExpensePayment(input);
      queryClient.setQueryData<ExpensePayment[]>(expensePaymentsKey(factoryId), (current = []) =>
        current.some((saved) => saved.id === payment.id) ? current : [payment, ...current]);
      setPaymentForm(emptyExpensePaymentForm(localToday));
      const stateResults = await Promise.allSettled(input.allocations.map((allocation) =>
        getExpenseRecordPaymentState(factoryId, allocation.expenseRecordId)));
      const states = stateResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (states.length > 0) {
        queryClient.setQueryData<ExpenseRecord[]>(expenseRecordsKey(factoryId), (current = []) =>
          applyExpensePaymentStates(current, states));
      }
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: expenseRecordsKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: expensePaymentsKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] }),
      ]);
      setSuccess(`Payment ${formatSalesMoney(payment.amount)} saved. Cash Book Money Out updates automatically.`);
    } catch (error) {
      setPaymentError(expenseOfficeErrorMessage(error, "Could not save this outgoing payment."));
    } finally {
      setIsSavingPayment(false);
    }
  }

  function selectCostsOutgoingsArea(area: OfficeCostsOutgoingsAreaId) {
    setCostsOutgoingsArea(area);
    setShowCostsArchive(false);
    setShowPaymentsArchive(false);
    setSelectedPaymentId("");
    window.location.hash = getOfficeCostsOutgoingsHash(area);
  }

  function openCostsArchive() {
    setCostsOutgoingsArea("costs");
    setShowCostsArchive(true);
    window.location.hash = getOfficeCostsArchiveHash();
  }

  function closeCostsArchive() {
    setShowCostsArchive(false);
    window.location.hash = getOfficeCostsOutgoingsHash("costs");
  }

  function openPaymentsArchive() {
    setCostsOutgoingsArea("outgoing-payments");
    setShowPaymentsArchive(true);
    setSelectedPaymentId("");
    window.location.hash = getOfficeOutgoingPaymentsArchiveHash();
  }

  function closePaymentsArchive() {
    setShowPaymentsArchive(false);
    setSelectedPaymentId("");
    window.location.hash = getOfficeCostsOutgoingsHash("outgoing-payments");
  }

  function openCostFromPayment(expenseRecordId: string) {
    if (!records.some((record) => record.id === expenseRecordId)) return;
    setSelectedRecordId(expenseRecordId);
    setConfirmingVoidId("");
    setSelectedPaymentId("");
    setShowPaymentsArchive(false);
    setCostsOutgoingsArea("costs");
    window.location.hash = getOfficeCostsOutgoingsHash("costs");
  }

  return (
    <>
    <div className="mt-atlas-3" hidden={activeArea !== "purchases-expenses" || !showCostsOutgoings}>
      <CostsOutgoingsOfficeWorkspace
        activeArea={costsOutgoingsArea}
        onAreaChange={selectCostsOutgoingsArea}
      >
        <section aria-labelledby="expenses-office-heading">
          {costsOutgoingsArea === "costs" && !showCostsArchive && <div className="max-w-6xl">
            <div>
              <h2 id="expenses-office-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Costs & Outgoings</h2>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record purchases and expenses, then review recent costs.</p>
            </div>

            <div className="mt-atlas-4 space-y-atlas-3">
              {queryError && <Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(queryError, "Could not load Costs & Outgoings.")}</Feedback>}
              {success && <Feedback role="status" tone="success">{success}</Feedback>}
            </div>

            <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ExpenseRecordEditor
                  form={recordForm}
                  setForm={setRecordForm}
                  suppliers={suppliers}
                  selectedSupplier={selectedSupplier}
                  editing={Boolean(editingRecordId)}
                  isSaving={isSavingRecord}
                  error={recordError}
                  onSave={saveRecord}
                  onCancel={() => openNewRecord("purchase")}
                />
              </div>
              <RecentCosts
                records={recentRecords}
                isLoading={recordsQuery.isLoading}
                error={recordsQuery.error}
                onOpen={(id) => {
                  setSelectedRecordId(id);
                  setConfirmingVoidId("");
                }}
                onViewAll={openCostsArchive}
              />
            </div>
          </div>}

          {costsOutgoingsArea === "costs" && showCostsArchive && <div className="max-w-6xl">
            <div>
              <Button type="button" variant="ghost" onClick={closeCostsArchive}>← Back to Costs</Button>
              <h2 id="expenses-office-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Costs</h2>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review the authoritative Purchase and Expense history.</p>
            </div>

            <div className="mt-atlas-4 space-y-atlas-3">
              {recordsQuery.error && <Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(recordsQuery.error, "Could not load Cost history.")}</Feedback>}
              {recordError && <Feedback role="alert" tone="danger">{recordError}</Feedback>}
              {success && <Feedback role="status" tone="success">{success}</Feedback>}
              {!archiveDatesValid && <Feedback role="alert" tone="warning">Choose a valid inclusive date range.</Feedback>}
            </div>

            <div className="mt-atlas-4"><Card as="section" aria-labelledby="cost-archive-filters-heading">
              <h3 id="cost-archive-filters-heading" className="sr-only">Cost archive filters</h3>
              <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-3">
                <FormField label="Search Costs"><Input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="Counterparty, particulars or reference" /></FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" value={archiveFromDate} onChange={(event) => setArchiveFromDate(event.target.value)} /></FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" value={archiveToDate} onChange={(event) => setArchiveToDate(event.target.value)} /></FormField>
                <FormField label="Type"><Select value={archiveKind} onChange={(event) => setArchiveKind(event.target.value as ExpenseKindFilter)}><option value="all">All Types</option><option value="purchase">Purchase</option><option value="expense">Expense</option></Select></FormField>
                <FormField label="Counterparty / Payee"><Select value={archiveCounterparty} onChange={(event) => setArchiveCounterparty(event.target.value)}><option value="">All counterparties</option>{archiveCounterparties.map((counterparty) => <option key={counterparty} value={counterparty}>{counterparty}</option>)}</Select></FormField>
                <FormField label="State"><Select value={archiveState} onChange={(event) => setArchiveState(event.target.value as ExpenseArchiveStateFilter)}><option value="all">All States</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="void">Void</option></Select></FormField>
              </div>
            </Card></div>

            <div className="mt-atlas-3"><Card as="section" surface="muted" aria-label="Filtered Cost totals">
              <div className="grid grid-cols-2 gap-atlas-3 lg:grid-cols-4">
                <ArchiveTotal label="Total Purchases" value={archiveSummary.totalPurchases} />
                <ArchiveTotal label="Total Expenses" value={archiveSummary.totalExpenses} />
                <ArchiveTotal label="Paid" value={archiveSummary.totalPaid} />
                <ArchiveTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={archiveSummary.totalOutstanding} />
              </div>
            </Card></div>

            <div className="mt-atlas-3"><TableContainer bounded aria-label="All Costs table">
              <Table wide>
                <TableCaption visuallyHidden>All Purchase and Expense records matching the selected filters</TableCaption>
                <TableHeader sticky>
                  <TableRow>
                    <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Supplier / Counterparty</TableHeaderCell>
                    <TableHeaderCell>Description</TableHeaderCell>
                    <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
                    <TableHeaderCell numeric>Paid</TableHeaderCell>
                    <TableHeaderCell numeric>{ATLAS_UI_STRINGS.payment.due}</TableHeaderCell>
                    <TableHeaderCell>Note / Reference</TableHeaderCell>
                    <TableHeaderCell>{ATLAS_UI_STRINGS.fields.status}</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archiveRecords.map((record) => {
                    const status = record.status === "void"
                      ? resolveStatusPresentation(EXPENSE_RECORD_STATUS, record.status)
                      : resolveStatusPresentation(EXPENSE_PAYMENT_STATUS, record.paymentState);
                    return <TableRow key={record.id} hoverable selected={selectedRecordId === record.id}>
                      <TableCell>{formatDateOnly(record.businessDate)}</TableCell>
                      <TableCell><span className="font-atlas-semibold">{expenseKindLabel(record.kind)}</span></TableCell>
                      <TableCell>{record.counterpartyNameSnapshot}</TableCell>
                      <TableCell>{record.description}</TableCell>
                      <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(record.totalAmount)}</span></TableCell>
                      <TableCell numeric>{record.status === "void" ? "—" : formatIndianCurrency(record.totalPaid)}</TableCell>
                      <TableCell numeric>{record.status === "void" ? "—" : formatIndianCurrency(record.outstandingAmount)}</TableCell>
                      <TableCell>{record.note ?? "—"}</TableCell>
                      <TableCell><StatusPill label={status.label} tone={status.tone} /></TableCell>
                      <TableCell><Button type="button" variant="ghost" onClick={() => { setSelectedRecordId(record.id); setConfirmingVoidId(""); }}>{ATLAS_UI_STRINGS.actions.open} →</Button></TableCell>
                    </TableRow>;
                  })}
                  {!recordsQuery.isLoading && archiveDatesValid && archiveRecords.length === 0 && <TableRow><TableCell colSpan={10}>No Costs match these filters.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer></div>
            {recordsQuery.isLoading && <EmptyState title="Loading Cost history..." />}
          </div>}

          {costsOutgoingsArea === "costs" && selectedRecord && <div className="max-w-6xl"><ExpenseRecordDetail
            record={selectedRecord}
            payments={getPaymentsForExpenseRecord(payments, selectedRecord.id)}
            eligibility={getExpenseRecordEligibility(selectedRecord)}
            confirmingVoid={confirmingVoidId === selectedRecord.id}
            isVoiding={isVoiding}
            onEdit={() => openEditRecord(selectedRecord)}
            onAskVoid={() => setConfirmingVoidId(selectedRecord.id)}
            onCancelVoid={() => setConfirmingVoidId("")}
            onConfirmVoid={() => void confirmVoid(selectedRecord)}
            onRecordPayment={() => {
              setPaymentError("");
              selectCostsOutgoingsArea("outgoing-payments");
            }}
            onClose={() => { setSelectedRecordId(""); setConfirmingVoidId(""); }}
          /></div>}

          {costsOutgoingsArea === "outgoing-payments" && !showPaymentsArchive && <div className="max-w-6xl">
            <div>
              <h2 id="expenses-office-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Outgoing Payments</h2>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record one payment and explicitly allocate it to genuine outstanding costs.</p>
            </div>

            <div className="mt-atlas-4 space-y-atlas-3">
              {queryError && <Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(queryError, "Could not load outgoing payments.")}</Feedback>}
              {success && <Feedback role="status" tone="success">{success}</Feedback>}
            </div>

            <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ExpensePaymentEditor
                  form={paymentForm}
                  setForm={setPaymentForm}
                  candidates={candidates}
                  status={paymentStatus}
                  isLoadingCandidates={recordsQuery.isLoading}
                  candidatesError={recordsQuery.error}
                  isSaving={isSavingPayment}
                  error={paymentError}
                  onSave={savePayment}
                />
              </div>
              <RecentOutgoingPayments
                payments={recentPayments}
                isLoading={paymentsQuery.isLoading}
                error={paymentsQuery.error}
                onViewAll={openPaymentsArchive}
              />
            </div>
          </div>}

          {costsOutgoingsArea === "outgoing-payments" && showPaymentsArchive && <div className="max-w-6xl">
            <div>
              <Button type="button" variant="ghost" onClick={closePaymentsArchive}>← Back to Outgoing Payments</Button>
              <h2 id="expenses-office-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Outgoing Payments</h2>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review immutable payments and their saved Cost allocations.</p>
            </div>

            <div className="mt-atlas-4 space-y-atlas-3">
              {paymentsQuery.error && <Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(paymentsQuery.error, "Could not load Outgoing Payment history.")}</Feedback>}
              {!paymentArchiveDatesValid && <Feedback role="alert" tone="warning">Choose a valid inclusive date range.</Feedback>}
            </div>

            <div className="mt-atlas-4"><Card as="section" aria-labelledby="outgoing-payment-archive-filters-heading">
              <h3 id="outgoing-payment-archive-filters-heading" className="sr-only">Outgoing Payment archive filters</h3>
              <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-5">
                <FormField label="Search payments"><Input value={paymentArchiveSearch} onChange={(event) => setPaymentArchiveSearch(event.target.value)} placeholder="Counterparty, description or note" /></FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" value={paymentArchiveFromDate} onChange={(event) => setPaymentArchiveFromDate(event.target.value)} /></FormField>
                <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" value={paymentArchiveToDate} onChange={(event) => setPaymentArchiveToDate(event.target.value)} /></FormField>
                <FormField label="Allocation type"><Select value={paymentArchiveKind} onChange={(event) => setPaymentArchiveKind(event.target.value as ExpenseKindFilter)}><option value="all">All Types</option><option value="purchase">Purchase</option><option value="expense">Expense</option></Select></FormField>
                <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select value={paymentArchiveMode} onChange={(event) => setPaymentArchiveMode(event.target.value as ExpensePayment["paymentMode"] | "")}><option value="">All modes</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
              </div>
            </Card></div>

            <div className="mt-atlas-3"><TableContainer bounded aria-label="All Outgoing Payments table">
              <Table wide>
                <TableCaption visuallyHidden>All Outgoing Payments matching the selected filters</TableCaption>
                <TableHeader sticky>
                  <TableRow>
                    <TableHeaderCell>Payment Date</TableHeaderCell>
                    <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
                    <TableHeaderCell>{ATLAS_UI_STRINGS.payment.mode}</TableHeaderCell>
                    <TableHeaderCell>Note / Reference</TableHeaderCell>
                    <TableHeaderCell numeric>Allocated Costs</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentArchivePayments.map((payment) => <TableRow key={payment.id} hoverable selected={selectedPaymentId === payment.id}>
                    <TableCell>{formatDateOnly(payment.paymentDate)}</TableCell>
                    <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(payment.amount)}</span></TableCell>
                    <TableCell>{formatCustomerPaymentMode(payment.paymentMode)}</TableCell>
                    <TableCell>{payment.note ?? "—"}</TableCell>
                    <TableCell numeric>{payment.allocations.length}</TableCell>
                    <TableCell><Button type="button" variant="ghost" onClick={() => setSelectedPaymentId(payment.id)}>Open payment →</Button></TableCell>
                  </TableRow>)}
                  {!paymentsQuery.isLoading && paymentArchiveDatesValid && paymentArchivePayments.length === 0 && <TableRow><TableCell colSpan={6}>No Outgoing Payments match these filters.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer></div>
            {paymentsQuery.isLoading && <EmptyState title="Loading Outgoing Payment history..." />}
          </div>}
        </section>
      </CostsOutgoingsOfficeWorkspace>
      {showPaymentsArchive && selectedPayment && <ExpensePaymentDetailDrawer
        payment={selectedPayment}
        onClose={() => setSelectedPaymentId("")}
        getCostBusinessDate={(expenseRecordId) => records.find((record) => record.id === expenseRecordId)?.businessDate ?? null}
        onOpenCost={openCostFromPayment}
      />}
    </div>
    <SupplierManagementSection
      hidden={activeArea !== "settings"}
      suppliers={suppliers}
      isLoading={suppliersQuery.isLoading}
      error={suppliersQuery.error}
      editor={supplierEditor}
      form={supplierForm}
      setForm={setSupplierForm}
      isSaving={isSavingSupplier}
      formError={supplierError}
      onCreate={openSupplierCreate}
      onEdit={openSupplierEdit}
      onCancel={() => { setSupplierEditor(null); setEditingSupplierId(""); setSupplierError(""); }}
      onSave={saveSupplier}
    />
    </>
  );
}

function SupplierManagementSection({
  hidden,
  suppliers,
  isLoading,
  error,
  editor,
  form,
  setForm,
  isSaving,
  formError,
  onCreate,
  onEdit,
  onCancel,
  onSave,
}: Readonly<{
  hidden: boolean;
  suppliers: readonly Supplier[];
  isLoading: boolean;
  error: Error | null;
  editor: "create" | "edit" | null;
  form: SupplierForm;
  setForm: React.Dispatch<React.SetStateAction<SupplierForm>>;
  isSaving: boolean;
  formError: string;
  onCreate: () => void;
  onEdit: (supplier: Supplier) => void;
  onCancel: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}>) {
  return <div hidden={hidden} className="mt-atlas-8">
    <Card as="section" aria-labelledby="supplier-management-heading">
      <div className="flex flex-wrap items-start justify-between gap-atlas-4">
        <div><h2 id="supplier-management-heading" className="text-atlas-xl font-atlas-semibold text-atlas-text">Suppliers</h2><p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Manage saved suppliers used by Purchases & Expenses.</p></div>
        <Button type="button" onClick={onCreate}>Add supplier</Button>
      </div>
      {isLoading && <div className="mt-atlas-4"><Feedback role="status" tone="neutral">Loading suppliers...</Feedback></div>}
      {error && <div className="mt-atlas-4"><Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(error, "Could not load suppliers.")}</Feedback></div>}
      {!isLoading && !error && suppliers.length === 0 && <EmptyState title="No saved suppliers" />}
      {suppliers.length > 0 && <ul className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border">{suppliers.map((supplier) => <li key={supplier.id} className="flex flex-col gap-atlas-3 py-atlas-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-atlas-semibold text-atlas-text">{supplier.name}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{[supplier.address, supplier.mobile].filter(Boolean).join(" · ") || "No address or mobile saved"}</p></div><Button type="button" variant="secondary" onClick={() => onEdit(supplier)}>Edit supplier</Button></li>)}</ul>}
      {editor && <div className="mt-atlas-4"><Card surface="muted"><form onSubmit={onSave}>
        <div className="flex items-center justify-between gap-atlas-4"><h3 className="font-atlas-semibold text-atlas-text">{editor === "create" ? "Add supplier" : "Edit supplier"}</h3><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
        <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-3"><FormField label="Name"><Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={200} /></FormField><FormField label="Address (optional)"><Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={500} /></FormField><FormField label="Mobile (optional)"><Input inputMode="tel" value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} maxLength={50} /></FormField></div>
        <div className="mt-atlas-3"><Button type="submit" loading={isSaving} loadingLabel="Saving supplier...">Save supplier</Button></div>
        {formError && <div className="mt-atlas-2"><Feedback role="alert" tone="danger">{formError}</Feedback></div>}
      </form></Card></div>}
    </Card>
  </div>;
}

function ExpenseRecordEditor({ form, setForm, suppliers, selectedSupplier, editing, isSaving, error,
  onSave, onCancel,
}: Readonly<{
  form: ExpenseRecordForm;
  setForm: React.Dispatch<React.SetStateAction<ExpenseRecordForm>>;
  suppliers: readonly Supplier[];
  selectedSupplier: Supplier | null;
  editing: boolean;
  isSaving: boolean;
  error: string;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}>) {
  return <Card as="section" aria-labelledby="expense-record-editor-heading">
    <form onSubmit={onSave}>
      <div className="flex flex-col gap-atlas-2 border-b border-atlas-border pb-atlas-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="expense-record-editor-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{editing ? `Correct ${expenseKindLabel(form.kind)}` : "New Cost"}</h3>
          {editing && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Only unpaid records can be corrected.</p>}
        </div>
        {editing && <Button type="button" variant="ghost" onClick={onCancel}>Cancel correction</Button>}
      </div>

      <div className="mt-atlas-4 grid gap-atlas-3 md:grid-cols-3">
        <FormField label="Type">
          <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ExpenseRecordKind })}>
            <option value="purchase">Purchase</option>
            <option value="expense">Expense</option>
          </Select>
        </FormField>
        <FormField label="Business date"><Input type="date" required value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} /></FormField>
        <FormField label="Supplier (optional)">
          <Select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value, counterpartyName: event.target.value ? "" : form.counterpartyName })}>
            <option value="">No saved supplier</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </Select>
        </FormField>
      </div>

      {selectedSupplier && <div className="mt-atlas-3"><Card surface="muted"><p className="text-atlas-xs text-atlas-text-muted"><span className="font-atlas-semibold text-atlas-text">{selectedSupplier.name}</span>{selectedSupplier.address ? ` · ${selectedSupplier.address}` : ""}{selectedSupplier.mobile ? ` · ${selectedSupplier.mobile}` : ""}</p></Card></div>}

      {!form.supplierId && <div className="mt-atlas-3"><FormField label="Counterparty / Payee"><Input required value={form.counterpartyName} onChange={(event) => setForm({ ...form, counterpartyName: event.target.value })} maxLength={200} placeholder="Supplier, garage, mechanic, contractor..." /></FormField></div>}

      <div className="mt-atlas-3"><FormField label="Particulars / description"><Input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={300} placeholder="Coal purchase, tractor repair, lubricant, consumables..." /></FormField></div>

      <div className="mt-atlas-3 grid gap-atlas-3 md:grid-cols-2">
        <FormField label="Cost amount"><Input required inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></FormField>
        <FormField label="Reference / note (optional)"><Input value={form.referenceNote} onChange={(event) => setForm({ ...form, referenceNote: event.target.value })} maxLength={500} placeholder="Invoice or internal voucher note" /></FormField>
      </div>

      <div className="mt-atlas-4 flex flex-col gap-atlas-3 border-t border-atlas-border pt-atlas-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-atlas-xs text-atlas-text-muted">Payment is recorded separately in Outgoing Payments.</p>
        <Button type="submit" loading={isSaving} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{editing ? "Save correction" : `Save ${expenseKindLabel(form.kind)}`}</Button>
      </div>
      {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    </form>
  </Card>;
}

function ExpensePaymentEditor({
  form,
  setForm,
  candidates,
  status,
  isLoadingCandidates,
  candidatesError,
  isSaving,
  error,
  onSave,
}: Readonly<{
  form: ExpensePaymentForm;
  setForm: React.Dispatch<React.SetStateAction<ExpensePaymentForm>>;
  candidates: readonly ExpenseRecord[];
  status: ReturnType<typeof getExpensePaymentFormStatus>;
  isLoadingCandidates: boolean;
  candidatesError: Error | null;
  isSaving: boolean;
  error: string;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}>) {
  return <form onSubmit={onSave} aria-labelledby="expense-payment-editor-heading" className="space-y-atlas-4">
    <Card as="section">
      <div className="border-b border-atlas-border pb-atlas-3">
        <h3 id="expense-payment-editor-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Payment Details</h3>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">One saved payment creates one Cash Book Money Out.</p>
      </div>
      <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
        <FormField label="Payment date"><Input type="date" required value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} /></FormField>
        <FormField label="Payment amount"><Input required inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => setExpensePaymentAmount(current, event.target.value))} placeholder="0.00" /></FormField>
        <FormField label="Payment mode"><Select required value={form.paymentMode} onChange={(event) => setForm({ ...form, paymentMode: event.target.value })}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
        <FormField label="Reference / note (optional)"><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} maxLength={500} /></FormField>
      </div>
    </Card>

    <Card as="section" aria-labelledby="outstanding-costs-heading">
      <div className="border-b border-atlas-border pb-atlas-3">
        <h3 id="outstanding-costs-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Outstanding Costs</h3>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Nothing is selected automatically. Select a Cost to allocate its full Due, then adjust Allocation for a partial payment.</p>
      </div>

      {isLoadingCandidates && <EmptyState title="Loading outstanding costs..." />}
      {Boolean(candidatesError) && <div className="py-atlas-3"><Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(candidatesError, "Could not load outstanding costs.")}</Feedback></div>}
      {!isLoadingCandidates && !candidatesError && candidates.length === 0 && <EmptyState title="No outstanding costs" description="Only active Purchase and Expense records with a genuine due balance appear here." />}
      {!isLoadingCandidates && !candidatesError && candidates.length > 0 && <ul className="max-h-96 divide-y divide-atlas-border overflow-y-auto overscroll-contain">{candidates.map((record) => {
        const selected = Object.prototype.hasOwnProperty.call(form.allocations, record.id);
        return <li key={record.id}>
          <div
            className={`flex cursor-pointer flex-col gap-atlas-3 border-l-4 px-atlas-3 py-atlas-3 transition-colors sm:flex-row sm:items-start ${selected ? "border-l-atlas-primary bg-atlas-primary-surface" : "border-l-transparent bg-atlas-surface hover:bg-atlas-surface-hover"}`}
            onClick={(event) => {
              if (isInteractiveExpensePaymentRowTarget(event.target)) return;
              setForm((current) => toggleExpensePaymentAllocation(
                current,
                record,
                !Object.prototype.hasOwnProperty.call(current.allocations, record.id),
              ));
            }}
          >
            <div className="flex min-w-0 flex-1 items-start gap-atlas-3">
              <label className="flex min-h-atlas-12 cursor-pointer items-center">
                <Checkbox aria-label={`Allocate payment to ${record.description}`} checked={selected} onChange={(event) => setForm((current) => toggleExpensePaymentAllocation(current, record, event.target.checked))} />
              </label>
              <div className="min-w-0 flex-1">
                <p className="text-atlas-sm font-atlas-semibold text-atlas-text">{expenseKindLabel(record.kind)} · {record.counterpartyNameSnapshot}</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatChallanDate(record.businessDate)} · {record.description}</p>
                <dl className="mt-atlas-2 grid grid-cols-3 gap-atlas-3"><PaymentMetric label="Cost" value={record.totalAmount} /><PaymentMetric label="Paid" value={record.totalPaid} /><PaymentMetric label="Due" value={record.outstandingAmount} /></dl>
              </div>
            </div>
            <div className="sm:w-56">
              <FormField label="Allocation"><Input inputMode="decimal" disabled={!selected} value={form.allocations[record.id] ?? ""} onChange={(event) => setForm((current) => setExpensePaymentAllocation(current, record.id, event.target.value))} placeholder="0.00" /></FormField>
            </div>
          </div>
        </li>;
      })}</ul>}

      {!status.canSubmit && (Boolean(form.amount) || Object.keys(form.allocations).length > 0) && <div className="mt-atlas-3"><Feedback role="status" tone="warning">{status.error}</Feedback></div>}
      {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
      <section aria-label="Payment reconciliation" className="sticky bottom-atlas-0 z-20 -mx-atlas-4 mt-atlas-4 flex flex-col gap-atlas-3 border-t border-atlas-border-strong bg-atlas-surface px-atlas-4 py-atlas-3 sm:flex-row sm:items-end sm:justify-between">
        <dl className="grid grid-cols-3 gap-atlas-3"><PaymentMetric label="Payment" value={status.paymentAmount} /><PaymentMetric label="Allocated" value={status.allocatedAmount} /><PaymentMetric label="Remaining" value={status.remainingAmount} /></dl>
        <div className="grid sm:block"><Button type="submit" disabled={!status.canSubmit} loading={isSaving} loadingLabel="Saving payment...">Save Payment</Button></div>
      </section>
    </Card>
  </form>;
}

function isInteractiveExpensePaymentRowTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(
    "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [contenteditable='true']",
  ) !== null;
}

function RecentCosts({ records, isLoading, error, onOpen, onViewAll }: Readonly<{
  records: readonly ExpenseRecord[];
  isLoading: boolean;
  error: unknown;
  onOpen: (id: string) => void;
  onViewAll: () => void;
}>) {
  return <Card as="section" aria-labelledby="recent-costs-heading">
    <div className="flex h-96 flex-col">
      <div className="shrink-0 border-b border-atlas-border pb-atlas-3">
        <h3 id="recent-costs-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Costs</h3>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Latest 10 Purchase and Expense records</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <EmptyState title="Loading recent costs..." />}
        {Boolean(error) && <div className="py-atlas-3"><Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(error, "Could not load recent costs.")}</Feedback></div>}
        {!isLoading && !error && records.length === 0 && <EmptyState title="No costs saved yet." />}
        {!isLoading && !error && records.length > 0 && <ul className="divide-y divide-atlas-border">{records.map((record) => {
          const status = record.status === "void"
            ? resolveStatusPresentation(EXPENSE_RECORD_STATUS, record.status)
            : resolveStatusPresentation(EXPENSE_PAYMENT_STATUS, record.paymentState);
          return <li key={record.id} className="py-atlas-3">
            <div className="flex items-start justify-between gap-atlas-3">
              <div className="min-w-0">
                <p className="text-atlas-xs text-atlas-text-muted">{formatChallanDate(record.businessDate)} · {expenseKindLabel(record.kind)}</p>
                <p className="mt-atlas-1 truncate text-atlas-sm font-atlas-semibold text-atlas-text">{record.counterpartyNameSnapshot}</p>
                <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-muted">{record.description}</p>
              </div>
              <p className="shrink-0 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatSalesMoney(record.totalAmount)}</p>
            </div>
            <div className="mt-atlas-2 flex items-center justify-between gap-atlas-2">
              <div className="flex flex-wrap items-center gap-atlas-2">
                <StatusPill label={status.label} tone={status.tone} />
                {record.status === "active" && <span className="text-atlas-xs tabular-nums text-atlas-text-muted">Due {formatSalesMoney(record.outstandingAmount)}</span>}
              </div>
              <Button type="button" variant="ghost" onClick={() => onOpen(record.id)}>{ATLAS_UI_STRINGS.actions.open} →</Button>
            </div>
          </li>;
        })}</ul>}
      </div>
      <div className="shrink-0 border-t border-atlas-border pt-atlas-3">
        <Button type="button" variant="ghost" onClick={onViewAll}>View all costs →</Button>
      </div>
    </div>
  </Card>;
}

function ExpenseRecordDetail({ record, payments, eligibility, confirmingVoid, isVoiding, onEdit, onAskVoid,
  onCancelVoid, onConfirmVoid, onRecordPayment, onClose,
}: Readonly<{
  record: ExpenseRecord;
  payments: readonly ExpensePayment[];
  eligibility: ReturnType<typeof getExpenseRecordEligibility>;
  confirmingVoid: boolean;
  isVoiding: boolean;
  onEdit: () => void;
  onAskVoid: () => void;
  onCancelVoid: () => void;
  onConfirmVoid: () => void;
  onRecordPayment: () => void;
  onClose: () => void;
}>) {
  return <section aria-labelledby="expense-record-detail-heading" className="mt-6 rounded-xl border border-slate-300 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 id="expense-record-detail-heading" className="text-xl font-bold">{expenseKindLabel(record.kind)} · {record.description}</h3>{record.status === "void" && <span className="rounded bg-slate-200 px-2 py-1 text-xs font-extrabold text-slate-700">VOID</span>}{record.isLocked && <span className="rounded bg-amber-100 px-2 py-1 text-xs font-extrabold text-amber-900">Financially locked</span>}</div><p className="mt-1 text-sm text-slate-600">{formatChallanDate(record.businessDate)} · saved historical identity</p></div><button type="button" onClick={onClose} className="text-sm font-semibold text-slate-600 hover:underline">Close</button></div>
    <dl className="mt-5 grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4"><DetailValue label="Supplier / counterparty" value={record.counterpartyNameSnapshot} /><DetailValue label="Saved address" value={record.counterpartyAddressSnapshot ?? "—"} /><DetailValue label="Saved mobile" value={record.counterpartyMobileSnapshot ?? "—"} /><DetailValue label="Reference / note" value={record.note ?? "—"} /><DetailMoney label="Cost" value={record.totalAmount} /><DetailMoney label="Paid" value={record.totalPaid} /><DetailMoney label="Due" value={record.outstandingAmount} /><DetailValue label="Payment state" value={record.status === "void" ? "—" : expensePaymentStateLabel(record.paymentState)} /></dl>
    <div className="mt-4 flex flex-wrap gap-2">{eligibility.canEdit && <button type="button" onClick={onEdit} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold">Edit unpaid record</button>}{eligibility.canVoid && !confirmingVoid && <button type="button" onClick={onAskVoid} className="h-9 rounded-lg border border-red-300 bg-white px-4 text-sm font-bold text-red-700">Void unpaid record</button>}{record.status === "active" && record.outstandingAmount > 0 && <button type="button" onClick={onRecordPayment} className="h-9 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white">Record Payment</button>}{eligibility.reason === "locked" && <span className="self-center text-xs font-semibold text-amber-800">Payment history locks financial edits and voiding.</span>}</div>
    {confirmingVoid && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm"><span className="font-semibold text-red-800">Void this unpaid record? It will remain visible and stop affecting totals.</span><button type="button" onClick={onConfirmVoid} disabled={isVoiding} className="h-8 rounded bg-red-700 px-3 text-xs font-bold text-white disabled:opacity-50">{isVoiding ? "Voiding..." : "Confirm void"}</button><button type="button" onClick={onCancelVoid} disabled={isVoiding} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-bold">Cancel</button></div>}
    <div className="mt-5 border-t border-slate-200 pt-4"><h4 className="font-bold">Payment history for this record</h4>{payments.length === 0 && <p className="mt-2 text-sm text-slate-500">No payment has been allocated to this record.</p>}{payments.length > 0 && <ul className="mt-3 space-y-2">{payments.map((payment) => {
      const allocation = payment.allocations.find((item) => item.expenseRecordId === record.id)!;
      return <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm"><span>{formatChallanDate(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)}{payment.note ? ` · ${payment.note}` : ""}</span><span className="font-bold tabular-nums">Allocated {formatSalesMoney(allocation.allocatedAmount)}</span></li>;
    })}</ul>}</div>
  </section>;
}

function RecentOutgoingPayments({ payments, isLoading, error, onViewAll }: Readonly<{
  payments: readonly ExpensePayment[];
  isLoading: boolean;
  error: Error | null;
  onViewAll: () => void;
}>) {
  return <Card as="section" aria-labelledby="recent-outgoing-payments-heading">
    <div className="flex h-96 flex-col">
      <div className="shrink-0 border-b border-atlas-border pb-atlas-3">
        <h3 id="recent-outgoing-payments-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Outgoing Payments</h3>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Latest 10 saved payments</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <EmptyState title="Loading outgoing payments..." />}
        {Boolean(error) && <div className="py-atlas-3"><Feedback role="alert" tone="danger">{expenseOfficeErrorMessage(error, "Could not load recent outgoing payments.")}</Feedback></div>}
        {!isLoading && !error && payments.length === 0 && <EmptyState title="No outgoing payments saved yet." />}
        {!isLoading && !error && payments.length > 0 && <ul className="divide-y divide-atlas-border">{payments.map((payment) => <li key={payment.id} className="py-atlas-3">
          <div className="flex items-start justify-between gap-atlas-3">
            <div className="min-w-0">
              <p className="text-atlas-xs text-atlas-text-muted">{formatChallanDate(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)}</p>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{payment.allocations.length === 1 ? "1 cost allocated" : `${payment.allocations.length} costs allocated`}</p>
            </div>
            <p className="shrink-0 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatSalesMoney(payment.amount)}</p>
          </div>
          <ul className="mt-atlas-2 space-y-atlas-1">{payment.allocations.slice(0, 2).map((allocation) => <li key={allocation.id} className="flex items-start justify-between gap-atlas-2 text-atlas-xs text-atlas-text-muted"><span className="min-w-0 truncate">{expenseKindLabel(allocation.expenseKind)} · {allocation.counterpartyNameSnapshot} · {allocation.description}</span><span className="shrink-0 tabular-nums">{formatSalesMoney(allocation.allocatedAmount)}</span></li>)}</ul>
          {payment.allocations.length > 2 && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">+{payment.allocations.length - 2} more allocations</p>}
          {payment.note && <p className="mt-atlas-2 truncate text-atlas-xs text-atlas-text-subtle">{payment.note}</p>}
        </li>)}</ul>}
      </div>
      <div className="shrink-0 border-t border-atlas-border pt-atlas-3">
        <Button type="button" variant="ghost" onClick={onViewAll}>View all payments →</Button>
      </div>
    </div>
  </Card>;
}

function PaymentMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div className="min-w-0"><dt className="text-atlas-xs text-atlas-text-muted">{label}</dt><dd className="mt-atlas-1 break-words text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatSalesMoney(value)}</dd></div>;
}

function ArchiveTotal({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div><p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">{label}</p><p className="mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(value)}</p></div>;
}

function DetailValue({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value}</dd></div>;
}

function DetailMoney({ label, value }: Readonly<{ label: string; value: number }>) {
  return <DetailValue label={label} value={formatSalesMoney(value)} />;
}
