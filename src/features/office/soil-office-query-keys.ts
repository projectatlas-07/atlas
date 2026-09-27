export const soilWorkersQueryKey = (factoryId: string) =>
  ["office-soil-workers", factoryId] as const;

export const soilCurrentRateQueryKey = (
  factoryId: string,
  workerId: string,
  date: string,
) => ["office-soil-current-rate", factoryId, workerId, date] as const;

export const soilRateHistoryQueryKey = (factoryId: string, workerId: string) =>
  ["office-soil-rate-history", factoryId, workerId] as const;

export const soilFinancialSummaryQueryKey = (factoryId: string, workerId: string) =>
  ["office-soil-financial-summary", factoryId, workerId] as const;

export const soilEarningsQueryKey = (
  factoryId: string,
  workerId: string,
  fromDate: string | undefined,
  toDate: string | undefined,
) => ["office-soil-earnings", factoryId, workerId, fromDate, toDate] as const;

export const soilEarningHistoryExistenceQueryKey = (
  factoryId: string,
  workerId: string,
) => ["office-soil-earning-history-exists", factoryId, workerId] as const;

export const soilPaymentsQueryKey = (factoryId: string, workerId: string) =>
  ["office-soil-payments", factoryId, workerId] as const;

export const soilAdjustmentsQueryKey = (factoryId: string, workerId: string) =>
  ["office-soil-adjustments", factoryId, workerId] as const;
