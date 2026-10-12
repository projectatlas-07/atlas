import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

test("legacy factory API stays visibly unresolved and cannot acquire new production callers", () => {
  const root = new URL("../../../", import.meta.url);
  const legacy = readFileSync(new URL("features/auth/services/factory-access-service.ts", root), "utf8");
  assert.match(legacy, /@deprecated UNRESOLVED LEGACY AUTH/);
  assert.match(legacy, /shared getUser\(\).*remove a newer/s);
  assert.match(legacy, /queries can substitute its credentials/);
  const callers = readdirSync(root, { recursive: true }).filter((path) => /\.tsx?$/.test(String(path)) && !/\.test\./.test(String(path)))
    .map(String).filter((path) => path !== "features/auth/services/factory-access-service.ts" && readFileSync(new URL(path, root), "utf8").includes("resolveAuthenticatedFactoryId"));
  assert.deepEqual(callers.sort(), [
    "features/office/components/office-dashboard.tsx", "features/production/components/production-entry-screen.tsx",
    "features/sales/components/challan-print-screen.tsx", "features/sales/components/payment-receipt-screen.tsx",
    "features/soil/components/soil-daily-entry-screen.tsx", "features/transport/components/transport-daily-entry-screen.tsx",
  ].sort());
  for (const path of ["features/auth/services/login-service.ts", "features/auth/services/signup-service.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(path, root), "utf8"), /\bresolveAuthenticatedFactoryId\b/, `Migrated service restored a legacy reference: ${path}`);
  }
  // Each approved file has one import and one existing use. Also reject new
  // legacy uses inside a previously approved file, not just brand-new files.
  for (const path of callers) {
    assert.equal(readFileSync(new URL(path, root), "utf8").match(/\bresolveAuthenticatedFactoryId\b/g)?.length, 2, `Legacy reference inventory changed: ${path}`);
  }
  const scripts = new URL("../scripts/", root);
  for (const path of readdirSync(scripts, { recursive: true }).map(String).filter((path) => /\.[cm]?[jt]s$/.test(path) && !/\.test\./.test(path))) {
    assert.doesNotMatch(readFileSync(new URL(path, scripts), "utf8"), /\bresolveAuthenticatedFactoryId\b/, `Unapproved script caller: ${path}`);
  }
});
