import type {
  CalculateTransportWeeklyWagesInput,
  TransportWeeklyWageCalculationSummary,
} from "../transport/services/transport-weekly-wage-calculation-service.ts";
import type {
  TransportLockedWeeklyEarning,
  TransportWeeklyEarningDetail,
} from "../transport/types.ts";
import { assertCompletedWageWeek } from "../wages/services/completed-wage-week-validation.ts";
import { formatTransportDirection } from "./transport-office-model.ts";

export function buildTransportWeeklyCalculationInput({
  factoryId,
  weekStart,
  today,
}: Readonly<{
  factoryId: string;
  weekStart: string;
  today: string;
}>): CalculateTransportWeeklyWagesInput {
  if (!factoryId) throw new Error("Factory is required.");
  assertCompletedWageWeek(weekStart, today);
  return { factoryId, weekStart };
}

export type TransportWeeklyCalculationOutcome =
  | { status: "calculated"; message: string }
  | { status: "already_calculated"; message: string }
  | { status: "no_work"; message: string };

export function getTransportWeeklyCalculationOutcome(
  summary: TransportWeeklyWageCalculationSummary,
): TransportWeeklyCalculationOutcome {
  if (summary.rowsSkipped > 0) {
    return {
      status: "already_calculated",
      message: "Already calculated — this week remains locked.",
    };
  }
  if (summary.workersCalculated === 0 && summary.detailRowsCreated === 0) {
    return {
      status: "no_work",
      message: "No transport work was found for this week; no earnings were created.",
    };
  }
  const workerLabel = summary.workersCalculated === 1 ? "worker earning" : "worker earnings";
  const detailLabel = summary.detailRowsCreated === 1 ? "daily contribution" : "daily contributions";
  return {
    status: "calculated",
    message: `Calculated and locked ${summary.workersCalculated} ${workerLabel} with ${summary.detailRowsCreated} ${detailLabel}.`,
  };
}

export function getTransportWeekEnd(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const sunday = new Date(year, month - 1, day + 6);
  const sundayYear = sunday.getFullYear();
  const sundayMonth = String(sunday.getMonth() + 1).padStart(2, "0");
  const sundayDay = String(sunday.getDate()).padStart(2, "0");
  return `${sundayYear}-${sundayMonth}-${sundayDay}`;
}

export function formatTransportLockedCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  })}`;
}

export function formatTransportSnapshotNumber(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 20 });
}

export function buildTransportWeeklyEarningDisplay(
  earning: TransportLockedWeeklyEarning,
): {
  weeklyEarningId: string;
  workerLabel: string;
  totalAmount: string;
} {
  return {
    weeklyEarningId: earning.weeklyEarningId,
    workerLabel: `${earning.transportWorkerName}${earning.transportWorkerIsActive ? "" : " (Inactive)"}`,
    totalAmount: formatTransportLockedCurrency(earning.totalAmount),
  };
}

export function buildTransportWeeklyDetailDisplay(
  detail: TransportWeeklyEarningDetail,
): {
  detailId: string;
  workDate: string;
  crewLabel: string;
  paya: string;
  attendanceCount: string;
  ratePerPaya: string;
  dailyCrewPool: string;
  workerShare: string;
} {
  return {
    detailId: detail.detailId,
    workDate: detail.workDate,
    crewLabel: `${detail.transportCrewName} · ${formatTransportDirection(detail.transportCrewWorkDirection)}`,
    paya: formatTransportSnapshotNumber(detail.payaQuantitySnapshot),
    attendanceCount: String(detail.attendanceCountSnapshot),
    ratePerPaya: `${formatTransportLockedCurrency(detail.ratePerPayaSnapshot)} / paya`,
    dailyCrewPool: formatTransportLockedCurrency(detail.dailyCrewPoolSnapshot),
    workerShare: formatTransportLockedCurrency(detail.workerDailyShareSnapshot),
  };
}

export function transportWeeklySettlementErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Could not complete the weekly transport request.";
  }
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "P2601") return "A transport daily entry has zero attendance.";
  if (code === "P2602") return message || "A required transport crew rate is missing.";
  if (code === "P2603") return "Multiple transport crew rates apply to a work date; calculation was stopped.";
  if (code === "22023" || /finite monday|must be a monday/i.test(message)) {
    return "Choose a valid Monday week start.";
  }
  if (/not completed yet/i.test(message)) {
    return message;
  }
  if (code === "42501" || code === "401") {
    return "You do not have access to transport earnings for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || "Could not complete the weekly transport request.";
}
