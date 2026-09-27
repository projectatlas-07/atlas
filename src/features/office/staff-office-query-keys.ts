export const staffCategoriesQueryKey = (factoryId: string) =>
  ["office-staff-categories", factoryId] as const;

export const staffWorkersQueryKey = (factoryId: string) =>
  ["office-staff-workers", factoryId] as const;

export const staffPaymentSummaryQueryKey = (
  factoryId: string,
  staffWorkerId: string,
) => ["office-staff-payment-summary", factoryId, staffWorkerId] as const;

export const staffPaymentHistoryQueryKey = (
  factoryId: string,
  staffWorkerId: string,
) => ["office-staff-payment-history", factoryId, staffWorkerId] as const;
