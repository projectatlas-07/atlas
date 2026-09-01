"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildStaffCategoryCreateInput,
  buildStaffCategoryUpdateInput,
  buildStaffPaymentInput,
  buildStaffReferenceSalaryInput,
  buildStaffWorkerCreateInput,
  formatStaffMoney,
  formatStaffPaymentDate,
  formatStaffReferenceSalary,
  insertStaffPaymentNewestFirst,
  splitStaffWorkers,
  STAFF_SECTION_HEADING,
  staffOfficeErrorMessage,
} from "@/features/office/staff-office-model";
import {
  getStaffPaymentSummary,
  listStaffPayments,
  recordStaffPayment,
} from "@/features/staff/services/staff-payment-service";
import {
  archiveStaffWorker,
  createStaffCategory,
  createStaffWorker,
  deleteStaffCategory,
  deleteStaffWorker,
  listStaffCategories,
  listStaffWorkers,
  restoreStaffWorker,
  updateStaffCategory,
  updateStaffReferenceSalary,
} from "@/features/staff/services/staff-worker-service";
import type {
  StaffCategory,
  StaffPayment,
  StaffPaymentSummary,
  StaffWorker,
} from "@/features/staff/types";
import { getLocalDate } from "@/lib/local-date";

const categoriesKey = (factoryId: string) => ["office-staff-categories", factoryId] as const;
const workersKey = (factoryId: string) => ["office-staff-workers", factoryId] as const;
const paymentSummaryKey = (factoryId: string, staffWorkerId: string) =>
  ["office-staff-payment-summary", factoryId, staffWorkerId] as const;
const paymentHistoryKey = (factoryId: string, staffWorkerId: string) =>
  ["office-staff-payment-history", factoryId, staffWorkerId] as const;
const inputClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950";
const primaryButton = "h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

export function StaffOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const categoriesQuery = useQuery({
    queryKey: categoriesKey(factoryId),
    queryFn: () => listStaffCategories(factoryId),
  });
  const workersQuery = useQuery({
    queryKey: workersKey(factoryId),
    queryFn: () => listStaffWorkers(factoryId),
  });

  return (
    <section aria-labelledby="staff-office-heading" className="mt-10 border-t-4 border-indigo-200 pt-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-indigo-700">{STAFF_SECTION_HEADING}</p>
        <h2 id="staff-office-heading" className="mt-1 text-2xl font-bold">Staff and payments</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Keep an individual reference salary for context, then record the actual amount paid whenever payment occurs.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryManagement
          factoryId={factoryId}
          categories={categoriesQuery.data ?? []}
          isLoading={categoriesQuery.isLoading}
          loadError={categoriesQuery.error}
        />
        <WorkerCreate
          factoryId={factoryId}
          categories={categoriesQuery.data ?? []}
          categoriesUnavailable={categoriesQuery.isLoading || Boolean(categoriesQuery.error)}
        />
      </div>

      <WorkerManagement
        factoryId={factoryId}
        workers={workersQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        isLoading={workersQuery.isLoading}
        loadError={workersQuery.error}
      />
    </section>
  );
}

function CategoryManagement({ factoryId, categories, isLoading, loadError }: Readonly<{
  factoryId: string;
  categories: readonly StaffCategory[];
  isLoading: boolean;
  loadError: Error | null;
}>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState("");
  const [categoryAction, setCategoryAction] = useState<"edit" | "delete" | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffCategoryCreateInput(factoryId, name);
    if (!input) return setError("Category name is required.");
    setIsSaving(true); setError(""); setSuccess("");
    try {
      await createStaffCategory(input);
      setName(""); setSuccess("Staff category added.");
      await queryClient.invalidateQueries({ queryKey: categoriesKey(factoryId) });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not add Staff category."));
    } finally { setIsSaving(false); }
  }

  function startEdit(category: StaffCategory) {
    setEditingCategoryId(category.id);
    setEditName(category.name);
    setConfirmingDeleteId("");
    setError(""); setSuccess("");
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffCategoryUpdateInput(
      factoryId,
      editingCategoryId,
      editName,
    );
    if (!input) return setError("Category name is required.");
    setCategoryAction("edit"); setError(""); setSuccess("");
    try {
      const updatedCategory = await updateStaffCategory(input);
      queryClient.setQueryData<StaffCategory[]>(
        categoriesKey(factoryId),
        (current = []) => current.map((category) =>
          category.id === updatedCategory.id ? updatedCategory : category),
      );
      setEditingCategoryId(""); setEditName("");
      setSuccess("Staff category renamed.");
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not rename the Staff category."));
    } finally { setCategoryAction(""); }
  }

  async function removeCategory(category: StaffCategory) {
    setCategoryAction("delete"); setError(""); setSuccess("");
    try {
      await deleteStaffCategory({
        factoryId,
        staffCategoryId: category.id,
      });
      queryClient.setQueryData<StaffCategory[]>(
        categoriesKey(factoryId),
        (current = []) => current.filter((item) => item.id !== category.id),
      );
      setConfirmingDeleteId("");
      setSuccess("Staff category deleted.");
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not delete the Staff category."));
      setConfirmingDeleteId("");
    } finally { setCategoryAction(""); }
  }

  return (
    <section aria-labelledby="staff-categories-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="staff-categories-heading" className="text-lg font-bold">Staff categories</h3>
      <p className="mt-1 text-sm text-slate-600">Categories organize Staff by role. They do not set or calculate salary.</p>
      <form onSubmit={submit} className="mt-5 flex gap-2">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          <span className="sr-only">Category name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Category name" className={inputClass} />
        </label>
        <button disabled={isSaving || Boolean(categoryAction)} className={primaryButton}>{isSaving ? "Adding..." : "Add category"}</button>
      </form>
      <Feedback error={error} success={success} />
      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading Staff categories...</p>}
      {loadError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">{staffOfficeErrorMessage(loadError, "Could not load Staff categories.")}</p>}
      {!isLoading && !loadError && categories.length === 0 && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No Staff categories yet. Add the first one above.</p>}
      <ul className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {categories.map((category) => (
          <li key={category.id} className="px-4 py-3">
            {editingCategoryId === category.id ? (
              <form onSubmit={saveEdit} className="flex items-end gap-2">
                <Field label="Category name" compact>
                  <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} className={inputClass} />
                </Field>
                <button disabled={isSaving || Boolean(categoryAction)} className={secondaryButton}>{categoryAction === "edit" ? "Saving..." : "Save"}</button>
                <button type="button" onClick={() => { setEditingCategoryId(""); setEditName(""); }} disabled={isSaving || Boolean(categoryAction)} className={secondaryButton}>Cancel</button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{category.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => startEdit(category)} disabled={isSaving || Boolean(categoryAction)} className={secondaryButton}>Edit</button>
                  {confirmingDeleteId === category.id ? (
                    <>
                      <button type="button" onClick={() => setConfirmingDeleteId("")} disabled={isSaving || Boolean(categoryAction)} className={secondaryButton}>Cancel</button>
                      <button type="button" onClick={() => removeCategory(category)} disabled={isSaving || Boolean(categoryAction)} className="h-9 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{categoryAction === "delete" ? "Deleting..." : "Confirm delete"}</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { setConfirmingDeleteId(category.id); setEditingCategoryId(""); setError(""); setSuccess(""); }} disabled={isSaving || Boolean(categoryAction)} className="h-9 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 disabled:opacity-50">Delete</button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkerCreate({ factoryId, categories, categoriesUnavailable }: Readonly<{
  factoryId: string;
  categories: readonly StaffCategory[];
  categoriesUnavailable: boolean;
}>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [staffCategoryId, setStaffCategoryId] = useState("");
  const [referenceSalary, setReferenceSalary] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffWorkerCreateInput({
      factoryId, name, staffCategoryId, referenceSalary,
    });
    if (!input) return setError("Enter a name, category, and positive reference salary.");
    setIsSaving(true); setError(""); setSuccess("");
    try {
      await createStaffWorker(input);
      setName(""); setStaffCategoryId(""); setReferenceSalary("");
      setSuccess("Staff member added.");
      await queryClient.invalidateQueries({ queryKey: workersKey(factoryId) });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not add the Staff member."));
    } finally { setIsSaving(false); }
  }

  return (
    <section aria-labelledby="add-staff-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="add-staff-heading" className="text-lg font-bold">Add Staff member</h3>
      <p className="mt-1 text-sm text-slate-600">Reference salary is informational only and never limits payments.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <Field label="Category">
          <select value={staffCategoryId} onChange={(event) => setStaffCategoryId(event.target.value)} disabled={categoriesUnavailable || categories.length === 0} className={inputClass}>
            <option value="">Select category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label="Reference salary">
          <input type="number" min="0.01" step="0.01" value={referenceSalary} onChange={(event) => setReferenceSalary(event.target.value)} className={inputClass} />
        </Field>
        <div className="flex items-end"><button disabled={isSaving || categories.length === 0} className={primaryButton}>{isSaving ? "Adding..." : "Add Staff member"}</button></div>
      </form>
      {!categoriesUnavailable && categories.length === 0 && <p className="mt-4 text-sm text-amber-700">Add a Staff category first.</p>}
      <Feedback error={error} success={success} />
    </section>
  );
}

function WorkerManagement({ factoryId, workers, categories, isLoading, loadError }: Readonly<{
  factoryId: string;
  workers: readonly StaffWorker[];
  categories: readonly StaffCategory[];
  isLoading: boolean;
  loadError: Error | null;
}>) {
  const { active, archived } = splitStaffWorkers(workers);

  return (
    <>
      <section aria-labelledby="active-staff-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 id="active-staff-heading" className="text-lg font-bold">Active Staff</h3>
        <p className="mt-1 text-sm text-slate-600">Record payments or archive people who are no longer active.</p>
        {isLoading && <p className="mt-5 text-sm text-slate-500">Loading Staff members...</p>}
        {loadError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">{staffOfficeErrorMessage(loadError, "Could not load Staff members.")}</p>}
        {!isLoading && !loadError && workers.length === 0 && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No Staff members yet. Use the form above to add one.</p>}
        {!isLoading && !loadError && workers.length > 0 && active.length === 0 && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No active Staff members.</p>}
        <div className="mt-5 grid gap-4">
          {active.map((worker) => (
            <WorkerCard key={worker.id} factoryId={factoryId} worker={worker}
              category={categories.find((category) => category.id === worker.staffCategoryId)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="archived-staff-heading" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h3 id="archived-staff-heading" className="text-lg font-bold">Archived Staff</h3>
        <p className="mt-1 text-sm text-slate-600">Past Staff remain available with their complete read-only payment history.</p>
        {!isLoading && !loadError && archived.length === 0 && <p className="mt-5 text-sm text-slate-500">No archived Staff members.</p>}
        <div className="mt-5 grid gap-4">
          {archived.map((worker) => (
            <WorkerCard key={worker.id} factoryId={factoryId} worker={worker}
              category={categories.find((category) => category.id === worker.staffCategoryId)} />
          ))}
        </div>
      </section>
    </>
  );
}

function WorkerCard({ factoryId, worker, category }: Readonly<{
  factoryId: string;
  worker: StaffWorker;
  category: StaffCategory | undefined;
}>) {
  const queryClient = useQueryClient();
  const summaryKey = paymentSummaryKey(factoryId, worker.id);
  const historyKey = paymentHistoryKey(factoryId, worker.id);
  const summaryQuery = useQuery({
    queryKey: summaryKey,
    queryFn: () => getStaffPaymentSummary({ factoryId, staffWorkerId: worker.id }),
  });
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: () => listStaffPayments({ factoryId, staffWorkerId: worker.id }),
  });
  const [referenceSalary, setReferenceSalary] = useState(
    worker.referenceSalary.toString(),
  );
  const [paymentDate, setPaymentDate] = useState(getLocalDate);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [savingAction, setSavingAction] = useState<"reference" | "payment" | "archive" | "restore" | "delete" | "">("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function saveReferenceSalary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffReferenceSalaryInput({
      factoryId,
      staffWorkerId: worker.id,
      referenceSalary,
    });
    if (!input) return setError("Enter a positive reference salary.");
    setSavingAction("reference"); setError(""); setSuccess("");
    try {
      const updatedWorker = await updateStaffReferenceSalary(input);
      queryClient.setQueryData<StaffWorker[]>(workersKey(factoryId), (current = []) =>
        current.map((item) => item.id === updatedWorker.id ? updatedWorker : item));
      setReferenceSalary(updatedWorker.referenceSalary.toString());
      setSuccess("Reference salary updated.");
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not update the reference salary."));
    } finally { setSavingAction(""); }
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffPaymentInput({
      factoryId,
      staffWorkerId: worker.id,
      paymentDate,
      amount: paymentAmount,
      note: paymentNote,
    });
    if (!input) return setError("Enter a positive amount and valid payment date.");
    setSavingAction("payment"); setError(""); setSuccess("");
    try {
      const recorded = await recordStaffPayment(input);
      queryClient.setQueryData<StaffPaymentSummary>(summaryKey, {
        totalPaid: recorded.totalPaid,
      });
      queryClient.setQueryData<StaffPayment[]>(historyKey, (current = []) =>
        insertStaffPaymentNewestFirst(current, recorded));
      setPaymentAmount(""); setPaymentNote("");
      setSuccess("Payment recorded.");
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not record the payment."));
    } finally { setSavingAction(""); }
  }

  function cacheWorker(updatedWorker: StaffWorker) {
    queryClient.setQueryData<StaffWorker[]>(workersKey(factoryId), (current = []) =>
      current.map((item) => item.id === updatedWorker.id ? updatedWorker : item));
  }

  async function archiveWorker() {
    setSavingAction("archive"); setError(""); setSuccess(""); setConfirmingDelete(false);
    try {
      cacheWorker(await archiveStaffWorker({ factoryId, staffWorkerId: worker.id }));
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not archive the Staff member."));
    } finally { setSavingAction(""); }
  }

  async function restoreWorker() {
    setSavingAction("restore"); setError(""); setSuccess("");
    try {
      cacheWorker(await restoreStaffWorker({ factoryId, staffWorkerId: worker.id }));
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not restore the Staff member."));
    } finally { setSavingAction(""); }
  }

  async function deleteWorker() {
    setSavingAction("delete"); setError(""); setSuccess("");
    try {
      await deleteStaffWorker({ factoryId, staffWorkerId: worker.id });
      queryClient.setQueryData<StaffWorker[]>(workersKey(factoryId), (current = []) =>
        current.filter((item) => item.id !== worker.id));
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not delete the Staff member."));
      setConfirmingDelete(false);
    } finally { setSavingAction(""); }
  }

  const hasPaymentHistory = (summaryQuery.data?.totalPaid ?? 0) > 0;
  const deleteUnavailable = summaryQuery.isLoading || Boolean(summaryQuery.error) || hasPaymentHistory;

  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">{worker.name}</h4>
            {!worker.isActive && <Status active={false} />}
          </div>
          <p className="mt-1 text-sm text-slate-600">{category?.name ?? "Unknown category"}</p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="grid grid-cols-2 gap-4 sm:min-w-80">
            <SummaryValue label="Reference salary" value={formatStaffReferenceSalary(worker.referenceSalary)} />
            <SummaryValue
              label="Total paid"
              value={summaryQuery.isLoading ? "Loading..." : summaryQuery.data ? formatStaffMoney(summaryQuery.data.totalPaid) : "Unavailable"}
            />
          </div>
          {worker.isActive ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={archiveWorker} disabled={Boolean(savingAction)} className={secondaryButton}>{savingAction === "archive" ? "Archiving..." : "Archive"}</button>
              {!confirmingDelete ? (
                <button type="button" onClick={() => setConfirmingDelete(true)} disabled={Boolean(savingAction) || deleteUnavailable} className="h-9 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">Delete</button>
              ) : (
                <>
                  <button type="button" onClick={() => setConfirmingDelete(false)} disabled={Boolean(savingAction)} className={secondaryButton}>Cancel</button>
                  <button type="button" onClick={deleteWorker} disabled={Boolean(savingAction)} className="h-9 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{savingAction === "delete" ? "Deleting..." : "Confirm delete"}</button>
                </>
              )}
              {hasPaymentHistory && <span className="w-full text-right text-xs text-slate-500">Payment history exists; archive instead.</span>}
            </div>
          ) : (
            <button type="button" onClick={restoreWorker} disabled={Boolean(savingAction)} className={secondaryButton}>{savingAction === "restore" ? "Restoring..." : "Restore"}</button>
          )}
        </div>
      </div>
      {summaryQuery.error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{staffOfficeErrorMessage(summaryQuery.error, "Could not load Total Paid.")}</p>}

      <details className="mt-4 rounded-lg border border-slate-200 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Payments</summary>
        <div className={`mt-4 grid gap-5 ${worker.isActive ? "lg:grid-cols-2" : ""}`}>
          {worker.isActive && <div className="space-y-5">
            <form onSubmit={saveReferenceSalary} className="rounded-lg bg-slate-50 p-4">
              <h5 className="font-semibold">Edit reference salary</h5>
              <p className="mt-1 text-xs text-slate-600">Informational only. Changing it does not affect Total Paid.</p>
              <div className="mt-3 flex items-end gap-2">
                <Field label="Reference salary" compact>
                  <input type="number" min="0.01" step="0.01" value={referenceSalary} onChange={(event) => setReferenceSalary(event.target.value)} className={inputClass} />
                </Field>
                <button disabled={Boolean(savingAction)} className={secondaryButton}>{savingAction === "reference" ? "Saving..." : "Save"}</button>
              </div>
            </form>

            <form onSubmit={submitPayment} className="rounded-lg bg-indigo-50 p-4">
              <h5 className="font-semibold text-indigo-950">Record payment</h5>
              <p className="mt-1 text-xs text-indigo-800">Record the actual amount received. Reference salary does not limit it.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Payment date"><input type="date" max={getLocalDate()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className={inputClass} /></Field>
                <Field label="Amount received"><input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className={inputClass} /></Field>
                <div className="sm:col-span-2"><Field label="Note (optional)"><input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} className={inputClass} /></Field></div>
                <div className="sm:col-span-2"><button disabled={Boolean(savingAction)} className={primaryButton}>{savingAction === "payment" ? "Recording..." : "Record payment"}</button></div>
              </div>
            </form>
          </div>}

          <section aria-label={`${worker.name} payment history`} className="min-w-0 rounded-lg border border-slate-200 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h5 className="font-semibold">Payment history</h5>
              {summaryQuery.data && <span className="text-sm font-semibold text-indigo-800">Total Paid: {formatStaffMoney(summaryQuery.data.totalPaid)}</span>}
            </div>
            {historyQuery.isLoading && <p className="mt-3 text-sm text-slate-500">Loading payment history...</p>}
            {historyQuery.error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{staffOfficeErrorMessage(historyQuery.error, "Could not load payment history.")}</p>}
            {!historyQuery.isLoading && !historyQuery.error && (historyQuery.data?.length ?? 0) === 0 && <p className="mt-3 text-sm text-slate-500">No payments recorded yet.</p>}
            <ul className="mt-2 divide-y divide-slate-100">
              {(historyQuery.data ?? []).map((payment) => (
                <li key={payment.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>{formatStaffPaymentDate(payment.paymentDate)}</span>
                    <span className="font-semibold">{formatStaffMoney(payment.amount)}</span>
                  </div>
                  {payment.note && <p className="mt-1 text-xs text-slate-600">{payment.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>
      <Feedback error={error} success={success} />
    </article>
  );
}

function SummaryValue({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-950">{value}</p></div>;
}

function Field({ label, compact = false, children }: Readonly<{ label: string; compact?: boolean; children: React.ReactNode }>) {
  return <label className={`${compact ? "min-w-48 flex-1" : ""} text-sm font-medium text-slate-700`}><span className="mb-1 block">{label}</span>{children}</label>;
}

function Status({ active }: Readonly<{ active: boolean }>) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{active ? "Active" : "Archived"}</span>;
}

function Feedback({ error, success }: Readonly<{ error: string; success: string }>) {
  return <>{error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}{success && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{success}</p>}</>;
}
