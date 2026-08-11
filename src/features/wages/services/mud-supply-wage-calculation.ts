import { getActiveRate, type WageRate } from "./wage-rate-service.ts";

export function getActiveMudSupplyRate(rates: WageRate[], weekStart: string): WageRate {
  return getActiveRate(rates, "mud_supply", weekStart);
}

export function calculateMudSupplyGroupWage(quantity: number, ratePer1000Bricks: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be greater than or equal to zero.");
  }
  if (!Number.isFinite(ratePer1000Bricks) || ratePer1000Bricks <= 0) {
    throw new Error("Mud-supply rate per 1,000 bricks must be greater than zero.");
  }

  return (quantity / 1000) * ratePer1000Bricks;
}

export function calculateInformationalPerMemberShare(groupEarning: number, memberCount: number): number {
  if (!Number.isFinite(groupEarning) || groupEarning < 0) {
    throw new Error("Group earning must be greater than or equal to zero.");
  }
  if (!Number.isInteger(memberCount) || memberCount <= 0) {
    throw new Error("Member count must be a positive integer.");
  }

  return groupEarning / memberCount;
}
