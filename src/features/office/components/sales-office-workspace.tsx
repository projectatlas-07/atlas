"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useOfficePageScrollReset } from "@/features/office/components/office-shell";

export type SalesWorkspaceArea =
  | "challans"
  | "customer-payments"
  | "sales-register";

export const SALES_WORKSPACE_AREAS = [
  { id: "challans", label: "Challans" },
  { id: "customer-payments", label: "Customer Payments" },
  { id: "sales-register", label: "Sales Register" },
] as const satisfies ReadonlyArray<{
  id: SalesWorkspaceArea;
  label: string;
}>;

export function SalesOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: SalesWorkspaceArea;
  onAreaChange: (area: SalesWorkspaceArea) => void;
  children: ReactNode;
}>) {
  const resetOfficePageScroll = useOfficePageScrollReset();

  function selectArea(area: SalesWorkspaceArea) {
    if (area === activeArea) return;
    onAreaChange(area);
    resetOfficePageScroll();
  }

  return (
    <div className="space-y-atlas-4">
      <nav aria-label="Sales areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {SALES_WORKSPACE_AREAS.map((area) => (
            <Button
              key={area.id}
              variant={activeArea === area.id ? "primary" : "ghost"}
              aria-pressed={activeArea === area.id}
              onClick={() => selectArea(area.id)}
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
