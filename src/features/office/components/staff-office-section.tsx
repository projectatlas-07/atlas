"use client";

import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState, Feedback as OverviewFeedback } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form-controls";
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
import { AddStaffDrawer, type AddStaffInput } from "@/features/office/components/add-staff-drawer";
import { StaffAccountPaymentDrawer } from "@/features/office/components/staff-account-payment-drawer";
import { StaffCategoriesDrawer } from "@/features/office/components/staff-categories-drawer";
import { StaffManagementDrawer } from "@/features/office/components/staff-management-drawer";
import {
  buildStaffWorkerCreateInput,
  filterStaffOverviewWorkers,
  formatStaffLastPaid,
  getStaffInitials,
  latestStaffPayment,
  STAFF_SECTION_HEADING,
  staffOfficeErrorMessage,
  sumStaffPaymentsInRange,
  type StaffWorkerLifecycleFilter,
} from "@/features/office/staff-office-model";
import {
  staffCategoriesQueryKey,
  staffPaymentHistoryQueryKey,
  staffWorkersQueryKey,
} from "@/features/office/staff-office-query-keys";
import { listStaffPayments } from "@/features/staff/services/staff-payment-service";
import {
  createStaffWorker,
  listStaffCategories,
  listStaffWorkers,
} from "@/features/staff/services/staff-worker-service";
import type {
  StaffCategory,
  StaffWorker,
} from "@/features/staff/types";
import {
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  STAFF_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const STAFF_RANGE_PRESETS: ReadonlyArray<{
  value: WageEarningsDatePreset;
  label: string;
}> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom" },
];

export function StaffOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({
    queryKey: staffCategoriesQueryKey(factoryId),
    queryFn: () => listStaffCategories(factoryId),
  });
  const workersQuery = useQuery({
    queryKey: staffWorkersQueryKey(factoryId),
    queryFn: () => listStaffWorkers(factoryId),
  });
  const [openSetup, setOpenSetup] = useState<"categories" | "add" | "">("");
  const [accountWorkerId, setAccountWorkerId] = useState<string | null>(null);
  const [managementWorkerId, setManagementWorkerId] = useState<string | null>(null);
  const workers = workersQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const accountWorker = workers.find((worker) => worker.id === accountWorkerId);
  const managementWorker = workers.find((worker) => worker.id === managementWorkerId);

  function toggleSetup(value: "categories" | "add") {
    setAccountWorkerId(null);
    setManagementWorkerId(null);
    setOpenSetup((current) => current === value ? "" : value);
  }

  function openAccount(workerId: string) {
    setOpenSetup("");
    setManagementWorkerId(null);
    setAccountWorkerId(workerId);
  }

  function openManagement(workerId: string) {
    setOpenSetup("");
    setAccountWorkerId(null);
    setManagementWorkerId(workerId);
  }

  async function createStaff(input: AddStaffInput): Promise<string | null> {
    const createInput = buildStaffWorkerCreateInput({ factoryId, ...input });
    if (!createInput) return "Enter a name, category, and positive reference salary.";

    try {
      const createdWorker = await createStaffWorker(createInput);
      queryClient.setQueryData<StaffWorker[]>(
        staffWorkersQueryKey(factoryId),
        (current = []) => [...current.filter((worker) => worker.id !== createdWorker.id), createdWorker]
          .sort((left, right) => left.name.localeCompare(right.name, "en-IN") || left.id.localeCompare(right.id)),
      );
      await queryClient.invalidateQueries({ queryKey: staffWorkersQueryKey(factoryId) });
      return null;
    } catch (failure) {
      return staffOfficeErrorMessage(failure, "Could not add the Staff member.");
    }
  }

  return (
    <section aria-labelledby="staff-office-heading">
      <StaffOverview
        factoryId={factoryId}
        workers={workers}
        categories={categories}
        workersLoading={workersQuery.isLoading}
        workersError={workersQuery.error}
        categoriesError={categoriesQuery.error}
        selectedWorkerId={accountWorkerId ?? managementWorkerId}
        onManageCategories={() => toggleSetup("categories")}
        onAddStaff={() => toggleSetup("add")}
        onOpenAccount={openAccount}
        onManageWorker={openManagement}
      />

      {openSetup === "categories" && (
        <StaffCategoriesDrawer
          factoryId={factoryId}
          categories={categories}
          workers={workers}
          isLoading={categoriesQuery.isLoading}
          loadError={categoriesQuery.error}
          workersLoading={workersQuery.isLoading}
          workersError={workersQuery.error}
          onClose={() => setOpenSetup("")}
        />
      )}
      {openSetup === "add" && (
        <AddStaffDrawer
          categories={categories}
          categoriesLoading={categoriesQuery.isLoading}
          categoriesError={categoriesQuery.error}
          onCreate={createStaff}
          onClose={() => setOpenSetup("")}
        />
      )}
      {managementWorker && (
        <StaffManagementDrawer
          factoryId={factoryId}
          worker={managementWorker}
          category={categories.find((category) => category.id === managementWorker.staffCategoryId) ?? null}
          onClose={() => setManagementWorkerId(null)}
        />
      )}
      {accountWorker && (
        <StaffAccountPaymentDrawer
          factoryId={factoryId}
          worker={accountWorker}
          categoryName={categories.find((category) => category.id === accountWorker.staffCategoryId)?.name ?? null}
          onClose={() => setAccountWorkerId(null)}
        />
      )}
    </section>
  );
}

function StaffOverview({
  factoryId,
  workers,
  categories,
  workersLoading,
  workersError,
  categoriesError,
  selectedWorkerId,
  onManageCategories,
  onAddStaff,
  onOpenAccount,
  onManageWorker,
}: Readonly<{
  factoryId: string;
  workers: readonly StaffWorker[];
  categories: readonly StaffCategory[];
  workersLoading: boolean;
  workersError: Error | null;
  categoriesError: Error | null;
  selectedWorkerId: string | null;
  onManageCategories: () => void;
  onAddStaff: () => void;
  onOpenAccount: (workerId: string) => void;
  onManageWorker: (workerId: string) => void;
}>) {
  const [localToday] = useState(getLocalDate);
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>("this_month");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [lifecycleFilter, setLifecycleFilter] = useState<StaffWorkerLifecycleFilter>("all");
  const [search, setSearch] = useState("");
  const paymentRange = resolveWageEarningsDateRange(
    rangePreset,
    localToday,
    customFrom,
    customTo,
  );
  const paymentQueries = useQueries({
    queries: workers.map((worker) => ({
      queryKey: staffPaymentHistoryQueryKey(factoryId, worker.id),
      queryFn: () => listStaffPayments({ factoryId, staffWorkerId: worker.id }),
      enabled: !workersLoading && !workersError,
      refetchInterval: 30_000,
    })),
  });
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const paymentStateByWorker = new Map(
    workers.map((worker, index) => [worker.id, paymentQueries[index]]),
  );
  const visibleWorkers = filterStaffOverviewWorkers({
    workers,
    categoryNames,
    lifecycle: lifecycleFilter,
    search,
  });
  const activeCount = workers.filter((worker) => worker.isActive).length;
  const archivedCount = workers.length - activeCount;
  const paymentsLoading = paymentQueries.some((query) => query.isLoading);
  const paymentsError = paymentQueries.some((query) => Boolean(query.error));
  const periodTotal = paymentRange && !paymentsLoading && !paymentsError
    ? paymentQueries.reduce(
      (total, query) => total + sumStaffPaymentsInRange(query.data ?? [], paymentRange),
      0,
    )
    : null;
  const periodLabel = STAFF_RANGE_PRESETS.find((option) => option.value === rangePreset)?.label
    ?? "Selected period";

  function paymentLabel(workerId: string): string {
    const query = paymentStateByWorker.get(workerId);
    if (!query || query.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (query.error || !paymentRange) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatIndianCurrency(sumStaffPaymentsInRange(query.data ?? [], paymentRange));
  }

  function lastPaidLabel(workerId: string): string {
    const query = paymentStateByWorker.get(workerId);
    if (!query || query.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (query.error) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatStaffLastPaid(latestStaffPayment(query.data ?? [])?.paymentDate ?? null, localToday);
  }

  return (
    <section aria-labelledby="staff-office-heading">
      <header className="border-b border-atlas-border pb-atlas-5">
        <div className="flex flex-col gap-atlas-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Workforce / Staff
            </p>
            <div className="mt-atlas-1 flex flex-col gap-atlas-2 sm:flex-row sm:items-center">
              <h2 id="staff-office-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">
                {STAFF_SECTION_HEADING}
              </h2>
              <div className="w-full sm:w-44">
                <Select
                  aria-label="Payment period"
                  value={rangePreset}
                  onChange={(event) => setRangePreset(event.target.value as WageEarningsDatePreset)}
                >
                  {STAFF_RANGE_PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
              {formatIndianNumber(activeCount)} active staff · {paymentsLoading
                ? ATLAS_UI_STRINGS.feedback.loading
                : paymentsError || periodTotal === null
                  ? ATLAS_UI_STRINGS.feedback.unavailable
                  : formatIndianCurrency(periodTotal)} paid {periodLabel.toLocaleLowerCase("en-IN")} · {formatIndianNumber(archivedCount)} archived
            </p>
          </div>
          <div className="flex flex-col gap-atlas-2 sm:flex-row">
            <Button variant="secondary" onClick={onManageCategories}>Manage categories</Button>
            <Button variant="secondary" onClick={onAddStaff}>Add staff</Button>
          </div>
        </div>

        {rangePreset === "custom" && (
          <div className="mt-atlas-4 grid max-w-xl gap-atlas-3 sm:grid-cols-2">
            <label className="text-atlas-sm font-atlas-medium text-atlas-text-muted">
              <span className="mb-atlas-1 block">From</span>
              <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            </label>
            <label className="text-atlas-sm font-atlas-medium text-atlas-text-muted">
              <span className="mb-atlas-1 block">To</span>
              <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </label>
          </div>
        )}
        {rangePreset === "custom" && !paymentRange && (
          <div className="mt-atlas-3"><OverviewFeedback role="alert" tone="danger">Choose a valid inclusive date range.</OverviewFeedback></div>
        )}
        {paymentRange && (
          <p className="mt-atlas-3 text-atlas-xs text-atlas-text-subtle">
            {formatDateOnly(paymentRange.fromDate)} — {formatDateOnly(paymentRange.toDate)}, inclusive. Paid values use recorded Staff payment ledger entries only.
          </p>
        )}
      </header>

      <div className="mt-atlas-5 flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
        <div aria-label="Filter Staff members" className="flex gap-atlas-2 overflow-x-auto pb-atlas-1">
          {([
            ["all", `All ${formatIndianNumber(workers.length)}`],
            ["active", `Active ${formatIndianNumber(activeCount)}`],
            ["archived", `Archived ${formatIndianNumber(archivedCount)}`],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              variant={lifecycleFilter === value ? "primary" : "ghost"}
              aria-pressed={lifecycleFilter === value}
              onClick={() => setLifecycleFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="w-full sm:max-w-xs">
          <Input
            type="search"
            aria-label="Search staff"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search staff or category"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {workersError && <OverviewFeedback role="alert" tone="danger">Could not load Staff members.</OverviewFeedback>}
        {categoriesError && <OverviewFeedback role="alert" tone="danger">Could not load Staff categories.</OverviewFeedback>}
        {paymentsError && <OverviewFeedback role="alert" tone="danger">Could not load one or more Staff payment histories.</OverviewFeedback>}
      </div>

      {workersLoading ? (
        <div className="mt-atlas-4"><OverviewFeedback role="status" tone="neutral">Loading Staff members...</OverviewFeedback></div>
      ) : workersError ? null : visibleWorkers.length === 0 ? (
        <EmptyState
          title={workers.length === 0 ? "No Staff members yet" : "No Staff members match these filters"}
          description={workers.length === 0 ? "Use Add staff to create the first Staff member." : "Clear the search or choose another lifecycle filter."}
        />
      ) : (
        <>
          <div className="mt-atlas-4 hidden md:block">
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Staff overview for {periodLabel}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Staff member</TableHeaderCell>
                    <TableHeaderCell>Category</TableHeaderCell>
                    <TableHeaderCell numeric>Reference salary</TableHeaderCell>
                    <TableHeaderCell numeric>Paid ({periodLabel})</TableHeaderCell>
                    <TableHeaderCell>Last paid</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleWorkers.map((worker) => {
                    const status = resolveBooleanStatusPresentation(STAFF_WORKER_LIFECYCLE_STATUS, worker.isActive);
                    return (
                      <TableRow key={worker.id} hoverable selected={selectedWorkerId === worker.id}>
                        <TableCell>
                          <div className="flex items-center gap-atlas-2">
                            <span className="flex h-atlas-8 w-atlas-8 shrink-0 items-center justify-center rounded-atlas-pill bg-atlas-primary-surface text-atlas-xs font-atlas-semibold text-atlas-primary">
                              {getStaffInitials(worker.name)}
                            </span>
                            <div className="flex flex-wrap items-center gap-atlas-2">
                              <span className="font-atlas-semibold text-atlas-text">{worker.name}</span>
                              {!worker.isActive && <StatusPill label={status.label} tone={status.tone} />}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><span className="text-atlas-text-muted">{categoryNames.get(worker.staffCategoryId) ?? "Unknown category"}</span></TableCell>
                        <TableCell numeric>
                          <span className="font-atlas-medium text-atlas-text-muted">{formatIndianCurrency(worker.referenceSalary)}</span>
                          <span className="ml-atlas-1 text-atlas-xs text-atlas-text-subtle">informational</span>
                        </TableCell>
                        <TableCell numeric><span className="font-atlas-semibold text-atlas-text">{paymentLabel(worker.id)}</span></TableCell>
                        <TableCell><span className="text-atlas-sm text-atlas-text-muted">{lastPaidLabel(worker.id)}</span></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-atlas-2">
                            <Button onClick={() => onOpenAccount(worker.id)}>Account &amp; payment</Button>
                            <Button variant="ghost" onClick={() => onManageWorker(worker.id)}>Manage</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex flex-col gap-atlas-1 border-t border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 text-atlas-xs text-atlas-text-subtle sm:flex-row sm:items-center sm:justify-between">
                <p>Showing {formatIndianNumber(visibleWorkers.length)} of {formatIndianNumber(workers.length)} Staff members</p>
                <p>Reference salary is informational only; it does not create accrued salary or payable debt.</p>
              </div>
            </TableContainer>
          </div>

          <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
            {visibleWorkers.map((worker) => {
              const status = resolveBooleanStatusPresentation(STAFF_WORKER_LIFECYCLE_STATUS, worker.isActive);
              return (
                <article key={worker.id} className={selectedWorkerId === worker.id ? "bg-atlas-primary-surface py-atlas-4" : "py-atlas-4"}>
                  <div className="flex items-start justify-between gap-atlas-3">
                    <div className="flex min-w-0 items-center gap-atlas-2">
                      <span className="flex h-atlas-8 w-atlas-8 shrink-0 items-center justify-center rounded-atlas-pill bg-atlas-primary-surface text-atlas-xs font-atlas-semibold text-atlas-primary">
                        {getStaffInitials(worker.name)}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-atlas-base font-atlas-semibold text-atlas-text">{worker.name}</h3>
                        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{categoryNames.get(worker.staffCategoryId) ?? "Unknown category"}</p>
                      </div>
                    </div>
                    {!worker.isActive && <StatusPill label={status.label} tone={status.tone} />}
                  </div>
                  <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 text-atlas-sm">
                    <div>
                      <dt className="text-atlas-xs text-atlas-text-subtle">Reference salary</dt>
                      <dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text-muted">{formatIndianCurrency(worker.referenceSalary)}</dd>
                    </div>
                    <div>
                      <dt className="text-right text-atlas-xs text-atlas-text-subtle">Paid · {periodLabel}</dt>
                      <dd className="mt-atlas-1 text-right font-atlas-semibold tabular-nums text-atlas-text">{paymentLabel(worker.id)}</dd>
                    </div>
                  </dl>
                  <p className="mt-atlas-3 text-atlas-xs text-atlas-text-muted">{lastPaidLabel(worker.id)}</p>
                  <div className="mt-atlas-3 flex flex-col gap-atlas-2 sm:flex-row">
                    <Button onClick={() => onOpenAccount(worker.id)}>Account &amp; payment</Button>
                    <Button variant="ghost" onClick={() => onManageWorker(worker.id)}>Manage</Button>
                  </div>
                </article>
              );
            })}
            <p className="py-atlas-3 text-atlas-xs text-atlas-text-subtle">
              Reference salary is informational only; it does not create accrued salary or payable debt.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
