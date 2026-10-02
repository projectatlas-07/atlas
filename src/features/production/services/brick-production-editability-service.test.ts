import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: {} },
});
const { deriveBrickProductionEditability } = await import("./brick-production-editability-service.ts");
const service = readFileSync(new URL("./brick-production-editability-service.ts", import.meta.url), "utf8");

const labourerIds = ["labourer-open", "labourer-locked"];

test("a date stays fully open when it is after every authoritative cutoff", () => {
  const result = deriveBrickProductionEditability({
    businessDate: "2026-09-30",
    labourerIds,
    mudAccountingMode: "SETTLEMENT",
    mudSettlementCutoff: "2026-09-20",
    productionSettlements: [
      { labourer_id: "labourer-open", settled_through: "2026-09-25" },
      { labourer_id: "labourer-locked", settled_through: "2026-09-29" },
    ],
  });

  assert.equal(result.isMudLocked, false);
  assert.equal(result.labourers["labourer-open"].isLocked, false);
  assert.equal(result.labourers["labourer-locked"].isLocked, false);
});

test("a factory Mud cutoff locks every labourer row", () => {
  const result = deriveBrickProductionEditability({
    businessDate: "2026-09-20",
    labourerIds,
    mudAccountingMode: "SETTLEMENT",
    mudSettlementCutoff: "2026-09-20",
    productionSettlements: [],
  });

  assert.equal(result.isMudLocked, true);
  for (const labourerId of labourerIds) {
    assert.deepEqual(result.labourers[labourerId], {
      isLocked: true,
      settledThrough: "2026-09-20",
      lockSource: "mud",
    });
  }
});

test("Production cutoffs preserve mixed labourer-level editability", () => {
  const result = deriveBrickProductionEditability({
    businessDate: "2026-09-25",
    labourerIds,
    mudAccountingMode: "SETTLEMENT",
    mudSettlementCutoff: "2026-09-20",
    productionSettlements: [
      { labourer_id: "labourer-locked", settled_through: "2026-09-24" },
      { labourer_id: "labourer-locked", settled_through: "2026-09-25" },
    ],
  });

  assert.deepEqual(result.labourers["labourer-open"], {
    isLocked: false,
    settledThrough: null,
    lockSource: null,
  });
  assert.deepEqual(result.labourers["labourer-locked"], {
    isLocked: true,
    settledThrough: "2026-09-25",
    lockSource: "production",
  });
});

test("the read service composes the same factory-scoped immutable settlement sources as the backend guard", () => {
  assert.match(service, /\.from\("mud_accounting_states"\)/);
  assert.match(service, /\.from\("mud_factory_settlements"\)/);
  assert.match(service, /\.from\("production_earning_settlements"\)/);
  assert.ok((service.match(/\.eq\("factory_id", factoryId\)/g) ?? []).length >= 3);
  assert.match(service, /mudAccountingMode === "SETTLEMENT"/);
  assert.match(service, /businessDate <= activeMudCutoff/);
  assert.match(service, /businessDate <= productionCutoff/);
});
