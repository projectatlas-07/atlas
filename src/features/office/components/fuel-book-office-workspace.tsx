"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  OFFICE_FUEL_BOOK_AREAS,
  type OfficeFuelBookAreaId,
} from "@/features/office/office-navigation";

export function FuelBookOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: OfficeFuelBookAreaId;
  onAreaChange: (area: OfficeFuelBookAreaId) => void;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-atlas-3">
      <nav aria-label="Fuel Book areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {OFFICE_FUEL_BOOK_AREAS.map((area) => (
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
