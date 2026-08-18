import type { CreateTransportWorkerWithdrawalInput } from "../transport/services/transport-worker-financial-service.ts";
import type {
  TransportWorker,
  TransportWorkerAvailableBalance,
  TransportWorkerWithdrawal,
} from "../transport/types.ts";

export type TransportWorkerFinanceFormState = {
  selectedWorkerId: string;
  withdrawalDate: string;
  amountInput: string;
};

export function buildTransportFinanceWorkerOption(worker: TransportWorker): {
  id: string;
  label: string;
} {
  return {
    id: worker.id,
    label: `${worker.name}${worker.isActive ? "" : " (Inactive)"}`,
  };
}

export function selectTransportFinanceWorker(
  state: TransportWorkerFinanceFormState,
  selectedWorkerId: string,
): TransportWorkerFinanceFormState {
  return { ...state, selectedWorkerId, amountInput: "" };
}

export function buildTransportWithdrawalInput({
  factoryId,
  selectedWorkerId,
  withdrawalDate,
  amountInput,
}: Readonly<TransportWorkerFinanceFormState & { factoryId: string }>): CreateTransportWorkerWithdrawalInput | null {
  const amount = Number(amountInput);
  if (
    !factoryId
    || !selectedWorkerId
    || !isCanonicalDate(withdrawalDate)
    || !amountInput.trim()
    || !Number.isFinite(amount)
    || amount <= 0
  ) {
    return null;
  }

  return {
    factoryId,
    transportWorkerId: selectedWorkerId,
    withdrawalDate,
    amount,
  };
}

export function transportFinanceFormAfterSuccess(
  state: TransportWorkerFinanceFormState,
): TransportWorkerFinanceFormState {
  return { ...state, amountInput: "" };
}

export function getTransportFinanceRefreshQueryKeys({
  factoryId,
  transportWorkerId,
  asOfDate,
}: Readonly<{
  factoryId: string;
  transportWorkerId: string;
  asOfDate: string;
}>): readonly [readonly string[], readonly string[]] {
  return [
    ["office-transport-worker-balance", factoryId, transportWorkerId, asOfDate],
    ["office-transport-worker-withdrawals", factoryId, transportWorkerId],
  ];
}

export function formatTransportFinanceCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  })}`;
}

export function buildTransportBalanceDisplay(balance: TransportWorkerAvailableBalance): {
  earned: string;
  withdrawn: string;
  available: string;
  hasLockedEarnings: boolean;
  hasAvailableBalance: boolean;
} {
  return {
    earned: formatTransportFinanceCurrency(balance.totalEarned),
    withdrawn: formatTransportFinanceCurrency(balance.totalWithdrawn),
    available: formatTransportFinanceCurrency(balance.availableBalance),
    hasLockedEarnings: balance.totalEarned > 0,
    hasAvailableBalance: balance.availableBalance > 0,
  };
}

export function buildTransportWithdrawalHistoryItem(
  withdrawal: TransportWorkerWithdrawal,
): {
  withdrawalId: string;
  withdrawalDate: string;
  amount: string;
} {
  return {
    withdrawalId: withdrawal.withdrawalId,
    withdrawalDate: withdrawal.withdrawalDate,
    amount: formatTransportFinanceCurrency(withdrawal.amount),
  };
}

export function transportWorkerFinanceErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "P0001" || /exceeds available balance|insufficient.*balance/i.test(message)) {
    return "Insufficient available balance for this withdrawal date.";
  }
  if (code === "22023" || /valid finite date|greater than zero/i.test(message)) {
    return "Enter a valid withdrawal date and an amount greater than zero.";
  }
  if (code === "42501" || code === "401") {
    return /worker/i.test(message)
      ? "This transport worker does not belong to your factory."
      : "You do not have access to transport finances for this factory.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

function isCanonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}
