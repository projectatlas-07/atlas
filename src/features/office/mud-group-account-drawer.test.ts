import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/mud-group-account-drawer.tsx", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("./components/mud-group-management.tsx", import.meta.url),
  "utf8",
);

test("Mud account opens as a focused responsive dialog over the overview", () => {
  assert.match(overview, /<MudGroupAccountDrawer/);
  assert.doesNotMatch(overview, /function LegacyMudAccounting/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("drawer reads and writes only the existing authoritative Mud account sources", () => {
  for (const authority of [
    "getLabourGroupAvailableBalance",
    "getLabourGroupWithdrawalHistory",
    "createLabourGroupWithdrawal",
    "calculateMudSupplyWages",
    "getMudSupplyWeeklyEarning",
    "setMudSupplyRate",
  ]) {
    assert.match(drawer, new RegExp(`${authority}\\(`));
  }
  assert.match(drawer, /completed locked legacy weeks and real group withdrawals/);
  assert.match(drawer, /SHADOW allocation values are excluded/);
  assert.doesNotMatch(drawer, /getMudGroupRangeAllocation|earnedAmount|weeklyAllocation/);
  assert.doesNotMatch(drawer, /Paid \/ Unpaid|Pay All|payment method|remarks|notes|individual Mud/i);
  assert.doesNotMatch(drawer, /settlement cutoff|settledThrough|SETTLEMENT/);
});

test("payment, weekly calculation, and rate writes guard duplicate activation", () => {
  assert.match(drawer, /if \(isPaying\) return/);
  assert.match(drawer, /if \(isCalculating\) return/);
  assert.match(drawer, /if \(isSavingRate\) return/);
  assert.match(drawer, /loading=\{isPaying\}/);
  assert.match(drawer, /loading=\{isCalculating\}/);
  assert.match(drawer, /loading=\{isSavingRate\}/);
  assert.match(drawer, /inputMode="decimal"/);
  assert.match(drawer, /amount: numericAmount/);
  assert.doesNotMatch(drawer, /max=\{asOfDate\}/);
});

test("drawer uses the V2 primitives and tokens without inventing a visual system", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "TableContainer"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.match(drawer, /text-atlas-3xl/);
  assert.match(drawer, /border-atlas-border/);
  assert.match(drawer, /bg-atlas-surface/);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
