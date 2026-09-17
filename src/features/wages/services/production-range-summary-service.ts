import { supabase } from "../../../lib/supabase/client.ts";
import type { WageEarningsDateRange } from "../wage-earnings-date-range.ts";
import { isWageEarningsDateRange } from "../wage-earnings-date-range.ts";
import { calculateProductionWage } from "./production-wage-calculation.ts";
import {
  getCurrentLabourerProductionWageRate,
  type ProductionWageRate,
} from "./production-wage-rate-read-service.ts";

export type ProductionRangeEntry = {
  productionDate: string;
  quantity: number;
};

export type ProductionRangeDay = {
  productionDate: string;
  quantity: number;
  ratePer1000Bricks: number;
  rateSource: "direct_labourer";
  earned: number;
};

export type ProductionRangeRatePeriod = {
  productionWageRateId: string;
  ratePer1000Bricks: number;
  fromDate: string;
  toDate: string;
};

export type ProductionRangeSummary = {
  rangeProduction: number;
  rangeEarned: number;
  ratePeriods: ProductionRangeRatePeriod[];
  days: ProductionRangeDay[];
};

type ProductionRangeEntryRow = {
  production_date: string;
  quantity: number;
};

export async function listLabourerProductionEntriesForRange({
  factoryId,
  labourerId,
  range,
}: Readonly<{
  factoryId: string;
  labourerId: string;
  range: WageEarningsDateRange;
}>): Promise<ProductionRangeEntry[]> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!labourerId) throw new Error("Labourer is required.");
  if (!isWageEarningsDateRange(range)) throw new Error("A valid inclusive date range is required.");

  const { data, error } = await supabase
    .from("production_entries")
    .select("production_date, quantity")
    .eq("factory_id", factoryId)
    .eq("labourer_id", labourerId)
    .gte("production_date", range.fromDate)
    .lte("production_date", range.toDate)
    .order("production_date", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductionRangeEntryRow[]).map((entry) => ({
    productionDate: entry.production_date,
    quantity: entry.quantity,
  }));
}

export function calculateProductionRangeSummary({
  labourerId,
  entries,
  wageRates,
  range,
}: Readonly<{
  labourerId: string;
  entries: readonly ProductionRangeEntry[];
  wageRates: readonly ProductionWageRate[];
  range: WageEarningsDateRange;
}>): ProductionRangeSummary {
  if (!labourerId) throw new Error("Labourer is required.");
  if (!isWageEarningsDateRange(range)) throw new Error("A valid inclusive date range is required.");
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
      const directRate = getCurrentLabourerProductionWageRate(
        wageRates,
        labourerId,
        productionDate,
      );
      if (!directRate) {
        throw new Error(`Rate not set for this labourer on ${productionDate}.`);
      }
      return {
        productionDate,
        quantity,
        ratePer1000Bricks: directRate.ratePer1000Bricks,
        rateSource: "direct_labourer" as const,
        earned: calculateProductionWage(quantity, directRate.ratePer1000Bricks),
      };
    });

  const usedRateIds = new Set<string>();
  const ratePeriods = days.flatMap((day) => {
    const directRate = getCurrentLabourerProductionWageRate(
      wageRates,
      labourerId,
      day.productionDate,
    );
    if (!directRate || usedRateIds.has(directRate.id)) return [];
    usedRateIds.add(directRate.id);
    return [{
      productionWageRateId: directRate.id,
      ratePer1000Bricks: directRate.ratePer1000Bricks,
      fromDate: directRate.effectiveFrom > range.fromDate ? directRate.effectiveFrom : range.fromDate,
      toDate: directRate.effectiveTo !== null && directRate.effectiveTo < range.toDate
        ? directRate.effectiveTo
        : range.toDate,
    }];
  }).sort((left, right) => left.fromDate.localeCompare(right.fromDate));

  return {
    rangeProduction: days.reduce((total, day) => total + day.quantity, 0),
    rangeEarned: days.reduce((total, day) => total + day.earned, 0),
    ratePeriods,
    days,
  };
}
