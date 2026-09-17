import type { PostgrestError } from "@supabase/supabase-js";
import { getLocalDate, isLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";

export type MudAccountingMode = "LEGACY_WEEKLY" | "SHADOW" | "SETTLEMENT";

export type MudGroupConfiguration = {
  groupId: string;
  name: string;
  currentMemberCount: number | null;
  currentRatePer1000Bricks: number | null;
  isEarning: boolean;
  currentTermId: string | null;
  currentRateId: string | null;
  accountingMode: MudAccountingMode;
};

type MudGroupConfigurationRow = {
  labour_group_id: string;
  group_name: string;
  current_member_count: number | null;
  current_rate_per_1000_bricks: number | null;
  is_earning: boolean;
  current_term_id: string | null;
  current_rate_id: string | null;
  accounting_mode: MudAccountingMode;
};

export class MudGroupConfigurationError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "MudGroupConfigurationError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function requiredFactory(factoryId: string) {
  if (!factoryId) throw new Error("Factory is required.");
}

function requiredGroup(groupId: string) {
  if (!groupId) throw new Error("Mud group is required.");
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function positiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function validDate(value: string, label: string) {
  if (!isLocalDate(value)) throw new Error(`${label} must be a valid date.`);
}

export async function listMudGroupConfigurations({
  factoryId,
  asOfDate = getLocalDate(),
}: Readonly<{
  factoryId: string;
  asOfDate?: string;
}>): Promise<MudGroupConfiguration[]> {
  requiredFactory(factoryId);
  validDate(asOfDate, "As-of date");
  const { data, error } = await supabase.rpc("get_mud_group_configuration", {
    p_factory_id: factoryId,
    p_as_of_date: asOfDate,
  });
  if (error) throw new MudGroupConfigurationError(error);
  return ((data ?? []) as MudGroupConfigurationRow[]).map((row) => ({
    groupId: row.labour_group_id,
    name: row.group_name,
    currentMemberCount: row.current_member_count,
    currentRatePer1000Bricks: row.current_rate_per_1000_bricks,
    isEarning: row.is_earning,
    currentTermId: row.current_term_id,
    currentRateId: row.current_rate_id,
    accountingMode: row.accounting_mode,
  }));
}

export async function getMudAccountingMode(factoryId: string): Promise<MudAccountingMode> {
  requiredFactory(factoryId);
  const { data, error } = await supabase
    .from("mud_accounting_states")
    .select("accounting_mode")
    .eq("factory_id", factoryId)
    .single();
  if (error) throw new MudGroupConfigurationError(error);
  return data.accounting_mode;
}

export async function createMudGroup({
  factoryId,
  name,
  memberCount,
  earningStartDate = getLocalDate(),
  initialRate,
  rateEffectiveDate,
}: Readonly<{
  factoryId: string;
  name: string;
  memberCount: number;
  earningStartDate?: string;
  initialRate: number;
  rateEffectiveDate?: string;
}>): Promise<string> {
  requiredFactory(factoryId);
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Mud group name is required.");
  positiveInteger(memberCount, "Member count");
  positiveNumber(initialRate, "Initial rate");
  validDate(earningStartDate, "Earning start date");
  const resolvedRateDate = rateEffectiveDate ?? earningStartDate;
  validDate(resolvedRateDate, "Rate effective date");
  if (resolvedRateDate > earningStartDate) {
    throw new Error("Initial rate must cover the first earning date.");
  }
  const { data, error } = await supabase.rpc("create_mud_group", {
    p_factory_id: factoryId,
    p_name: trimmedName,
    p_member_count: memberCount,
    p_earning_start_date: earningStartDate,
    p_initial_rate: initialRate,
    p_rate_effective_date: resolvedRateDate,
  });
  if (error) throw new MudGroupConfigurationError(error);
  if (!data) throw new Error("create_mud_group returned no group.");
  return data;
}

export async function editMudGroupMembers({
  factoryId,
  groupId,
  memberCount,
  effectiveFrom,
}: Readonly<{
  factoryId: string;
  groupId: string;
  memberCount: number;
  effectiveFrom: string;
}>): Promise<string> {
  requiredFactory(factoryId);
  requiredGroup(groupId);
  positiveInteger(memberCount, "Member count");
  validDate(effectiveFrom, "Effective-from date");
  const { data, error } = await supabase.rpc("set_mud_group_member_count", {
    p_factory_id: factoryId,
    p_labour_group_id: groupId,
    p_member_count: memberCount,
    p_effective_from: effectiveFrom,
  });
  if (error) throw new MudGroupConfigurationError(error);
  if (!data) throw new Error("set_mud_group_member_count returned no term.");
  return data;
}

export async function setMudGroupRate({
  factoryId,
  groupId,
  ratePer1000Bricks,
  effectiveFrom,
}: Readonly<{
  factoryId: string;
  groupId: string;
  ratePer1000Bricks: number;
  effectiveFrom: string;
}>): Promise<string> {
  requiredFactory(factoryId);
  requiredGroup(groupId);
  positiveNumber(ratePer1000Bricks, "Rate per 1,000 bricks");
  validDate(effectiveFrom, "Effective-from date");
  const { data, error } = await supabase.rpc("set_mud_group_rate", {
    p_factory_id: factoryId,
    p_labour_group_id: groupId,
    p_rate_per_1000_bricks: ratePer1000Bricks,
    p_effective_from: effectiveFrom,
  });
  if (error) throw new MudGroupConfigurationError(error);
  if (!data) throw new Error("set_mud_group_rate returned no rate.");
  return data;
}

export async function stopMudGroupEarning({
  factoryId,
  groupId,
  stopDate,
}: Readonly<{
  factoryId: string;
  groupId: string;
  stopDate: string;
}>): Promise<string> {
  requiredFactory(factoryId);
  requiredGroup(groupId);
  validDate(stopDate, "Stop date");
  const { data, error } = await supabase.rpc("stop_mud_group_earning", {
    p_factory_id: factoryId,
    p_labour_group_id: groupId,
    p_stop_date: stopDate,
  });
  if (error) throw new MudGroupConfigurationError(error);
  if (!data) throw new Error("stop_mud_group_earning returned no term.");
  return data;
}

export async function restartMudGroupEarning({
  factoryId,
  groupId,
  memberCount,
  restartDate,
}: Readonly<{
  factoryId: string;
  groupId: string;
  memberCount: number;
  restartDate: string;
}>): Promise<string> {
  requiredFactory(factoryId);
  requiredGroup(groupId);
  positiveInteger(memberCount, "Member count");
  validDate(restartDate, "Restart date");
  const { data, error } = await supabase.rpc("restart_mud_group_earning", {
    p_factory_id: factoryId,
    p_labour_group_id: groupId,
    p_member_count: memberCount,
    p_restart_date: restartDate,
  });
  if (error) throw new MudGroupConfigurationError(error);
  if (!data) throw new Error("restart_mud_group_earning returned no term.");
  return data;
}
