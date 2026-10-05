import { supabase } from "../../../lib/supabase/client.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import {
  resolveAuthenticatedFactoryId,
  type FactoryResolutionResult,
} from "./factory-access-service.ts";

export const CURRENT_SIGNUP_OTP_LENGTH = 8;
export const SIGNUP_RESEND_COOLDOWN_SECONDS = 60;

type AuthErrorLike = Readonly<{ code?: string }>;

export type SignupResult =
  | { ok: true }
  | { ok: false; reason: "configuration" | "request"; message: string };

export type VerificationDestinationResult =
  | { ok: true; destination: "/office" | "/onboarding" }
  | { ok: false; reason: "otp" | "identity" | "workspace"; message: string };

export type ResendResult =
  | { ok: true }
  | { ok: false; message: string };

type SignupDependencies = Readonly<{
  signUp: (credentials: Readonly<{ email: string; password: string }>) => PromiseLike<{
    data: { session: unknown | null };
    error: AuthErrorLike | null;
  }>;
  signOut: () => PromiseLike<unknown>;
}>;

type VerificationDependencies = Readonly<{
  verifyOtp: (params: Readonly<{ email: string; token: string; type: "signup" }>) => PromiseLike<{
    error: unknown | null;
  }>;
  getUser: () => PromiseLike<{
    data: { user: unknown | null };
    error: unknown | null;
  }>;
  resolveFactoryAccess: () => Promise<FactoryResolutionResult>;
}>;

type ResendDependencies = Readonly<{
  resend: (params: Readonly<{ type: "signup"; email: string }>) => PromiseLike<{
    error: unknown | null;
  }>;
}>;

const productionSignupDependencies: SignupDependencies = {
  signUp: (credentials) => supabase.auth.signUp(credentials),
  signOut: () => supabase.auth.signOut({ scope: "local" }),
};

const productionVerificationDependencies: VerificationDependencies = {
  async verifyOtp(params) {
    const { error } = await supabase.auth.verifyOtp(params);
    return { error };
  },
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    return { data, error };
  },
  resolveFactoryAccess: resolveAuthenticatedFactoryId,
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
  dependencies: SignupDependencies = productionSignupDependencies,
): Promise<SignupResult> {
  try {
    const { data, error } = await dependencies.signUp(credentials);

    // Supabase normally obscures an existing account as a successful response.
    // Treat known legacy/error variants the same so Atlas never enumerates email addresses.
    if (error) {
      if (error.code && EXISTING_ACCOUNT_ERROR_CODES.has(error.code)) {
        return { ok: true };
      }
      return { ok: false, reason: "request", message: ATLAS_UI_STRINGS.auth.signupError };
    }

    if (data.session) {
      try {
        await dependencies.signOut();
      } catch {
        // The visible configuration error still blocks the flow if local sign-out fails.
      }
      return {
        ok: false,
        reason: "configuration",
        message: ATLAS_UI_STRINGS.auth.signupConfigurationError,
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "request", message: ATLAS_UI_STRINGS.auth.signupError };
  }
}

export async function verifySignupOtp(
  email: string,
  token: string,
  dependencies: VerificationDependencies = productionVerificationDependencies,
): Promise<VerificationDestinationResult> {
  try {
    const { error: otpError } = await dependencies.verifyOtp({ email, token, type: "signup" });
    if (otpError) {
      return { ok: false, reason: "otp", message: ATLAS_UI_STRINGS.auth.otpInvalid };
    }

    const { data, error: userError } = await dependencies.getUser();
    if (userError || !data.user) {
      return {
        ok: false,
        reason: "identity",
        message: ATLAS_UI_STRINGS.auth.verificationError,
      };
    }

    const factoryAccess = await dependencies.resolveFactoryAccess();
    if (factoryAccess.ok) {
      return { ok: true, destination: "/office" };
    }
    if (factoryAccess.error.code === "access_denied") {
      return { ok: true, destination: "/onboarding" };
    }

    return {
      ok: false,
      reason: "workspace",
      message: ATLAS_UI_STRINGS.auth.workspaceError,
    };
  } catch {
    return {
      ok: false,
      reason: "identity",
      message: ATLAS_UI_STRINGS.auth.verificationError,
    };
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

export function normalizeSignupOtp(value: string, length = CURRENT_SIGNUP_OTP_LENGTH): string {
  return value.replace(/\D/g, "").slice(0, length);
}

export function nextResendCountdown(seconds: number): number {
  return Math.max(0, seconds - 1);
}

export function formatResendCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
