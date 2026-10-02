import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clearBrickTypeFromUnsavedChallanDraft } from "../office/sales-office-model.ts";

const salesSource = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const drawerSource = readFileSync(
  new URL("../office/components/brick-type-management-drawer.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../office/components/office-dashboard.tsx", import.meta.url),
  "utf8",
);

test("Challan creation exposes one contextual Brick Type management drawer", () => {
  assert.match(salesSource, /!challan && <ChallanButton[\s\S]*Manage brick types/);
  assert.match(salesSource, /<BrickTypeManagementDrawer[\s\S]*onBrickTypesChanged=\{onBrickTypesChanged\}/);
  assert.match(drawerSource, /role="dialog"[\s\S]*aria-labelledby="brick-types-drawer-title"/);
  assert.match(drawerSource, /Manage finished Brick Types available for Sales \/ Challans\./);
  assert.match(drawerSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawerSource, /event\.key === "Escape"/);
  assert.match(drawerSource, /aria-label="Close Brick Types"[\s\S]*onClick=\{requestClose\}/);
});

test("drawer uses every authoritative 10B lifecycle service and refreshes one canonical list", () => {
  for (const service of [
    "createBrickType",
    "renameBrickType",
    "deactivateBrickType",
    "reactivateBrickType",
    "deleteUnusedBrickType",
  ]) {
    assert.match(drawerSource, new RegExp(`await ${service}\\(`));
  }
  assert.match(drawerSource, /async function refreshBrickTypes\(\)[\s\S]*await onBrickTypesChanged\(\)/);
  assert.match(dashboardSource, /const loadBrickTypes = useCallback/);
  assert.match(dashboardSource, /setBrickTypes\(await listBrickTypes\(factoryId\)\)/);
  assert.match(dashboardSource, /onBrickTypesChanged=\{loadBrickTypes\}/);
  assert.doesNotMatch(drawerSource, /from\("brick_types"\)|supabase/);
});

test("add and rename preserve clean validation and stable IDs", () => {
  assert.match(drawerSource, /createBrickType\(\{ factoryId, name \}\)/);
  assert.match(drawerSource, /setName\(""\)/);
  assert.match(drawerSource, /renameBrickType\(\{ factoryId, brickTypeId: editingId, name: editName \}\)/);
  assert.doesNotMatch(drawerSource, /setEditingId\([^)]*updated|brickTypeId: crypto|randomUUID/);
  assert.match(drawerSource, /failure instanceof Error \? failure\.message/);
});

test("deactivate and delete require the exact confirmation copy", () => {
  assert.match(drawerSource, /setConfirmation\(\{ kind: "deactivate", brickType \}\)/);
  assert.match(drawerSource, /setConfirmation\(\{ kind: "delete", brickType \}\)/);
  assert.match(drawerSource, /Deactivate brick type\?/);
  assert.match(drawerSource, /This brick type will no longer be available for new Challans\. Existing Challans that already use it will remain unchanged\./);
  assert.match(drawerSource, /Delete brick type permanently\?/);
  assert.match(drawerSource, /This brick type has never been used in a saved Challan\. Deleting it cannot be undone\./);
  assert.match(drawerSource, /Delete permanently/);
});

test("used types never expose permanent delete and reactivation is direct", () => {
  assert.match(drawerSource, /!brickType\.everUsed && \([\s\S]*setConfirmation\(\{ kind: "delete", brickType \}\)/);
  assert.match(drawerSource, /onClick=\{\(\) => void reactivate\(brickType\)\}/);
  assert.doesNotMatch(drawerSource, /kind: "reactivate"/);
});

test("invalidated unsaved selections clear only Brick Type IDs", () => {
  const draft = {
    challanNumber: "CH-55",
    challanDate: "2026-10-03",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    selectedVehicleIsActive: true,
    vehicleDeliveryWageTrackingEnabled: true,
    tripLabourWage: "900",
    lines: [
      { key: "a", brickTypeId: "type-a", quantity: "2500", ratePer1000Bricks: "8000" },
      { key: "b", brickTypeId: "type-b", quantity: "1200", ratePer1000Bricks: "7000" },
      { key: "c", brickTypeId: "type-a", quantity: "300", ratePer1000Bricks: "7500", lineAmount: "2250" },
    ],
    flexibleLines: [{ key: "note-a", lineType: "NOTE" as const, particulars: "Keep this note" }],
  };

  const updated = clearBrickTypeFromUnsavedChallanDraft(draft, "type-a");
  assert.deepEqual(updated, {
    ...draft,
    lines: [
      { ...draft.lines[0], brickTypeId: "" },
      draft.lines[1],
      { ...draft.lines[2], brickTypeId: "" },
    ],
  });
  assert.equal(updated.customerId, draft.customerId);
  assert.equal(updated.lines[0].quantity, "2500");
  assert.equal(updated.lines[0].ratePer1000Bricks, "8000");
  assert.equal(updated.flexibleLines[0], draft.flexibleLines[0]);
  assert.match(salesSource, /if \(challan\) return;[\s\S]*clearBrickTypeFromUnsavedChallanDraft/);
});

test("correction keeps its established inactive Brick Type representation", () => {
  assert.match(salesSource, /brickType\.isActive \|\| brickType\.id === line\.brickTypeId/);
  assert.match(salesSource, /isManagingBrickTypes && !challan/);
});

test("Settings no longer owns Brick Type management and Production remains isolated", () => {
  assert.doesNotMatch(dashboardSource, /AddBrickTypeForm|BrickTypeManagement|Brick type settings/);
  assert.doesNotMatch(dashboardSource, /deactivateBrickType|reactivateBrickType|createBrickType/);
  const productionSource = readFileSync(
    new URL("../office/components/production-office-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(productionSource, /brickType|brick_type|Brick Type/i);
});
