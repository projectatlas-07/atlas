import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import type { DashboardSnapshot, OwnerDashboardSnapshot } from "./types.ts";

type OwnerServiceCall = [factoryId: string, businessDate: string, weekStart: string];

const serviceCalls: OwnerServiceCall[] = [];
let serviceResult: OwnerDashboardSnapshot;
let serviceError: Error | null = null;

await mock.module("./services/dashboard-service.ts", {
  namedExports: {
    getOwnerDashboardSnapshot: async (...args: OwnerServiceCall) => {
      serviceCalls.push(args);
      if (serviceError) throw serviceError;
      return serviceResult;
    },
    getDashboardSnapshot: async (): Promise<DashboardSnapshot> => {
      throw new Error("Legacy query should not run for the owner Dashboard.");
    },
  },
});

const { ownerDashboardQueryOptions } = await import("./dashboard-query.ts");

const containerSource = readFileSync(new URL("./components/dashboard-container.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("./components/dashboard-view.tsx", import.meta.url), "utf8");
const querySource = readFileSync(new URL("./dashboard-query.ts", import.meta.url), "utf8");

const today: DashboardSnapshot = {
  dateFrom: "2026-09-23",
  dateTo: "2026-09-23",
  flows: {
    sales: 1,
    paymentsReceived: 2,
    expenses: 3,
    cashIn: 4,
    cashOut: 5,
    productionQuantity: 6,
    productionLabourPaid: 7,
    mudSupplyPaid: 8,
    chamberTransportPaid: 9,
    soilTrolleyPaid: 10,
    staffPaid: 11,
    vehicleDeliveryWagePaid: 12,
  },
  stocks: { cashBalance: 13, currentCustomerOutstanding: 14 },
};
const snapshot: OwnerDashboardSnapshot = {
  today,
  thisWeekSales: { dateFrom: "2026-09-21", dateTo: "2026-09-23", amount: 15 },
};

function reset(): void {
  serviceCalls.length = 0;
  serviceResult = snapshot;
  serviceError = null;
}

test("query passes the exact factory, Kolkata business date, and Monday boundary", async () => {
  reset();
  const options = ownerDashboardQueryOptions("factory-a", "2026-09-23", "2026-09-21");

  assert.strictEqual(await options.queryFn(), snapshot);
  assert.deepEqual(serviceCalls, [["factory-a", "2026-09-23", "2026-09-21"]]);
  assert.deepEqual(options.queryKey, ["owner-dashboard", "factory-a", "2026-09-23", "2026-09-21"]);
  assert.match(querySource, /getOwnerDashboardSnapshot\(factoryId, businessDate, weekStart\)/);
});

test("container has explicit loading, recoverable error, and resolved states", () => {
  const loadingBranch = containerSource.indexOf("if (snapshotQuery.isLoading)");
  const errorBranch = containerSource.indexOf("if (snapshotQuery.error || !snapshotQuery.data)");
  const resolvedView = containerSource.indexOf("<DashboardView snapshot={snapshotQuery.data} />");

  assert.ok(loadingBranch > -1 && errorBranch > loadingBranch && resolvedView > errorBranch);
  assert.match(containerSource, /aria-busy="true"/);
  assert.match(containerSource, /Loading Dashboard\.\.\./);
  assert.match(containerSource, /role="alert"/);
  assert.match(containerSource, /Dashboard could not be loaded\./);
  assert.match(containerSource, /snapshotQuery\.refetch\(\)/);
  assert.match(containerSource, /ATLAS_UI_STRINGS\.actions\.retry/);
  assert.doesNotMatch(containerSource, /error\.message|snapshotQuery\.error\?\.message|\?\?\s*0/);
});

test("factory and dates produce distinct query identities", () => {
  const first = ownerDashboardQueryOptions("factory-a", "2026-09-23", "2026-09-21");
  const nextDay = ownerDashboardQueryOptions("factory-a", "2026-09-24", "2026-09-21");
  const nextFactory = ownerDashboardQueryOptions("factory-b", "2026-09-24", "2026-09-21");
  assert.notDeepEqual(first.queryKey, nextDay.queryKey);
  assert.notDeepEqual(nextDay.queryKey, nextFactory.queryKey);
  assert.doesNotMatch(containerSource, /keepPreviousData|placeholderData/);
});

test("container has one live-data boundary and the view remains presentational", () => {
  assert.match(containerSource, /from "\.\.\/dashboard-query"/);
  assert.match(querySource, /from "\.\/services\/dashboard-service\.ts"/);
  assert.doesNotMatch(`${containerSource}\n${querySource}`, /supabase|cash-book|sales\/services|expenses\/services|production\/services|compensation\/providers|\.from\(|\.rpc\(|\bfetch\(/i);
  assert.doesNotMatch(viewSource, /getOwnerDashboardSnapshot|getDashboardSnapshot|supabase|\/services\/|compensation\/providers|\bfetch\(/i);
});
