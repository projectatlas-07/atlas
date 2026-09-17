import assert from "node:assert/strict";
import { mock, test } from "node:test";

type AccountRow = {
  settled_earned: number;
  live_earned: number;
  total_earned: number;
  total_withdrawn: number;
  available_balance: number;
  latest_settlement_cutoff: string | null;
};

type RpcArgs = { p_factory_id: string; p_labourer_id: string; p_as_of_date: string };
const calls: Array<[string, RpcArgs]> = [];
let response: { data: AccountRow[] | null; error: { message: string } | null } = { data: [], error: null };

const fakeSupabase = {
  rpc(functionName: string, args: RpcArgs) {
    calls.push([functionName, args]);
    return Promise.resolve(response);
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getLabourerAvailableBalance } = await import("./labourer-available-balance-service.ts");

test("uses the authoritative Production account and maps settled plus live earnings", async () => {
  calls.length = 0;
  response = { data: [{
    settled_earned: 1_250,
    live_earned: 400,
    total_earned: 1_650,
    total_withdrawn: 500,
    available_balance: 1_150,
    latest_settlement_cutoff: "2026-09-12",
  }], error: null };

  assert.deepEqual(
    await getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-09-15" }),
    {
      settledEarned: 1_250,
      liveEarned: 400,
      totalEarned: 1_650,
      totalWithdrawn: 500,
      availableBalance: 1_150,
      latestSettlementCutoff: "2026-09-12",
    },
  );
  assert.deepEqual(calls, [["get_production_labourer_account", {
    p_factory_id: "factory-a",
    p_labourer_id: "labourer-a",
    p_as_of_date: "2026-09-15",
  }]]);
});

test("supports a fully live account before its first settlement", async () => {
  calls.length = 0;
  response = { data: [{
    settled_earned: 0,
    live_earned: 800,
    total_earned: 800,
    total_withdrawn: 0,
    available_balance: 800,
    latest_settlement_cutoff: null,
  }], error: null };

  const account = await getLabourerAvailableBalance({
    factoryId: "factory-a", labourerId: "labourer-b", asOfDate: "2026-09-15",
  });
  assert.equal(account.liveEarned, 800);
  assert.equal(account.latestSettlementCutoff, null);
});

test("surfaces account failures and empty responses clearly", async () => {
  calls.length = 0;
  response = { data: null, error: { message: "Rate not set for labourer on 2026-09-14." } };
  await assert.rejects(
    () => getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-09-15" }),
    /Could not load Production account: Rate not set/,
  );

  response = { data: [], error: null };
  await assert.rejects(
    () => getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-09-15" }),
    /returned no account/,
  );
});

test("rejects invalid local calendar dates before querying", async () => {
  calls.length = 0;
  await assert.rejects(
    () => getLabourerAvailableBalance({ factoryId: "factory-a", labourerId: "labourer-a", asOfDate: "2026-02-30" }),
    /asOfDate must be a valid YYYY-MM-DD date/,
  );
  assert.deepEqual(calls, []);
});
