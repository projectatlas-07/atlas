import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const rangeService = readFileSync(
  new URL("../wages/services/mud-supply-range-summary-service.ts", import.meta.url),
  "utf8",
);
const sharedRange = readFileSync(
  new URL("../wages/wage-earnings-date-range.ts", import.meta.url),
  "utf8",
);
const currentMudMigration = readFileSync(
  new URL("../../../supabase/migrations/20260810000005_remove_is_placeholder.sql", import.meta.url),
  "utf8",
);
const mudArea = dashboard.slice(
  dashboard.indexOf("function MudSupplyWageCalculation"),
  dashboard.indexOf("function LabourGroupWithdrawalPanel"),
);
const groupFinance = dashboard.slice(
  dashboard.indexOf("function LabourGroupWithdrawalPanel"),
  dashboard.indexOf("function AddBrickTypeForm"),
);
const officialMudCalculator = currentMudMigration.slice(
  currentMudMigration.indexOf("create or replace function public.calculate_mud_supply_wages"),
  currentMudMigration.indexOf("do $$", currentMudMigration.indexOf("create or replace function public.calculate_mud_supply_wages")),
);

test("Mud range defaults fresh mounts to the shared This Week controls", () => {
  for (const label of ["This Week", "Last Week", "This Month", "Custom"]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(sharedRange, /DEFAULT_WAGE_EARNINGS_DATE_PRESET = "this_week"/);
  assert.match(mudArea, /useState<WageEarningsDatePreset>\(\s*DEFAULT_WAGE_EARNINGS_DATE_PRESET/);
  assert.match(mudArea, /resolveWageEarningsDateRange/);
  assert.doesNotMatch(mudArea, /localStorage|sessionStorage/);
});

test("Mud range uses the current official all-valid-production eligibility contract", () => {
  assert.match(officialMudCalculator, /from public\.production_entries/);
  assert.match(officialMudCalculator, /join public\.labourers/);
  assert.match(officialMudCalculator, /labourers\.factory_id = production_entries\.factory_id/);
  assert.doesNotMatch(officialMudCalculator, /is_placeholder/);
  assert.match(rangeService, /\.from\("production_entries"\)/);
  assert.doesNotMatch(rangeService, /is_active|is_placeholder/);
});

test("Mud production read is factory-scoped and inclusive on authoritative work dates", () => {
  assert.match(rangeService, /\.eq\("factory_id", factoryId\)/);
  assert.match(rangeService, /\.gte\("production_date", range\.fromDate\)/);
  assert.match(rangeService, /\.lte\("production_date", range\.toDate\)/);
  assert.doesNotMatch(rangeService, /created_at/);
});

test("range summary is factory-level and visibly separate from group finance", () => {
  for (const label of ["Mud range summary", "Earnings period", "Range Production", "Range Earned"]) {
    assert.match(mudArea, new RegExp(label));
  }
  assert.match(mudArea, /Factory-level informational summary/);
  assert.match(mudArea, /not attributed to a labour group/);
  for (const label of ["Group Balance", "Available Balance", "Total Earned", "Total Withdrawn", "Withdrawal History"]) {
    assert.match(groupFinance, new RegExp(label));
  }
});

test("range changes only the read-only production query and not weekly or group accounts", () => {
  assert.match(mudArea, /"mud-supply-range-summary"[\s\S]*mudRange\?\.fromDate[\s\S]*mudRange\?\.toDate/);
  assert.match(mudArea, /refetchInterval: 30_000/);
  assert.match(mudArea, /calculateMudSupplyWages/);
  assert.match(groupFinance, /"labour-group-available-balance", factoryId, labourGroup\.groupId, asOfDate/);
  assert.match(groupFinance, /"labour-group-withdrawal-history", factoryId, labourGroup\.groupId/);
  assert.doesNotMatch(groupFinance, /mudRange|rangePreset|customFrom|customTo/);
});

test("Mud range calculation reuses the weekly rate resolver and formula without writes", () => {
  assert.match(rangeService, /getMondayWageWeekStart/);
  assert.match(rangeService, /getActiveMudSupplyRate/);
  assert.match(rangeService, /calculateMudSupplyGroupWage/);
  assert.doesNotMatch(rangeService, /weekly_earnings|withdrawals/);
  assert.doesNotMatch(rangeService, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
