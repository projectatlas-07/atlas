"use client";

import { useQuery } from "@tanstack/react-query";
import { dashboardSnapshotQueryOptions } from "../dashboard-query";
import { DashboardView } from "./dashboard-view";

export interface DashboardContainerProps {
  factoryId: string;
  dateFrom: string;
  dateTo: string;
}

export function DashboardContainer({
  factoryId,
  dateFrom,
  dateTo,
}: Readonly<DashboardContainerProps>) {
  const snapshotQuery = useQuery(
    dashboardSnapshotQueryOptions(factoryId, dateFrom, dateTo),
  );

  if (snapshotQuery.isLoading) {
    return (
      <section aria-label="Dashboard" aria-busy="true" className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-600">Loading Dashboard...</p>
      </section>
    );
  }

  if (snapshotQuery.error || !snapshotQuery.data) {
    return (
      <section role="alert" aria-label="Dashboard unavailable" className="rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center">
        <p className="font-semibold text-red-800">Dashboard could not be loaded.</p>
        <p className="mt-1 text-sm text-red-700">Change the selected period or reopen this screen to try again.</p>
      </section>
    );
  }

  return <DashboardView snapshot={snapshotQuery.data} />;
}
