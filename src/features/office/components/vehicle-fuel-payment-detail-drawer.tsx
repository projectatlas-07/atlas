"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Feedback } from "@/components/ui/feedback";
import {
  formatFuelTime,
  getVehicleFuelPaymentAllocationReconciliation,
} from "@/features/vehicle-fuel/vehicle-fuel-model";
import type { VehicleFuelBatchPayment } from "@/features/vehicle-fuel/types";
import { formatCustomerPaymentMode } from "@/features/sales/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

export function VehicleFuelPaymentDetailDrawer({
  payment,
  onClose,
  canOpenFuelEntry,
  onOpenFuelEntry,
}: Readonly<{
  payment: VehicleFuelBatchPayment;
  onClose: () => void;
  canOpenFuelEntry: (fuelRecordId: string) => boolean;
  onOpenFuelEntry: (fuelRecordId: string) => void;
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

  const reconciliation = getVehicleFuelPaymentAllocationReconciliation(payment);

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal payment-detail drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Pump Payment details" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="pump-payment-detail-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="flex items-start justify-between gap-atlas-3">
            <div>
              <h2 id="pump-payment-detail-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">Pump Payment</h2>
              <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{formatDateOnly(payment.paymentDate)}</p>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Pump Payment details" onClick={onClose}><span aria-hidden="true">×</span></Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-atlas-5 overflow-y-auto px-atlas-5 py-atlas-5">
          <section className="border-b border-atlas-border pb-atlas-5" aria-labelledby="pump-payment-amount-heading">
            <h3 id="pump-payment-amount-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-subtle">{ATLAS_UI_STRINGS.payment.amount}</h3>
            <p className="mt-atlas-2 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(payment.amount, MONEY_WITH_PAISE)}</p>
          </section>

          <section className="border-b border-atlas-border pb-atlas-5" aria-label="Pump Payment information">
            <dl className="space-y-atlas-4 text-atlas-sm">
              <div className="flex items-start justify-between gap-atlas-4"><dt className="shrink-0 text-atlas-text-muted">Fuel Pump</dt><dd className="text-right font-atlas-semibold text-atlas-text">{payment.pumpName}</dd></div>
              <div className="flex items-start justify-between gap-atlas-4"><dt className="shrink-0 text-atlas-text-muted">{ATLAS_UI_STRINGS.payment.date}</dt><dd className="text-right tabular-nums text-atlas-text">{formatDateOnly(payment.paymentDate)}</dd></div>
              <div className="flex items-start justify-between gap-atlas-4"><dt className="shrink-0 text-atlas-text-muted">{ATLAS_UI_STRINGS.payment.mode}</dt><dd className="text-right font-atlas-medium text-atlas-text">{formatCustomerPaymentMode(payment.paymentMode)}</dd></div>
              {payment.note && <div className="flex items-start justify-between gap-atlas-4"><dt className="shrink-0 text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.note}</dt><dd className="max-w-xs whitespace-pre-wrap text-right text-atlas-text">{payment.note}</dd></div>}
            </dl>
          </section>

          <section aria-labelledby="fuel-payment-allocations-heading">
            <div className="flex items-start justify-between gap-atlas-3">
              <h3 id="fuel-payment-allocations-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Fuel Entry allocations</h3>
              <p className="text-right text-atlas-xs text-atlas-text-subtle">{formatIndianNumber(payment.allocations.length)} {payment.allocations.length === 1 ? "allocation" : "allocations"}</p>
            </div>

            <ul className="mt-atlas-3 space-y-atlas-3">
              {payment.allocations.map((allocation) => <li key={allocation.fuelRecordId}>
                <Card>
                  <div className="flex items-start justify-between gap-atlas-3">
                    <div className="min-w-0">
                      <p className="font-atlas-semibold text-atlas-text">{allocation.vehicleNumberSnapshot}</p>
                      <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
                        {formatDateOnly(allocation.fuelDate)} ·
                        {/* ui-exception: Existing Fuel formatter preserves the saved local wall-clock time. */}
                        {formatFuelTime(allocation.fuelTime)}
                      </p>
                      <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{allocation.fuelType === "DIESEL" ? "Diesel" : "Petrol"} · {formatIndianNumber(allocation.litres)} L</p>
                    </div>
                    <p className="shrink-0 font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(allocation.allocatedAmount, MONEY_WITH_PAISE)}</p>
                  </div>
                  {canOpenFuelEntry(allocation.fuelRecordId) && <div className="mt-atlas-3 flex justify-end border-t border-atlas-border pt-atlas-3">
                    <Button type="button" variant="ghost" onClick={() => onOpenFuelEntry(allocation.fuelRecordId)}>Open Fuel Entry →</Button>
                  </div>}
                </Card>
              </li>)}
            </ul>

            <div className="mt-atlas-4 border-t border-atlas-border pt-atlas-4">
              <div className="flex items-baseline justify-between gap-atlas-3 text-atlas-sm">
                <span className="text-atlas-text-muted">Allocated total</span>
                <span className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(reconciliation.allocatedAmount, MONEY_WITH_PAISE)}</span>
              </div>
              {reconciliation.reconciles
                ? <p className="mt-atlas-2 text-atlas-xs text-atlas-success-text">Allocations reconcile with the saved Pump Payment total.</p>
                : <div className="mt-atlas-3"><Feedback role="alert" tone="warning">Saved allocations differ from the payment total by {formatIndianCurrency(Math.abs(reconciliation.remainingAmount), MONEY_WITH_PAISE)}.</Feedback></div>}
            </div>
          </section>
        </div>

        <footer className="border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <Button variant="secondary" onClick={onClose}>{ATLAS_UI_STRINGS.actions.close}</Button>
        </footer>
      </aside>
    </div>
  );
}
