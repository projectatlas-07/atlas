"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  OFFICE_COSTS_OUTGOINGS_AREAS,
  type OfficeCostsOutgoingsAreaId,
} from "@/features/office/office-navigation";

export function CostsOutgoingsOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: OfficeCostsOutgoingsAreaId;
  onAreaChange: (area: OfficeCostsOutgoingsAreaId) => void;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-atlas-3">
      <nav aria-label="Costs and Outgoings areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {OFFICE_COSTS_OUTGOINGS_AREAS.map((area) => (
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
