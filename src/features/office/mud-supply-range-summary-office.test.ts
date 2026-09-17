import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./components/office-dashboard.tsx", import.meta.url), "utf8");
const mudUi = readFileSync(new URL("./components/mud-group-management.tsx", import.meta.url), "utf8");
const allocationService = readFileSync(new URL("../wages/services/mud-multi-group-allocation-service.ts", import.meta.url), "utf8");
const configurationService = readFileSync(new URL("../wages/services/mud-group-configuration-service.ts", import.meta.url), "utf8");
const sharedRange = readFileSync(new URL("../wages/wage-earnings-date-range.ts", import.meta.url), "utf8");

test("Office mounts one dedicated Mud multi-group section", () => {
  assert.match(dashboard, /import \{ MudGroupManagement \}/);
  assert.match(dashboard, /<MudGroupManagement factoryId=\{factoryId!\} \/>/);
  assert.doesNotMatch(dashboard, /function MudSupplyWageCalculation|function MudSupplyRateControl|function LabourGroupManagement/);
});

test("live range keeps the established four date controls and defaults to This Week", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom"]) assert.ok(mudUi.includes(label));
  assert.match(sharedRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(mudUi, /resolveWageEarningsDateRange/);
  assert.match(mudUi, /"mud-group-range-allocation"/);
});

test("each group shows configuration, live allocation, earning, and informational share", () => {
  for (const label of ["Current members", "Current rate / 1,000", "Edit Members", "Set Rate", "Stop Earning", "Restart Earning", "Allocated Production", "Live Mud earning", "Per-member share (informational)"]) {
    assert.ok(mudUi.includes(label), `${label} remains visible`);
  }
  assert.match(mudUi, /Add Mud Group/);
  assert.match(mudUi, /getMudGroupRangeAllocation/);
  assert.match(allocationService, /informationalPerMemberEarned \+= row\.earned_amount \/ row\.member_count/);
});

test("the UI uses only controlled configuration RPC services", () => {
  for (const operation of ["createMudGroup", "editMudGroupMembers", "setMudGroupRate", "stopMudGroupEarning", "restartMudGroupEarning"]) assert.match(mudUi, new RegExp(operation));
  assert.doesNotMatch(configurationService, /\.from\("mud_group_(terms|rates)"\)[\s\S]*\.(insert|update|delete)\(/);
});

test("legacy weekly finance is visibly separate and remains the only money authority", () => {
  assert.match(mudUi, /Financial accounting:[\s\S]*Legacy Weekly/);
  assert.match(mudUi, /Legacy Weekly Financial Accounting/);
  assert.match(mudUi, /calculateMudSupplyWages/);
  assert.match(mudUi, /createLabourGroupWithdrawal/);
  assert.match(mudUi, /does not create weekly earnings, withdrawals, balances, or settlements/);
  assert.doesNotMatch(allocationService, /weekly_earnings|withdrawals|settlements|\.insert\(|\.update\(|\.delete\(/);
});

test("SHADOW shows the small certification status without exposing a cutover action", () => {
  assert.match(mudUi, /getMudShadowCertification/);
  assert.match(mudUi, /SHADOW certification:/);
  assert.match(mudUi, /certification\.reason/);
  assert.doesNotMatch(mudUi, /Transition to Settlement|Enable Settlement|Start Settlement/);
});

test("SHADOW shows compact read-only cutover readiness and future boundary dates", () => {
  assert.match(mudUi, /getMudCutoverReadiness/);
  assert.match(mudUi, /Cutover readiness:/);
  assert.match(mudUi, /Final legacy week:/);
  assert.match(mudUi, /Settlement accounting begins:/);
  assert.doesNotMatch(mudUi, /Run Cutover|Create Legacy Opening|Transition to SETTLEMENT/);
});
