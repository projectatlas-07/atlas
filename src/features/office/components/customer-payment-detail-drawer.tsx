"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  formatChallanLabel,
  formatCustomerPaymentMethods,
  type CustomerPayment,
} from "@/features/sales/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

export function CustomerPaymentDetailDrawer({
  payment,
  onClose,
}: Readonly<{
  payment: CustomerPayment;
  onClose: () => void;
}>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const drawer = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const allocationCount = payment.allocations.length;

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal payment-detail drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close payment details" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-payment-detail-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="flex items-start justify-between gap-atlas-3">
            <div>
              <h2 id="customer-payment-detail-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">
                Payment receipt
              </h2>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
                {formatDateOnly(payment.paymentDate)}
              </p>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close payment details" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-atlas-5 overflow-y-auto px-atlas-5 py-atlas-5">
          <section className="border-b border-atlas-border pb-atlas-5" aria-labelledby="payment-amount-heading">
            <h3 id="payment-amount-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-subtle">
              Amount received
            </h3>
            <p className="mt-atlas-2 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">
              {formatIndianCurrency(payment.amount, MONEY_WITH_PAISE)}
            </p>
          </section>

          <section className="border-b border-atlas-border pb-atlas-5" aria-label="Payment information">
            <dl className="space-y-atlas-4 text-atlas-sm">
              <div className="flex items-start justify-between gap-atlas-4">
                <dt className="shrink-0 text-atlas-text-muted">Customer</dt>
                <dd className="text-right font-atlas-semibold text-atlas-text">{payment.customerNameSnapshot}</dd>
              </div>
              {payment.customerAddressSnapshot && (
                <div className="flex items-start justify-between gap-atlas-4">
                  <dt className="shrink-0 text-atlas-text-muted">Address</dt>
                  <dd className="max-w-xs text-right text-atlas-text">{payment.customerAddressSnapshot}</dd>
                </div>
              )}
              {payment.customerMobileSnapshot && (
                <div className="flex items-start justify-between gap-atlas-4">
                  <dt className="shrink-0 text-atlas-text-muted">Mobile</dt>
                  <dd className="text-right font-atlas-medium tabular-nums text-atlas-text">{payment.customerMobileSnapshot}</dd>
                </div>
              )}
              <div className="flex items-start justify-between gap-atlas-4">
                <dt className="shrink-0 text-atlas-text-muted">{ATLAS_UI_STRINGS.payment.mode}</dt>
                <dd className="text-right font-atlas-medium text-atlas-text">
                  {formatCustomerPaymentMethods(payment.methods, payment.paymentMode)}
                </dd>
              </div>
              {payment.note && (
                <div className="flex items-start justify-between gap-atlas-4">
                  <dt className="shrink-0 text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.note}</dt>
                  <dd className="max-w-xs whitespace-pre-wrap text-right text-atlas-text">{payment.note}</dd>
                </div>
              )}
            </dl>
          </section>

          <section aria-labelledby="payment-allocations-heading">
            <div className="flex items-start justify-between gap-atlas-3">
              <h3 id="payment-allocations-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">
                Allocated Challans
              </h3>
              <p className="text-right text-atlas-xs text-atlas-text-subtle">
                {formatIndianNumber(allocationCount)} {allocationCount === 1 ? "allocation" : "allocations"}
              </p>
            </div>

            {allocationCount === 0 ? (
              <div className="mt-atlas-3">
                <Card surface="muted">
                  <p className="text-atlas-sm text-atlas-text-muted">No allocations recorded</p>
                </Card>
              </div>
            ) : (
              <ul className="mt-atlas-3 space-y-atlas-3">
                {payment.allocations.map((allocation) => (
                  <li key={allocation.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-atlas-3">
                        <div className="min-w-0">
                          <p className="font-atlas-semibold text-atlas-text">
                            {formatChallanLabel(allocation.challanNumber)}
                          </p>
                          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
                            {formatDateOnly(allocation.challanDate)}
                          </p>
                        </div>
                        <p className="shrink-0 font-atlas-semibold tabular-nums text-atlas-text">
                          {formatIndianCurrency(allocation.allocatedAmount, MONEY_WITH_PAISE)}
                        </p>
                      </div>
                      <div className="mt-atlas-3 flex justify-end border-t border-atlas-border pt-atlas-3">
                        <Link
                          href={`/office/challans/${allocation.challanId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-atlas-12 items-center rounded-atlas-button px-atlas-2 py-atlas-2 text-atlas-sm font-atlas-semibold text-atlas-primary underline-offset-4 hover:bg-atlas-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus"
                        >
                          Open Challan ↗
                        </Link>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex flex-col gap-atlas-2 border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4 shadow-atlas-medium sm:flex-row-reverse">
          <Link
            href={`/office/payments/${payment.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-atlas-12 items-center justify-center rounded-atlas-button border border-atlas-primary bg-atlas-primary px-atlas-4 py-atlas-2 text-atlas-base font-atlas-semibold text-atlas-primary-foreground transition-colors hover:bg-atlas-primary-hover focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus"
          >
            Open receipt ↗
          </Link>
          <Button variant="secondary" onClick={onClose}>{ATLAS_UI_STRINGS.actions.close}</Button>
        </footer>
      </aside>
    </div>
  );
}
