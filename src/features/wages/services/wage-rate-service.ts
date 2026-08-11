export type WageRateAppliesTo = "production" | "mud_supply";

export type WageRate = {
  id: string;
  applies_to: WageRateAppliesTo;
  rate_per_1000_bricks: number;
  effective_from: string;
  effective_to: string | null;
};

export type WageRateHistory = WageRate & {
  factory_id: string;
  created_at: string;
};

export type WageRateResolutionFailure = "missing" | "overlapping";

export class WageRateResolutionError extends Error {
  readonly failure: WageRateResolutionFailure;

  constructor(
    failure: WageRateResolutionFailure,
    message: string,
  ) {
    super(message);
    this.name = "WageRateResolutionError";
    this.failure = failure;
  }
}

export function assertMondayWeekStart(weekStart: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);

  if (!match) {
    throw new Error(`Invalid week_start "${weekStart}". Use a valid YYYY-MM-DD Monday.`);
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const localDate = new Date(year, month - 1, day);

  if (
    localDate.getFullYear() !== year
    || localDate.getMonth() !== month - 1
    || localDate.getDate() !== day
    || localDate.getDay() !== 1
  ) {
    throw new Error(`Invalid week_start "${weekStart}". week_start must be a Monday.`);
  }
}

export function getActiveRate(
  rates: WageRate[],
  appliesTo: WageRateAppliesTo,
  weekStart: string,
): WageRate {
  assertMondayWeekStart(weekStart);

  const applicableRates = rates.filter((rate) => (
    rate.applies_to === appliesTo
    && rate.effective_from <= weekStart
    && (rate.effective_to === null || rate.effective_to >= weekStart)
  ));

  if (applicableRates.length === 0) {
    throw new WageRateResolutionError(
      "missing",
      `No ${appliesTo} wage rate applies to week starting ${weekStart}.`,
    );
  }

  if (applicableRates.length > 1) {
    throw new WageRateResolutionError(
      "overlapping",
      `Overlapping ${appliesTo} wage rates apply to week starting ${weekStart}.`,
    );
  }

  return applicableRates[0];
}

export type WageRateHistoryStatus = "current" | "future" | "historical";

export function getWageRateHistoryStatus(rate: WageRate, weekStart: string): WageRateHistoryStatus {
  try {
    getActiveRate([rate], rate.applies_to, weekStart);
    return "current";
  } catch (error) {
    if (!(error instanceof WageRateResolutionError) || error.failure !== "missing") throw error;
    return rate.effective_from > weekStart ? "future" : "historical";
  }
}
