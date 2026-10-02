"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useOfficePageScrollReset } from "@/features/office/components/office-shell";

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
  const resetOfficePageScroll = useOfficePageScrollReset();

  function selectArea(area: WorkforceWorkspaceArea) {
    if (area === activeArea) return;
    onAreaChange(area);
    resetOfficePageScroll();
  }

  return (
    <div className="space-y-atlas-4">
      <nav aria-label="Workforce areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {WORKFORCE_WORKSPACE_AREAS.map((area) => (
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
