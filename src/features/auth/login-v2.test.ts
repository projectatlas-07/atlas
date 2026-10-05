import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginPage = readFileSync(
  new URL("../../app/login/page.tsx", import.meta.url),
  "utf8",
);
const authShell = readFileSync(
  new URL("./components/auth-shell.tsx", import.meta.url),
  "utf8",
);
const card = readFileSync(
  new URL("../../components/ui/card.ts", import.meta.url),
  "utf8",
);
const forgotPasswordPage = readFileSync(
  new URL("../../app/forgot-password/page.tsx", import.meta.url),
  "utf8",
);
const signupPage = readFileSync(
  new URL("../../app/signup/page.tsx", import.meta.url),
  "utf8",
);

test("login renders the shared Authentication V2 hierarchy with existing primitives", () => {
  assert.match(loginPage, /<AuthShell[\s\S]*loginTitle[\s\S]*loginDescription/);
  assert.equal((loginPage.match(/<form\b/g) ?? []).length, 1);
  assert.equal((loginPage.match(/<Input\b/g) ?? []).length, 2);
  assert.match(loginPage, /type="email"[\s\S]*autoComplete="email"/);
  assert.match(loginPage, /autoComplete="current-password"/);
  assert.match(loginPage, /<Feedback role="alert" tone="danger">/);
  assert.match(loginPage, /<Button[\s\S]*type="submit"[\s\S]*fullWidth/);
});

test("password visibility is an accessible single-field toggle", () => {
  assert.match(loginPage, /useState\(false\)[\s\S]*showPassword/);
  assert.match(loginPage, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(loginPage, /aria-label=\{passwordToggleLabel\}/);
  assert.match(loginPage, /aria-pressed=\{showPassword\}/);
  assert.match(loginPage, /setShowPassword\(\(isVisible\) => !isVisible\)/);
});

test("login navigation points to the staged recovery route and implemented signup route", () => {
  assert.match(loginPage, /<Link href="\/forgot-password"/);
  assert.match(loginPage, /<Link href="\/signup"/);
  assert.match(forgotPasswordPage, /function ForgotPasswordPage/);
  assert.match(signupPage, /function SignupPage/);
  assert.match(forgotPasswordPage, /<Link href="\/login"/);
  assert.match(signupPage, /<Link href="\/login"/);
});

test("signed-in login access uses session plus authoritative factory resolution", () => {
  assert.match(loginPage, /supabase\.auth\.getSession\(\)/);
  assert.match(loginPage, /resolvePostLoginDestination\(\)/);
  assert.match(loginPage, /router\.replace\(result\.destination\)/);
  assert.doesNotMatch(loginPage, /getOfficeProductionHref|#brick-production/);
});

test("responsive auth structure is one narrow fluid shell, not separate mobile markup", () => {
  assert.match(authShell, /min-h-screen/);
  assert.match(authShell, /px-atlas-4/);
  assert.match(authShell, /sm:px-atlas-5/);
  assert.match(authShell, /w-full max-w-md/);
  assert.match(authShell, /<Card as="section" padding="comfortable"/);
  assert.match(card, /comfortable: "p-atlas-6 sm:p-atlas-8"/);
  assert.doesNotMatch(loginPage + authShell, /md:hidden|lg:hidden|hidden md:|hidden lg:/);
  assert.doesNotMatch(loginPage + authShell, /overflow-x|w-screen|min-w-/);
});

test("Authentication V2 presentation uses Atlas tokens without raw colors or arbitrary values", () => {
  for (const source of [loginPage, authShell, forgotPasswordPage, signupPage]) {
    assert.doesNotMatch(
      source,
      /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
    );
  }
});
