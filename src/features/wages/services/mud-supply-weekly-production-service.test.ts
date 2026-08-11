import assert from "node:assert/strict";
import { mock, test } from "node:test";

const calls: Array<{ factoryId: string; weekStart: string }> = [];
let eligibleLabourers: Array<{ labourerId: string; quantity: number }> = [];

await mock.module("./production-wage-labourer-service.ts", {
  namedExports: {
    getProductionWageLabourers: async (input: { factoryId: string; weekStart: string }) => {
      calls.push(input);
      return eligibleLabourers;
    },
  },
});

const { getMudSupplyWeeklyProduction } = await import("./mud-supply-weekly-production-service.ts");

test("sums exact eligible production for the requested completed week", async () => {
  calls.length = 0;
  eligibleLabourers = [
    { labourerId: "labourer-a", quantity: 60000 },
    { labourerId: "labourer-b", quantity: 40000 },
  ];

  assert.equal(await getMudSupplyWeeklyProduction({ factoryId: "factory-a", weekStart: "2026-07-27", today: "2026-08-09" }), 100000);
  assert.deepEqual(calls, [{ factoryId: "factory-a", weekStart: "2026-07-27" }]);
});

test("returns zero when eligible production is empty", async () => {
  calls.length = 0;
  eligibleLabourers = [];

  assert.equal(await getMudSupplyWeeklyProduction({ factoryId: "factory-a", weekStart: "2026-07-27", today: "2026-08-09" }), 0);
});

test("rejects current, future, and non-Monday weeks before reading production", async () => {
  calls.length = 0;

  await assert.rejects(
    () => getMudSupplyWeeklyProduction({ factoryId: "factory-a", weekStart: "2026-08-03", today: "2026-08-09" }),
    /not completed yet/,
  );
  await assert.rejects(
    () => getMudSupplyWeeklyProduction({ factoryId: "factory-a", weekStart: "2026-08-10", today: "2026-08-09" }),
    /not completed yet/,
  );
  await assert.rejects(
    () => getMudSupplyWeeklyProduction({ factoryId: "factory-a", weekStart: "2026-07-28", today: "2026-08-09" }),
    /must be a Monday/,
  );
  assert.deepEqual(calls, []);
});
