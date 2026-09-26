"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export type WorkforceWorkspaceArea =
  | "production-workers"
  | "mud-supply"
  | "chamber-transport"
  | "soil-workers"
  | "staff"
  | "vehicle-delivery-wages";

export const WORKFORCE_WORKSPACE_AREAS = [
  { id: "production-workers", label: "Production workers" },
  { id: "mud-supply", label: "Mud Supply" },
  { id: "chamber-transport", label: "Chamber Transport" },
  { id: "soil-workers", label: "Soil / Trolley workers" },
  { id: "staff", label: "Staff" },
  { id: "vehicle-delivery-wages", label: "Vehicle Delivery Wages" },
] as const satisfies ReadonlyArray<{
  id: WorkforceWorkspaceArea;
  label: string;
}>;

export function WorkforceOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: WorkforceWorkspaceArea;
  onAreaChange: (area: WorkforceWorkspaceArea) => void;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-atlas-6">
      <header className="border-b border-atlas-border pb-atlas-5">
        <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
          People, rates and accounts
        </p>
        <h2 className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">
          Workforce workspace
        </h2>
        <p className="mt-atlas-2 max-w-3xl text-atlas-sm text-atlas-text-muted">
          Manage workers, wage rates, earnings, payments, balances and history. Daily operational recording remains in Production.
        </p>
      </header>

      <nav aria-label="Workforce areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {WORKFORCE_WORKSPACE_AREAS.map((area) => (
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
