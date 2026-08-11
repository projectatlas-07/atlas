export type ProductionLabourerRow = {
  id: string;
  name: string;
  assigned_brick_type_id: string;
};

export type ProductionBrickTypeRow = {
  id: string;
  name: string;
};

export type ProductionEntryRow = {
  id: string;
  labourer_id: string;
  brick_type_id: string;
  quantity: number;
};

export type ActiveProductionLabourer = {
  id: string;
  name: string;
  brickTypeId: string;
  brickTypeName: string;
};

export type SavedProductionEntry = {
  id: string;
  brickTypeId: string;
};

export type ProductionSavePayload = {
  key: string;
  factoryId: string;
  labourerId: string;
  brickTypeId: string;
  productionDate: string;
  quantity: number;
  savedEntryId?: string;
  newEntryId?: string;
};

export function prepareProductionEntryState({
  labourerRows,
  brickTypeRows,
  productionRows,
}: {
  labourerRows: readonly ProductionLabourerRow[];
  brickTypeRows: readonly ProductionBrickTypeRow[];
  productionRows: readonly ProductionEntryRow[];
}) {
  const brickTypesById = new Map(brickTypeRows.map((brickType) => [brickType.id, brickType]));
  const savedEntriesByLabourer = new Map<string, SavedProductionEntry>();
  const quantitiesByLabourer = new Map<string, string>();
  for (const entry of productionRows) {
    savedEntriesByLabourer.set(entry.labourer_id, { id: entry.id, brickTypeId: entry.brick_type_id });
    quantitiesByLabourer.set(entry.labourer_id, String(entry.quantity));
  }

  const labourers = labourerRows.flatMap<ActiveProductionLabourer>((labourer) => {
    const savedEntry = savedEntriesByLabourer.get(labourer.id);
    const brickTypeId = savedEntry?.brickTypeId ?? labourer.assigned_brick_type_id;
    const brickType = brickTypesById.get(brickTypeId);
    if (!brickType) return [];
    return [{
      id: labourer.id,
      name: labourer.name,
      brickTypeId: brickType.id,
      brickTypeName: brickType.name,
    }];
  });

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
    brickTypeId: labourer.brickTypeId,
    productionDate,
    quantity,
    savedEntryId: savedEntry?.id,
    newEntryId: savedEntry ? undefined : pendingNewEntryId ?? newEntryId,
  };
}
