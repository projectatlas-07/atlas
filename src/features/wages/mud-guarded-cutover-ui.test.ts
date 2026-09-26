import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(
  new URL("../office/components/mud-group-management.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("./services/mud-cutover-readiness-service.ts", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../../../supabase/verify_mud_atomic_cutover.sql", import.meta.url),
  "utf8",
);

test("BLOCKED SHADOW shows its reason without a usable cutover action", () => {
  assert.match(ui, /Cutover readiness: \{ready \? "Ready" : "Blocked"\}/);
  assert.match(ui, /\{readiness\.reason\}/);
  assert.match(ui, /\{hasCompletePreview && <button[\s\S]*Switch to Settlement Accounting/);
  assert.doesNotMatch(ui, /readiness\.status === "BLOCKED"[\s\S]*executeMudSettlementCutover/);
});

test("READY confirmation shows exact boundary, group openings, and permanent warning", () => {
  for (const phrase of [
    "Confirm Settlement Accounting cutover",
    "Final legacy week",
    "Legacy cutoff",
    "Settlement begins",
    "Legacy Opening preview",
    "Opening earned",
    "Already withdrawn",
    "Opening balance",
    "permanently changes Mud’s financial authority",
    "I understand this permanent accounting change",
    "Confirm Permanent Cutover",
  ]) assert.match(ui, new RegExp(phrase));
  assert.match(ui, /disabled=\{!confirmedPermanentChange \|\| submitting\}/);
});

test("confirmed action delegates only factory and cutoff to the atomic RPC", () => {
  assert.match(service, /supabase\.rpc\("execute_mud_settlement_cutover"/);
  assert.match(service, /p_factory_id: factoryId/);
  assert.match(service, /p_proposed_legacy_cutoff: proposedLegacyCutoff/);
  assert.doesNotMatch(service, /calculate_mud_cutover_readiness|create_mud_legacy_opening|transition_mud_accounting_mode/);
});

test("successful action refreshes mode and routes from legacy SHADOW to SETTLEMENT", () => {
  assert.match(ui, /await onCutover\(\)/);
  assert.match(ui, /invalidateQueries\(\{ queryKey: \["mud-accounting-mode", factoryId\]/);
  assert.match(ui, /mode === "SETTLEMENT" && <SettlementMudAccounting/);
  assert.match(ui, /mode === "LEGACY_WEEKLY" \|\| mode === "SHADOW"/);
  assert.match(ui, /<MudGroupAccountDrawer/);
});

test("database verifier owns stale, duplicate, isolation, and rollback guarantees", () => {
  for (const phrase of [
    "post-cutoff legacy withdrawal rejects cutover",
    "unreconciled legacy balance rejects cutover",
    "duplicate cutover is rejected",
    "invalid next-Monday configuration rejects cutover",
    "real factory is still SHADOW",
    "outer rollback restored every baseline count",
  ]) assert.match(verifier, new RegExp(phrase));
});
