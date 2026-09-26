import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/mud-group-management-drawer.tsx", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("./components/mud-group-management.tsx", import.meta.url),
  "utf8",
);

test("Group setup opens as the reference-style responsive management drawer", () => {
  assert.match(overview, /<MudGroupManagementDrawer/);
  assert.doesNotMatch(overview, /function AddMudGroupForm|function MudGroupCard/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
  assert.match(drawer, />Mud Group Management</);
});

test("all existing group mutations retain their exact controlled service contracts", () => {
  for (const operation of [
    "createMudGroup",
    "editMudGroupMembers",
    "setMudGroupRate",
    "stopMudGroupEarning",
    "restartMudGroupEarning",
  ]) assert.match(drawer, new RegExp(`${operation}\\(`));

  for (const field of [
    "memberCount: Number(memberCount)",
    "earningStartDate: startDate",
    "initialRate: Number(rate)",
    "rateEffectiveDate: rateDate",
    "memberCount: Number(members)",
    "effectiveFrom: memberDate",
    "ratePer1000Bricks: Number(rate)",
    "effectiveFrom: rateDate",
    "stopDate: statusDate",
    "memberCount: Number(restartMembers)",
    "restartDate: statusDate",
  ]) assert.ok(drawer.includes(field), `${field} remains wired`);
});

test("management uses compact cards and one inline edit state per group", () => {
  assert.match(drawer, /type EditingSection = "members" \| "rate" \| "status" \| null/);
  assert.match(drawer, /StatusPill label=\{group\.isEarning \? "Earning" : "Stopped"\}/);
  assert.match(drawer, /editingSection === "members"/);
  assert.match(drawer, /editingSection === "rate"/);
  assert.match(drawer, /editingSection === "status"/);
  assert.match(drawer, /Current rate/);
  assert.match(drawer, /Effective from/);
  assert.match(drawer, /First non-earning date/);
  assert.match(drawer, /Restart date/);
});

test("SHADOW previews and diagnostics remain separate from payable accounting", () => {
  assert.match(drawer, /Operational allocation previews are SHADOW previews\. They are not payable balances/);
  assert.match(drawer, /Operational SHADOW context only\. These values are not payable balances/);
  assert.match(drawer, /Advanced \/ Accounting diagnostics/);
  assert.match(overview, /accountingDiagnostics=\{mode === "SHADOW"/);
  assert.doesNotMatch(drawer, /getLabourGroupAvailableBalance|createLabourGroupWithdrawal|calculateMudSupplyWages/);
  assert.doesNotMatch(drawer, /Paid \/ Unpaid|Pay All|payment method|notes|individual Mud|settlement cutoff/i);
});

test("forms block duplicate activation and use only Atlas V2 presentation contracts", () => {
  assert.match(drawer, /if \(submitting\) return/);
  assert.match(drawer, /if \(working\) return/);
  assert.match(drawer, /loading=\{submitting\}/);
  assert.match(drawer, /loading=\{working\}/);
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "FormField", "Input", "StatusPill"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
