const PENDING_SIGNUP_EMAIL_KEY = "atlas.auth.pending-signup-email";
let signupOtpRecentlySent = false;

type PendingEmailStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): PendingEmailStorage | null {
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

/** Stores only the pending email so verification survives closing the tab. */
export function savePendingSignupEmail(
  email: string,
  storage: PendingEmailStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_SIGNUP_EMAIL_KEY, email.trim());
  } catch {
    // The verification screen can recover the email if browser storage is unavailable.
  }
}

export function readPendingSignupEmail(
  storage: PendingEmailStorage | null = browserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const email = storage.getItem(PENDING_SIGNUP_EMAIL_KEY)?.trim() ?? "";
    if (!isPlausibleEmail(email)) {
      storage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
      return null;
    }
    return email;
  } catch {
    return null;
  }
}

export function clearPendingSignupEmail(
  storage: PendingEmailStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(PENDING_SIGNUP_EMAIL_KEY);
  } catch {
    // No sensitive state is retained by Atlas when browser storage is unavailable.
  }
}

/** In-memory only: starts the resend timer after the signup navigation, not after a later reload. */
export function markSignupOtpRecentlySent(): void {
  signupOtpRecentlySent = true;
}

export function consumeSignupOtpRecentlySent(): boolean {
  const wasRecentlySent = signupOtpRecentlySent;
  signupOtpRecentlySent = false;
  return wasRecentlySent;
}
