import { supabase } from "../../../lib/supabase/client.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

export const CURRENT_RECOVERY_OTP_LENGTH = 8;
export const RECOVERY_RESEND_COOLDOWN_SECONDS = 60;

type ResetDependencies = Readonly<{
  resetPasswordForEmail: (email: string) => PromiseLike<{ error: unknown | null }>;
}>;

type VerifyDependencies = Readonly<{
  verifyOtp: (params: Readonly<{
    email: string;
    token: string;
    type: "recovery";
  }>) => PromiseLike<{ error: unknown | null }>;
  getUser: () => PromiseLike<{
    data: { user: { id: string } | null };
    error: unknown | null;
  }>;
}>;

type UpdateDependencies = Readonly<{
  updateUser: (attributes: Readonly<{ password: string }>) => PromiseLike<{
    error: unknown | null;
  }>;
}>;

type SignOutDependencies = Readonly<{
  signOut: (options: Readonly<{ scope: "global" }>) => PromiseLike<{
    error: unknown | null;
  }>;
}>;

const productionResetDependencies: ResetDependencies = {
  async resetPasswordForEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  },
};

const productionVerifyDependencies: VerifyDependencies = {
  async verifyOtp(params) {
    const { error } = await supabase.auth.verifyOtp(params);
    return { error };
  },
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    return { data, error };
  },
};

const productionUpdateDependencies: UpdateDependencies = {
  async updateUser(attributes) {
    const { error } = await supabase.auth.updateUser(attributes);
    return { error };
  },
};

const productionSignOutDependencies: SignOutDependencies = {
  async signOut(options) {
    const { error } = await supabase.auth.signOut(options);
    return { error };
  },
};

/** Always returns the same public result so the request cannot enumerate accounts. */
export async function requestPasswordRecovery(
  email: string,
  dependencies: ResetDependencies = productionResetDependencies,
): Promise<{ ok: true }> {
  try {
    await dependencies.resetPasswordForEmail(email);
  } catch {
    // Request details are intentionally not exposed to the public recovery flow.
  }
  return { ok: true };
}

export async function resendRecoveryCode(
  email: string,
  dependencies: ResetDependencies = productionResetDependencies,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await dependencies.resetPasswordForEmail(email);
    if (error) return { ok: false, message: ATLAS_UI_STRINGS.auth.recoveryResendError };
    return { ok: true };
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.recoveryResendError };
  }
}

export async function verifyRecoveryOtp(
  email: string,
  token: string,
  dependencies: VerifyDependencies = productionVerifyDependencies,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; message: string }
> {
  try {
    const { error: otpError } = await dependencies.verifyOtp({
      email,
      token,
      type: "recovery",
    });
    if (otpError) return { ok: false, message: ATLAS_UI_STRINGS.auth.recoveryOtpInvalid };

    const { data, error: userError } = await dependencies.getUser();
    if (userError || !data.user) {
      return { ok: false, message: ATLAS_UI_STRINGS.auth.recoverySessionError };
    }

    return { ok: true, userId: data.user.id };
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.recoverySessionError };
  }
}

export async function validateRecoverySession(
  expectedUserId: string,
  dependencies: Pick<VerifyDependencies, "getUser"> = productionVerifyDependencies,
): Promise<boolean> {
  try {
    const { data, error } = await dependencies.getUser();
    return !error && Boolean(data.user) && data.user?.id === expectedUserId;
  } catch {
    return false;
  }
}

export async function updateRecoveryPassword(
  password: string,
  dependencies: UpdateDependencies = productionUpdateDependencies,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await dependencies.updateUser({ password });
    if (error) return { ok: false, message: ATLAS_UI_STRINGS.auth.passwordUpdateError };
    return { ok: true };
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.passwordUpdateError };
  }
}

export async function signOutAfterRecovery(
  dependencies: SignOutDependencies = productionSignOutDependencies,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await dependencies.signOut({ scope: "global" });
    if (error) return { ok: false, message: ATLAS_UI_STRINGS.auth.recoverySignOutError };
    return { ok: true };
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.recoverySignOutError };
  }
}
