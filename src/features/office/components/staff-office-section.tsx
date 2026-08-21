"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildStaffCategoryCreateInput,
  buildStaffLifecycleInput,
  buildStaffSalaryInput,
  buildStaffWorkerCreateInput,
  canonicalMonthStart,
  describeResolvedStaffSalary,
  formatStaffMonthlySalary,
  getStaffCategorySalaryForm,
  resolveStaffSalariesForDisplay,
  STAFF_SECTION_HEADING,
  staffOfficeErrorMessage,
  updateStaffCategorySalaryForm,
  type StaffCategorySalaryFormState,
} from "@/features/office/staff-office-model";
import {
  activateStaffCategory,
  activateStaffWorker,
  createStaffCategory,
  createStaffCategoryMonthlySalary,
  createStaffMonthlySalaryOverride,
  createStaffWorker,
  deactivateStaffCategory,
  deactivateStaffWorker,
  deleteStaffWorker,
  getStaffCategoryMonthlySalaryForDate,
  listStaffCategories,
  listStaffSalaryEligibilityPeriods,
  listStaffWorkers,
  resolveStaffMonthlySalary,
} from "@/features/staff/services/staff-salary-service";
import type {
  ResolvedStaffMonthlySalary,
  StaffCategory,
  StaffMonthlySalaryRate,
  StaffWorker,
} from "@/features/staff/types";
import { getLocalDate } from "@/lib/local-date";
import { StaffFinancialDetail } from "@/features/office/components/staff-financial-detail";

const categoriesKey = (factoryId: string) => ["office-staff-categories", factoryId] as const;
const workersKey = (factoryId: string) => ["office-staff-workers", factoryId] as const;
const eligibilityKey = (factoryId: string) => ["office-staff-salary-eligibility", factoryId] as const;
const salariesKey = (factoryId: string, date: string) => ["office-staff-current-salaries", factoryId, date] as const;
const inputClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950";
const primaryButton = "h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

type SalarySnapshot = {
  categoryDefaults: Record<string, StaffMonthlySalaryRate | null>;
  workerResolutions: Record<string, ResolvedStaffMonthlySalary | null>;
};

export function StaffOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const today = getLocalDate();
  const currentMonthStart = canonicalMonthStart(today.slice(0, 7))!;
  const categoriesQuery = useQuery({
    queryKey: categoriesKey(factoryId),
    queryFn: () => listStaffCategories(factoryId),
  });
  const workersQuery = useQuery({
    queryKey: workersKey(factoryId),
    queryFn: () => listStaffWorkers(factoryId),
  });
  const eligibilityQuery = useQuery({
    queryKey: eligibilityKey(factoryId),
    queryFn: () => listStaffSalaryEligibilityPeriods(factoryId),
  });
  const salariesQuery = useQuery({
    queryKey: salariesKey(factoryId, currentMonthStart),
    enabled: categoriesQuery.isSuccess && workersQuery.isSuccess && eligibilityQuery.isSuccess,
    queryFn: async (): Promise<SalarySnapshot> => {
      const categories = categoriesQuery.data ?? [];
      const workers = workersQuery.data ?? [];
      const categoryEntries = await Promise.all(categories.map(async (category) => [
        category.id,
        await getStaffCategoryMonthlySalaryForDate({
          factoryId,
          staffCategoryId: category.id,
          effectiveDate: currentMonthStart,
        }),
      ] as const));
      const workerResolutions = await resolveStaffSalariesForDisplay(
        workers,
        eligibilityQuery.data ?? [],
        currentMonthStart,
        async (worker, effectiveMonth) => {
          try {
            return await resolveStaffMonthlySalary({
              factoryId,
              staffWorkerId: worker.id,
              effectiveDate: effectiveMonth,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (/no .*salary|salary configuration.*not found|could not resolve/i.test(message)) {
              return null;
            }
            throw error;
          }
        },
      );
      return {
        categoryDefaults: Object.fromEntries(categoryEntries),
        workerResolutions,
      };
    },
  });

  return (
    <section aria-labelledby="staff-office-heading" className="mt-10 border-t-4 border-indigo-200 pt-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-indigo-700">{STAFF_SECTION_HEADING}</p>
        <h2 id="staff-office-heading" className="mt-1 text-2xl font-bold">People, monthly salaries, and finances</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage salaried Staff separately from Production, Mud, and Transport. Monthly salary entitlement remains automatic.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryManagement
          factoryId={factoryId}
          categories={categoriesQuery.data ?? []}
          currentDefaults={salariesQuery.data?.categoryDefaults ?? {}}
          isLoading={categoriesQuery.isLoading}
          loadError={categoriesQuery.error}
          today={today}
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
        resolutions={salariesQuery.data?.workerResolutions ?? {}}
        salaryIsLoading={eligibilityQuery.isLoading || salariesQuery.isLoading}
        salaryError={eligibilityQuery.error ?? salariesQuery.error}
        isLoading={workersQuery.isLoading}
        loadError={workersQuery.error}
        today={today}
      />
    </section>
  );
}

function CategoryManagement({ factoryId, categories, currentDefaults, isLoading, loadError, today }: Readonly<{
  factoryId: string;
  categories: readonly StaffCategory[];
  currentDefaults: Readonly<Record<string, StaffMonthlySalaryRate | null>>;
  isLoading: boolean;
  loadError: Error | null;
  today: string;
}>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [salaryForms, setSalaryForms] = useState<Record<string, StaffCategorySalaryFormState>>({});
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

  async function toggle(category: StaffCategory) {
    setUpdatingId(category.id); setError(""); setSuccess("");
    try {
      const action = category.isActive ? deactivateStaffCategory : activateStaffCategory;
      await action({ factoryId, staffCategoryId: category.id });
      setSuccess(`${category.name} ${category.isActive ? "deactivated" : "reactivated"}.`);
      await queryClient.invalidateQueries({ queryKey: categoriesKey(factoryId) });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not update Staff category."));
    } finally { setUpdatingId(""); }
  }

  return (
    <section aria-labelledby="staff-categories-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="staff-categories-heading" className="text-lg font-bold">Staff categories</h3>
      <p className="mt-1 text-sm text-slate-600">Create your own job categories and set each category&apos;s default salary.</p>
      <form onSubmit={submit} className="mt-5 flex gap-2">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          <span className="sr-only">Category name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Category name" className={inputClass} />
        </label>
        <button disabled={isSaving} className={primaryButton}>{isSaving ? "Adding..." : "Add category"}</button>
      </form>
      <Feedback error={error} success={success} />
      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading Staff categories...</p>}
      {loadError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">{staffOfficeErrorMessage(loadError, "Could not load Staff categories.")}</p>}
      {!isLoading && !loadError && categories.length === 0 && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No Staff categories yet. Add the first one above.</p>}
      <div className="mt-5 space-y-3">
        {categories.map((category) => (
          <CategoryCard
            key={category.id}
            factoryId={factoryId}
            category={category}
            currentDefault={currentDefaults[category.id] ?? null}
            salaryForm={getStaffCategorySalaryForm(salaryForms, category.id, today.slice(0, 7))}
            onSalaryFormChange={(patch) => setSalaryForms((forms) =>
              updateStaffCategorySalaryForm(forms, category.id, patch, today.slice(0, 7))
            )}
            isUpdating={updatingId === category.id}
            onToggle={() => toggle(category)}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryCard({ factoryId, category, currentDefault, salaryForm, onSalaryFormChange, isUpdating, onToggle }: Readonly<{
  factoryId: string;
  category: StaffCategory;
  currentDefault: StaffMonthlySalaryRate | null;
  salaryForm: StaffCategorySalaryFormState;
  onSalaryFormChange: (patch: Partial<StaffCategorySalaryFormState>) => void;
  isUpdating: boolean;
  onToggle: () => void;
}>) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const salary = buildStaffSalaryInput({
      factoryId, targetId: category.id,
      amount: salaryForm.amount, effectiveMonth: salaryForm.effectiveMonth,
    });
    if (!salary) return setError("Enter a positive monthly salary and a valid effective month.");
    setIsSaving(true); setError(""); setSuccess("");
    try {
      await createStaffCategoryMonthlySalary({ factoryId, staffCategoryId: category.id, ...salary });
      onSalaryFormChange({ amount: "" }); setSuccess("Default salary saved.");
      await queryClient.invalidateQueries({ queryKey: ["office-staff-current-salaries", factoryId] });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not save the category salary."));
    } finally { setIsSaving(false); }
  }

  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">{category.name}</h4>
          <p className="mt-1 text-sm text-slate-600">
            {currentDefault ? `Current default: ${formatStaffMonthlySalary(currentDefault.monthlySalary)}` : "Current default: Not set"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Status active={category.isActive} />
          <button type="button" disabled={isUpdating} onClick={onToggle} className={secondaryButton}>
            {isUpdating ? "Saving..." : category.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </div>
      <form onSubmit={submit} className="mt-4 grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-medium text-slate-600"><span className="mb-1 block">Monthly salary</span><input type="number" min="0.01" step="0.01" value={salaryForm.amount} onChange={(event) => onSalaryFormChange({ amount: event.target.value })} aria-label={`${category.name} monthly salary`} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600"><span className="mb-1 block">Effective month</span><input type="month" value={salaryForm.effectiveMonth} onChange={(event) => onSalaryFormChange({ effectiveMonth: event.target.value })} aria-label={`${category.name} salary effective month`} className={inputClass} /></label>
        <button disabled={isSaving} className={primaryButton}>{isSaving ? "Saving..." : "Set salary"}</button>
      </form>
      <Feedback error={error} success={success} />
    </article>
  );
}

function WorkerCreate({ factoryId, categories, categoriesUnavailable }: Readonly<{
  factoryId: string;
  categories: readonly StaffCategory[];
  categoriesUnavailable: boolean;
}>) {
  const queryClient = useQueryClient();
  const activeCategories = categories.filter((category) => category.isActive);
  const [name, setName] = useState("");
  const [staffCategoryId, setStaffCategoryId] = useState("");
  const [salaryStartMonth, setSalaryStartMonth] = useState(() => getLocalDate().slice(0, 7));
  const [firstMonthCustomSalary, setFirstMonthCustomSalary] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffWorkerCreateInput({ factoryId, name, staffCategoryId, salaryStartMonth, firstMonthCustomSalary });
    if (!input) return setError("Enter a name, active category, valid start month, and a positive custom first-month salary if used.");
    setIsSaving(true); setError(""); setSuccess("");
    try {
      await createStaffWorker(input);
      setName(""); setStaffCategoryId(""); setFirstMonthCustomSalary(""); setSuccess("Staff member added. Their category is now permanent.");
      await queryClient.invalidateQueries({ queryKey: workersKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: eligibilityKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: ["office-staff-current-salaries", factoryId] });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not add the Staff member."));
    } finally { setIsSaving(false); }
  }

  return (
    <section aria-labelledby="add-staff-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="add-staff-heading" className="text-lg font-bold">Add Staff member</h3>
      <p className="mt-1 text-sm text-slate-600">Choose carefully: a Staff member&apos;s category cannot be changed later.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <Field label="Category">
          <select value={staffCategoryId} onChange={(event) => setStaffCategoryId(event.target.value)} disabled={categoriesUnavailable || activeCategories.length === 0} className={inputClass}>
            <option value="">Select category</option>
            {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label="Salary start month"><input type="month" value={salaryStartMonth} onChange={(event) => setSalaryStartMonth(event.target.value)} className={inputClass} /></Field>
        <Field label="First-month salary (optional)"><input type="number" min="0.01" step="0.01" value={firstMonthCustomSalary} onChange={(event) => setFirstMonthCustomSalary(event.target.value)} placeholder="Use for a partial first month" className={inputClass} /></Field>
        <div className="sm:col-span-2"><button disabled={isSaving || activeCategories.length === 0} className={primaryButton}>{isSaving ? "Adding..." : "Add Staff member"}</button></div>
      </form>
      {!categoriesUnavailable && activeCategories.length === 0 && <p className="mt-4 text-sm text-amber-700">Add or reactivate a Staff category first.</p>}
      <Feedback error={error} success={success} />
    </section>
  );
}

function WorkerManagement({ factoryId, workers, categories, resolutions, salaryIsLoading, salaryError, isLoading, loadError, today }: Readonly<{
  factoryId: string;
  workers: readonly StaffWorker[];
  categories: readonly StaffCategory[];
  resolutions: Readonly<Record<string, ResolvedStaffMonthlySalary | null>>;
  salaryIsLoading: boolean;
  salaryError: Error | null;
  isLoading: boolean;
  loadError: Error | null;
  today: string;
}>) {
  return (
    <section aria-labelledby="staff-members-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="staff-members-heading" className="text-lg font-bold">Staff members</h3>
      <p className="mt-1 text-sm text-slate-600">Deactivation keeps the selected month eligible, then stops future monthly salary. Reactivation requires a new restart month.</p>
      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading Staff members...</p>}
      {loadError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">{staffOfficeErrorMessage(loadError, "Could not load Staff members.")}</p>}
      {!isLoading && !loadError && workers.length === 0 && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No Staff members yet. Use the form above to add one.</p>}
      {salaryError && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{staffOfficeErrorMessage(salaryError, "Could not load current Staff salaries.")}</p>}
      <div className="mt-5 grid gap-4">
        {workers.map((worker) => (
          <WorkerCard
            key={worker.id}
            factoryId={factoryId}
            worker={worker}
            category={categories.find((category) => category.id === worker.staffCategoryId)}
            resolution={resolutions[worker.id] ?? null}
            salaryIsLoading={salaryIsLoading}
            today={today}
          />
        ))}
      </div>
    </section>
  );
}

function WorkerCard({ factoryId, worker, category, resolution, salaryIsLoading, today }: Readonly<{
  factoryId: string;
  worker: StaffWorker;
  category: StaffCategory | undefined;
  resolution: ResolvedStaffMonthlySalary | null;
  salaryIsLoading: boolean;
  today: string;
}>) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState(today.slice(0, 7));
  const [lifecycleMonth, setLifecycleMonth] = useState(today.slice(0, 7));
  const [savingAction, setSavingAction] = useState<"salary" | "lifecycle" | "delete" | "">("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const salary = describeResolvedStaffSalary(resolution, category);

  async function saveOverride(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildStaffSalaryInput({ factoryId, targetId: worker.id, amount, effectiveMonth });
    if (!input) return setError("Enter a positive monthly salary and a valid effective month.");
    setSavingAction("salary"); setError(""); setSuccess("");
    try {
      await createStaffMonthlySalaryOverride({ factoryId, staffWorkerId: worker.id, ...input });
      setAmount(""); setSuccess("Individual salary override saved.");
      await queryClient.invalidateQueries({ queryKey: ["office-staff-current-salaries", factoryId] });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not save the individual salary override."));
    } finally { setSavingAction(""); }
  }

  async function updateLifecycle() {
    const input = buildStaffLifecycleInput({ factoryId, staffWorkerId: worker.id, month: lifecycleMonth });
    if (!input) return setError(`Choose a valid ${worker.isActive ? "deactivation" : "restart"} month.`);
    setSavingAction("lifecycle"); setError(""); setSuccess("");
    try {
      if (worker.isActive) {
        await deactivateStaffWorker({ factoryId, staffWorkerId: worker.id, deactivationMonth: input.monthStart });
      } else {
        await activateStaffWorker({ factoryId, staffWorkerId: worker.id, salaryRestartMonth: input.monthStart });
      }
      setSuccess(`${worker.name} ${worker.isActive ? "deactivated" : "reactivated"}.`);
      await queryClient.invalidateQueries({ queryKey: workersKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: eligibilityKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: ["office-staff-current-salaries", factoryId] });
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, `Could not ${worker.isActive ? "deactivate" : "reactivate"} this Staff member.`));
    } finally { setSavingAction(""); }
  }

  async function removeWorker() {
    setSavingAction("delete"); setError(""); setSuccess("");
    try {
      await deleteStaffWorker({ factoryId, staffWorkerId: worker.id });
      await queryClient.invalidateQueries({ queryKey: workersKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: eligibilityKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: ["office-staff-current-salaries", factoryId] });
    } catch (failure) {
      setIsConfirmingDelete(false);
      setError(staffOfficeErrorMessage(failure, "Could not delete this Staff member."));
    } finally { setSavingAction(""); }
  }

  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h4 className="font-semibold">{worker.name}</h4><p className="mt-1 text-sm text-slate-600">{category?.name ?? "Unknown category"}</p></div>
        <Status active={worker.isActive} />
      </div>
      <div className="mt-4 rounded-lg bg-indigo-50 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">Current monthly salary</p>
        <p className="mt-1 text-sm font-semibold text-indigo-950">{salaryIsLoading ? "Loading current salary..." : salary.amount}</p>
        {!salaryIsLoading && <p className="mt-1 text-xs text-indigo-800">Source: {salary.source}</p>}
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-900">{worker.isActive ? "Deactivate" : "Reactivate"}</p>
        <p className="mt-1 text-xs text-slate-600">
          {worker.isActive
            ? "Stops future salary while keeping the Staff member and all history. The selected month remains eligible."
            : "Starts a new salary eligibility period while keeping all existing history."}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label={worker.isActive ? "Deactivation month" : "Salary restart month"} compact>
            <input type="month" value={lifecycleMonth} onChange={(event) => setLifecycleMonth(event.target.value)} className={inputClass} />
          </Field>
          <button type="button" onClick={updateLifecycle} disabled={Boolean(savingAction)} className={secondaryButton}>
            {savingAction === "lifecycle" ? "Saving..." : worker.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </div>
      <details className="mt-4 rounded-lg border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">Individual salary override</summary>
        <form onSubmit={saveOverride} className="mt-4 grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-medium text-slate-600"><span className="mb-1 block">Individual monthly salary</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label={`${worker.name} individual monthly salary`} className={inputClass} /></label>
          <label className="text-xs font-medium text-slate-600"><span className="mb-1 block">Effective month</span><input type="month" value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} aria-label={`${worker.name} salary effective month`} className={inputClass} /></label>
          <button disabled={Boolean(savingAction)} className={primaryButton}>{savingAction === "salary" ? "Saving..." : "Set override"}</button>
        </form>
      </details>
      <StaffFinancialDetail factoryId={factoryId} worker={worker} />
      <div className="mt-4 border-t border-slate-200 pt-4">
        <p className="text-sm font-semibold text-slate-900">Delete Staff</p>
        <p className="mt-1 text-xs text-slate-600">Only for mistakenly created Staff with no salary or financial history.</p>
        {!isConfirmingDelete ? (
          <button type="button" onClick={() => { setIsConfirmingDelete(true); setError(""); setSuccess(""); }} disabled={Boolean(savingAction)} className="mt-3 h-9 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">
            Delete Staff
          </button>
        ) : (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-900">Delete {worker.name}? This removes only this Staff setup and cannot be undone.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setIsConfirmingDelete(false)} disabled={savingAction === "delete"} className={secondaryButton}>Cancel</button>
              <button type="button" onClick={removeWorker} disabled={savingAction === "delete"} className="h-9 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {savingAction === "delete" ? "Deleting..." : "Confirm delete"}
              </button>
            </div>
          </div>
        )}
      </div>
      <Feedback error={error} success={success} />
    </article>
  );
}

function Field({ label, compact = false, children }: Readonly<{ label: string; compact?: boolean; children: React.ReactNode }>) {
  return <label className={`${compact ? "min-w-48" : ""} text-sm font-medium text-slate-700`}><span className="mb-1 block">{label}</span>{children}</label>;
}

function Status({ active }: Readonly<{ active: boolean }>) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{active ? "Active" : "Inactive"}</span>;
}

function Feedback({ error, success }: Readonly<{ error: string; success: string }>) {
  return <>{error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}{success && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{success}</p>}</>;
}
