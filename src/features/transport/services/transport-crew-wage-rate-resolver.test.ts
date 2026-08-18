import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = {
  id: string;
  factory_id: string;
  transport_crew_id: string;
  rate_per_paya: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

type DatabaseError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

type Call = [method: string, value?: unknown, secondValue?: unknown];
const calls: Call[] = [];
let rows: Row[] = [];
let requestError: DatabaseError | null = null;

const fakeSupabase = {
  from(table: string) {
    calls.push(["from", table]);
    let factoryId: string | undefined;
    let transportCrewId: string | undefined;
    let workDate: string | undefined;

    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: string) {
        calls.push(["eq", column, value]);
        if (column === "factory_id") factoryId = value;
        if (column === "transport_crew_id") transportCrewId = value;
        return builder;
      },
      lte(column: string, value: string) {
        calls.push(["lte", column, value]);
        if (column === "effective_from") workDate = value;
        return builder;
      },
      or(filter: string) {
        calls.push(["or", filter]);
        return builder;
      },
      limit(count: number) {
        calls.push(["limit", count]);
        const data = rows.filter((rate) =>
          rate.factory_id === factoryId
          && rate.transport_crew_id === transportCrewId
          && workDate !== undefined
          && rate.effective_from <= workDate
          && (rate.effective_to === null || rate.effective_to >= workDate),
        ).slice(0, count);
        return Promise.resolve({ data, error: requestError });
      },
    };

    return builder;
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});
const {
  TransportCrewWageRateResolutionError,
  TransportCrewWageRateServiceError,
  getTransportCrewWageRateForDate,
} = await import("./transport-crew-wage-rate-service.ts");

const oldRate: Row = {
  id: "rate-800",
  factory_id: "factory-a",
  transport_crew_id: "crew-a",
  rate_per_paya: 800,
  effective_from: "2026-08-01",
  effective_to: "2026-08-17",
  created_at: "2026-08-01T09:00:00Z",
};

const currentRate: Row = {
  id: "rate-900",
  factory_id: "factory-a",
  transport_crew_id: "crew-a",
  rate_per_paya: 900,
  effective_from: "2026-08-18",
  effective_to: null,
  created_at: "2026-08-18T09:00:00Z",
};

function reset(nextRows: Row[] = [oldRate, currentRate]): void {
  calls.length = 0;
  rows = nextRows;
  requestError = null;
}

async function resolve(workDate: string) {
  return getTransportCrewWageRateForDate({
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    workDate,
  });
}

async function expectResolutionFailure(
  workDate: string,
  failure: "missing" | "overlapping",
): Promise<void> {
  await assert.rejects(
    () => resolve(workDate),
    (error: unknown) => error instanceof TransportCrewWageRateResolutionError
      && error.failure === failure,
  );
}

test("resolves exactly one applicable transport crew rate and maps its record", async () => {
  reset();

  assert.deepEqual(await resolve("2026-08-10"), {
    id: "rate-800",
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    ratePerPaya: 800,
    effectiveFrom: "2026-08-01",
    effectiveTo: "2026-08-17",
    createdAt: "2026-08-01T09:00:00Z",
  });

  assert.deepEqual(calls, [
    ["from", "transport_crew_wage_rates"],
    ["select", "id, factory_id, transport_crew_id, rate_per_paya, effective_from, effective_to, created_at"],
    ["eq", "factory_id", "factory-a"],
    ["eq", "transport_crew_id", "crew-a"],
    ["lte", "effective_from", "2026-08-10"],
    ["or", "effective_to.is.null,effective_to.gte.2026-08-10"],
    ["limit", 2],
  ]);
});

test("effective_from boundary is inclusive", async () => {
  reset();
  assert.equal((await resolve("2026-08-01")).id, "rate-800");
});

test("effective_to boundary is inclusive", async () => {
  reset();
  assert.equal((await resolve("2026-08-17")).id, "rate-800");
});

test("an open-ended rate carries forward", async () => {
  reset();
  assert.equal((await resolve("2027-01-15")).id, "rate-900");
});

test("a mid-week replacement resolves the old and new rates on exact dates", async () => {
  reset();
  assert.equal((await resolve("2026-08-17")).ratePerPaya, 800);
  assert.equal((await resolve("2026-08-18")).ratePerPaya, 900);
});

test("a date before the first rate throws the typed missing condition", async () => {
  reset();
  await expectResolutionFailure("2026-07-31", "missing");
});

test("a gap between historical rate periods throws the typed missing condition", async () => {
  reset([
    { ...oldRate, effective_to: "2026-08-10" },
    { ...currentRate, effective_from: "2026-08-20" },
  ]);
  await expectResolutionFailure("2026-08-15", "missing");
});

test("multiple matching rows throw the typed overlapping condition", async () => {
  reset([
    oldRate,
    { ...currentRate, effective_from: "2026-08-10" },
    { ...currentRate, id: "rate-950", rate_per_paya: 950, effective_from: "2026-08-12" },
  ]);
  await expectResolutionFailure("2026-08-15", "overlapping");
});

test("another crew's rate is not used", async () => {
  reset([{ ...currentRate, transport_crew_id: "crew-b" }]);
  await expectResolutionFailure("2026-08-18", "missing");
});

test("another factory's rate is not used", async () => {
  reset([{ ...currentRate, factory_id: "factory-b" }]);
  await expectResolutionFailure("2026-08-18", "missing");
});

test("a database request failure stays separate from resolution failures", async () => {
  reset();
  requestError = {
    message: "connection unavailable",
    code: "08006",
    details: "request failed",
    hint: null,
  };

  await assert.rejects(
    () => resolve("2026-08-18"),
    (error: unknown) => {
      assert.ok(error instanceof TransportCrewWageRateServiceError);
      assert.equal(error instanceof TransportCrewWageRateResolutionError, false);
      assert.equal(error.code, "08006");
      assert.equal(error.message, "connection unavailable");
      return true;
    },
  );
});
