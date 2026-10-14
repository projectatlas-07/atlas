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
const recoverySession = readFileSync(new URL("./services/recovery-session.ts", import.meta.url), "utf8");

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
  assert.match(forgotPage, /captureRecoveryAction[\s\S]*await requestPasswordRecovery\(parsed\.data\);\s*if \(!active\(\)\)/);
});

test("public recovery request is neutral and cannot expose account existence", () => {
  assert.match(recoveryService, /Always returns the same public result/);
  assert.match(recoveryService, /await dependencies\.resetPasswordForEmail\(email\)/);
  assert.match(recoveryService, /return \{ ok: true \}/);
  assert.match(forgotPage + verifyPage, /recoveryRequestSuccess/);
  assert.doesNotMatch(forgotPage + verifyPage, /account exists|account does not exist|unconfirmed account/i);
});

test("recovery code uses the adaptable numeric OTP control and recovery verification type", () => {
  assert.match(verifyPage, /<AuthOtpInput[\s\S]*length=\{AUTH_EMAIL_OTP_LENGTH\}/);
  assert.match(otpInput, /inputMode="numeric"/);
  assert.match(otpInput, /autoComplete="one-time-code"/);
  assert.match(otpInput, /maxLength=\{length\}/);
  assert.match(recoverySession, /auth\.verifyOtp\(\{ email, token, type: "recovery" \}\)/);
  assert.match(recoverySession, /auth\.getUser\(intent\.token\)/);
  assert.match(recoverySession, /options\.saveMarker\(intent\.handle\.userId\)/);
  assert.match(verifyPage, /canPublishRecovery\(result\.context\)/);
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
  assert.match(recoverySession, /recoveryOtpInvalid/);
  assert.match(recoveryService, /recoveryResendError/);
  assert.doesNotMatch(verifyPage, /error\.message|otpError\.message|result\.error/);
});

test("new-password validates recovery context before rendering or updating", () => {
  const contextRead = newPasswordPage.indexOf("getRecoveryContext()");
  const contextValidation = newPasswordPage.indexOf("validateRecoverySession(savedContext, active)");
  const update = newPasswordPage.indexOf("updateRecoveryPassword(recoveryContext, parsed.data.password");
  assert.ok(contextRead > -1 && contextValidation > contextRead && update > contextValidation);
  assert.match(newPasswordPage, /if \(recoveryContext === null\)/);
  assert.match(newPasswordPage, /recoverySessionError/);
  assert.match(newPasswordPage, /router\.replace\("\/forgot-password"\)/);
  assert.match(newPasswordPage, /await signOutAfterRecovery\(recoveryContext,/);
  assert.doesNotMatch(newPasswordPage, /clearPendingRecoveryState|readPendingRecoverySession|savePendingRecoverySession/);
  const restart = newPasswordPage.slice(newPasswordPage.indexOf("async function restartRecovery"), newPasswordPage.indexOf("if (completion)"));
  assert.doesNotMatch(restart, /signOutAfterRecovery|\.auth\./);
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

test("successful password update stays confirmed and shows recovery-local fallback without login auto-redirect", () => {
  const update = newPasswordPage.indexOf("await updateRecoveryPassword(recoveryContext, parsed.data.password");
  const publish = newPasswordPage.indexOf("canPublishRecovery(recoveryContext)", update);
  const completion = newPasswordPage.indexOf("setCompletion(updateResult.completion)", publish);
  assert.ok(update > -1 && publish > update && completion > publish);
  assert.match(newPasswordPage, /recoveryCompleted[\s\S]*recoveryRevocationUnknown/);
  assert.match(newPasswordPage, /recoveryLocalSessionNotice/);
  assert.match(newPasswordPage, /setOutcomeLocked\(true\)/);
  assert.doesNotMatch(newPasswordPage, /router\.replace\("\/login\?password=updated"\)/);
  assert.match(recoverySession, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.match(recoverySession, /client\.auth\.signOut\(\{ scope: "global" \}\)/);
  assert.doesNotMatch(recoveryService, /supabase\.auth\.(?:getUser|getSession|verifyOtp|updateUser|signOut)\(/);
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

test("new-password captures an effect lease instead of reviving a shared mounted boolean", () => {
  assert.match(newPasswordPage, /const lifetime = \{ active: true \}/);
  assert.match(newPasswordPage, /return \(\) => \{ lifetime\.active = false; unsubscribe\(\); \}/);
  assert.match(newPasswordPage, /const lifetime = lifetimeRef\.current/);
  assert.match(newPasswordPage, /updateRecoveryPassword\(recoveryContext, parsed\.data\.password, \(\) => lifetime\?\.active === true\)/);
  assert.doesNotMatch(newPasswordPage, /mountedRef/);
  assert.doesNotMatch(recoverySession, /intent\.active|unsafeUpdateLifetime|unsafeEffectLifetime/);
});

test("remounted new-password uses stored pending and terminal attempt evidence without a new write", () => {
  assert.match(newPasswordPage, /getRecoveryAttemptState\(savedContext\)/);
  assert.match(newPasswordPage, /setCompletion\(latest\.completion\)/);
  assert.match(newPasswordPage, /latest\.status === "unknown" \|\| latest\.status === "complete"/);
  assert.match(newPasswordPage, /attemptState\?\.status === "updating"/);
  const effect = newPasswordPage.slice(newPasswordPage.indexOf("useEffect(() =>"), newPasswordPage.indexOf("async function setNewPassword"));
  assert.doesNotMatch(effect, /updateRecoveryPassword|signOutAfterRecovery|router\./);
});
