import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionSavePayload, prepareProductionEntryState } from "./production-entry-model.ts";
import { productionRecordSchema } from "./schemas/production-record-schema.ts";

test("production validation requires only worker, date, and raw quantity", () => {
  const input = {
    productionDate: "2026-08-10",
    labourId: "00000000-0000-4000-8000-000000000001",
    labourName: "Labourer",
    quantity: 1000,
  };

  assert.equal(productionRecordSchema.safeParse(input).success, true);
  assert.equal(productionRecordSchema.safeParse({ ...input, quantity: 0 }).success, false);
});

test("keeps every worker visible and restores saved quantities without Brick Type", () => {
  const state = prepareProductionEntryState({
    labourerRows: [
      { id: "labourer-a", name: "Asha" },
      { id: "labourer-b", name: "Bela" },
    ],
    productionRows: [
      { id: "entry-normal", labourer_id: "labourer-a", quantity: 800 },
    ],
  });

  assert.deepEqual(state.labourers, [
    { id: "labourer-a", name: "Asha" },
    { id: "labourer-b", name: "Bela" },
  ]);
  assert.equal(state.quantitiesByLabourer.get("labourer-a"), "800");
  assert.deepEqual([...state.savedLabourerIds], ["labourer-a"]);
});

test("normal production keeps retry identity and existing row ID without Brick Type", () => {
  const labourer = { id: "labourer-a", name: "Asha" };
  const insertPayload = buildProductionSavePayload({
    factoryId: "factory-a",
    labourer,
    productionDate: "2026-08-10",
    quantity: 800,
    newEntryId: "new-normal-entry",
  });
  const updatePayload = buildProductionSavePayload({
    factoryId: "factory-a",
    labourer,
    productionDate: "2026-08-10",
    quantity: 900,
    savedEntry: { id: "existing-normal-entry" },
    newEntryId: "unused-new-id",
  });

  assert.equal(insertPayload.newEntryId, "new-normal-entry");
  assert.equal(updatePayload.savedEntryId, "existing-normal-entry");
  assert.equal(updatePayload.newEntryId, undefined);
  assert.equal("brickTypeId" in insertPayload, false);
  assert.equal("brickTypeId" in updatePayload, false);
});
