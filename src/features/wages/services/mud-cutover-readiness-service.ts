import type { PostgrestError } from "@supabase/supabase-js";
import { isLocalDate } from "../../../lib/local-date.ts";
import { supabase } from "../../../lib/supabase/client.ts";

export type MudCutoverReadinessStatus = "READY_FOR_CUTOVER" | "BLOCKED";

export type MudLegacyOpeningPreview = {
  labourGroupId: string;
  groupName: string;
  legacyLockedEarningTotal: number;
  existingWithdrawals: number;
  proposedOpeningAmount: number;
  resultingBalance: number;
};

export type MudCutoverReadiness = {
  status: MudCutoverReadinessStatus;
  reason: string;
  certificationWeek: string | null;
  finalLegacyWeekStart: string | null;
  finalLegacyWeekEnd: string | null;
  proposedLegacyCutoff: string | null;
  settlementStartDate: string | null;
  groups: MudLegacyOpeningPreview[];
};

export type MudSettlementCutoverResult = {
  legacyOpeningSettlementId: string;
  finalLegacyWeekStart: string;
  legacyCutoff: string;
  settlementStartDate: string;
  groupOpenings: number;
  transitionAuditId: string;
  actor: string;
  cutoverAt: string;
};

type MudCutoverReadinessRow = {
  readiness_status: MudCutoverReadinessStatus;
  reason: string;
  certification_week: string | null;
  final_legacy_week_start: string | null;
  final_legacy_week_end: string | null;
  proposed_legacy_cutoff: string | null;
  settlement_start_date: string | null;
  labour_group_id: string | null;
  group_name: string | null;
  legacy_locked_earning_total: number | null;
  existing_withdrawals: number | null;
  proposed_opening_amount: number | null;
  resulting_balance: number | null;
};

type MudSettlementCutoverRow = {
  legacy_opening_settlement_id: string;
  final_legacy_week_start: string;
  legacy_cutoff: string;
  settlement_start_date: string;
  group_openings: number;
  transition_audit_id: string;
  actor: string;
  cutover_at: string;
};

export class MudCutoverReadinessError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "MudCutoverReadinessError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export class MudSettlementCutoverError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(getFriendlyCutoverError(error));
    this.name = "MudSettlementCutoverError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export async function getMudCutoverReadiness(factoryId: string): Promise<MudCutoverReadiness> {
  if (!factoryId) throw new Error("Factory is required.");

  const { data, error } = await supabase.rpc("get_mud_cutover_readiness", {
    p_factory_id: factoryId,
  });
  if (error) throw new MudCutoverReadinessError(error);

  const rows = (data ?? []) as MudCutoverReadinessRow[];
  const first = rows[0];
  if (!first) throw new Error("Mud cutover readiness returned no status.");
  if (rows.some((row) => row.readiness_status !== first.readiness_status
    || row.reason !== first.reason
    || row.proposed_legacy_cutoff !== first.proposed_legacy_cutoff)) {
    throw new Error("Mud cutover readiness returned inconsistent rows.");
  }

  return {
    status: first.readiness_status,
    reason: first.reason,
    certificationWeek: first.certification_week,
    finalLegacyWeekStart: first.final_legacy_week_start,
    finalLegacyWeekEnd: first.final_legacy_week_end,
    proposedLegacyCutoff: first.proposed_legacy_cutoff,
    settlementStartDate: first.settlement_start_date,
    groups: rows.flatMap((row) => row.labour_group_id && row.group_name
      && row.legacy_locked_earning_total !== null
      && row.existing_withdrawals !== null
      && row.proposed_opening_amount !== null
      && row.resulting_balance !== null
      ? [{
          labourGroupId: row.labour_group_id,
          groupName: row.group_name,
          legacyLockedEarningTotal: Number(row.legacy_locked_earning_total),
          existingWithdrawals: Number(row.existing_withdrawals),
          proposedOpeningAmount: Number(row.proposed_opening_amount),
          resultingBalance: Number(row.resulting_balance),
        }]
      : []),
  };
}

export async function executeMudSettlementCutover({
  factoryId,
  proposedLegacyCutoff,
}: Readonly<{
  factoryId: string;
  proposedLegacyCutoff: string;
}>): Promise<MudSettlementCutoverResult> {
  if (!factoryId) throw new Error("Factory is required.");
  if (!isLocalDate(proposedLegacyCutoff)) {
    throw new Error("A valid proposed legacy cutoff is required.");
  }

  const { data, error } = await supabase.rpc("execute_mud_settlement_cutover", {
    p_factory_id: factoryId,
    p_proposed_legacy_cutoff: proposedLegacyCutoff,
  });
  if (error) throw new MudSettlementCutoverError(error);

  const result = (data as MudSettlementCutoverRow[] | null)?.[0];
  if (!result) throw new Error("Mud settlement cutover returned no result.");
  return {
    legacyOpeningSettlementId: result.legacy_opening_settlement_id,
    finalLegacyWeekStart: result.final_legacy_week_start,
    legacyCutoff: result.legacy_cutoff,
    settlementStartDate: result.settlement_start_date,
    groupOpenings: result.group_openings,
    transitionAuditId: result.transition_audit_id,
    actor: result.actor,
    cutoverAt: result.cutover_at,
  };
}

function getFriendlyCutoverError(error: PostgrestError): string {
  if (error.code === "P3100" || error.message.toLowerCase().includes("certification")) {
    return "SHADOW certification is no longer ready. Refresh and complete a valid parity week before trying again.";
  }
  if (error.code === "P3202" || error.message.toLowerCase().includes("reconcil")) {
    return "Mud balances could not be reconciled safely. Nothing was changed; refresh and review the cutover readiness details.";
  }
  if (error.code === "P3200") {
    if (error.message.toLowerCase().includes("current shadow")) {
      return "This factory is no longer in SHADOW mode, possibly because another cutover already completed. Refresh to see its current Mud accounting view.";
    }
    return "Cutover readiness changed before confirmation. Nothing was changed; refresh and review the current blocker.";
  }
  if (error.code === "23505" || error.code === "P2906") {
    return "A Mud cutover already exists for this factory. Refresh to see the Settlement account.";
  }
  if (error.code === "42501") return "You do not have access to cut over this factory.";
  return "Mud cutover could not be completed safely. Nothing was changed; refresh and try again.";
}
