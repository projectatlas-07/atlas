import { supabase } from "../../../lib/supabase/client.ts";
import {
  isWageEarningsDateRange,
  type WageEarningsDateRange,
} from "../wage-earnings-date-range.ts";
import { isLocalDate, shiftLocalDate } from "../../../lib/local-date.ts";
import {
  calculateMudSupplyGroupWage,
} from "./mud-supply-wage-calculation.ts";
import type { WageRate } from "./wage-rate-service.ts";

export type MudSupplyRangeProductionEntry = {
  productionDate: string;
  quantity: number;
};

export type MudSupplyRangeDay = {
  productionDate: string;
  quantity: number;
  ratePer1000Bricks: number;
  earned: number;
};

export type MudSupplyRangeRatePeriod = {
  wageRateId: string;
  ratePer1000Bricks: number;
  fromDate: string;
  toDate: string;
};

export type MudSupplyRangeSummary = {
  rangeProduction: number;
  rangeEarned: number;
  ratePeriods: MudSupplyRangeRatePeriod[];
  days: MudSupplyRangeDay[];
};

type MudSupplyRangeProductionRow = {
  production_date: string;
  quantity: number;
};

export async function listMudSupplyProductionForRange({
  factoryId,
  range,
}: Readonly<{
  factoryId: string;
  range: WageEarningsDateRange;
}>): Promise<MudSupplyRangeProductionEntry[]> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!isWageEarningsDateRange(range)) throw new Error("A valid inclusive date range is required.");

  const { data, error } = await supabase
    .from("production_entries")
    .select("production_date, quantity")
    .eq("factory_id", factoryId)
    .gte("production_date", range.fromDate)
    .lte("production_date", range.toDate)
    .order("production_date", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as MudSupplyRangeProductionRow[]).map((entry) => ({
    productionDate: entry.production_date,
    quantity: entry.quantity,
  }));
}

export function calculateMudSupplyRangeSummary({
  entries,
  wageRates,
  range,
}: Readonly<{
  entries: readonly MudSupplyRangeProductionEntry[];
  wageRates: readonly WageRate[];
  range: WageEarningsDateRange;
}>): MudSupplyRangeSummary {
  if (!isWageEarningsDateRange(range)) throw new Error("A valid inclusive date range is required.");
  const quantityByDate = new Map<string, number>();
  for (const entry of entries) {
    if (!isLocalDate(entry.productionDate)
      || entry.productionDate < range.fromDate
      || entry.productionDate > range.toDate) {
      throw new Error(`Production date ${entry.productionDate} is outside the selected range.`);
    }
    if (!Number.isFinite(entry.quantity) || entry.quantity < 0) {
      throw new Error(`Invalid Production quantity for ${entry.productionDate}.`);
    }
    quantityByDate.set(
      entry.productionDate,
      (quantityByDate.get(entry.productionDate) ?? 0) + entry.quantity,
    );
  }

  const days = [...quantityByDate]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([productionDate, quantity]) => {
      const rate = getActiveMudSupplyRateForDate(wageRates, productionDate);
      return {
        productionDate,
        quantity,
        ratePer1000Bricks: rate.rate_per_1000_bricks,
        earned: calculateMudSupplyGroupWage(quantity, rate.rate_per_1000_bricks),
      };
    });

  return {
    rangeProduction: days.reduce((total, day) => total + day.quantity, 0),
    rangeEarned: days.reduce((total, day) => total + day.earned, 0),
    ratePeriods: getMudSupplyRatePeriods(wageRates, range),
    days,
  };
}

export function getActiveMudSupplyRateForDate(
  rates: readonly WageRate[],
  productionDate: string,
): WageRate {
  if (!isLocalDate(productionDate)) {
    throw new Error(`Invalid Production date ${productionDate}.`);
  }
  const applicableRates = rates.filter((rate) => (
    rate.applies_to === "mud_supply"
    && rate.effective_from <= productionDate
    && (rate.effective_to === null || rate.effective_to >= productionDate)
  ));
  if (applicableRates.length === 0) {
    throw new Error(`Mud rate not set for ${productionDate}.`);
  }
  if (applicableRates.length > 1) {
    throw new Error(`Overlapping Mud rates apply on ${productionDate}.`);
  }
  return applicableRates[0];
}

function getMudSupplyRatePeriods(
  rates: readonly WageRate[],
  range: WageEarningsDateRange,
): MudSupplyRangeRatePeriod[] {
  const boundaries = new Set<string>([range.fromDate]);
  for (const rate of rates) {
    if (rate.applies_to !== "mud_supply") continue;
    if (rate.effective_from > range.fromDate && rate.effective_from <= range.toDate) {
      boundaries.add(rate.effective_from);
    }
    if (rate.effective_to !== null) {
      const dayAfterRate = shiftLocalDate(rate.effective_to, 1);
      if (dayAfterRate && dayAfterRate > range.fromDate && dayAfterRate <= range.toDate) {
        boundaries.add(dayAfterRate);
      }
    }
  }

  const orderedBoundaries = [...boundaries].sort();
  return orderedBoundaries.map((fromDate, index) => {
    const nextBoundary = orderedBoundaries[index + 1];
    const toDate = nextBoundary ? shiftLocalDate(nextBoundary, -1)! : range.toDate;
    const rate = getActiveMudSupplyRateForDate(rates, fromDate);
    return {
      wageRateId: rate.id,
      ratePer1000Bricks: rate.rate_per_1000_bricks,
      fromDate,
      toDate,
    };
  });
}
