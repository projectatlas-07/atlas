import { supabase } from "../../../lib/supabase/client.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import { authConnection, resolveAuthDestination, unavailableDestination, type AuthDestinationResult, type AuthNavigationOperation } from "./auth-navigation.ts";
import type { AccountConnection } from "./account-activation.ts";
import { AUTH_EMAIL_OTP_LENGTH } from "./auth-config.ts";
import type { Session } from "@supabase/supabase-js";

export const SIGNUP_RESEND_COOLDOWN_SECONDS = 60;

type AuthErrorLike = Readonly<{ code?: string }>;

export type SignupResult =
  | { ok: true; kind: "verification_required" }
  | { ok: false; kind: "configuration_error" | "request_error" | "superseded"; reason: "configuration" | "request"; message: string };

export type VerificationDestinationResult = AuthDestinationResult & { otpAccepted?: true };

export type ResendResult =
  | { ok: true }
  | { ok: false; message: string };

type SignupDependencies = Readonly<{
  signUp: (credentials: Readonly<{ email: string; password: string }>) => PromiseLike<{
    data: { session: Session | null };
    error: AuthErrorLike | null;
  }>;
}>;

type ResendDependencies = Readonly<{
  resend: (params: Readonly<{ type: "signup"; email: string }>) => PromiseLike<{
    error: unknown | null;
  }>;
}>;

const productionSignupDependencies: SignupDependencies = {
  signUp: (credentials) => supabase.auth.signUp(credentials),
};

const productionResendDependencies: ResendDependencies = {
  async resend(params) {
    const { error } = await supabase.auth.resend(params);
    return { error };
  },
};

const EXISTING_ACCOUNT_ERROR_CODES = new Set([
  "email_exists",
  "user_already_exists",
  "user_already_registered",
]);

export async function signupWithPassword(
  credentials: Readonly<{ email: string; password: string }>,
  operation: AuthNavigationOperation,
  dependencies: SignupDependencies = productionSignupDependencies,
): Promise<SignupResult> {
  if (!operation.live()) return { ok: false, kind: "superseded", reason: "request", message: ATLAS_UI_STRINGS.auth.signupError };
  try {
    const { data, error } = await dependencies.signUp(credentials);
    const superseded: SignupResult = { ok: false, kind: "superseded", reason: "request", message: ATLAS_UI_STRINGS.auth.signupError };
    if (!operation.live()) return superseded;
    if (data.session) {
      if (!await operation.observeExpectedSession(data.session)) return superseded;
      // No shared logout cleanup: it could remove a replacement account.
      return { ok: false, kind: "configuration_error", reason: "configuration", message: ATLAS_UI_STRINGS.auth.signupConfigurationError };
    }
    if (!operation.unchanged()) return superseded;

    // Supabase normally obscures an existing account as a successful response.
    // Treat known legacy/error variants the same so Atlas never enumerates email addresses.
    if (error) {
      if (error.code && EXISTING_ACCOUNT_ERROR_CODES.has(error.code)) {
        return { ok: true, kind: "verification_required" };
      }
      return { ok: false, kind: "request_error", reason: "request", message: ATLAS_UI_STRINGS.auth.signupError };
    }

    return { ok: true, kind: "verification_required" };
  } catch {
    return { ok: false, kind: operation.unchanged() ? "request_error" : "superseded", reason: "request", message: ATLAS_UI_STRINGS.auth.signupError };
  }
}

export async function verifySignupOtp(
  email: string,
  token: string,
  operation: AuthNavigationOperation,
  connection: AccountConnection = authConnection(),
): Promise<VerificationDestinationResult> {
  if (!operation.live()) return unavailableDestination("superseded");
  try {
    // KNOWN-OPEN: verifyOtp may install a late session. This migration guards
    // application publication, not the SDK's session-installation side effect.
    const { data, error: otpError } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
    if (!operation.live()) return unavailableDestination("superseded");
    if (otpError) {
      return unavailableDestination(operation.unchanged() ? "otp" : "superseded");
    }
    const captured = await operation.observeExpectedSession(data.session);
    if (!captured) return { ...unavailableDestination(operation.unchanged() ? "uncertain" : "superseded"), otpAccepted: true };
    return { ...await resolveAuthDestination(operation, captured, connection), otpAccepted: true };
  } catch {
    return unavailableDestination(operation.unchanged() ? "request_error" : "superseded");
  }
}

export async function resendSignupOtp(
  email: string,
  dependencies: ResendDependencies = productionResendDependencies,
): Promise<ResendResult> {
  try {
    const { error } = await dependencies.resend({ type: "signup", email });
    if (error) return { ok: false, message: ATLAS_UI_STRINGS.auth.resendError };
    return { ok: true };
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.resendError };
  }
}

export function normalizeSignupOtp(value: string, length = AUTH_EMAIL_OTP_LENGTH): string {
  return value.replace(/\D/g, "").slice(0, length);
}

export function nextResendCountdown(seconds: number): number {
  return Math.max(0, seconds - 1);
}

export function formatResendCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
