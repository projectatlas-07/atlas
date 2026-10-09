"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCustomerPaymentReadCurrent, refreshSalesRegisterQueries } from "@/features/office/customer-payment-office-model";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form-controls";
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
  getChallanBrickQuantity,
  getSalesRegisterPaymentLabel,
  resolveSalesDateRange,
  summarizeSalesRegister,
  type SalesDatePreset,
  type SalesRegisterEntry,
} from "@/features/sales/sales-register-model";
import { listSalesRegister } from "@/features/sales/services/sales-register-service";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { CHALLAN_STATUS, resolveStatusPresentation } from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const presets: ReadonlyArray<Readonly<{ value: SalesDatePreset; label: string }>> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

export function SalesRegisterSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [preset, setPreset] = useState<SalesDatePreset>("today");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const range = resolveSalesDateRange(preset, localToday, customFrom, customTo);
  const registerKey = ["office-sales-register", factoryId, range?.fromDate, range?.toDate] as const;
  const registerQuery = useQuery({
    queryKey: registerKey,
    queryFn: () => listSalesRegister(factoryId, range!),
    enabled: range !== null,
  });
  const registerCurrent = Boolean(range) && !registerQuery.isPaused && isCustomerPaymentReadCurrent({
    isFetching: registerQuery.isFetching, error: registerQuery.error,
    dataUpdatedAt: registerQuery.dataUpdatedAt,
    isInvalidated: queryClient.getQueryState(registerKey)?.isInvalidated,
  });
  const entries = registerCurrent ? registerQuery.data ?? [] : [];
  const summary = registerCurrent ? summarizeSalesRegister(entries) : null;
  const errorMessage = registerQuery.error ? ATLAS_UI_STRINGS.salesRegister.loadError : "";

  async function refreshRegister() {
    if (!range) return;
    try { await refreshSalesRegisterQueries(queryClient, { factoryId, range }); }
    catch { /* Query state keeps unavailable financial values hidden; Refresh never writes. */ }
  }

  return (
    <Card as="section" aria-labelledby="sales-register-heading">
      <header className="flex flex-col gap-atlas-4 border-b border-atlas-border pb-atlas-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h3 id="sales-register-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">
            Sales Register
          </h3>
          <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
            Saved Challans are the sale records. Void Challans remain visible but do not count toward totals.
          </p>
          {range && (
            <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">
              Showing {formatDateOnly(range.fromDate)} to {formatDateOnly(range.toDate)}, inclusive.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-atlas-2" aria-label="Sales Register date filters">
          <Button variant="secondary" onClick={() => { void refreshRegister(); }} disabled={!range}>
            {ATLAS_UI_STRINGS.payment.refresh}
          </Button>
          <div className="flex flex-wrap gap-atlas-1 rounded-atlas-control bg-atlas-surface-muted p-atlas-1">
            {presets.slice(0, 4).map((option) => (
              <Button
                key={option.value}
                variant={preset === option.value ? "primary" : "ghost"}
                aria-pressed={preset === option.value}
                onClick={() => setPreset(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button
            variant={preset === "custom" ? "primary" : "secondary"}
            aria-pressed={preset === "custom"}
            onClick={() => setPreset("custom")}
          >
            Custom range
          </Button>
        </div>
      </header>

      {preset === "custom" && (
        <div className="mt-atlas-4 grid gap-atlas-3 border-b border-atlas-border pb-atlas-4 sm:max-w-xl sm:grid-cols-2">
          <FormField label={ATLAS_UI_STRINGS.fields.fromDate}>
            <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          </FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.toDate}>
            <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          </FormField>
        </div>
      )}
      {preset === "custom" && !range && (
        <div className="mt-atlas-3">
          <Feedback tone="danger" role="alert">
            Choose a valid start and end date. The start date cannot be after the end date.
          </Feedback>
        </div>
      )}

      <dl className="mt-atlas-4 grid grid-cols-2 overflow-hidden rounded-atlas-card border border-atlas-border bg-atlas-surface-muted sm:grid-cols-3 xl:grid-cols-6">
        <SummaryValue label="Brick Revenue" value={summary ? formatIndianCurrency(summary.brickRevenue, MONEY_WITH_PAISE) : ATLAS_UI_STRINGS.feedback.unavailable} />
        <SummaryValue label="Other Revenue" value={summary ? formatIndianCurrency(summary.otherRevenue, MONEY_WITH_PAISE) : ATLAS_UI_STRINGS.feedback.unavailable} />
        <SummaryValue label="Total Revenue" value={summary ? formatIndianCurrency(summary.totalRevenue, MONEY_WITH_PAISE) : ATLAS_UI_STRINGS.feedback.unavailable} emphasized />
        <SummaryValue label="Active Challans" value={summary ? formatIndianNumber(summary.activeChallans) : ATLAS_UI_STRINGS.feedback.unavailable} />
        <SummaryValue label="Brick quantity" value={summary ? formatIndianNumber(summary.totalBrickQuantity) : ATLAS_UI_STRINGS.feedback.unavailable} />
        <SummaryValue label="Void Challans" value={summary ? formatIndianNumber(summary.voidChallans) : ATLAS_UI_STRINGS.feedback.unavailable} />
      </dl>

      <div className="mt-atlas-4">
        {registerQuery.isLoading && (
          <Feedback tone="neutral" role="status">Loading Sales Register...</Feedback>
        )}
        {errorMessage && (
          <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{errorMessage}</span>
              <Button variant="secondary" onClick={() => { void refreshRegister(); }}>
                {ATLAS_UI_STRINGS.actions.retry}
              </Button>
            </div>
          </Feedback>
        )}
        {range && !registerCurrent && !registerQuery.isLoading && !errorMessage && (
          <Feedback tone="warning" role="status">{ATLAS_UI_STRINGS.salesRegister.outdated}</Feedback>
        )}
        {registerCurrent && entries.length === 0 && (
          <EmptyState
            title="No Challans in this date range"
            description="Choose another period to review saved Sales records."
          />
        )}

        {registerCurrent && entries.length > 0 && (
          <>
            <div className="hidden md:block">
              <div className="max-h-screen overflow-y-auto">
                <TableContainer>
                  <Table wide>
                    <TableCaption visuallyHidden>Authoritative Sales Register for the selected date range</TableCaption>
                    <TableHeader sticky>
                      <TableRow>
                        <TableHeaderCell>Challan</TableHeaderCell>
                        <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
                        <TableHeaderCell>Customer</TableHeaderCell>
                        <TableHeaderCell>Brick particulars</TableHeaderCell>
                        <TableHeaderCell numeric>Quantity</TableHeaderCell>
                        <TableHeaderCell numeric>Total Revenue</TableHeaderCell>
                        <TableHeaderCell>Vehicle</TableHeaderCell>
                        <TableHeaderCell>{ATLAS_UI_STRINGS.fields.status}</TableHeaderCell>
                        <TableHeaderCell>Payment</TableHeaderCell>
                        <TableHeaderCell>Document</TableHeaderCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry) => <SalesRegisterTableRow key={entry.challanId} entry={entry} />)}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            </div>

            <ul className="space-y-atlas-3 md:hidden">
              {entries.map((entry) => (
                <li key={entry.challanId}><SalesRegisterMobileCard entry={entry} /></li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function SummaryValue({
  label,
  value,
  emphasized = false,
}: Readonly<{
  label: string;
  value: string;
  emphasized?: boolean;
}>) {
  return (
    <div className="border-b border-r border-atlas-border p-atlas-3 last:border-r-0">
      <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-subtle">{label}</dt>
      <dd className={emphasized
        ? "mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums text-atlas-primary"
        : "mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums text-atlas-text"}
      >
        {value}
      </dd>
    </div>
  );
}

function SalesRegisterTableRow({ entry }: Readonly<{ entry: SalesRegisterEntry }>) {
  const lifecycleStatus = resolveStatusPresentation(CHALLAN_STATUS, entry.status);
  const isVoid = entry.status === "void";

  return (
    <TableRow hoverable>
      <TableCell>
        <span className={isVoid ? "font-atlas-semibold tabular-nums text-atlas-text-subtle" : "font-atlas-semibold tabular-nums text-atlas-text"}>
          {entry.challanNumber ?? "—"}
        </span>
      </TableCell>
      <TableCell>
        <span className={isVoid ? "whitespace-nowrap text-atlas-text-subtle" : "whitespace-nowrap text-atlas-text-muted"}>
          {formatDateOnly(entry.challanDate)}
        </span>
      </TableCell>
      <TableCell>
        <span className={isVoid ? "font-atlas-medium text-atlas-text-subtle" : "font-atlas-medium text-atlas-text"}>
          {entry.customerNameSnapshot}
        </span>
      </TableCell>
      <TableCell><BrickParticulars entry={entry} muted={isVoid} /></TableCell>
      <TableCell numeric>
        <span className={isVoid ? "font-atlas-semibold text-atlas-text-subtle" : "font-atlas-semibold text-atlas-text"}>
          {formatIndianNumber(getChallanBrickQuantity(entry))}
        </span>
      </TableCell>
      <TableCell numeric>
        <span className={isVoid ? "font-atlas-semibold text-atlas-text-subtle line-through" : "font-atlas-semibold text-atlas-text"}>
          {formatIndianCurrency(entry.totalRevenue, MONEY_WITH_PAISE)}
        </span>
      </TableCell>
      <TableCell>
        <span className={entry.vehicleNumber && !isVoid ? "whitespace-nowrap font-atlas-medium text-atlas-text-muted" : "whitespace-nowrap text-atlas-text-subtle"}>
          {entry.vehicleNumber || "—"}
        </span>
      </TableCell>
      <TableCell><StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} /></TableCell>
      <TableCell><PaymentDetails entry={entry} /></TableCell>
      <TableCell><ChallanDocumentLink entry={entry} /></TableCell>
    </TableRow>
  );
}

function SalesRegisterMobileCard({ entry }: Readonly<{ entry: SalesRegisterEntry }>) {
  const lifecycleStatus = resolveStatusPresentation(CHALLAN_STATUS, entry.status);
  const isVoid = entry.status === "void";

  return (
    <Card as="article" surface={isVoid ? "muted" : "default"}>
      <div className="flex items-start justify-between gap-atlas-3">
        <div>
          <p className="font-atlas-semibold tabular-nums text-atlas-text">Challan {entry.challanNumber ?? "—"}</p>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(entry.challanDate)}</p>
        </div>
        <p className={isVoid
          ? "shrink-0 font-atlas-semibold tabular-nums text-atlas-text-subtle line-through"
          : "shrink-0 font-atlas-semibold tabular-nums text-atlas-text"}
        >
          {formatIndianCurrency(entry.totalRevenue, MONEY_WITH_PAISE)}
        </p>
      </div>

      <dl className="mt-atlas-4 space-y-atlas-3 border-t border-atlas-border pt-atlas-3 text-atlas-sm">
        <MobileDetail label="Customer" value={entry.customerNameSnapshot} />
        <div>
          <dt className="text-atlas-text-muted">Brick particulars</dt>
          <dd className="mt-atlas-1"><BrickParticulars entry={entry} muted={isVoid} /></dd>
        </div>
        <MobileDetail label="Quantity" value={formatIndianNumber(getChallanBrickQuantity(entry))} numeric />
        <MobileDetail label="Vehicle" value={entry.vehicleNumber || "—"} />
        <div className="flex items-start justify-between gap-atlas-3">
          <dt className="text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.status}</dt>
          <dd><StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} /></dd>
        </div>
        <div className="flex items-start justify-between gap-atlas-3">
          <dt className="text-atlas-text-muted">Payment</dt>
          <dd className="text-right"><PaymentDetails entry={entry} /></dd>
        </div>
      </dl>

      <div className="mt-atlas-4 flex justify-end border-t border-atlas-border pt-atlas-3">
        <ChallanDocumentLink entry={entry} />
      </div>
    </Card>
  );
}

function BrickParticulars({
  entry,
  muted,
}: Readonly<{
  entry: SalesRegisterEntry;
  muted: boolean;
}>) {
  if (entry.items.length === 0) {
    return <span className="text-atlas-xs text-atlas-text-subtle">No brick revenue</span>;
  }

  return (
    <ul className="space-y-atlas-1">
      {entry.items.map((item) => (
        <li key={item.linePosition} className={muted ? "text-atlas-text-subtle" : "text-atlas-text"}>
          <span className="font-atlas-medium">{item.particularsSnapshot}</span>
          <span className="text-atlas-xs tabular-nums text-atlas-text-muted"> · {formatIndianNumber(item.quantity)}</span>
        </li>
      ))}
    </ul>
  );
}

function PaymentDetails({ entry }: Readonly<{ entry: SalesRegisterEntry }>) {
  return (
    <div className="whitespace-nowrap text-atlas-xs">
      <p className={entry.status === "void" ? "font-atlas-medium text-atlas-text-subtle" : "font-atlas-semibold text-atlas-text"}>
        {getSalesRegisterPaymentLabel(entry)}
      </p>
      {entry.status === "active" && (
        <div className="mt-atlas-1 space-y-atlas-1 tabular-nums text-atlas-text-muted">
          <p>Paid {formatIndianCurrency(entry.paidAmount, MONEY_WITH_PAISE)}</p>
          <p>Due {formatIndianCurrency(entry.outstandingAmount, MONEY_WITH_PAISE)}</p>
        </div>
      )}
    </div>
  );
}

function MobileDetail({
  label,
  value,
  numeric = false,
}: Readonly<{
  label: string;
  value: string;
  numeric?: boolean;
}>) {
  return (
    <div className="flex items-start justify-between gap-atlas-3">
      <dt className="text-atlas-text-muted">{label}</dt>
      <dd className={numeric ? "text-right font-atlas-medium tabular-nums text-atlas-text" : "text-right font-atlas-medium text-atlas-text"}>
        {value}
      </dd>
    </div>
  );
}

function ChallanDocumentLink({ entry }: Readonly<{ entry: SalesRegisterEntry }>) {
  return (
    <Link
      href={`/office/challans/${entry.challanId}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-atlas-12 items-center rounded-atlas-button px-atlas-2 py-atlas-2 text-atlas-sm font-atlas-semibold text-atlas-primary underline-offset-4 hover:bg-atlas-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus"
    >
      Open Challan ↗
    </Link>
  );
}
