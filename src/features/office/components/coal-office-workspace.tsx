"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  OFFICE_COAL_AREAS,
  type OfficeCoalAreaId,
} from "@/features/office/office-navigation";

export function CoalOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: OfficeCoalAreaId;
  onAreaChange: (area: OfficeCoalAreaId) => void;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-atlas-3">
      <nav aria-label="Coal areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {OFFICE_COAL_AREAS.map((area) => (
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
