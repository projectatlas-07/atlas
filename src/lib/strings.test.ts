import assert from "node:assert/strict";
import test from "node:test";

import {
  ATLAS_UI_STRINGS,
  type AtlasSharedStrings,
} from "./strings.ts";

function collectLeaves(value: unknown, path = ""): Array<[string, unknown]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [[path, value]];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectLeaves(child, path ? `${path}.${key}` : key));
}

test("shared strings expose stable namespaced wording", () => {
  assert.deepEqual(ATLAS_UI_STRINGS, {
    actions: {
      add: "Add",
      archive: "Archive",
      cancel: "Cancel",
      clear: "Clear",
      close: "Close",
      confirm: "Confirm",
      create: "Create",
      delete: "Delete",
      edit: "Edit",
      filter: "Filter",
      open: "Open",
      restore: "Restore",
      retry: "Retry",
      save: "Save",
      search: "Search",
      update: "Update",
    },
    fields: {
      amount: "Amount",
      date: "Date",
      fromDate: "From date",
      name: "Name",
      note: "Note",
      noteOptional: "Note (optional)",
      status: "Status",
      toDate: "To date",
    },
    payment: {
      amount: "Payment amount",
      date: "Payment date",
      mode: "Payment mode",
      modes: "Payment modes",
      addSplit: "Add split",
      removeSplit: "Remove split",
      selectMode: "Select mode",
      history: "Payment history",
      outstanding: "Outstanding",
      due: "Due",
      loadingHistory: "Loading payment history...",
      historyLoadError: "Could not load payment history.",
      noHistory: "No payments recorded yet.",
      savedDetailsUnavailable: "Payment saved. Receipt details could not load.",
      saved: "Payment saved.",
      balancesOutdated: "Balances and history may be outdated. Refresh before recording another payment.",
      refreshing: "Refreshing balances and payment history...",
      unknownOutcome: "We could not confirm whether this payment was saved. Check payment history before submitting again.",
      detailsUnavailable: "Payment exists. Receipt details could not load.",
      retryDetails: "Retry details",
      notFound: "Payment not found",
      openReceipt: "Open receipt",
      refresh: "Refresh",
    },
    feedback: {
      loading: "Loading...",
      saving: "Saving...",
      unavailable: "Unavailable",
    },
    dashboard: {
      cashBookNotStarted: "Cash Book not started",
      cashBookSetupDescription: "Open Cash Book to complete its one-time setup.",
    },
    auth: {
      loginTitle: "Welcome back",
      loginDescription: "Log in to your Atlas workspace.",
      email: "Email",
      password: "Password",
      forgotPassword: "Forgot password?",
      showPassword: "Show password",
      hidePassword: "Hide password",
      login: "Log in",
      loggingIn: "Logging in...",
      newToAtlas: "New to Atlas?",
      createAccount: "Create account",
      invalidCredentials: "Email or password is incorrect.",
      workspaceError: "Unable to verify your workspace. Please try again.",
      signupTitle: "Create your account",
      signupDescription: "Set up your Atlas login to get started.",
      confirmPassword: "Confirm password",
      passwordHelp: "Use at least 12 characters.",
      emailRequired: "Email is required.",
      emailInvalid: "Enter a valid email address.",
      passwordRequired: "Password is required.",
      passwordTooShort: "Password must be at least 12 characters.",
      passwordMismatch: "Passwords do not match.",
      creatingAccount: "Creating account...",
      alreadyHaveAccount: "Already have an account?",
      signupError: "Unable to create your account. Please try again.",
      signupConfigurationError: "Email verification is unavailable. Please contact support.",
      verifyTitle: "Verify your email",
      verifyDescription: "Enter the code we sent to",
      verificationCode: "Verification code",
      verifyEmail: "Verify email",
      verifyingEmail: "Verifying email...",
      otpRequired: "Enter the complete verification code.",
      otpInvalid: "The code is incorrect or has expired.",
      verificationError: "Unable to verify your email. Please try again.",
      didntReceiveCode: "Didn't receive the code?",
      resendCode: "Resend code",
      resendingCode: "Sending code...",
      resendAvailableIn: "Resend available in",
      resendError: "Unable to send a new code yet. Please wait and try again.",
      resendSuccess: "A new code was sent. Use the newest code.",
      wrongEmail: "Wrong email?",
      changeEmail: "Change email",
      missingEmailDescription: "Enter the email address you used to create your account.",
      continueToVerification: "Continue",
      checkingVerification: "Checking verification details...",
      onboardingTitle: "Set up your factory",
      onboardingDescription: "Enter the factory name your team uses day to day.",
      factoryName: "Factory name",
      factoryNamePlaceholder: "e.g. Shree Kiln Industries",
      factoryNameRequired: "Factory name is required.",
      factoryNameTooLong: "Factory name must be 200 characters or fewer.",
      factoryNameInvalid: "Check the factory name and try again.",
      createFactory: "Create factory",
      creatingFactory: "Creating factory...",
      factoryCreateError: "We couldn't create your factory. Try again.",
      checkingAccount: "Checking your account...",
      accessDisabledTitle: "Account access disabled",
      accessDisabledDescription: "Your account is signed in, but access to this factory is currently disabled.",
      accessDisabledHelp: "Contact the person who manages this account to restore access.",
      logout: "Log out",
      loggingOut: "Signing out...",
      logoutError: "Could not sign out. Please try again.",
      forgotPasswordTitle: "Forgot your password?",
      forgotPasswordDescription: "Enter your email and we'll send you a recovery code.",
      sendRecoveryCode: "Send reset code",
      sendingRecoveryCode: "Sending code...",
      recoveryRequestSuccess: "If an account can use this email, we sent a password reset code.",
      recoveryVerifyTitle: "Enter recovery code",
      recoveryVerifyDescription: "Enter the recovery code for",
      recoveryCode: "Recovery code",
      verifyRecoveryCode: "Verify code",
      verifyingRecoveryCode: "Verifying...",
      recoveryOtpInvalid: "The code is incorrect or has expired.",
      recoveryResendError: "Unable to send a new code yet. Please wait and try again.",
      recoveryMissingEmail: "Enter the email address you want to recover.",
      recoverySessionError: "This recovery session is unavailable or expired. Start recovery again.",
      checkingRecovery: "Checking recovery details...",
      newPasswordTitle: "Set a new password",
      newPasswordDescription: "Choose a new password for your Atlas account.",
      newPassword: "New password",
      confirmNewPassword: "Confirm new password",
      resetPassword: "Reset password",
      resettingPassword: "Resetting password...",
      passwordUpdateError: "Unable to update your password. Please try again.",
      recoverySignOutError: "Atlas could not safely end this recovery session. Please try again.",
      restartRecovery: "Start recovery again",
      passwordUpdated: "Password updated. Log in with your new password.",
      backToLogin: "Back to login",
    },
  });
});

test("every shared string leaf is non-empty plain text", () => {
  for (const [path, value] of collectLeaves(ATLAS_UI_STRINGS)) {
    assert.equal(typeof value, "string", `${path} must be a string`);
    assert.equal(value, (value as string).trim(), `${path} must be trimmed`);
    assert.ok((value as string).length > 0, `${path} must not be empty`);
    assert.doesNotMatch(
      value as string,
      /(?:className|bg-|text-|border-|#[0-9a-f]{3,8})/i,
      `${path} must contain wording only`,
    );
  }
});

test("status labels remain owned by the status presentation module", () => {
  const keys = collectLeaves(ATLAS_UI_STRINGS).map(([path]) =>
    path.split(".").at(-1));

  for (const statusKey of [
    "active",
    "void",
    "paid",
    "unpaid",
    "partiallyPaid",
    "locked",
    "inactive",
  ]) {
    assert.ok(!keys.includes(statusKey), `${statusKey} must not be duplicated`);
  }
});

test("the exported type can describe a future language dictionary", () => {
  const alternateDictionary: AtlasSharedStrings = {
    ...ATLAS_UI_STRINGS,
    actions: {
      ...ATLAS_UI_STRINGS.actions,
      save: "Alternate save wording",
    },
  };

  assert.equal(alternateDictionary.actions.save, "Alternate save wording");
  assert.deepEqual(
    Object.keys(alternateDictionary),
    Object.keys(ATLAS_UI_STRINGS),
  );
});
