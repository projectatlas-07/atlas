"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  OFFICE_PURCHASES_EXPENSES_AREAS,
  type OfficePurchasesExpensesAreaId,
} from "@/features/office/office-navigation";

export function PurchasesExpensesOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: OfficePurchasesExpensesAreaId;
  onAreaChange: (area: OfficePurchasesExpensesAreaId) => void;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-atlas-3">
      <nav aria-label="Purchases and Expenses areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {OFFICE_PURCHASES_EXPENSES_AREAS.map((area) => (
            <Button
              key={area.id}
              variant={activeArea === area.id ? "primary" : "ghost"}
              aria-pressed={activeArea === area.id}
              onClick={() => onAreaChange(area.id)}
            >
              {area.label}
            </Button>
          ))}
        </div>
      </nav>

      {children}
    </div>
  );
}
