import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const onboardingPage = readFileSync(new URL("../../app/onboarding/page.tsx", import.meta.url), "utf8");
const onboardingService = readFileSync(new URL("./services/onboarding-service.ts", import.meta.url), "utf8");
const disabledScreen = readFileSync(new URL("./components/account-access-disabled.tsx", import.meta.url), "utf8");
const authShell = readFileSync(new URL("./components/auth-shell.tsx", import.meta.url), "utf8");

test("onboarding resolves authoritative state before rendering its one-field form", () => {
  assert.match(onboardingPage, /resolveOnboardingAccess\(\)/);
  assert.match(onboardingPage, /viewState\.status === "loading"/);
  assert.match(onboardingPage, /viewState\.status === "disabled"/);
  assert.equal((onboardingPage.match(/<Input\b/g) ?? []).length, 1);
  assert.match(onboardingPage, /name="factoryName"/);
  assert.match(onboardingPage, /maxLength=\{FACTORY_NAME_MAX_LENGTH\}/);
  assert.doesNotMatch(onboardingPage, /GSTIN|address|phone|worker|brick type|opening balance|owner|admin/i);
});

test("onboarding routes signed-out, unconfirmed, and existing factory states safely", () => {
  assert.match(onboardingPage, /result\.state === "login"[\s\S]*router\.replace\("\/login"\)/);
  assert.match(onboardingPage, /result\.state === "verification"[\s\S]*routeToVerification/);
  assert.match(onboardingPage, /result\.state === "office"[\s\S]*router\.replace\("\/office"\)/);
  assert.match(onboardingPage, /savePendingSignupEmail\(email\)/);
});

test("factory submission is duplicate-locked and uses only the provisioning service", () => {
  assert.match(onboardingPage, /isSubmittingRef\.current/);
  assert.match(onboardingPage, /if \(viewState\.status !== "eligible" \|\| isSubmittingRef\.current\) return/);
  assert.match(onboardingPage, /provisionFirstFactory\(parsed\.data\)/);
  assert.doesNotMatch(onboardingPage, /\.from\("factories"\)|\.from\("factory_users"\)/);
});

test("the service uses dedicated generated RPC contracts", () => {
  assert.match(onboardingService, /supabase\.rpc\("provision_first_factory", args\)/);
  assert.match(onboardingService, /supabase\.rpc\("resolve_factory_access"\)/);
  assert.match(onboardingService, /p_factory_name: factoryName\.trim\(\)/);
  assert.doesNotMatch(onboardingService, /\.from\("factories"\)|\.from\("factory_users"\)/);
});

test("successful provisioning navigates directly to Office without an intermediate resolver", () => {
  assert.match(onboardingPage, /if \(result\.ok\)[\s\S]*router\.replace\("\/office"\)[\s\S]*router\.refresh\(\)/);
  assert.doesNotMatch(onboardingPage, /result\.created\s*===|if \(result\.created\)/);
  const provisionFunction = onboardingService.slice(
    onboardingService.indexOf("export async function provisionFirstFactory"),
    onboardingService.indexOf("export async function resolveFactoryAccessStatus"),
  );
  assert.doesNotMatch(provisionFunction, /resolve_factory_access|resolveFactoryAccess/);
});

test("empty-name and placeholder provisioning probes are completely removed", () => {
  assert.doesNotMatch(onboardingService + onboardingPage, /provisionFirstFactory\(\s*["']\s*["']/);
  assert.doesNotMatch(onboardingService + onboardingPage, /provision_first_factory[\s\S]{0,160}p_factory_name:\s*["']\s*["']/);
});

test("inactive accounts use the reference hierarchy and cannot reactivate themselves", () => {
  assert.match(disabledScreen, /accessDisabledTitle/);
  assert.match(disabledScreen, /accessDisabledDescription/);
  assert.match(disabledScreen, /accessDisabledHelp/);
  assert.match(disabledScreen, /<LogoutButton v2 fullWidth \/>/);
  assert.doesNotMatch(disabledScreen + onboardingPage, /reactivate|is_active\s*=|\.update\(/i);
});

test("duplicate names are not checked client-side", () => {
  assert.doesNotMatch(onboardingPage + onboardingService, /name already taken|unique factory|checkFactoryName|factories.*name.*eq/i);
});

test("onboarding stays responsive through the shared shell without mobile duplication", () => {
  assert.match(onboardingPage, /<AuthShell/);
  assert.match(onboardingPage, /<Button[\s\S]*type="submit"[\s\S]*fullWidth/);
  assert.match(authShell, /w-full max-w-md/);
  assert.doesNotMatch(onboardingPage + disabledScreen, /md:hidden|lg:hidden|hidden md:|hidden lg:/);
  assert.doesNotMatch(onboardingPage + disabledScreen, /overflow-x|w-screen|min-w-/);
});

test("onboarding sources use Atlas tokens without raw or arbitrary styling", () => {
  for (const source of [onboardingPage, disabledScreen]) {
    assert.doesNotMatch(
      source,
      /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
    );
  }
});
