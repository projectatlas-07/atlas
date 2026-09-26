"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Feedback } from "../../../components/ui/feedback";
import { ATLAS_UI_STRINGS } from "../../../lib/strings";
import { ownerDashboardQueryOptions } from "../dashboard-query";
import { DashboardView } from "./dashboard-view";

export interface DashboardContainerProps {
  factoryId: string;
  businessDate: string;
  weekStart: string;
}

export function DashboardContainer({
  factoryId,
  businessDate,
  weekStart,
}: Readonly<DashboardContainerProps>) {
  const snapshotQuery = useQuery(
    ownerDashboardQueryOptions(factoryId, businessDate, weekStart),
  );

  if (snapshotQuery.isLoading) {
    return <Feedback aria-label="Dashboard" aria-busy="true" role="status" tone="neutral">Loading Dashboard...</Feedback>;
  }

  if (snapshotQuery.error || !snapshotQuery.data) {
    return (
      <Feedback role="alert" aria-label="Dashboard unavailable" tone="danger">
        <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block font-atlas-semibold">Dashboard could not be loaded.</span>
            <span className="mt-atlas-1 block">The existing module data is unavailable right now.</span>
          </span>
          <Button variant="secondary" onClick={() => { void snapshotQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
        </div>
      </Feedback>
    );
  }

  return <DashboardView snapshot={snapshotQuery.data} />;
}
