import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./components/office-dashboard.tsx", import.meta.url), "utf8");
const mudUi = readFileSync(new URL("./components/mud-group-management.tsx", import.meta.url), "utf8");
const mudDrawer = readFileSync(new URL("./components/mud-group-account-drawer.tsx", import.meta.url), "utf8");
const managementDrawer = readFileSync(new URL("./components/mud-group-management-drawer.tsx", import.meta.url), "utf8");
const allocationService = readFileSync(new URL("../wages/services/mud-multi-group-allocation-service.ts", import.meta.url), "utf8");
const configurationService = readFileSync(new URL("../wages/services/mud-group-configuration-service.ts", import.meta.url), "utf8");
const sharedRange = readFileSync(new URL("../wages/wage-earnings-date-range.ts", import.meta.url), "utf8");

test("Office mounts one dedicated Mud multi-group section", () => {
  assert.match(dashboard, /import \{ MudGroupManagement \}/);
  assert.match(dashboard, /<MudGroupManagement factoryId=\{factoryId!\} \/>/);
  assert.doesNotMatch(dashboard, /function MudSupplyWageCalculation|function MudSupplyRateControl|function LabourGroupManagement/);
});

test("operational range keeps the established four date controls and defaults to this week", () => {
  for (const label of ["This week", "Last week", "This month", "Custom"]) assert.ok(mudUi.includes(label));
  assert.match(sharedRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(mudUi, /resolveWageEarningsDateRange/);
  assert.match(mudUi, /"mud-group-range-allocation"/);
});

test("group setup keeps configuration and labels SHADOW allocation values as operational", () => {
  for (const label of ["Current rate", "Members", "Stop earning", "Restart earning", "Allocated production", "Allocation value", "Per-member share"]) {
    assert.ok(managementDrawer.includes(label), `${label} remains visible`);
  }
  assert.match(managementDrawer, /SHADOW previews\. They are not payable balances/);
  assert.match(managementDrawer, /Add Mud Group/);
  assert.match(mudUi, /getMudGroupRangeAllocation/);
  assert.match(allocationService, /informationalPerMemberEarned \+= row\.earned_amount \/ row\.member_count/);
});

test("the UI uses only controlled configuration RPC services", () => {
  for (const operation of ["createMudGroup", "editMudGroupMembers", "setMudGroupRate", "stopMudGroupEarning", "restartMudGroupEarning"]) assert.match(managementDrawer, new RegExp(operation));
  assert.doesNotMatch(configurationService, /\.from\("mud_group_(terms|rates)"\)[\s\S]*\.(insert|update|delete)\(/);
});

test("legacy weekly finance is visibly separate and remains the only SHADOW money authority", () => {
  assert.match(mudUi, /Legacy weekly accounting remains the authoritative source for Mud payable balances/);
  assert.match(mudUi, /<MudGroupAccountDrawer/);
  assert.match(mudDrawer, /Legacy weekly financial account/);
  assert.match(mudDrawer, /calculateMudSupplyWages/);
  assert.match(mudDrawer, /createLabourGroupWithdrawal/);
  assert.match(mudDrawer, /SHADOW allocation values are excluded/);
  assert.match(mudUi, /Production below is operational context, not payable earnings/);
  assert.match(mudUi, /isAuthoritativeLegacyGroup/);
  assert.match(mudUi, /Not in weekly account/);
  assert.doesNotMatch(allocationService, /weekly_earnings|withdrawals|settlements|\.insert\(|\.update\(|\.delete\(/);
});

test("SHADOW diagnostics remain available only inside group setup", () => {
  assert.match(mudUi, /getMudShadowCertification/);
  assert.match(mudUi, /SHADOW certification:/);
  assert.match(mudUi, /certification\.reason/);
  assert.match(mudUi, /showAdministration && <MudGroupManagementDrawer[\s\S]*accountingDiagnostics=[\s\S]*MudShadowCertificationMessage/);
  assert.match(managementDrawer, /Advanced \/ Accounting diagnostics/);
});

test("SHADOW shows compact read-only cutover readiness and future boundary dates", () => {
  assert.match(mudUi, /getMudCutoverReadiness/);
  assert.match(mudUi, /Cutover readiness:/);
  assert.match(mudUi, /Final legacy week:/);
  assert.match(mudUi, /Settlement accounting begins:/);
  assert.doesNotMatch(mudUi, /Run Cutover|Create Legacy Opening|Transition to SETTLEMENT/);
});

test("Mud V2 overview stays group-level and uses only authoritative payment history", () => {
  for (const heading of ["Mud group", "Members", "Operational rate", "Production", "Weekly balance", "Last paid", "Action"]) {
    assert.match(mudUi, new RegExp(`TableHeaderCell(?: numeric)?>${heading}`));
  }
  assert.match(mudUi, /getLabourGroupAvailableBalance/);
  assert.match(mudUi, /getLabourGroupWithdrawalHistory/);
  assert.match(mudUi, /legacyHistoryQuery\.data\?\.\[0\]/);
  assert.match(mudUi, /formatMudGroupLastPaid/);
  assert.match(mudUi, /Account &amp; payment/);
  assert.doesNotMatch(mudUi, /Paid \/ Unpaid|Pay All|individual Mud/i);
  assert.doesNotMatch(mudDrawer, /Paid \/ Unpaid|Pay All|individual Mud|payment method|notes/i);
});

test("Mud V2 overview uses shared primitives and distinct desktop/mobile layouts", () => {
  for (const primitive of ["Button", "EmptyState", "Feedback", "FormField", "Input", "TableContainer"]) {
    assert.match(mudUi, new RegExp(`<${primitive}\\b`));
  }
  assert.match(mudUi, /hidden md:block/);
  assert.match(mudUi, /md:hidden/);
  assert.match(mudUi, /label="Search Mud groups"/);
  assert.doesNotMatch(mudUi.slice(0, mudUi.indexOf("function MudCutoverReadinessMessage")), /Search operators, units, logs|global search/i);
});
