import { supabase } from "../../../lib/supabase/client.ts";
import {
  getMondayWageWeekStart,
  isWageEarningsDateRange,
  type WageEarningsDateRange,
} from "../wage-earnings-date-range.ts";
import {
  calculateMudSupplyGroupWage,
  getActiveMudSupplyRate,
} from "./mud-supply-wage-calculation.ts";
import type { WageRate } from "./wage-rate-service.ts";

export type MudSupplyRangeProductionEntry = {
  productionDate: string;
  quantity: number;
};

export type MudSupplyRangeDay = {
  productionDate: string;
  weekStart: string;
  quantity: number;
  ratePer1000Bricks: number;
  earned: number;
};

export type MudSupplyRangeSummary = {
  rangeProduction: number;
  rangeEarned: number;
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
}: Readonly<{
  entries: readonly MudSupplyRangeProductionEntry[];
  wageRates: readonly WageRate[];
}>): MudSupplyRangeSummary {
  const quantityByDate = new Map<string, number>();
  for (const entry of entries) {
    quantityByDate.set(
      entry.productionDate,
      (quantityByDate.get(entry.productionDate) ?? 0) + entry.quantity,
    );
  }

  const days = [...quantityByDate]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([productionDate, quantity]) => {
      const weekStart = getMondayWageWeekStart(productionDate);
      if (!weekStart) throw new Error(`Invalid Production work date ${productionDate}.`);
      const rate = getActiveMudSupplyRate([...wageRates], weekStart);
      return {
        productionDate,
        weekStart,
        quantity,
        ratePer1000Bricks: rate.rate_per_1000_bricks,
        earned: calculateMudSupplyGroupWage(quantity, rate.rate_per_1000_bricks),
      };
    });

  return {
    rangeProduction: days.reduce((total, day) => total + day.quantity, 0),
    rangeEarned: days.reduce((total, day) => total + day.earned, 0),
    days,
  };
}
