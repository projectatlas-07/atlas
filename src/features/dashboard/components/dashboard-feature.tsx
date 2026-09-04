"use client";

import { useState } from "react";
import {
  getTodayDashboardRange,
  type DashboardDateMode,
  type DashboardDateRange,
} from "../dashboard-date-model";
import { DashboardContainer } from "./dashboard-container";
import { DashboardDateControls } from "./dashboard-date-controls";

export interface DashboardFeatureProps {
  factoryId: string;
}

export function DashboardFeature({ factoryId }: Readonly<DashboardFeatureProps>) {
  const [selection, setSelection] = useState<{
    mode: DashboardDateMode;
    range: DashboardDateRange;
  }>(() => ({ mode: "today", range: getTodayDashboardRange() }));

  function handleDateChange(mode: DashboardDateMode, range: DashboardDateRange) {
    setSelection({ mode, range });
  }

  return (
    <div className="space-y-6">
      <DashboardDateControls
        mode={selection.mode}
        range={selection.range}
        onChange={handleDateChange}
      />
      <DashboardContainer
        factoryId={factoryId}
        dateFrom={selection.range.dateFrom}
        dateTo={selection.range.dateTo}
      />
    </div>
  );
}
