export type ProductionLabourerRow = {
  id: string;
  name: string;
};

export type ProductionEntryRow = {
  id: string;
  labourer_id: string;
  quantity: number;
};

export type ActiveProductionLabourer = {
  id: string;
  name: string;
};

export type SavedProductionEntry = {
  id: string;
};

export type ProductionSavePayload = {
  key: string;
  factoryId: string;
  labourerId: string;
  productionDate: string;
  quantity: number;
  savedEntryId?: string;
  newEntryId?: string;
};

export function prepareProductionEntryState({
  labourerRows,
  productionRows,
}: {
  labourerRows: readonly ProductionLabourerRow[];
  productionRows: readonly ProductionEntryRow[];
}) {
  const savedEntriesByLabourer = new Map<string, SavedProductionEntry>();
  const quantitiesByLabourer = new Map<string, string>();
  for (const entry of productionRows) {
    savedEntriesByLabourer.set(entry.labourer_id, { id: entry.id });
    quantitiesByLabourer.set(entry.labourer_id, String(entry.quantity));
  }

  const labourers: ActiveProductionLabourer[] = labourerRows.map((labourer) => ({
    id: labourer.id,
    name: labourer.name,
  }));

  const activeLabourerIds = new Set(labourers.map((labourer) => labourer.id));
  const savedLabourerIds = new Set(
    productionRows
      .filter((entry) => activeLabourerIds.has(entry.labourer_id))
      .map((entry) => entry.labourer_id),
  );

  return { labourers, savedEntriesByLabourer, quantitiesByLabourer, savedLabourerIds };
}

export function buildProductionSavePayload({
  factoryId,
  labourer,
  productionDate,
  quantity,
  savedEntry,
  pendingNewEntryId,
  newEntryId,
}: {
  factoryId: string;
  labourer: ActiveProductionLabourer;
  productionDate: string;
  quantity: number;
  savedEntry?: SavedProductionEntry;
  pendingNewEntryId?: string;
  newEntryId: string;
}): ProductionSavePayload {
  return {
    key: `${factoryId}:${labourer.id}:${productionDate}`,
    factoryId,
    labourerId: labourer.id,
    productionDate,
    quantity,
    savedEntryId: savedEntry?.id,
    newEntryId: savedEntry ? undefined : pendingNewEntryId ?? newEntryId,
  };
}
