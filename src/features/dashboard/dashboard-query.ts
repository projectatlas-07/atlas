import { getDashboardSnapshot } from "./services/dashboard-service.ts";

export function dashboardSnapshotQueryOptions(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
) {
  return {
    queryKey: ["dashboard-snapshot", factoryId, dateFrom, dateTo] as const,
    queryFn: () => getDashboardSnapshot(factoryId, dateFrom, dateTo),
  };
}
