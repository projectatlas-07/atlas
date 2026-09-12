import { supabase } from "../../../lib/supabase/client.ts";
import type { WageEarningsDateRange } from "../wage-earnings-date-range.ts";
import { isWageEarningsDateRange } from "../wage-earnings-date-range.ts";
import type { ProductionCrewAssignment } from "./production-crew-assignment-service.ts";
import { getCurrentProductionCrewAssignment } from "./production-crew-service.ts";
import { calculateProductionWage } from "./production-wage-calculation.ts";
import {
  getCurrentCrewProductionWageRate,
  getCurrentLabourerProductionWageRateOverride,
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
  rateSource: "individual_override" | "crew_default";
  productionCrewId: string | null;
  earned: number;
};

export type ProductionRangeSummary = {
  rangeProduction: number;
  rangeEarned: number;
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
  crewAssignments,
  wageRates,
}: Readonly<{
  labourerId: string;
  entries: readonly ProductionRangeEntry[];
  crewAssignments: readonly ProductionCrewAssignment[];
  wageRates: readonly ProductionWageRate[];
}>): ProductionRangeSummary {
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
      const override = getCurrentLabourerProductionWageRateOverride(
        wageRates,
        labourerId,
        productionDate,
      );
      if (override) {
        return {
          productionDate,
          quantity,
          ratePer1000Bricks: override.ratePer1000Bricks,
          rateSource: "individual_override" as const,
          productionCrewId: null,
          earned: calculateProductionWage(quantity, override.ratePer1000Bricks),
        };
      }

      const assignment = getCurrentProductionCrewAssignment(
        crewAssignments,
        labourerId,
        productionDate,
      );
      if (!assignment) {
        throw new Error(`No production crew assignment applies to this labourer on ${productionDate}.`);
      }

      const crewRate = getCurrentCrewProductionWageRate(
        wageRates,
        assignment.productionCrewId,
        productionDate,
      );
      if (!crewRate) {
        throw new Error(`No crew-default production rate applies on ${productionDate}.`);
      }

      return {
        productionDate,
        quantity,
        ratePer1000Bricks: crewRate.ratePer1000Bricks,
        rateSource: "crew_default" as const,
        productionCrewId: assignment.productionCrewId,
        earned: calculateProductionWage(quantity, crewRate.ratePer1000Bricks),
      };
    });

  return {
    rangeProduction: days.reduce((total, day) => total + day.quantity, 0),
    rangeEarned: days.reduce((total, day) => total + day.earned, 0),
    days,
  };
}
