import { supabase } from "../../../lib/supabase/client.ts";

export type LabourGroup = {
  groupId: string;
  factoryId: string;
  name: string;
  memberNames: string | null;
  memberCount: number | null;
  isActive: boolean;
  createdAt: string;
};

export async function getLabourGroups(factoryId: string): Promise<LabourGroup[]> {
  const { data, error } = await supabase
    .from("labour_groups")
    .select("id, factory_id, name, member_names, member_count, is_active, created_at")
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((group) => ({
    groupId: group.id,
    factoryId: group.factory_id,
    name: group.name,
    memberNames: group.member_names,
    memberCount: group.member_count,
    isActive: group.is_active,
    createdAt: group.created_at,
  }));
}
