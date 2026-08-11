import { supabase } from "../../../lib/supabase/client.ts";

export type LabourGroupAvailableBalance = {
  totalEarned: number;
  totalWithdrawn: number;
  availableBalance: number;
};

export async function getLabourGroupAvailableBalance({
  factoryId,
  labourGroupId,
  asOfDate,
}: {
  factoryId: string;
  labourGroupId: string;
  asOfDate: string;
}): Promise<LabourGroupAvailableBalance> {
  const earningsWeekStartCutoff = subtractLocalCalendarDays(asOfDate, 6);

  const [earningsResult, withdrawalsResult] = await Promise.all([
    supabase
      .from("weekly_earnings")
      .select("amount")
      .eq("factory_id", factoryId)
      .eq("labour_group_id", labourGroupId)
      .is("labourer_id", null)
      .lte("week_start", earningsWeekStartCutoff),
    supabase
      .from("withdrawals")
      .select("amount")
      .eq("factory_id", factoryId)
      .eq("labour_group_id", labourGroupId)
      .is("labourer_id", null)
      .lte("withdrawal_date", asOfDate),
  ]);

  if (earningsResult.error) {
    throw new Error(`Could not load locked group earnings: ${earningsResult.error.message}`);
  }
  if (withdrawalsResult.error) {
    throw new Error(`Could not load group withdrawals: ${withdrawalsResult.error.message}`);
  }

  const totalEarned = (earningsResult.data ?? []).reduce((total, earning) => total + earning.amount, 0);
  const totalWithdrawn = (withdrawalsResult.data ?? []).reduce((total, withdrawal) => total + withdrawal.amount, 0);

  return {
    totalEarned,
    totalWithdrawn,
    availableBalance: totalEarned - totalWithdrawn,
  };
}

function subtractLocalCalendarDays(dateValue: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) throw new Error("asOfDate must be a valid YYYY-MM-DD date.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (formatLocalDate(date) !== dateValue) {
    throw new Error("asOfDate must be a valid YYYY-MM-DD date.");
  }

  date.setDate(date.getDate() - days);
  return formatLocalDate(date);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
