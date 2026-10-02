import assert from "node:assert/strict";
import { mock, test } from "node:test";

type RpcError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
};

const calls: Array<[string, unknown?]> = [];
let rpcResponses: Array<{
  data: Array<{ id: string }> | null;
  error: RpcError | null;
}> = [];
let refreshResponse: {
  data: { session: { access_token: string } | null };
  error: RpcError | null;
} = { data: { session: { access_token: "refreshed" } }, error: null };

const fakeSupabase = {
  rpc(functionName: string, args: Record<string, unknown>) {
    calls.push(["rpc", { functionName, args }]);
    return Promise.resolve(rpcResponses.shift() ?? { data: null, error: null });
  },
  auth: {
    refreshSession() {
      calls.push(["refreshSession"]);
      return Promise.resolve(refreshResponse);
    },
  },
};

await mock.module("../../../lib/supabase/client.ts", {
  namedExports: { supabase: fakeSupabase },
});

const {
  isTransientProductionSaveFailure,
  productionSaveErrorMessage,
  saveProductionEntryWithSessionRefresh,
} = await import("./production-entry-service.ts");

const payload = {
  key: "factory-a:labourer-a:2026-09-30",
  factoryId: "factory-a",
  labourerId: "labourer-a",
  productionDate: "2026-09-30",
  quantity: 1500,
  newEntryId: "entry-a",
};

function reset() {
  calls.length = 0;
  rpcResponses = [];
  refreshResponse = {
    data: { session: { access_token: "refreshed" } },
    error: null,
  };
}

test("saves raw Production through the existing guarded RPC contract", async () => {
  reset();
  rpcResponses.push({ data: [{ id: "entry-a" }], error: null });

  assert.deepEqual(await saveProductionEntryWithSessionRefresh(payload), {
    status: "saved",
    savedEntry: { id: "entry-a" },
  });
  assert.deepEqual(calls, [["rpc", {
    functionName: "save_production_entry",
    args: {
      p_factory_id: "factory-a",
      p_entry_id: "entry-a",
      p_labourer_id: "labourer-a",
      p_production_date: "2026-09-30",
      p_quantity: 1500,
    },
  }]]);
});

test("refreshes an expired session once and retries the same save identity", async () => {
  reset();
  rpcResponses.push(
    {
      data: null,
      error: { code: "PGRST301", message: "JWT expired", details: null, hint: null },
    },
    { data: [{ id: "entry-a" }], error: null },
  );

  assert.equal((await saveProductionEntryWithSessionRefresh(payload)).status, "saved");
  assert.equal(calls.filter(([method]) => method === "rpc").length, 2);
  assert.deepEqual(calls[1], ["refreshSession"]);
  assert.deepEqual(calls[0], calls[2]);
});

test("keeps settlement, permission, and transient failures understandable", () => {
  assert.equal(
    productionSaveErrorMessage({ code: "P2520", message: "Production through 28/09/2026 is settled." }),
    "Production through 28/09/2026 is settled.",
  );
  assert.equal(
    productionSaveErrorMessage({ code: "P3306", message: "Production through 29/09/2026 is settled." }),
    "Production through 29/09/2026 is settled.",
  );
  assert.equal(
    productionSaveErrorMessage({ code: "42501", message: "Denied" }),
    "You do not have access to save this Production entry.",
  );
  assert.equal(
    isTransientProductionSaveFailure(new TypeError("Failed to fetch")),
    true,
  );
});
