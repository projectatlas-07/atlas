"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  fillExpenseOutstandingAllocation,
  filterExpenseRecords,
  getExpensePaymentCandidates,
  getExpensePaymentFormStatus,
  getExpenseRecordEligibility,
  getPaymentsForExpenseRecord,
  resolveExpenseDateRange,
  summarizeExpenseRecords,
  toggleExpensePaymentAllocation,
  type ExpenseDatePreset,
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
import { getLocalDate } from "../../../lib/local-date";

export const expenseRecordsKey = (factoryId: string) =>
  ["office-expense-records", factoryId] as const;
export const expenseSuppliersKey = (factoryId: string) =>
  ["office-expense-suppliers", factoryId] as const;
export const expensePaymentsKey = (factoryId: string) =>
  ["office-expense-payments", factoryId] as const;

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100";
const presets: Array<{ value: ExpenseDatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
];
const kindFilters: Array<{ value: ExpenseKindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "purchase", label: "Purchases" },
  { value: "expense", label: "Expenses" },
];

export function ExpensesOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [recordForm, setRecordForm] = useState<ExpenseRecordForm>(() => emptyExpenseRecordForm(localToday));
  const [editingRecordId, setEditingRecordId] = useState("");
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(emptySupplierForm);
  const [supplierEditor, setSupplierEditor] = useState<"create" | "edit" | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
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
  const [preset, setPreset] = useState<ExpenseDatePreset>("today");
  const [kindFilter, setKindFilter] = useState<ExpenseKindFilter>("all");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);

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
  const selectedSupplier = suppliers.find((supplier) => supplier.id === recordForm.supplierId) ?? null;
  const range = resolveExpenseDateRange(preset, localToday, customFrom, customTo);
  const filteredRecords = filterExpenseRecords(records, range, kindFilter);
  const summary = summarizeExpenseRecords(filteredRecords);
  const paymentStatus = getExpensePaymentFormStatus(paymentForm, candidates);
  const queryError = suppliersQuery.error || recordsQuery.error || paymentsQuery.error;

  function openNewRecord(kind: ExpenseRecordKind) {
    setRecordForm(emptyExpenseRecordForm(localToday, kind));
    setEditingRecordId("");
    setShowRecordForm(true);
    setSupplierEditor(null);
    setRecordError("");
    setSupplierError("");
    setSuccess("");
  }

  function openEditRecord(record: ExpenseRecord) {
    if (!getExpenseRecordEligibility(record).canEdit) return;
    setRecordForm(expenseRecordFormFromSaved(record));
    setEditingRecordId(record.id);
    setShowRecordForm(true);
    setSupplierEditor(null);
    setRecordError("");
    setSuccess("");
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
      setShowRecordForm(false);
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
    setSupplierError("");
  }

  function openSupplierEdit(supplier: Supplier) {
    setSupplierForm({ name: supplier.name, address: supplier.address ?? "", mobile: supplier.mobile ?? "" });
    setSupplierEditor("edit");
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
    setIsSavingSupplier(true);
    setSupplierError("");
    try {
      const saved = supplierEditor === "edit" && selectedSupplier
        ? await updateSupplier({ ...input, supplierId: selectedSupplier.id })
        : await createSupplier(input);
      queryClient.setQueryData<Supplier[]>(expenseSuppliersKey(factoryId), (current = []) => {
        const next = current.some((supplier) => supplier.id === saved.id)
          ? current.map((supplier) => supplier.id === saved.id ? saved : supplier)
          : [...current, saved];
        return next.sort((left, right) => left.name.localeCompare(right.name, "en-IN"));
      });
      setRecordForm((current) => ({ ...current, supplierId: saved.id, counterpartyName: "" }));
      setSupplierEditor(null);
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

  return (
    <section aria-labelledby="expenses-office-heading" className="mt-10 border-t-4 border-amber-300 pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-amber-800">Expenses & Purchases</p>
          <h2 id="expenses-office-heading" className="mt-1 text-2xl font-bold">Costs and outgoing payments</h2>
          <p className="mt-1 text-sm text-slate-600">Record the cost once. Record actual payment separately; Cash Book receives Money Out automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openNewRecord("purchase")} className="h-10 rounded-lg bg-amber-700 px-4 text-sm font-bold text-white">Record Purchase</button>
          <button type="button" onClick={() => openNewRecord("expense")} className="h-10 rounded-lg border border-amber-700 bg-white px-4 text-sm font-bold text-amber-900">Record Expense</button>
          <button type="button" onClick={() => { setShowPaymentForm((open) => !open); setPaymentError(""); }} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white">Record Payment</button>
        </div>
      </div>

      {queryError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{expenseOfficeErrorMessage(queryError, "Could not load Expenses & Purchases.")}</p>}
      {success && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</p>}

      {showRecordForm && <ExpenseRecordEditor
        form={recordForm}
        setForm={setRecordForm}
        suppliers={suppliers}
        selectedSupplier={selectedSupplier}
        editing={Boolean(editingRecordId)}
        isSaving={isSavingRecord}
        error={recordError}
        supplierEditor={supplierEditor}
        supplierForm={supplierForm}
        setSupplierForm={setSupplierForm}
        isSavingSupplier={isSavingSupplier}
        supplierError={supplierError}
        onOpenSupplierCreate={openSupplierCreate}
        onOpenSupplierEdit={openSupplierEdit}
        onCancelSupplier={() => { setSupplierEditor(null); setSupplierError(""); }}
        onSaveSupplier={saveSupplier}
        onSave={saveRecord}
        onCancel={() => { setShowRecordForm(false); setEditingRecordId(""); setSupplierEditor(null); setRecordError(""); }}
      />}

      {showPaymentForm && <ExpensePaymentEditor
        form={paymentForm}
        setForm={setPaymentForm}
        candidates={candidates}
        status={paymentStatus}
        isSaving={isSavingPayment}
        error={paymentError}
        onSave={savePayment}
        onClose={() => { setShowPaymentForm(false); setPaymentError(""); }}
      />}

      <ExpenseRegister
        records={filteredRecords}
        summary={summary}
        isLoading={recordsQuery.isLoading}
        error={recordsQuery.error}
        preset={preset}
        setPreset={setPreset}
        kindFilter={kindFilter}
        setKindFilter={setKindFilter}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        range={range}
        onOpen={setSelectedRecordId}
      />

      {selectedRecord && <ExpenseRecordDetail
        record={selectedRecord}
        payments={getPaymentsForExpenseRecord(payments, selectedRecord.id)}
        eligibility={getExpenseRecordEligibility(selectedRecord)}
        confirmingVoid={confirmingVoidId === selectedRecord.id}
        isVoiding={isVoiding}
        onEdit={() => openEditRecord(selectedRecord)}
        onAskVoid={() => setConfirmingVoidId(selectedRecord.id)}
        onCancelVoid={() => setConfirmingVoidId("")}
        onConfirmVoid={() => void confirmVoid(selectedRecord)}
        onRecordPayment={() => { setShowPaymentForm(true); setPaymentError(""); }}
        onClose={() => { setSelectedRecordId(""); setConfirmingVoidId(""); }}
      />}

      <ExpensePaymentHistory payments={payments} isLoading={paymentsQuery.isLoading} />
    </section>
  );
}

function ExpenseRecordEditor({ form, setForm, suppliers, selectedSupplier, editing, isSaving, error,
  supplierEditor, supplierForm, setSupplierForm, isSavingSupplier, supplierError,
  onOpenSupplierCreate, onOpenSupplierEdit, onCancelSupplier, onSaveSupplier, onSave, onCancel,
}: Readonly<{
  form: ExpenseRecordForm;
  setForm: React.Dispatch<React.SetStateAction<ExpenseRecordForm>>;
  suppliers: readonly Supplier[];
  selectedSupplier: Supplier | null;
  editing: boolean;
  isSaving: boolean;
  error: string;
  supplierEditor: "create" | "edit" | null;
  supplierForm: SupplierForm;
  setSupplierForm: React.Dispatch<React.SetStateAction<SupplierForm>>;
  isSavingSupplier: boolean;
  supplierError: string;
  onOpenSupplierCreate: () => void;
  onOpenSupplierEdit: (supplier: Supplier) => void;
  onCancelSupplier: () => void;
  onSaveSupplier: (event: React.FormEvent<HTMLFormElement>) => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}>) {
  return <section aria-labelledby="expense-record-editor-heading" className="mt-6 rounded-xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <h3 id="expense-record-editor-heading" className="text-lg font-bold">{editing ? `Correct ${expenseKindLabel(form.kind)}` : `New ${expenseKindLabel(form.kind)}`}</h3>
      <button type="button" onClick={onCancel} className="text-sm font-semibold text-slate-600 hover:underline">Close</button>
    </div>
    <form onSubmit={onSave} className="mt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-slate-600">Type<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ExpenseRecordKind })} className={inputClass}><option value="purchase">Purchase</option><option value="expense">Expense</option></select></label>
        <label className="text-xs font-medium text-slate-600">Business date<input type="date" required value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Supplier (optional)<select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value, counterpartyName: event.target.value ? "" : form.counterpartyName })} className={inputClass}><option value="">No saved supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <div className="flex items-end gap-2"><button type="button" onClick={onOpenSupplierCreate} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">Quick-create supplier</button>{selectedSupplier && <button type="button" onClick={() => onOpenSupplierEdit(selectedSupplier)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold">Edit supplier</button>}</div>
      </div>
      {selectedSupplier && <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600"><span className="font-bold text-slate-900">{selectedSupplier.name}</span>{selectedSupplier.address ? ` · ${selectedSupplier.address}` : ""}{selectedSupplier.mobile ? ` · ${selectedSupplier.mobile}` : ""}</div>}
      {!form.supplierId && <label className="mt-3 block max-w-xl text-xs font-medium text-slate-600">Counterparty / payee<input required value={form.counterpartyName} onChange={(event) => setForm({ ...form, counterpartyName: event.target.value })} maxLength={200} placeholder="Supplier, garage, mechanic..." className={inputClass} /></label>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_2fr]">
        <label className="text-xs font-medium text-slate-600">Particulars / description<input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={300} placeholder="Coal purchase, tractor repair..." className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Cost amount<input required inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Reference / note (optional)<input value={form.referenceNote} onChange={(event) => setForm({ ...form, referenceNote: event.target.value })} maxLength={500} placeholder="Invoice or internal note" className={inputClass} /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="submit" disabled={isSaving} className="h-10 rounded-lg bg-amber-700 px-5 text-sm font-bold text-white disabled:opacity-50">{isSaving ? "Saving..." : editing ? "Save correction" : `Save ${expenseKindLabel(form.kind)}`}</button><span className="text-xs text-slate-500">Saving a cost does not create Cash Book Money Out.</span></div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    </form>
    {supplierEditor && <form onSubmit={onSaveSupplier} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-4"><h4 className="font-bold">{supplierEditor === "create" ? "Quick-create supplier" : "Edit selected supplier"}</h4><button type="button" onClick={onCancelSupplier} className="text-xs font-semibold text-slate-600">Cancel</button></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium text-slate-600">Name<input required value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} maxLength={200} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">Address (optional)<input value={supplierForm.address} onChange={(event) => setSupplierForm({ ...supplierForm, address: event.target.value })} maxLength={500} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">Mobile (optional)<input value={supplierForm.mobile} onChange={(event) => setSupplierForm({ ...supplierForm, mobile: event.target.value })} maxLength={50} className={inputClass} /></label></div>
      <button type="submit" disabled={isSavingSupplier} className="mt-3 h-9 rounded-lg bg-slate-950 px-4 text-xs font-bold text-white disabled:opacity-50">{isSavingSupplier ? "Saving supplier..." : "Save supplier"}</button>
      {supplierError && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{supplierError}</p>}
    </form>}
  </section>;
}

function ExpensePaymentEditor({ form, setForm, candidates, status, isSaving, error, onSave, onClose }: Readonly<{
  form: ExpensePaymentForm;
  setForm: React.Dispatch<React.SetStateAction<ExpensePaymentForm>>;
  candidates: readonly ExpenseRecord[];
  status: ReturnType<typeof getExpensePaymentFormStatus>;
  isSaving: boolean;
  error: string;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}>) {
  return <section aria-labelledby="expense-payment-editor-heading" className="mt-6 rounded-xl border border-slate-300 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-center justify-between gap-4"><div><h3 id="expense-payment-editor-heading" className="text-lg font-bold">Record outgoing payment</h3><p className="mt-1 text-xs text-slate-500">Explicitly select each source. Nothing is selected or allocated automatically.</p></div><button type="button" onClick={onClose} className="text-sm font-semibold text-slate-600 hover:underline">Close</button></div>
    <form onSubmit={onSave} className="mt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium text-slate-600">Payment date<input type="date" required value={form.paymentDate} onChange={(event) => setForm({ ...form, paymentDate: event.target.value })} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">Payment amount<input required inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" className={inputClass} /></label><label className="text-xs font-medium text-slate-600">Payment mode<select required value={form.paymentMode} onChange={(event) => setForm({ ...form, paymentMode: event.target.value })} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Reference / note (optional)<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} maxLength={500} className={inputClass} /></label></div>
      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h4 className="text-sm font-bold">Allocate payment</h4><p className="mt-1 text-xs text-slate-500">Only active records with an outstanding balance are available.</p></div>{candidates.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">No payable Expense/Purchase records.</p>}{candidates.length > 0 && <ul className="divide-y divide-slate-100">{candidates.map((record) => {
        const selected = Object.prototype.hasOwnProperty.call(form.allocations, record.id);
        return <li key={record.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[2rem_1.5fr_repeat(3,1fr)_10rem_7rem] lg:items-center"><input type="checkbox" aria-label={`Allocate payment to ${record.description}`} checked={selected} onChange={(event) => setForm(toggleExpensePaymentAllocation(form, record.id, event.target.checked))} className="h-4 w-4" /><div><p className="font-bold">{expenseKindLabel(record.kind)} · {record.description}</p><p className="text-xs text-slate-500">{formatChallanDate(record.businessDate)} · {record.counterpartyNameSnapshot}</p></div><SmallMoney label="Cost" value={record.totalAmount} /><SmallMoney label="Paid" value={record.totalPaid} /><SmallMoney label="Due" value={record.outstandingAmount} /><label className="text-xs font-medium text-slate-600">Allocation<input inputMode="decimal" disabled={!selected} value={form.allocations[record.id] ?? ""} onChange={(event) => setForm({ ...form, allocations: { ...form.allocations, [record.id]: event.target.value } })} className={inputClass} /></label><button type="button" disabled={!selected} onClick={() => setForm(fillExpenseOutstandingAllocation(form, record))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold disabled:opacity-40">Pay full due</button></li>;
      })}</ul>}</div>
      <div className="mt-4 flex flex-col gap-4 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-end sm:justify-between"><dl className="grid grid-cols-3 gap-5 text-sm"><MoneyTotal label="Payment" value={status.paymentAmount} /><MoneyTotal label="Allocated" value={status.allocatedAmount} /><MoneyTotal label="Remaining" value={status.remainingAmount} /></dl><button type="submit" disabled={!status.canSubmit || isSaving} className="h-10 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? "Saving payment..." : "Save payment"}</button></div>
      {!status.canSubmit && form.amount && <p className="mt-3 text-xs font-medium text-amber-800">{status.error}</p>}{error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    </form>
  </section>;
}

function ExpenseRegister({ records, summary, isLoading, error, preset, setPreset, kindFilter, setKindFilter,
  customFrom, setCustomFrom, customTo, setCustomTo, range, onOpen,
}: Readonly<{
  records: readonly ExpenseRecord[];
  summary: ReturnType<typeof summarizeExpenseRecords>;
  isLoading: boolean;
  error: unknown;
  preset: ExpenseDatePreset;
  setPreset: (preset: ExpenseDatePreset) => void;
  kindFilter: ExpenseKindFilter;
  setKindFilter: (kind: ExpenseKindFilter) => void;
  customFrom: string;
  setCustomFrom: (date: string) => void;
  customTo: string;
  setCustomTo: (date: string) => void;
  range: ReturnType<typeof resolveExpenseDateRange>;
  onOpen: (id: string) => void;
}>) {
  return <section aria-labelledby="expense-register-heading" className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h3 id="expense-register-heading" className="text-xl font-bold">Expense / Purchase Register</h3><p className="mt-1 text-sm text-slate-600">One row per cost source. Paid and Due come from S7A allocations.</p></div><div className="flex flex-wrap gap-2" aria-label="Expense Register date filters">{presets.map((option) => <button key={option.value} type="button" aria-pressed={preset === option.value} onClick={() => setPreset(option.value)} className={`h-9 rounded-lg border px-3 text-sm font-semibold ${preset === option.value ? "border-amber-700 bg-amber-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{option.label}</button>)}</div></div><div className="mt-4 flex flex-wrap gap-2" aria-label="Expense Register type filters">{kindFilters.map((option) => <button key={option.value} type="button" aria-pressed={kindFilter === option.value} onClick={() => setKindFilter(option.value)} className={`h-8 rounded-full px-3 text-xs font-bold ${kindFilter === option.value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>{option.label}</button>)}</div>{preset === "custom" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">From date<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">To date<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className={inputClass} /></label></div>}{preset === "custom" && !range && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Choose a valid inclusive date range.</p>}{range && <p className="mt-3 text-xs text-slate-500">Showing {formatChallanDate(range.fromDate)} to {formatChallanDate(range.toDate)}, inclusive.</p>}</div>
    <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 sm:grid-cols-4"><SummaryValue label="Total Purchases" value={summary.totalPurchases} /><SummaryValue label="Total Expenses" value={summary.totalExpenses} /><SummaryValue label="Total Paid" value={summary.totalPaid} /><SummaryValue label="Total Outstanding" value={summary.totalOutstanding} /></div>
    {isLoading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading Expenses & Purchases...</p>}{Boolean(error) && <p role="alert" className="px-5 py-10 text-center text-sm font-semibold text-red-700">{expenseOfficeErrorMessage(error, "Could not load the register.")}</p>}{!isLoading && !error && range && records.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No Expense/Purchase records in this range.</p>}{!isLoading && !error && records.length > 0 && <div className="max-h-[42rem] overflow-auto"><table className="w-full min-w-[70rem] text-left text-sm"><thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-500 shadow-sm"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Supplier / counterparty</th><th className="px-4 py-3">Particulars</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Due</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Record</th></tr></thead><tbody className="divide-y divide-slate-100">{records.map((record) => <tr key={record.id} className={record.status === "void" ? "bg-slate-50 text-slate-500" : "bg-white"}><td className="whitespace-nowrap px-4 py-3">{formatChallanDate(record.businessDate)}</td><td className="px-4 py-3 font-bold">{expenseKindLabel(record.kind)}</td><td className="px-4 py-3 font-medium">{record.counterpartyNameSnapshot}</td><td className="px-4 py-3">{record.description}{record.note ? <p className="mt-1 text-xs text-slate-500">{record.note}</p> : null}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{formatSalesMoney(record.totalAmount)}</td><td className="px-4 py-3 text-right tabular-nums">{record.status === "void" ? "—" : formatSalesMoney(record.totalPaid)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{record.status === "void" ? "—" : formatSalesMoney(record.outstandingAmount)}</td><td className="px-4 py-3">{record.status === "void" ? "—" : expensePaymentStateLabel(record.paymentState)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${record.status === "void" ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800"}`}>{record.status === "void" ? "VOID" : "Active"}</span></td><td className="px-4 py-3 text-right"><button type="button" onClick={() => onOpen(record.id)} className="font-semibold text-amber-800 hover:underline">Open</button></td></tr>)}</tbody></table></div>}
  </section>;
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

function ExpensePaymentHistory({ payments, isLoading }: Readonly<{ payments: readonly ExpensePayment[]; isLoading: boolean }>) {
  return <section aria-labelledby="expense-payment-history-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h3 id="expense-payment-history-heading" className="text-lg font-bold">Outgoing payment history</h3><p className="mt-1 text-xs text-slate-500">One permanent event per real payment, with its explicit allocations.</p>{isLoading && <p className="py-6 text-sm text-slate-500">Loading outgoing payments...</p>}{!isLoading && payments.length === 0 && <p className="py-6 text-sm text-slate-500">No Expense/Purchase payments recorded.</p>}{payments.length > 0 && <ul className="mt-4 space-y-3">{payments.map((payment) => <li key={payment.id} className="rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">Payment {formatSalesMoney(payment.amount)}</p><p className="mt-1 text-xs text-slate-500">{formatChallanDate(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)}{payment.note ? ` · ${payment.note}` : ""}</p></div><span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">Immutable</span></div><ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">{payment.allocations.map((allocation) => <li key={allocation.id} className="flex flex-wrap justify-between gap-4 py-2"><span>{expenseKindLabel(allocation.expenseKind)} · {allocation.description} · {allocation.counterpartyNameSnapshot}</span><span className="font-semibold tabular-nums">{formatSalesMoney(allocation.allocatedAmount)}</span></li>)}</ul></li>)}</ul>}</section>;
}

function SummaryValue({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div className="border-r border-slate-200 px-4 py-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{formatSalesMoney(value)}</p></div>;
}

function SmallMoney({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div className="text-sm"><p className="text-xs text-slate-500">{label}</p><p className="font-semibold tabular-nums">{formatSalesMoney(value)}</p></div>;
}

function MoneyTotal({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-bold tabular-nums">{formatSalesMoney(value)}</dd></div>;
}

function DetailValue({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value}</dd></div>;
}

function DetailMoney({ label, value }: Readonly<{ label: string; value: number }>) {
  return <DetailValue label={label} value={formatSalesMoney(value)} />;
}
