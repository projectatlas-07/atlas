const PENDING_RECOVERY_EMAIL_KEY = "atlas.auth.pending-recovery-email";
const PENDING_RECOVERY_SESSION_KEY = "atlas.auth.pending-recovery-session";
let recoveryOtpRecentlySent = false;

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingRecoverySession = Readonly<{
  userId: string;
}>;

function browserStorage(): RecoveryStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Persists only the email needed to resume the recovery-code screen. */
export function savePendingRecoveryEmail(
  email: string,
  storage: RecoveryStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_RECOVERY_EMAIL_KEY, email.trim());
  } catch {
    // The verification screen provides an explicit email-recovery path.
  }
}

export function readPendingRecoveryEmail(
  storage: RecoveryStorage | null = browserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const email = storage.getItem(PENDING_RECOVERY_EMAIL_KEY)?.trim() ?? "";
    if (!isPlausibleEmail(email)) {
      storage.removeItem(PENDING_RECOVERY_EMAIL_KEY);
      return null;
    }
    return email;
  } catch {
    return null;
  }
}

export function clearPendingRecoveryEmail(
  storage: RecoveryStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(PENDING_RECOVERY_EMAIL_KEY);
  } catch {
    // No password or OTP is stored by Atlas.
  }
}

/** Navigation state only; Supabase session validation remains authoritative. */
export function savePendingRecoverySession(
  userId: string,
  storage: RecoveryStorage | null = browserStorage(),
): void {
  if (!storage || !userId.trim()) return;
  try {
    storage.setItem(PENDING_RECOVERY_SESSION_KEY, JSON.stringify({ userId }));
  } catch {
    // The new-password screen fails closed if the marker cannot be persisted.
  }
}

export function readPendingRecoverySession(
  storage: RecoveryStorage | null = browserStorage(),
): PendingRecoverySession | null {
  if (!storage) return null;
  try {
    const rawValue = storage.getItem(PENDING_RECOVERY_SESSION_KEY);
    if (!rawValue) return null;
    const value = JSON.parse(rawValue) as Partial<PendingRecoverySession> | null;
    if (!value || typeof value.userId !== "string" || !value.userId.trim()) {
      storage.removeItem(PENDING_RECOVERY_SESSION_KEY);
      return null;
    }
    return { userId: value.userId };
  } catch {
    try {
      storage.removeItem(PENDING_RECOVERY_SESSION_KEY);
    } catch {
      // Invalid recovery state still fails closed.
    }
    return null;
  }
}

export function clearPendingRecoveryState(
  storage: RecoveryStorage | null = browserStorage(),
): void {
  if (!storage) return;
  clearPendingRecoveryEmail(storage);
  try {
    storage.removeItem(PENDING_RECOVERY_SESSION_KEY);
  } catch {
    // Supabase session validation still protects the password update call.
  }
}

/** In-memory only: starts the resend timer after an explicit send action. */
export function markRecoveryOtpRecentlySent(): void {
  recoveryOtpRecentlySent = true;
}

export function consumeRecoveryOtpRecentlySent(): boolean {
  const wasRecentlySent = recoveryOtpRecentlySent;
  recoveryOtpRecentlySent = false;
  return wasRecentlySent;
}
