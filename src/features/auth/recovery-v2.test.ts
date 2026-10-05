import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forgotPage = readFileSync(new URL("../../app/forgot-password/page.tsx", import.meta.url), "utf8");
const verifyPage = readFileSync(new URL("../../app/recover/verify/page.tsx", import.meta.url), "utf8");
const newPasswordPage = readFileSync(new URL("../../app/recover/new-password/page.tsx", import.meta.url), "utf8");
const loginPage = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const authGuard = readFileSync(new URL("./components/auth-guard.tsx", import.meta.url), "utf8");
const authShell = readFileSync(new URL("./components/auth-shell.tsx", import.meta.url), "utf8");
const otpInput = readFileSync(new URL("./components/signup-otp-input.tsx", import.meta.url), "utf8");
const recoveryService = readFileSync(new URL("./services/recovery-service.ts", import.meta.url), "utf8");
const recoveryState = readFileSync(new URL("./services/pending-recovery-state.ts", import.meta.url), "utf8");
const recoveryValidation = readFileSync(new URL("./services/recovery-validation.ts", import.meta.url), "utf8");

test("forgot-password renders the V2 email form and requests a reset code once", () => {
  assert.match(forgotPage, /function ForgotPasswordPage/);
  assert.match(forgotPage, /<AuthShell[\s\S]*forgotPasswordTitle[\s\S]*forgotPasswordDescription/);
  assert.equal((forgotPage.match(/<form\b/g) ?? []).length, 1);
  assert.match(forgotPage, /type="email"[\s\S]*autoComplete="email"/);
  assert.match(forgotPage, /recoveryEmailSchema\.safeParse\(values\.email\)/);
  assert.match(forgotPage, /isRequestingRef\.current/);
  assert.equal((forgotPage.match(/requestPasswordRecovery\(/g) ?? []).length, 1);
  assert.match(forgotPage, /savePendingRecoveryEmail\(parsed\.data\)/);
  assert.match(forgotPage, /router\.push\("\/recover\/verify"\)/);
});

test("public recovery request is neutral and cannot expose account existence", () => {
  assert.match(recoveryService, /Always returns the same public result/);
  assert.match(recoveryService, /await dependencies\.resetPasswordForEmail\(email\)/);
  assert.match(recoveryService, /return \{ ok: true \}/);
  assert.match(forgotPage + verifyPage, /recoveryRequestSuccess/);
  assert.doesNotMatch(forgotPage + verifyPage, /account exists|account does not exist|unconfirmed account/i);
});

test("recovery code uses the adaptable numeric OTP control and recovery verification type", () => {
  assert.match(verifyPage, /<AuthOtpInput[\s\S]*length=\{CURRENT_RECOVERY_OTP_LENGTH\}/);
  assert.match(otpInput, /inputMode="numeric"/);
  assert.match(otpInput, /autoComplete="one-time-code"/);
  assert.match(otpInput, /maxLength=\{length\}/);
  assert.match(recoveryService, /type: "recovery"/);
  assert.match(recoveryService, /dependencies\.verifyOtp\(\{[\s\S]*type: "recovery"/);
  assert.match(recoveryService, /dependencies\.getUser\(\)/);
  assert.match(verifyPage, /savePendingRecoverySession\(result\.userId\)/);
  assert.match(verifyPage, /router\.replace\("\/recover\/new-password"\)/);
});

test("recovery resend is explicit, uses resetPasswordForEmail, and never uses auth.resend", () => {
  assert.equal((verifyPage.match(/resendRecoveryCode\(pendingEmail\)/g) ?? []).length, 1);
  assert.match(recoveryService, /function resendRecoveryCode[\s\S]*resetPasswordForEmail\(email\)/);
  assert.doesNotMatch(recoveryService + verifyPage, /supabase\.auth\.resend\(|dependencies\.resend\(/);
  const effects = verifyPage.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g) ?? [];
  assert.equal(effects.length, 2);
  for (const effect of effects) {
    assert.doesNotMatch(effect, /requestPasswordRecovery|resendRecoveryCode|resetPasswordForEmail/);
  }
});

test("missing recovery email has a validated explicit resend path without URL state", () => {
  assert.match(verifyPage, /if \(pendingEmail === null\)/);
  assert.match(verifyPage, /recoveryEmailSchema\.safeParse\(emailEntry\)/);
  assert.match(verifyPage, /requestPasswordRecovery\(parsed\.data\)/);
  assert.doesNotMatch(forgotPage + verifyPage, /[?&]email=|searchParams.*email/i);
  assert.equal((recoveryState.match(/storage\.setItem\(/g) ?? []).length, 2);
  assert.doesNotMatch(recoveryState, /storage\.setItem\([^\n]*(?:password|token)/i);
});

test("wrong or expired OTP and resend failures use stable Atlas messages", () => {
  assert.match(recoveryService, /recoveryOtpInvalid/);
  assert.match(recoveryService, /recoveryResendError/);
  assert.doesNotMatch(verifyPage, /error\.message|otpError\.message|result\.error/);
});

test("new-password validates recovery context before rendering or updating", () => {
  const contextRead = newPasswordPage.indexOf("readPendingRecoverySession()");
  const contextValidation = newPasswordPage.indexOf("validateRecoverySession(savedContext.userId)");
  const update = newPasswordPage.indexOf("updateRecoveryPassword(parsed.data.password)");
  assert.ok(contextRead > -1 && contextValidation > contextRead && update > contextValidation);
  assert.match(newPasswordPage, /if \(recoveryContext === null\)/);
  assert.match(newPasswordPage, /recoverySessionError/);
  assert.match(newPasswordPage, /router\.replace\("\/forgot-password"\)/);
  assert.match(newPasswordPage, /await signOutAfterRecovery\(\)/);
});

test("new-password uses two password-manager-compatible fields and current Atlas policy", () => {
  assert.equal((newPasswordPage.match(/<PasswordField\b/g) ?? []).length, 2);
  assert.equal((newPasswordPage.match(/autoComplete="new-password"/g) ?? []).length, 2);
  assert.match(newPasswordPage, /recoveryPasswordSchema\.safeParse\(values\)/);
  assert.match(newPasswordPage, /errors\.password/);
  assert.match(newPasswordPage, /errors\.confirmPassword/);
  assert.match(recoveryValidation, /AUTH_PASSWORD_MIN_LENGTH/);
  assert.match(recoveryValidation, /passwordMismatch/);
});

test("successful password update clears state, signs out globally, then returns to login", () => {
  const update = newPasswordPage.indexOf("await updateRecoveryPassword(parsed.data.password)");
  const clear = newPasswordPage.indexOf("clearPendingRecoveryState();", update);
  const signOut = newPasswordPage.indexOf("await signOutAfterRecovery();", clear);
  const route = newPasswordPage.indexOf('router.replace("/login?password=updated")', signOut);
  assert.ok(update > -1 && clear > update && signOut > clear && route > signOut);
  assert.match(recoveryService, /updateUser\(attributes\)/);
  assert.match(recoveryService, /signOut\(\{ scope: "global" \}\)|signOut\(options\)/);
});

test("recovery sessions cannot fall through Login or AuthGuard into Office", () => {
  assert.match(loginPage, /readPendingRecoverySession\(\)[\s\S]*router\.replace\("\/recover\/new-password"\)/);
  assert.match(authGuard, /readPendingRecoverySession\(\) \? "recovery" : "authenticated"/);
  assert.match(authGuard, /sessionState === "recovery"[\s\S]*router\.replace\("\/recover\/new-password"\)/);
  assert.doesNotMatch(verifyPage + newPasswordPage, /\/office|resolvePostLoginDestination|resolveAuthenticatedFactoryId/);
});

test("login shows the restrained completion banner only for password=updated", () => {
  assert.match(loginPage, /new URLSearchParams\(window\.location\.search\)\.get\("password"\) === "updated"/);
  assert.match(loginPage, /<Feedback role="status" tone="success">[\s\S]*passwordUpdated/);
});

test("all recovery screens share one responsive shell without separate mobile DOM", () => {
  const sources = forgotPage + verifyPage + newPasswordPage + authShell;
  assert.match(authShell, /w-full max-w-md/);
  assert.match(authShell, /px-atlas-4/);
  assert.match(authShell, /sm:px-atlas-5/);
  assert.doesNotMatch(sources, /md:hidden|lg:hidden|hidden md:|hidden lg:/);
  assert.doesNotMatch(sources, /overflow-x|w-screen|min-w-/);
  assert.doesNotMatch(sources, /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i);
});
