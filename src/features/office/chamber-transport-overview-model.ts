import type {
  TransportGroupAssignment,
  TransportWeeklyEarningDetail,
  TransportWorker,
} from "../transport/types.ts";
import { formatDateOnly } from "../../lib/formatting.ts";
import { isLocalDate } from "../../lib/local-date.ts";

export type TransportWorkerLifecycleFilter = "all" | "active" | "inactive";

export type TransportWorkerGroupMembership = {
  id: string;
  name: string;
  isActive: boolean;
};

export function groupTransportMembershipsByWorker(
  assignments: readonly TransportGroupAssignment[],
): ReadonlyMap<string, readonly TransportWorkerGroupMembership[]> {
  const memberships = new Map<string, TransportWorkerGroupMembership[]>();

  for (const assignment of assignments) {
    const workerMemberships = memberships.get(assignment.transportWorkerId) ?? [];
    if (!workerMemberships.some((group) => group.id === assignment.transportGroupId)) {
      workerMemberships.push({
        id: assignment.transportGroupId,
        name: assignment.transportGroupName,
        isActive: assignment.transportGroupIsActive,
      });
      workerMemberships.sort((left, right) =>
        left.name.localeCompare(right.name, "en-IN") || left.id.localeCompare(right.id),
      );
    }
    memberships.set(assignment.transportWorkerId, workerMemberships);
  }

  return memberships;
}

export function sumTransportEarningsByWorker(
  details: readonly TransportWeeklyEarningDetail[],
): ReadonlyMap<string, number> {
  const earnings = new Map<string, number>();
  for (const detail of details) {
    earnings.set(
      detail.transportWorkerId,
      (earnings.get(detail.transportWorkerId) ?? 0) + detail.workerDailyShareSnapshot,
    );
  }
  return earnings;
}

export function filterTransportOverviewWorkers({
  workers,
  memberships,
  lifecycle,
  search,
}: Readonly<{
  workers: readonly TransportWorker[];
  memberships: ReadonlyMap<string, readonly TransportWorkerGroupMembership[]>;
  lifecycle: TransportWorkerLifecycleFilter;
  search: string;
}>): TransportWorker[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("en-IN");
  return workers.filter((worker) => {
    if (lifecycle === "active" && !worker.isActive) return false;
    if (lifecycle === "inactive" && worker.isActive) return false;
    if (!normalizedSearch) return true;

    return [
      worker.name,
      ...(memberships.get(worker.id) ?? []).map((group) => group.name),
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedSearch));
  });
}

export function formatTransportWorkerLastPaid(
  paymentDate: string | null,
  localToday: string,
): string {
  if (paymentDate === null) return "No payments yet";
  if (!isLocalDate(paymentDate) || !isLocalDate(localToday)) {
    return "Payment date unavailable";
  }

  const dayDifference = toUtcDay(localToday) - toUtcDay(paymentDate);
  if (dayDifference === 0) return "Last paid today";
  if (dayDifference > 0 && dayDifference <= 5) {
    return `Last paid ${dayDifference} ${dayDifference === 1 ? "day" : "days"} ago`;
  }

  return `Last paid ${formatDateOnly(paymentDate)}`;
}

function toUtcDay(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
