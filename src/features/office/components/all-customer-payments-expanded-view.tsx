"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form-controls";
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
import { CustomerPaymentDetailDrawer } from "@/features/office/components/customer-payment-detail-drawer";
import {
  filterCustomerPaymentsForExpandedView,
  type CustomerDuesDatePreset,
  type CustomerPaymentHistorySort,
} from "@/features/office/customer-payment-office-model";
import { listFactoryCustomerPayments } from "@/features/sales/services/customer-payment-service";
import {
  formatChallanLabel,
  formatCustomerPaymentMethods,
  type CustomerPayment,
} from "@/features/sales/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const PERIOD_OPTIONS: ReadonlyArray<Readonly<{
  value: CustomerDuesDatePreset;
  label: string;
}>> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

const SORT_OPTIONS: ReadonlyArray<Readonly<{
  value: CustomerPaymentHistorySort;
  label: string;
}>> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount-high", label: "Amount: high to low" },
  { value: "amount-low", label: "Amount: low to high" },
];

const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

const factoryPaymentsKey = (factoryId: string) =>
  ["office-factory-customer-payments", factoryId] as const;

export function AllCustomerPaymentsExpandedView({
  factoryId,
  isActive,
  onBack,
}: Readonly<{
  factoryId: string;
  isActive: boolean;
  onBack: () => void;
}>) {
  const [localToday] = useState(() => getLocalDate());
  const [searchText, setSearchText] = useState("");
  const [period, setPeriod] = useState<CustomerDuesDatePreset>("all");
  const [sort, setSort] = useState<CustomerPaymentHistorySort>("newest");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const paymentsQuery = useQuery({
    queryKey: factoryPaymentsKey(factoryId),
    queryFn: () => listFactoryCustomerPayments(factoryId),
    enabled: isActive,
  });
  const payments = paymentsQuery.data ?? [];
  const selectedPayment = payments.find((payment) => payment.id === selectedPaymentId) ?? null;
  const filtered = filterCustomerPaymentsForExpandedView(payments, {
    searchText,
    period,
    sort,
    localToday,
    customFrom,
    customTo,
  });
  const errorMessage = paymentsQuery.error instanceof Error
    ? paymentsQuery.error.message
    : paymentsQuery.error
      ? "Could not load customer payments."
      : "";
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Newest first";

  return (
    <section aria-labelledby="all-customer-payments-heading" className="text-atlas-text">
      <header className="flex flex-col gap-atlas-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" onClick={onBack}>← Back to Customer Payments</Button>
          <h2 id="all-customer-payments-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold">
            All Payments
          </h2>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
            Search and review the complete authoritative customer payment history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-atlas-3">
          {!paymentsQuery.isLoading && !errorMessage && (
            <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">
              {formatIndianNumber(payments.length)} {payments.length === 1 ? "payment" : "payments"}
            </p>
          )}
          <Button variant="secondary" onClick={() => { void paymentsQuery.refetch(); }}>Refresh</Button>
        </div>
      </header>

      <div className="mt-atlas-5">
        <Card as="section" aria-label="All Payments filters">
          <div className="grid gap-atlas-4 lg:grid-cols-3 lg:items-end">
            <FormField label="Search customer or Challan">
              <Input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search customer..."
              />
            </FormField>
            <FormField label="Period">
              <Select value={period} onChange={(event) => setPeriod(event.target.value as CustomerDuesDatePreset)}>
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Sort">
              <Select value={sort} onChange={(event) => setSort(event.target.value as CustomerPaymentHistorySort)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>
          </div>

          {period === "custom" && (
            <div className="mt-atlas-4 grid gap-atlas-3 border-t border-atlas-border pt-atlas-4 sm:grid-cols-2">
              <FormField label={ATLAS_UI_STRINGS.fields.fromDate}>
                <Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              </FormField>
              <FormField label={ATLAS_UI_STRINGS.fields.toDate}>
                <Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
              </FormField>
            </div>
          )}
          {filtered.error && (
            <div className="mt-atlas-3">
              <Feedback tone="danger" role="alert">{filtered.error}</Feedback>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-atlas-4">
        {paymentsQuery.isLoading && (
          <Feedback tone="neutral" role="status">Loading customer payments...</Feedback>
        )}
        {errorMessage && (
          <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{errorMessage}</span>
              <Button variant="secondary" onClick={() => { void paymentsQuery.refetch(); }}>
                {ATLAS_UI_STRINGS.actions.retry}
              </Button>
            </div>
          </Feedback>
        )}
        {!paymentsQuery.isLoading && !errorMessage && !filtered.error && payments.length === 0 && (
          <EmptyState
            title="No customer payments yet"
            description="Recorded customer payments will appear here."
          />
        )}
        {!paymentsQuery.isLoading && !errorMessage && !filtered.error
          && payments.length > 0 && filtered.payments.length === 0 && (
          <EmptyState
            title="No matching payments"
            description="Change the customer search or date filters to see more history."
          />
        )}
        {!paymentsQuery.isLoading && !errorMessage && !filtered.error
          && filtered.payments.length > 0 && (
          <>
            <p className="mb-atlas-2 text-atlas-xs font-atlas-medium text-atlas-text-muted">
              Showing {formatIndianNumber(filtered.payments.length)} of {formatIndianNumber(payments.length)} payments · {sortLabel}
            </p>
            <div className="hidden md:block">
              <div className="max-h-screen overflow-y-auto">
                <TableContainer>
                  <Table wide>
                    <TableCaption visuallyHidden>Complete factory-wide customer payment history</TableCaption>
                    <TableHeader sticky>
                      <TableRow>
                        <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
                        <TableHeaderCell>Customer / note</TableHeaderCell>
                        <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
                        <TableHeaderCell>Mode</TableHeaderCell>
                        <TableHeaderCell>Allocation</TableHeaderCell>
                        <TableHeaderCell>Action</TableHeaderCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.payments.map((payment) => (
                        <ExpandedPaymentTableRow
                          key={payment.id}
                          payment={payment}
                          selected={payment.id === selectedPaymentId}
                          onOpen={() => setSelectedPaymentId(payment.id)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            </div>
            <ul className="space-y-atlas-3 md:hidden">
              {filtered.payments.map((payment) => (
                <li key={payment.id}>
                  <ExpandedPaymentMobileCard
                    payment={payment}
                    selected={payment.id === selectedPaymentId}
                    onOpen={() => setSelectedPaymentId(payment.id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {selectedPayment && (
        <CustomerPaymentDetailDrawer
          payment={selectedPayment}
          onClose={() => setSelectedPaymentId(null)}
        />
      )}
    </section>
  );
}

function ExpandedPaymentTableRow({
  payment,
  selected,
  onOpen,
}: Readonly<{
  payment: CustomerPayment;
  selected: boolean;
  onOpen: () => void;
}>) {
  return (
    <TableRow hoverable selected={selected}>
      <TableCell>
        <p className="whitespace-nowrap font-atlas-medium">{formatDateOnly(payment.paymentDate)}</p>
      </TableCell>
      <TableCell>
        <p className="font-atlas-medium">{payment.customerNameSnapshot}</p>
        <p className="mt-atlas-1 max-w-sm truncate text-atlas-xs text-atlas-text-muted">
          {payment.note || payment.customerAddressSnapshot || "No note recorded"}
        </p>
      </TableCell>
      <TableCell numeric>
        <span className="font-atlas-semibold">{formatIndianCurrency(payment.amount, MONEY_WITH_PAISE)}</span>
      </TableCell>
      <TableCell>
        <span className="whitespace-nowrap rounded-atlas-control bg-atlas-surface-muted px-atlas-2 py-atlas-1 text-atlas-xs font-atlas-medium text-atlas-text-muted">
          {formatCustomerPaymentMethods(payment.methods, payment.paymentMode)}
        </span>
      </TableCell>
      <TableCell><PaymentAllocationSummary payment={payment} /></TableCell>
      <TableCell>
        <div className="flex items-center gap-atlas-1">
          <Button variant="ghost" aria-label={`View payment details for ${payment.customerNameSnapshot}`} onClick={onOpen}>
            View details
          </Button>
          <ReceiptLink paymentId={payment.id} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function ExpandedPaymentMobileCard({
  payment,
  selected,
  onOpen,
}: Readonly<{
  payment: CustomerPayment;
  selected: boolean;
  onOpen: () => void;
}>) {
  return (
    <Card as="article" aria-current={selected ? "true" : undefined}>
      <div className="flex items-start justify-between gap-atlas-3">
        <div className="min-w-0">
          <p className="font-atlas-semibold">{payment.customerNameSnapshot}</p>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(payment.paymentDate)}</p>
        </div>
        <p className="shrink-0 font-atlas-semibold tabular-nums">
          {formatIndianCurrency(payment.amount, MONEY_WITH_PAISE)}
        </p>
      </div>
      <dl className="mt-atlas-4 space-y-atlas-3 border-t border-atlas-border pt-atlas-3 text-atlas-sm">
        <div className="flex items-start justify-between gap-atlas-3">
          <dt className="text-atlas-text-muted">Mode</dt>
          <dd className="text-right font-atlas-medium">{formatCustomerPaymentMethods(payment.methods, payment.paymentMode)}</dd>
        </div>
        <div className="flex items-start justify-between gap-atlas-3">
          <dt className="text-atlas-text-muted">Allocation</dt>
          <dd className="text-right"><PaymentAllocationSummary payment={payment} /></dd>
        </div>
        <div className="flex items-start justify-between gap-atlas-3">
          <dt className="text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.note}</dt>
          <dd className="max-w-xs text-right">{payment.note || "No note recorded"}</dd>
        </div>
      </dl>
      <div className="mt-atlas-4 flex flex-wrap justify-end gap-atlas-1 border-t border-atlas-border pt-atlas-3">
        <Button variant="ghost" onClick={onOpen}>View details</Button>
        <ReceiptLink paymentId={payment.id} />
      </div>
    </Card>
  );
}

function PaymentAllocationSummary({ payment }: Readonly<{ payment: CustomerPayment }>) {
  if (payment.allocations.length === 0) {
    return <span className="text-atlas-xs text-atlas-text-subtle">No allocations recorded</span>;
  }
  if (payment.allocations.length > 1) {
    return (
      <span className="whitespace-nowrap text-atlas-sm font-atlas-semibold text-atlas-primary">
        {formatIndianNumber(payment.allocations.length)} Challans
      </span>
    );
  }

  const allocation = payment.allocations[0]!;
  return (
    <span className="whitespace-nowrap text-atlas-sm text-atlas-text-muted">
      {formatChallanLabel(allocation.challanNumber)} · {formatIndianCurrency(allocation.allocatedAmount, MONEY_WITH_PAISE)}
    </span>
  );
}

function ReceiptLink({ paymentId }: Readonly<{ paymentId: string }>) {
  return (
    <Link
      href={`/office/payments/${paymentId}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-atlas-12 items-center rounded-atlas-button px-atlas-2 py-atlas-2 text-atlas-sm font-atlas-semibold text-atlas-primary hover:bg-atlas-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus"
    >
      Open receipt ↗
    </Link>
  );
}
