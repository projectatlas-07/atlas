"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  OFFICE_VEHICLE_MAINTENANCE_AREAS,
  type OfficeVehicleMaintenanceAreaId,
} from "@/features/office/office-navigation";

export function VehicleMaintenanceOfficeWorkspace({
  activeArea,
  onAreaChange,
  children,
}: Readonly<{
  activeArea: OfficeVehicleMaintenanceAreaId;
  onAreaChange: (area: OfficeVehicleMaintenanceAreaId) => void;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-atlas-3">
      <nav aria-label="Vehicle Maintenance areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {OFFICE_VEHICLE_MAINTENANCE_AREAS.map((area) => (
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
