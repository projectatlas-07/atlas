import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveLegacyProductionRedirect } from "./manager-workflow-navigation.ts";

const rootPageSource = readFileSync(
  new URL("../../app/page.tsx", import.meta.url),
  "utf8",
);
const officePageSource = readFileSync(
  new URL("../../app/office/page.tsx", import.meta.url),
  "utf8",
);
const officeDashboardSource = readFileSync(
  new URL("../office/components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const authGuardSource = readFileSync(
  new URL("../auth/components/auth-guard.tsx", import.meta.url),
  "utf8",
);
const startupRedirectSource = readFileSync(
  new URL("../office/components/office-startup-redirect.tsx", import.meta.url),
  "utf8",
);
const loginPageSource = readFileSync(
  new URL("../../app/login/page.tsx", import.meta.url),
  "utf8",
);
const loginServiceSource = readFileSync(
  new URL("../auth/services/login-service.ts", import.meta.url),
  "utf8",
);

test("retired root recording hashes redirect to matching Office Production tabs", () => {
  assert.equal(resolveLegacyProductionRedirect("#brick-production"), "/office#brick-production");
  assert.equal(resolveLegacyProductionRedirect("#chamber-transport"), "/office#chamber-transport");
  assert.equal(resolveLegacyProductionRedirect("#soil"), "/office#soil");
});

test("legacy aliases, the bare root, and unknown hashes safely use inline Brick Production", () => {
  assert.equal(resolveLegacyProductionRedirect("#production"), "/office#brick-production");
  assert.equal(resolveLegacyProductionRedirect("#transport"), "/office#chamber-transport");
  assert.equal(resolveLegacyProductionRedirect("#unknown"), "/office#brick-production");
  assert.equal(resolveLegacyProductionRedirect(""), "/office#brick-production");
});

test("the root startup boundary redirects without mounting auth or retired workflow UI", () => {
  assert.match(rootPageSource, /<OfficeStartupRedirect\s*\/>/);
  assert.doesNotMatch(rootPageSource, /AuthGuard|ManagerEntryScreen|ProductionEntryScreen|SoilDailyEntryScreen|TransportDailyEntryScreen/);
  assert.match(startupRedirectSource, /window\.location\.replace\(resolveLegacyProductionRedirect\(window\.location\.hash\)\)/);
  assert.match(startupRedirectSource, /return null/);
  assert.doesNotMatch(startupRedirectSource, /Opening Production|useRouter|router\.(?:push|replace)/);
});

test("Office deep links mount Office directly and keep legitimate startup ownership there", () => {
  assert.match(officePageSource, /<AuthGuard><OfficeDashboard\s*\/><\/AuthGuard>/);
  assert.doesNotMatch(officePageSource, /ManagerEntryScreen|OfficeStartupRedirect|resolveLegacyProductionRedirect/);
  assert.match(officeDashboardSource, /const hash = window\.location\.hash/);
  assert.match(officeDashboardSource, /setActiveArea\(resolveOfficeAreaFromHash\(hash\)\)/);
  assert.match(officeDashboardSource, /window\.addEventListener\("hashchange", syncAreaFromHash\)/);
});

test("Office retains real session and factory loading with explicit failure handling", () => {
  assert.match(authGuardSource, /supabase\.auth\.getSession\(\)/);
  assert.match(authGuardSource, /supabase\.auth\.onAuthStateChange/);
  assert.match(officeDashboardSource, /resolveAuthenticatedFactoryId\(\)/);
  assert.match(officeDashboardSource, /Loading factory access\.\.\./);
  assert.match(officeDashboardSource, /factoryAccessStatus === "failed"/);
  assert.match(officeDashboardSource, />Try again<\/Button>/);
});

test("successful sign-in enters the canonical Office default without a root redirect hop", () => {
  assert.match(loginPageSource, /router\.replace\(result\.destination\)/);
  assert.match(loginServiceSource, /destination: "\/office"/);
  assert.match(loginServiceSource, /resolveAuthenticatedFactoryId/);
  assert.doesNotMatch(loginPageSource, /getOfficeProductionHref|#brick-production/);
  assert.doesNotMatch(loginPageSource, /router\.replace\("\/"\)/);
});
