"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form-controls";
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
  filterChallansForExpandedView,
  type ChallanHistoryFinancialLock,
  type ChallanHistoryLifecycle,
  type ChallanHistoryPeriod,
} from "@/features/office/sales-office-model";
import type { ChallanHeader } from "@/features/sales/types";
import { formatChallanLabel } from "@/features/sales/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  CHALLAN_FINANCIAL_LOCK_STATUS,
  CHALLAN_STATUS,
  resolveBooleanStatusPresentation,
  resolveStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const PERIOD_OPTIONS: ReadonlyArray<Readonly<{
  value: ChallanHistoryPeriod;
  label: string;
}>> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All time" },
];

const LIFECYCLE_OPTIONS: ReadonlyArray<Readonly<{
  value: ChallanHistoryLifecycle;
  label: string;
}>> = [
  { value: "all", label: "All" },
  { value: "active", label: CHALLAN_STATUS.definitions.active.label },
  { value: "void", label: CHALLAN_STATUS.definitions.void.label },
];

const FINANCIAL_LOCK_OPTIONS: ReadonlyArray<Readonly<{
  value: ChallanHistoryFinancialLock;
  label: string;
}>> = [
  { value: "all", label: "All" },
  { value: "locked", label: CHALLAN_FINANCIAL_LOCK_STATUS.definitions.true.label },
  { value: "unlocked", label: CHALLAN_FINANCIAL_LOCK_STATUS.definitions.false.label },
];

const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

export function AllChallansExpandedView({
  challans,
  isLoading,
  errorMessage,
  selectedChallanId,
  onBack,
  onOpen,
  onRetry,
}: Readonly<{
  challans: readonly ChallanHeader[];
  isLoading: boolean;
  errorMessage: string;
  selectedChallanId: string;
  onBack: () => void;
  onOpen: (challanId: string) => void;
  onRetry: () => void;
}>) {
  const [localToday] = useState(() => getLocalDate());
  const [searchText, setSearchText] = useState("");
  const [period, setPeriod] = useState<ChallanHistoryPeriod>("all");
  const [lifecycle, setLifecycle] = useState<ChallanHistoryLifecycle>("all");
  const [financialLock, setFinancialLock] = useState<ChallanHistoryFinancialLock>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const filtered = filterChallansForExpandedView(challans, {
    searchText,
    period,
    lifecycle,
    financialLock,
    localToday,
    customFrom,
    customTo,
  });

  return (
    <section aria-labelledby="all-challans-heading" className="text-atlas-text">
      <header>
        <div>
          <Button variant="ghost" onClick={onBack}>← Back to Challans</Button>
          <h2 id="all-challans-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold">All Challans</h2>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
            Search, verify, and inspect the complete authoritative Challan history.
          </p>
        </div>
      </header>

      <section
        aria-label="All Challans filters"
        className="mt-atlas-4 border-y border-atlas-border bg-atlas-surface py-atlas-2"
      >
        <div className="flex flex-wrap items-end gap-atlas-2 xl:flex-nowrap">
          <div className="w-full min-w-0 xl:flex-1">
            <FormField label="Search Challans">
              <Input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search Challan, customer, vehicle, location or amount"
              />
            </FormField>
          </div>
          <FilterGroup
            label="Period"
            options={PERIOD_OPTIONS}
            selected={period}
            onSelect={setPeriod}
          />
          <div className="w-48 max-w-full">
            <FormField label="Lifecycle">
              <Select
                value={lifecycle}
                onChange={(event) => setLifecycle(event.target.value as ChallanHistoryLifecycle)}
              >
                {LIFECYCLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="w-48 max-w-full">
            <FormField label="Financial lock">
              <Select
                value={financialLock}
                onChange={(event) => setFinancialLock(event.target.value as ChallanHistoryFinancialLock)}
              >
                {FINANCIAL_LOCK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>

        {period === "custom" && (
          <div className="mt-atlas-2 grid max-w-xl gap-atlas-2 border-t border-atlas-border pt-atlas-2 sm:grid-cols-2">
            <FormField label={ATLAS_UI_STRINGS.fields.fromDate}>
              <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            </FormField>
            <FormField label={ATLAS_UI_STRINGS.fields.toDate}>
              <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </FormField>
          </div>
        )}
        {filtered.error && <div className="mt-atlas-2"><Feedback tone="danger" role="alert">{filtered.error}</Feedback></div>}
      </section>

      <div className="mt-atlas-3">
        {isLoading && <Feedback tone="neutral" role="status">Loading Challans...</Feedback>}
        {errorMessage && (
          <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{errorMessage}</span>
              <Button variant="secondary" onClick={onRetry}>{ATLAS_UI_STRINGS.actions.retry}</Button>
            </div>
          </Feedback>
        )}
        {!isLoading && !errorMessage && !filtered.error && challans.length === 0 && (
          <EmptyState title="No Challans yet" description="Create the first Challan from the main Challans screen." />
        )}
        {!isLoading && !errorMessage && !filtered.error && challans.length > 0 && filtered.challans.length === 0 && (
          <EmptyState title="No matching Challans" description="Change the search or filters to see more history." />
        )}
        {!isLoading && !errorMessage && !filtered.error && filtered.challans.length > 0 && (
          <>
            <p className="mb-atlas-2 text-atlas-xs font-atlas-medium text-atlas-text-muted">
              Showing {formatIndianNumber(filtered.challans.length)} of {formatIndianNumber(challans.length)} Challans · newest first
            </p>
            <div className="hidden md:block">
              <div className="max-h-screen overflow-y-auto">
                <TableContainer>
                  <Table wide>
                    <TableCaption visuallyHidden>Complete Challan history, newest first</TableCaption>
                    <TableHeader sticky>
                      <TableRow>
                        <TableHeaderCell>Challan / date</TableHeaderCell>
                        <TableHeaderCell>Customer / location</TableHeaderCell>
                        <TableHeaderCell>Vehicle / trip wage</TableHeaderCell>
                        <TableHeaderCell numeric>Total</TableHeaderCell>
                        <TableHeaderCell>Lifecycle</TableHeaderCell>
                        <TableHeaderCell>Financial lock</TableHeaderCell>
                        <TableHeaderCell>Action</TableHeaderCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.challans.map((challan) => (
                        <ExpandedChallanTableRow
                          key={challan.id}
                          challan={challan}
                          selected={selectedChallanId === challan.id}
                          onOpen={() => onOpen(challan.id)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            </div>
            <ul className="space-y-atlas-3 md:hidden">
              {filtered.challans.map((challan) => (
                <li
                  key={challan.id}
                  className={selectedChallanId === challan.id
                    ? "border-l-4 border-atlas-primary"
                    : "border-l-4 border-transparent"}
                >
                  <ExpandedChallanMobileCard challan={challan} onOpen={() => onOpen(challan.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function FilterGroup<TValue extends string>({
  label,
  options,
  selected,
  onSelect,
}: Readonly<{
  label: string;
  options: ReadonlyArray<Readonly<{ value: TValue; label: string }>>;
  selected: TValue;
  onSelect: (value: TValue) => void;
}>) {
  return (
    <fieldset className="max-w-full">
      <legend className="mb-atlas-1 text-atlas-sm font-atlas-medium text-atlas-text-muted">{label}</legend>
      <div className="flex max-w-full gap-atlas-1 overflow-x-auto rounded-atlas-control bg-atlas-surface-muted p-atlas-1">
        {options.map((option) => (
          <Button
            key={option.value}
            variant={selected === option.value ? "primary" : "ghost"}
            aria-pressed={selected === option.value}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function ExpandedChallanTableRow({
  challan,
  selected,
  onOpen,
}: Readonly<{
  challan: ChallanHeader;
  selected: boolean;
  onOpen: () => void;
}>) {
  const lifecycleStatus = resolveStatusPresentation(CHALLAN_STATUS, challan.status);
  const financialLockStatus = resolveBooleanStatusPresentation(
    CHALLAN_FINANCIAL_LOCK_STATUS,
    challan.isLocked,
  );
  const vehicleNumber = challan.vehicleNumberSnapshot || challan.vehicleNumber;
  const tripWage = challan.deliveryWageApplicableSnapshot && challan.tripLabourWage !== null
    ? formatIndianCurrency(challan.tripLabourWage, MONEY_WITH_PAISE)
    : null;

  return (
    <TableRow hoverable selected={selected}>
      <TableCell>
        <p className="whitespace-nowrap font-atlas-semibold">{formatChallanLabel(challan.challanNumber)}</p>
        <p className="mt-atlas-1 whitespace-nowrap text-atlas-xs text-atlas-text-muted">{formatDateOnly(challan.challanDate)}</p>
      </TableCell>
      <TableCell>
        <p className="font-atlas-medium">{challan.customerNameSnapshot}</p>
        <p className="mt-atlas-1 max-w-sm truncate text-atlas-xs text-atlas-text-muted">{challan.customerAddressSnapshot || "No location recorded"}</p>
      </TableCell>
      <TableCell>
        <p className={vehicleNumber ? "whitespace-nowrap font-atlas-medium" : "whitespace-nowrap text-atlas-text-subtle"}>{vehicleNumber || "No vehicle"}</p>
        <p className="mt-atlas-1 whitespace-nowrap text-atlas-xs text-atlas-text-muted">{tripWage ? `Trip wage ${tripWage}` : "No trip wage"}</p>
      </TableCell>
      <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(challan.challanTotal, MONEY_WITH_PAISE)}</span></TableCell>
      <TableCell><StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} /></TableCell>
      <TableCell><StatusPill label={financialLockStatus.label} tone={financialLockStatus.tone} /></TableCell>
      <TableCell><Button variant="ghost" onClick={onOpen}>Open →</Button></TableCell>
    </TableRow>
  );
}

function ExpandedChallanMobileCard({
  challan,
  onOpen,
}: Readonly<{
  challan: ChallanHeader;
  onOpen: () => void;
}>) {
  const lifecycleStatus = resolveStatusPresentation(CHALLAN_STATUS, challan.status);
  const financialLockStatus = resolveBooleanStatusPresentation(
    CHALLAN_FINANCIAL_LOCK_STATUS,
    challan.isLocked,
  );
  const vehicleNumber = challan.vehicleNumberSnapshot || challan.vehicleNumber;
  const tripWage = challan.deliveryWageApplicableSnapshot && challan.tripLabourWage !== null
    ? formatIndianCurrency(challan.tripLabourWage, MONEY_WITH_PAISE)
    : null;

  return (
    <Card as="article">
      <div className="flex items-start justify-between gap-atlas-3">
        <div>
          <h3 className="font-atlas-semibold">{formatChallanLabel(challan.challanNumber)}</h3>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(challan.challanDate)}</p>
        </div>
        <p className="font-atlas-semibold tabular-nums">{formatIndianCurrency(challan.challanTotal, MONEY_WITH_PAISE)}</p>
      </div>
      <div className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
        <p className="font-atlas-medium">{challan.customerNameSnapshot}</p>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{challan.customerAddressSnapshot || "No location recorded"}</p>
        <p className="mt-atlas-2 text-atlas-sm">{vehicleNumber || "No vehicle"}</p>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{tripWage ? `Trip wage ${tripWage}` : "No trip wage"}</p>
      </div>
      <div className="mt-atlas-3 flex flex-wrap gap-atlas-1">
        <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
        <StatusPill label={financialLockStatus.label} tone={financialLockStatus.tone} />
      </div>
      <div className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
        <Button variant="ghost" onClick={onOpen}>Open Challan →</Button>
      </div>
    </Card>
  );
}
