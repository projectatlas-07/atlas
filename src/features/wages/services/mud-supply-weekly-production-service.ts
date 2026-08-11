import { assertCompletedWageWeek } from "./completed-wage-week-validation.ts";
import { getProductionWageLabourers } from "./production-wage-labourer-service.ts";

export type GetMudSupplyWeeklyProductionInput = {
  factoryId: string;
  weekStart: string;
  today: string;
};

export async function getMudSupplyWeeklyProduction({
  factoryId,
  weekStart,
  today,
}: GetMudSupplyWeeklyProductionInput): Promise<number> {
  assertCompletedWageWeek(weekStart, today);

  const eligibleLabourers = await getProductionWageLabourers({ factoryId, weekStart });
  return eligibleLabourers.reduce((total, labourer) => total + labourer.quantity, 0);
}
