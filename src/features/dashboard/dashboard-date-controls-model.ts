import {
  getCustomDashboardRange,
  getSingleDateDashboardRange,
  getTodayDashboardRange,
  type DashboardDateMode,
  type DashboardDateRange,
} from "./dashboard-date-model.ts";

export function resolveDashboardDateSelection(
  mode: DashboardDateMode,
  draft: DashboardDateRange,
): { range: DashboardDateRange | null; error: string | null } {
  try {
    if (mode === "today") return { range: getTodayDashboardRange(), error: null };
    if (!draft.dateFrom || (mode === "range" && !draft.dateTo)) {
      return { range: null, error: null };
    }
    const range = mode === "single-date"
      ? getSingleDateDashboardRange(draft.dateFrom)
      : getCustomDashboardRange(draft.dateFrom, draft.dateTo);
    return { range, error: null };
  } catch (error) {
    return {
      range: null,
      error: error instanceof Error && error.message === "dateFrom must not be after dateTo."
        ? "From date cannot be after To date."
        : "Choose a valid date for each field.",
    };
  }
}
