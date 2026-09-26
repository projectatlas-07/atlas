import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/chamber-transport-management-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/transport-office-section.tsx", import.meta.url),
  "utf8",
);

test("Manage setup opens a responsive right-side V2 drawer over the unchanged overview", () => {
  assert.match(officeSection, /<ChamberTransportWorkforceOverview/);
  assert.match(officeSection, /<ChamberTransportManagementDrawer/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-lg/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("worker and group lifecycle operations keep their existing factory-scoped services", () => {
  for (const operation of [
    "createTransportWorker",
    "activateTransportWorker",
    "deactivateTransportWorker",
    "createTransportGroup",
    "activateTransportGroup",
    "deactivateTransportGroup",
  ]) {
    assert.match(drawer, new RegExp(`${operation}\\(`));
  }
  assert.match(drawer, /buildTransportWorkerCreateInput\(factoryId, name\)/);
  assert.match(drawer, /buildTransportGroupCreateInput\(\{ factoryId, name \}\)/);
});

test("membership controls preserve many-to-many assignment without a batch or one-group rule", () => {
  assert.match(drawer, /groups\.map\(\(group\)/);
  assert.match(drawer, /workerAssignments\.some\(\(assignment\) => assignment\.transportGroupId === group\.id\)/);
  assert.match(drawer, /assignTransportWorkerToGroup\(\{ factoryId, transportWorkerId: worker\.id, transportGroupId: group\.id \}\)/);
  assert.match(drawer, /unassignTransportWorkerFromGroup\(\{ factoryId, assignmentId: existing!\.id \}\)/);
  assert.match(drawer, /workers may belong to multiple Transport Groups/);
  assert.match(drawer, /assignmentsError[\s\S]*Memberships unavailable/);
  assert.doesNotMatch(drawer, /Save memberships|move worker|primary group|one-worker-one-group/i);
});

test("effective-dated group rates and their history remain authoritative", () => {
  assert.match(drawer, /getTransportGroupWageRateForDate\(/);
  assert.match(drawer, /createTransportGroupWageRate\(input\)/);
  assert.match(drawer, /listTransportGroupWageRates\(/);
  assert.match(drawer, /buildTransportGroupWageRateInput\(\{/);
  assert.match(drawer, /effectiveFrom/);
  assert.match(drawer, /Rate history/);
  assert.match(drawer, /formatDateOnly\(rate\.effectiveFrom\)/);
});

test("weekly controls retain immutable calculation and snapshot reads", () => {
  assert.match(drawer, /calculateTransportWeeklyWages\(input\)/);
  assert.match(drawer, /listTransportWeeklyEarnings\(/);
  assert.match(drawer, /listTransportWeeklyEarningDetails\(/);
  assert.match(drawer, /Already calculated/);
  assert.match(drawer, /Saved snapshots are shown without recalculation/);
  assert.match(drawer, /<StatusPill label="Locked" tone="success" \/>/);
});

test("drawer stays domain-correct and uses Atlas V2 presentation contracts", () => {
  for (const primitive of ["Button", "Card", "Checkbox", "EmptyState", "Feedback", "FormField", "Input", "StatusPill"]) {
    assert.match(drawer, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(drawer, /work_direction|direction|individual worker rate|payment method|notes|effective-dated assignment/i);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
