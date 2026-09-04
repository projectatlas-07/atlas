import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import type { DashboardSnapshot } from "./types.ts";

type ServiceCall = [factoryId: string, dateFrom: string, dateTo: string];

const serviceCalls: ServiceCall[] = [];
let serviceResult: DashboardSnapshot;
let serviceError: Error | null = null;

await mock.module("./services/dashboard-service.ts", {
  namedExports: {
    getDashboardSnapshot: async (...args: ServiceCall) => {
      serviceCalls.push(args);
      if (serviceError) throw serviceError;
      return serviceResult;
    },
  },
});

const { dashboardSnapshotQueryOptions } = await import("./dashboard-query.ts");

const containerSource = readFileSync(
  new URL("./components/dashboard-container.tsx", import.meta.url),
  "utf8",
);
const viewSource = readFileSync(
  new URL("./components/dashboard-view.tsx", import.meta.url),
  "utf8",
);
const querySource = readFileSync(
  new URL("./dashboard-query.ts", import.meta.url),
  "utf8",
);

const snapshot: DashboardSnapshot = {
  dateFrom: "2026-08-01",
  dateTo: "2026-08-31",
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

function reset(): void {
  serviceCalls.length = 0;
  serviceResult = snapshot;
  serviceError = null;
}

test("passes the exact factory and explicit range to the mocked Dashboard aggregation service", async () => {
  reset();
  const options = dashboardSnapshotQueryOptions("factory-a", "2026-08-01", "2026-08-31");

  assert.strictEqual(await options.queryFn(), snapshot);
  assert.deepEqual(serviceCalls, [["factory-a", "2026-08-01", "2026-08-31"]]);
  assert.match(querySource, /getDashboardSnapshot\(factoryId, dateFrom, dateTo\)/);
});

test("shows loading before resolution and passes the resolved snapshot unchanged to DashboardView", () => {
  const loadingBranch = containerSource.indexOf("if (snapshotQuery.isLoading)");
  const resolvedView = containerSource.indexOf("<DashboardView snapshot={snapshotQuery.data} />");

  assert.notEqual(loadingBranch, -1);
  assert.match(containerSource, /aria-busy="true"/);
  assert.match(containerSource, /Loading Dashboard\.\.\./);
  assert.notEqual(resolvedView, -1);
  assert.ok(loadingBranch < resolvedView);
});

test("shows a recoverable safe error without fabricating zero metrics or exposing internals", async () => {
  reset();
  serviceError = new Error("internal database detail");

  await assert.rejects(
    dashboardSnapshotQueryOptions("factory-a", "2026-08-01", "2026-08-31").queryFn(),
    /internal database detail/,
  );
  assert.match(containerSource, /if \(snapshotQuery\.error \|\| !snapshotQuery\.data\)/);
  assert.match(containerSource, /role="alert"/);
  assert.match(containerSource, /Dashboard could not be loaded\./);
  assert.match(containerSource, /Change the selected period or reopen this screen to try again\./);
  assert.doesNotMatch(containerSource, /error\.message|snapshotQuery\.error\?\.message|flows:\s*\{|stocks:\s*\{|\?\?\s*0/);
});

test("factory and date changes reload with distinct TanStack query identities", async () => {
  reset();
  const first = dashboardSnapshotQueryOptions("factory-a", "2026-08-01", "2026-08-31");
  const newRange = dashboardSnapshotQueryOptions("factory-a", "2026-09-01", "2026-09-30");
  const newFactory = dashboardSnapshotQueryOptions("factory-b", "2026-09-01", "2026-09-30");

  assert.notDeepEqual(first.queryKey, newRange.queryKey);
  assert.notDeepEqual(newRange.queryKey, newFactory.queryKey);
  await Promise.all([first.queryFn(), newRange.queryFn(), newFactory.queryFn()]);
  assert.deepEqual(serviceCalls, [
    ["factory-a", "2026-08-01", "2026-08-31"],
    ["factory-a", "2026-09-01", "2026-09-30"],
    ["factory-b", "2026-09-01", "2026-09-30"],
  ]);
  assert.match(querySource, /\["dashboard-snapshot", factoryId, dateFrom, dateTo\]/);
  assert.doesNotMatch(containerSource, /keepPreviousData|placeholderData/);
});

test("container has one allowed live-data dependency and DashboardView remains presentational", () => {
  assert.match(containerSource, /from "\.\.\/dashboard-query"/);
  assert.match(querySource, /from "\.\/services\/dashboard-service\.ts"/);
  assert.doesNotMatch(
    `${containerSource}\n${querySource}`,
    /supabase|cash-book|sales\/services|expenses\/services|production\/services|compensation\/providers|\.from\(|\.rpc\(|fetch\(/i,
  );
  assert.doesNotMatch(
    viewSource,
    /getDashboardSnapshot|supabase|\/services\/|compensation-provider|compensation\/providers|fetch\(/i,
  );
});
