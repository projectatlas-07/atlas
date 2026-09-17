import assert from "node:assert/strict";
import { mock, test } from "node:test";

let rpcResponse: { data: unknown; error: null | { message: string; code: string; details: null; hint: null } };
const calls: Array<[string, Record<string, unknown>]> = [];
const fakeSupabase = {
  async rpc(name: string, args: Record<string, unknown>) {
    calls.push([name, args]);
    return rpcResponse;
  },
};

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const { getMudShadowCertification, MudShadowCertificationError } = await import("./mud-shadow-certification-service.ts");

test("maps certification evidence without rounding financial values", async () => {
  calls.length = 0;
  rpcResponse = { data: [{
    certification_status: "READY",
    certification_week: "2026-08-31",
    legacy_earning: "700.125",
    new_engine_earning: "700.125",
    difference: "0",
    parity_status: "PARITY_OK",
    reason: "Exact parity.",
  }], error: null };

  assert.deepEqual(await getMudShadowCertification("factory-1"), {
    status: "READY",
    certificationWeek: "2026-08-31",
    legacyEarning: 700.125,
    newEngineEarning: 700.125,
    difference: 0,
    parityStatus: "PARITY_OK",
    reason: "Exact parity.",
  });
  assert.deepEqual(calls, [["get_mud_shadow_certification_status", { p_factory_id: "factory-1" }]]);
});

test("preserves controlled certification RPC errors", async () => {
  rpcResponse = { data: null, error: { message: "Denied", code: "42501", details: null, hint: null } };
  await assert.rejects(() => getMudShadowCertification("factory-1"), (error: unknown) =>
    error instanceof MudShadowCertificationError && error.code === "42501");
});

test("requires a factory", async () => {
  await assert.rejects(() => getMudShadowCertification(""), /Factory is required/);
});
