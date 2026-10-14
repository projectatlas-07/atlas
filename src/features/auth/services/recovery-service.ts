import { supabase } from "../../../lib/supabase/client.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import { createRecoveryFlow, recoverySharedIdentity, type RecoveryContext } from "./recovery-session.ts";
import type { Session } from "@supabase/supabase-js";
import { readPendingRecoverySession, savePendingRecoverySession, clearPendingRecoveryState } from "./pending-recovery-state.ts";

export const RECOVERY_RESEND_COOLDOWN_SECONDS = 60;

type ResetDependencies = Readonly<{
  resetPasswordForEmail: (email: string) => PromiseLike<{ error: unknown | null }>;
}>;

const productionResetDependencies: ResetDependencies = {
  async resetPasswordForEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  },
};

let recoveryFlow: ReturnType<typeof createRecoveryFlow> | undefined;
function flow() {
  if (recoveryFlow) return recoveryFlow;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Atlas Auth configuration.");
  // Matches the installed SDK default and the existing shared createClient
  // configuration. Read only the actor for ownership, never recover credentials.
  const sharedStorageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  recoveryFlow = createRecoveryFlow({ sharedAuth: supabase.auth, url, key,
    readMarker: readPendingRecoverySession, saveMarker: savePendingRecoverySession,
    clearMarker: clearPendingRecoveryState,
    readSharedIdentity() {
      if (typeof window === "undefined") return undefined;
      try {
        const value = window.localStorage.getItem(sharedStorageKey);
        if (!value) return null;
        return recoverySharedIdentity(JSON.parse(value) as Session);
      } catch { return undefined; }
    },
  });
  return recoveryFlow;
}
export const getRecoveryContext = () => flow().context();
export const getRecoveryCompletion = (context: RecoveryContext) => flow().completion(context);
export const getRecoveryAttemptState = (context: RecoveryContext) => flow().state(context);
export const canPublishRecovery = (context: RecoveryContext) => flow().canPublish(context);
export const subscribeRecoveryOwnership = (listener: () => void) => flow().subscribe(listener);
export const captureRecoveryAction = (active: () => boolean) => flow().captureAction(active);
export type { RecoveryContext, RecoveryCompletion, RecoveryAttemptState } from "./recovery-session.ts";

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
  active: () => boolean = () => true,
) {
  return flow().verify(email, token, active);
}

export async function validateRecoverySession(
  context: RecoveryContext,
  active: () => boolean = () => true,
): Promise<boolean> {
  return flow().validate(context, active);
}

export async function updateRecoveryPassword(
  context: RecoveryContext,
  password: string,
  active: () => boolean = () => true,
) {
  return flow().update(context, password, active);
}

export async function signOutAfterRecovery(
  context: RecoveryContext,
  active: () => boolean = () => true,
): Promise<boolean> {
  return flow().leave(context, active);
}
