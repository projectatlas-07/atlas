export const vehicleWageAccountQueryKey = (factoryId: string, vehicleId: string) =>
  ["office-vehicle-wages", factoryId, "account", vehicleId] as const;

export const vehicleWagePaymentsQueryKey = (factoryId: string, vehicleId: string) =>
  ["office-vehicle-wages", factoryId, "payments", vehicleId] as const;
