import {
  getDashboardSnapshot,
  getOwnerDashboardSnapshot,
} from "./services/dashboard-service.ts";

export function ownerDashboardQueryOptions(
  factoryId: string,
  businessDate: string,
  weekStart: string,
) {
  return {
    queryKey: ["owner-dashboard", factoryId, businessDate, weekStart] as const,
    queryFn: () => getOwnerDashboardSnapshot(factoryId, businessDate, weekStart),
  };
}

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
