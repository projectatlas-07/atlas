import assert from "node:assert/strict";
import { mock, test } from "node:test";

const calls: Array<[string, Record<string, unknown>]> = [];
let response: { data: unknown; error: null | { message: string; code: string; details: null; hint: null } } = { data: [], error: null };
const fakeSupabase = { async rpc(name: string, args: Record<string, unknown>) { calls.push([name, args]); return response; } };

await mock.module("../../../lib/supabase/client.ts", { namedExports: { supabase: fakeSupabase } });
const service = await import("./mud-cutover-readiness-service.ts");

test("maps exact READY boundary and per-group Legacy Opening preview", async () => {
  calls.length = 0;
  response = { data: [
    { readiness_status: "READY_FOR_CUTOVER", reason: "Ready", certification_week: "2026-09-21", final_legacy_week_start: "2026-09-21", final_legacy_week_end: "2026-09-27", proposed_legacy_cutoff: "2026-09-27", settlement_start_date: "2026-09-28", labour_group_id: "group-a", group_name: "Group A", legacy_locked_earning_total: "60000.25", existing_withdrawals: "25000.10", proposed_opening_amount: "60000.25", resulting_balance: "35000.15" },
    { readiness_status: "READY_FOR_CUTOVER", reason: "Ready", certification_week: "2026-09-21", final_legacy_week_start: "2026-09-21", final_legacy_week_end: "2026-09-27", proposed_legacy_cutoff: "2026-09-27", settlement_start_date: "2026-09-28", labour_group_id: "group-b", group_name: "Group B", legacy_locked_earning_total: "0", existing_withdrawals: "0", proposed_opening_amount: "0", resulting_balance: "0" },
  ], error: null };

  const result = await service.getMudCutoverReadiness("factory-1");
  assert.equal(result.status, "READY_FOR_CUTOVER");
  assert.equal(result.proposedLegacyCutoff, "2026-09-27");
  assert.equal(result.settlementStartDate, "2026-09-28");
  assert.deepEqual(result.groups.map((group) => [group.groupName, group.proposedOpeningAmount, group.existingWithdrawals, group.resultingBalance]), [
    ["Group A", 60000.25, 25000.1, 35000.15],
    ["Group B", 0, 0, 0],
  ]);
  assert.deepEqual(calls, [["get_mud_cutover_readiness", { p_factory_id: "factory-1" }]]);
});

test("maps BLOCKED without fabricating preview rows", async () => {
  response = { data: [{ readiness_status: "BLOCKED", reason: "Certification is not ready", certification_week: null, final_legacy_week_start: null, final_legacy_week_end: null, proposed_legacy_cutoff: null, settlement_start_date: null, labour_group_id: null, group_name: null, legacy_locked_earning_total: null, existing_withdrawals: null, proposed_opening_amount: null, resulting_balance: null }], error: null };
  assert.deepEqual(await service.getMudCutoverReadiness("factory-1"), {
    status: "BLOCKED",
    reason: "Certification is not ready",
    certificationWeek: null,
    finalLegacyWeekStart: null,
    finalLegacyWeekEnd: null,
    proposedLegacyCutoff: null,
    settlementStartDate: null,
    groups: [],
  });
});

test("preserves RPC errors and rejects missing factories", async () => {
  response = { data: null, error: { message: "Denied", code: "42501", details: null, hint: null } };
  await assert.rejects(() => service.getMudCutoverReadiness("factory-1"), (error: unknown) => error instanceof service.MudCutoverReadinessError && error.code === "42501");
  await assert.rejects(() => service.getMudCutoverReadiness(""), /Factory is required/);
});

test("confirmed cutover calls only the existing atomic authority and maps its audit result", async () => {
  calls.length = 0;
  response = { data: [{
    legacy_opening_settlement_id: "opening-1",
    final_legacy_week_start: "2026-09-21",
    legacy_cutoff: "2026-09-27",
    settlement_start_date: "2026-09-28",
    group_openings: 2,
    transition_audit_id: "audit-1",
    actor: "user-1",
    cutover_at: "2026-09-28T04:30:00Z",
  }], error: null };
  assert.deepEqual(await service.executeMudSettlementCutover({ factoryId: "factory-1", proposedLegacyCutoff: "2026-09-27" }), {
    legacyOpeningSettlementId: "opening-1",
    finalLegacyWeekStart: "2026-09-21",
    legacyCutoff: "2026-09-27",
    settlementStartDate: "2026-09-28",
    groupOpenings: 2,
    transitionAuditId: "audit-1",
    actor: "user-1",
    cutoverAt: "2026-09-28T04:30:00Z",
  });
  assert.deepEqual(calls, [["execute_mud_settlement_cutover", { p_factory_id: "factory-1", p_proposed_legacy_cutoff: "2026-09-27" }]]);
});

test("blocked, stale, duplicate, and reconciliation failures stay controlled", async () => {
  for (const [code, message, expected] of [
    ["P3100", "certification failed", /certification is no longer ready/i],
    ["P3200", "Mud cutover readiness is BLOCKED.", /readiness changed/i],
    ["P3200", "Mud cutover requires current SHADOW accounting mode.", /no longer in SHADOW/i],
    ["P3202", "Created openings do not reconcile", /could not be reconciled safely/i],
    ["23505", "duplicate key", /cutover already exists/i],
  ] as const) {
    response = { data: null, error: { message, code, details: null, hint: null } };
    await assert.rejects(
      () => service.executeMudSettlementCutover({ factoryId: "factory-1", proposedLegacyCutoff: "2026-09-27" }),
      expected,
    );
  }
});

test("invalid cutover input stops before the database", async () => {
  calls.length = 0;
  await assert.rejects(() => service.executeMudSettlementCutover({ factoryId: "", proposedLegacyCutoff: "2026-09-27" }), /Factory is required/);
  await assert.rejects(() => service.executeMudSettlementCutover({ factoryId: "factory-1", proposedLegacyCutoff: "" }), /valid proposed legacy cutoff/);
  assert.deepEqual(calls, []);
});
