import { isLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";
import { isWageEarningsDateRange, type WageEarningsDateRange } from "../wage-earnings-date-range.ts";

export type MudGroupDailyAllocation = {
  labourGroupId: string;
  memberCount: number;
  totalActiveMembers: number;
  eligibleFactoryProduction: number;
  allocatedProduction: number;
  mudGroupRateId: string;
  ratePer1000Bricks: number;
  earnedAmount: number;
};

type MudGroupDailyAllocationRow = {
  labour_group_id: string;
  member_count: number;
  total_active_members: number;
  eligible_factory_production: number;
  allocated_production: number;
  mud_group_rate_id: string;
  rate_per_1000_bricks: number;
  earned_amount: number;
};

type MudGroupRangeAllocationRow = MudGroupDailyAllocationRow & {
  production_date: string;
};

export type MudGroupRangeAllocation = {
  rangeProduction: number;
  groups: Array<{
    labourGroupId: string;
    allocatedProduction: number;
    earnedAmount: number;
    informationalPerMemberEarned: number;
  }>;
  days: Array<{
    productionDate: string;
    eligibleFactoryProduction: number;
    allocatedProduction: number;
  }>;
};

export async function getMudGroupDailyAllocation({
  factoryId,
  productionDate,
}: Readonly<{
  factoryId: string;
  productionDate: string;
}>): Promise<MudGroupDailyAllocation[]> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!isLocalDate(productionDate)) throw new Error("Production date must be a valid date.");

  const { data, error } = await supabase.rpc("get_mud_group_daily_allocation", {
    p_factory_id: factoryId,
    p_production_date: productionDate,
  });
  if (error) throw new Error(error.message);

  return ((data ?? []) as MudGroupDailyAllocationRow[]).map((row) => ({
    labourGroupId: row.labour_group_id,
    memberCount: row.member_count,
    totalActiveMembers: row.total_active_members,
    eligibleFactoryProduction: row.eligible_factory_production,
    allocatedProduction: row.allocated_production,
    mudGroupRateId: row.mud_group_rate_id,
    ratePer1000Bricks: row.rate_per_1000_bricks,
    earnedAmount: row.earned_amount,
  }));
}

export async function getMudGroupRangeAllocation({
  factoryId,
  range,
}: Readonly<{
  factoryId: string;
  range: WageEarningsDateRange;
}>): Promise<MudGroupRangeAllocation> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!isWageEarningsDateRange(range)) throw new Error("A valid inclusive date range is required.");
  const { data, error } = await supabase.rpc("get_mud_group_range_allocation", {
    p_factory_id: factoryId,
    p_from_date: range.fromDate,
    p_to_date: range.toDate,
  });
  if (error) throw new Error(error.message);

  const groups = new Map<string, MudGroupRangeAllocation["groups"][number]>();
  const days = new Map<string, MudGroupRangeAllocation["days"][number]>();
  for (const row of (data ?? []) as MudGroupRangeAllocationRow[]) {
    const group = groups.get(row.labour_group_id) ?? {
      labourGroupId: row.labour_group_id,
      allocatedProduction: 0,
      earnedAmount: 0,
      informationalPerMemberEarned: 0,
    };
    group.allocatedProduction += row.allocated_production;
    group.earnedAmount += row.earned_amount;
    group.informationalPerMemberEarned += row.earned_amount / row.member_count;
    groups.set(row.labour_group_id, group);

    const day = days.get(row.production_date) ?? {
      productionDate: row.production_date,
      eligibleFactoryProduction: row.eligible_factory_production,
      allocatedProduction: 0,
    };
    if (day.eligibleFactoryProduction !== row.eligible_factory_production) {
      throw new Error(`Inconsistent eligible Production for ${row.production_date}.`);
    }
    day.allocatedProduction += row.allocated_production;
    days.set(row.production_date, day);
  }
  for (const day of days.values()) {
    if (day.allocatedProduction !== day.eligibleFactoryProduction) {
      throw new Error(`Mud group allocations do not equal eligible Production for ${day.productionDate}.`);
    }
  }

  const orderedDays = [...days.values()].sort((left, right) => left.productionDate.localeCompare(right.productionDate));
  return {
    rangeProduction: orderedDays.reduce((total, day) => total + day.eligibleFactoryProduction, 0),
    groups: [...groups.values()].sort((left, right) => left.labourGroupId.localeCompare(right.labourGroupId)),
    days: orderedDays,
  };
}
