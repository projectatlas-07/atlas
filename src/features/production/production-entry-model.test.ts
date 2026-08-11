import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionSavePayload, prepareProductionEntryState } from "./production-entry-model.ts";
import { productionRecordSchema } from "./schemas/production-record-schema.ts";

test("production validation requires a brick type", () => {
  const common = {
    productionDate: "2026-08-10",
    labourId: "00000000-0000-4000-8000-000000000001",
    labourName: "Labourer",
    quantity: 1000,
  };

  assert.equal(productionRecordSchema.safeParse({ ...common, brickType: null }).success, false);
  assert.equal(productionRecordSchema.safeParse({ ...common, brickType: "Red Brick" }).success, true);
});

test("resolves assigned and saved brick types and restores saved quantities", () => {
  const state = prepareProductionEntryState({
    labourerRows: [
      { id: "labourer-a", name: "Asha", assigned_brick_type_id: "brick-a" },
      { id: "labourer-b", name: "Bela", assigned_brick_type_id: "brick-b" },
    ],
    brickTypeRows: [
      { id: "brick-a", name: "Red Brick" },
      { id: "brick-b", name: "Blue Brick" },
    ],
    productionRows: [
      { id: "entry-normal", labourer_id: "labourer-a", brick_type_id: "brick-b", quantity: 800 },
    ],
  });

  assert.deepEqual(state.labourers, [
    { id: "labourer-a", name: "Asha", brickTypeId: "brick-b", brickTypeName: "Blue Brick" },
    { id: "labourer-b", name: "Bela", brickTypeId: "brick-b", brickTypeName: "Blue Brick" },
  ]);
  assert.equal(state.quantitiesByLabourer.get("labourer-a"), "800");
  assert.deepEqual([...state.savedLabourerIds], ["labourer-a"]);
});

test("normal production keeps its resolved brick snapshot for insert and existing row ID for update", () => {
  const labourer = { id: "labourer-a", name: "Asha", brickTypeId: "brick-a", brickTypeName: "Red Brick" };
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
    savedEntry: { id: "existing-normal-entry", brickTypeId: "brick-a" },
    newEntryId: "unused-new-id",
  });

  assert.equal(insertPayload.brickTypeId, "brick-a");
  assert.equal(insertPayload.newEntryId, "new-normal-entry");
  assert.equal(updatePayload.savedEntryId, "existing-normal-entry");
  assert.equal(updatePayload.newEntryId, undefined);
  assert.equal(updatePayload.brickTypeId, "brick-a");
});
