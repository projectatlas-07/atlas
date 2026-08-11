import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { LabourGroup } from "./labour-group-read-service.ts";

export type CreateLabourGroupInput = {
  factoryId: string;
  name: string;
  memberNames: string | null;
  memberCount: number;
};

export type SetLabourGroupActiveInput = {
  factoryId: string;
  groupId: string;
  isActive: boolean;
};

export class LabourGroupMutationError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "LabourGroupMutationError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function createLabourGroup({
  factoryId,
  name,
  memberNames,
  memberCount,
}: CreateLabourGroupInput): Promise<LabourGroup> {
  if (!Number.isInteger(memberCount) || memberCount <= 0) {
    throw new Error("Member count must be a positive integer.");
  }

  const { data, error } = await supabase
    .from("labour_groups")
    .insert({
      factory_id: factoryId,
      name,
      member_names: memberNames,
      member_count: memberCount,
    })
    .select("id, factory_id, name, member_names, member_count, is_active, created_at")
    .single();

  if (error) throw new LabourGroupMutationError(error);

  return {
    groupId: data.id,
    factoryId: data.factory_id,
    name: data.name,
    memberNames: data.member_names,
    memberCount: data.member_count,
    isActive: data.is_active,
    createdAt: data.created_at,
  };
}

export async function setLabourGroupActive({
  factoryId,
  groupId,
  isActive,
}: SetLabourGroupActiveInput): Promise<void> {
  const { data, error } = await supabase
    .from("labour_groups")
    .update({ is_active: isActive })
    .eq("id", groupId)
    .eq("factory_id", factoryId)
    .select("id");

  if (error) throw new LabourGroupMutationError(error);
  if (!data || data.length === 0) {
    throw new Error("Labour group was not updated.");
  }
  if (data.length !== 1) {
    throw new Error("Unexpected result: more than one labour group was updated.");
  }
}
