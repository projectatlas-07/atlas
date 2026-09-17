import type { PostgrestError } from "@supabase/supabase-js";
import { isLocalDate, shiftLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";

export type MudSettlementAccount = {
  settledEarned: number;
  liveEarned: number;
  totalEarned: number;
  totalWithdrawn: number;
  availableBalance: number;
  latestSettlementCutoff: string;
};

export type CreatedMudSettlementWithdrawal = {
  withdrawalId: string;
  settlementId: string;
  previousCutoff: string;
  settledThrough: string;
  withdrawalDate: string;
  withdrawalAmount: number;
  settledEarned: number;
  totalWithdrawn: number;
  settledAvailableBalance: number;
  dailySnapshots: number;
  groupSnapshots: number;
  wasReplayed: boolean;
};

type MudSettlementAccountRow = {
  settled_earned: number;
  live_earned: number;
  total_earned: number;
  total_withdrawn: number;
  available_balance: number;
  latest_settlement_cutoff: string | null;
};

type MudSettlementWithdrawalRow = {
  withdrawal_id: string;
  settlement_id: string;
  previous_cutoff: string;
  settled_through: string;
  withdrawal_date: string;
  withdrawal_amount: number;
  settled_earned: number;
  total_withdrawn: number;
  settled_available_balance: number;
  daily_snapshots: number;
  group_snapshots: number;
  was_replayed: boolean;
};

const friendlyMessages: Readonly<Record<string, string>> = {
  P2902: "Settle production through cannot be earlier than the latest Mud settlement cutoff.",
  P3300: "Mud settlement accounting is not active for this factory.",
  P3301: "Settle production through must be before the withdrawal date.",
  P3302: "This Mud account is missing its cutover opening. Contact support before withdrawing.",
  P3303: "Withdrawal exceeds this group's earnings settled through the selected cutoff.",
  P3304: "This withdrawal request was already used with different details. Refresh and try again.",
};

export class MudSettlementAccountError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(friendlyMessages[error.code] ?? error.message);
    this.name = "MudSettlementAccountError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function getMudSettlementAccount({
  factoryId,
  labourGroupId,
  asOfDate,
}: Readonly<{
  factoryId: string;
  labourGroupId: string;
  asOfDate: string;
}>): Promise<MudSettlementAccount> {
  requiredIdentity(factoryId, labourGroupId);
  validDate(asOfDate, "As-of date");

  const { data, error } = await supabase.rpc("get_mud_group_settlement_account", {
    p_factory_id: factoryId,
    p_labour_group_id: labourGroupId,
    p_as_of_date: asOfDate,
  });
  if (error) throw new MudSettlementAccountError(error);

  const account = (data as MudSettlementAccountRow[] | null)?.[0];
  if (!account || !account.latest_settlement_cutoff) {
    throw new Error("Mud settlement account returned no cutover balance.");
  }
  return {
    settledEarned: Number(account.settled_earned),
    liveEarned: Number(account.live_earned),
    totalEarned: Number(account.total_earned),
    totalWithdrawn: Number(account.total_withdrawn),
    availableBalance: Number(account.available_balance),
    latestSettlementCutoff: account.latest_settlement_cutoff,
  };
}

export async function createMudSettlementWithdrawal({
  factoryId,
  withdrawalId,
  labourGroupId,
  withdrawalDate,
  settlementCutoff,
  amount,
}: Readonly<{
  factoryId: string;
  withdrawalId: string;
  labourGroupId: string;
  withdrawalDate: string;
  settlementCutoff: string;
  amount: number;
}>): Promise<CreatedMudSettlementWithdrawal> {
  requiredIdentity(factoryId, labourGroupId);
  if (!withdrawalId) throw new Error("Withdrawal identity is required.");
  validDate(withdrawalDate, "Withdrawal date");
  validDate(settlementCutoff, "Settle production through");
  if (settlementCutoff >= withdrawalDate) {
    throw new Error("Settle production through must be before the withdrawal date.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Withdrawal amount must be greater than zero.");
  }

  const { data, error } = await supabase.rpc("create_mud_settlement_withdrawal", {
    p_factory_id: factoryId,
    p_withdrawal_id: withdrawalId,
    p_labour_group_id: labourGroupId,
    p_withdrawal_date: withdrawalDate,
    p_settlement_cutoff: settlementCutoff,
    p_amount: amount,
  });
  if (error) throw new MudSettlementAccountError(error);

  const result = (data as MudSettlementWithdrawalRow[] | null)?.[0];
  if (!result) throw new Error("Mud settlement withdrawal returned no result.");
  return {
    withdrawalId: result.withdrawal_id,
    settlementId: result.settlement_id,
    previousCutoff: result.previous_cutoff,
    settledThrough: result.settled_through,
    withdrawalDate: result.withdrawal_date,
    withdrawalAmount: Number(result.withdrawal_amount),
    settledEarned: Number(result.settled_earned),
    totalWithdrawn: Number(result.total_withdrawn),
    settledAvailableBalance: Number(result.settled_available_balance),
    dailySnapshots: result.daily_snapshots,
    groupSnapshots: result.group_snapshots,
    wasReplayed: result.was_replayed,
  };
}

export function getDefaultMudSettlementCutoff(
  withdrawalDate: string,
  latestSettlementCutoff: string,
): string {
  const previousDay = shiftLocalDate(withdrawalDate, -1);
  if (!previousDay) return "";
  return latestSettlementCutoff > previousDay ? latestSettlementCutoff : previousDay;
}

function requiredIdentity(factoryId: string, labourGroupId: string) {
  if (!factoryId) throw new Error("Factory is required.");
  if (!labourGroupId) throw new Error("Mud group is required.");
}

function validDate(value: string, label: string) {
  if (!isLocalDate(value)) throw new Error(`${label} must be a valid date.`);
}
