import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signupPage = readFileSync(new URL("../../app/signup/page.tsx", import.meta.url), "utf8");
const verifyPage = readFileSync(new URL("../../app/signup/verify/page.tsx", import.meta.url), "utf8");
const onboardingPage = readFileSync(new URL("../../app/onboarding/page.tsx", import.meta.url), "utf8");
const passwordField = readFileSync(new URL("./components/password-field.tsx", import.meta.url), "utf8");
const otpInput = readFileSync(new URL("./components/signup-otp-input.tsx", import.meta.url), "utf8");
const authShell = readFileSync(new URL("./components/auth-shell.tsx", import.meta.url), "utf8");

test("signup renders the Authentication V2 account form and routes accepted submissions to verification", () => {
  assert.match(signupPage, /<AuthShell[\s\S]*signupTitle[\s\S]*signupDescription/);
  assert.equal((signupPage.match(/<form\b/g) ?? []).length, 1);
  assert.match(signupPage, /type="email"[\s\S]*autoComplete="email"/);
  assert.equal((signupPage.match(/<PasswordField\b/g) ?? []).length, 2);
  assert.match(signupPage, /signupWithPassword\([\s\S]*email:[\s\S]*password:/);
  assert.match(signupPage, /savePendingSignupEmail\(parsed\.data\.email\)/);
  assert.match(signupPage, /markSignupOtpRecentlySent\(\)/);
  assert.match(signupPage, /router\.push\("\/signup\/verify"\)/);
  assert.match(signupPage, /<Link href="\/login"/);
  assert.doesNotMatch(signupPage, /savePendingSignupEmail\([^)]*password/);
  assert.doesNotMatch(signupPage + passwordField, /onPaste|preventDefault\(\).*paste/i);
});

test("password visibility controls are accessible and preserve password-manager semantics", () => {
  assert.match(passwordField, /type=\{isVisible \? "text" : "password"\}/);
  assert.match(passwordField, /aria-label=\{`\$\{toggleLabel\}: \$\{label\}`\}/);
  assert.match(passwordField, /aria-pressed=\{isVisible\}/);
  assert.match(signupPage, /autoComplete="new-password"/);
});

test("verification uses an adaptable numeric one-time-code input and no email URL state", () => {
  assert.match(verifyPage, /<SignupOtpInput[\s\S]*length=\{AUTH_EMAIL_OTP_LENGTH\}/);
  assert.match(otpInput, /inputMode="numeric"/);
  assert.match(otpInput, /pattern="\[0-9\]\*"/);
  assert.match(otpInput, /autoComplete="one-time-code"/);
  assert.match(otpInput, /maxLength=\{length\}/);
  assert.match(otpInput, /normalizeSignupOtp\(event\.target\.value, length\)/);
  assert.match(otpInput, /Array\.from\(\{ length \}/);
  assert.doesNotMatch(verifyPage + signupPage, /[?&]email=|searchParams.*email/);
});

test("verification supports missing-email recovery, explicit resend, and changing email", () => {
  assert.match(verifyPage, /if \(pendingEmail === null\)/);
  assert.match(verifyPage, /pendingEmailSchema\.safeParse\(emailEntry\)/);
  assert.match(verifyPage, /async function resendCode\(\)/);
  assert.equal((verifyPage.match(/resendSignupOtp\(/g) ?? []).length, 1);
  assert.match(verifyPage, /consumeSignupOtpRecentlySent\(\)[\s\S]*setResendSeconds\(SIGNUP_RESEND_COOLDOWN_SECONDS\)/);
  assert.match(verifyPage, /resendSuccess/);
  assert.match(verifyPage, /clearPendingSignupEmail\(\)[\s\S]*router\.push\("\/signup"\)/);
});

test("verification effects restore state and decrement UI time only; they never send email", () => {
  const effects = verifyPage.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
  assert.equal(effects.length, 2);
  for (const effect of effects) {
    assert.doesNotMatch(effect, /resendSignupOtp|supabase\.auth\.resend/);
  }
  assert.match(verifyPage, /nextResendCountdown/);
});

test("verified users follow the service destination into the guarded onboarding flow", () => {
  assert.match(verifyPage, /verifySignupOtp\(pendingEmail, token\)/);
  assert.match(verifyPage, /router\.replace\(result\.destination\)/);
  assert.match(onboardingPage, /function OnboardingPage/);
  assert.match(onboardingPage, /resolveOnboardingAccess\(\)/);
  assert.match(onboardingPage, /<AuthShell/);
  assert.match(onboardingPage, /provisionFirstFactory\(parsed\.data\)/);
});

test("signup and verification share one responsive shell without separate mobile DOM", () => {
  assert.match(authShell, /w-full max-w-md/);
  assert.match(authShell, /px-atlas-4/);
  assert.match(authShell, /sm:px-atlas-5/);
  assert.doesNotMatch(signupPage + verifyPage + authShell, /md:hidden|lg:hidden|hidden md:|hidden lg:/);
  assert.doesNotMatch(signupPage + verifyPage + authShell, /overflow-x|w-screen|min-w-/);
});

test("Authentication V2 signup sources use Atlas tokens without raw colors or arbitrary values", () => {
  for (const source of [signupPage, verifyPage, onboardingPage, passwordField, otpInput]) {
    assert.doesNotMatch(
      source,
      /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
    );
  }
});
