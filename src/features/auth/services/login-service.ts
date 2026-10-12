import { supabase } from "../../../lib/supabase/client.ts";
import { authConnection, resolveAuthDestination, unavailableDestination, type AuthDestinationResult, type AuthNavigationOperation } from "./auth-navigation.ts";
import type { AccountConnection, AccountSnapshot } from "./account-activation.ts";

export type LoginCredentials = Readonly<{
  email: string;
  password: string;
}>;

export type LoginDestinationResult = AuthDestinationResult;

export async function resolvePostLoginDestination(
  operation: AuthNavigationOperation,
  connection: AccountConnection = authConnection(),
  retrySnapshot?: AccountSnapshot,
): Promise<LoginDestinationResult> {
  const captured = await operation.currentCapture(2_000, retrySnapshot);
  if (!captured) {
    if (!operation.canPublish(unavailableDestination("uncertain"))) return unavailableDestination("superseded");
    const snapshot = operation.coordinator.getSnapshot();
    return unavailableDestination(snapshot.reason === "authentication" ? "authentication_failed" : snapshot.status === "signed_out" ? "signed_out" : "uncertain");
  }
  return resolveAuthDestination(operation, captured, connection);
}

export async function loginWithPassword(
  credentials: LoginCredentials,
  operation: AuthNavigationOperation,
  connection: AccountConnection = authConnection(),
): Promise<LoginDestinationResult> {
  if (!operation.live()) return unavailableDestination("superseded");
  try {
    // KNOWN-OPEN: supported SDK sign-in can install a late A session over B.
    // Application ownership checks do NOT fix or undo that SDK side effect.
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (!operation.live()) return unavailableDestination("superseded");
    if (error) return unavailableDestination(operation.unchanged() ? "invalid_credentials" : "superseded");
    const captured = await operation.observeExpectedSession(data.session);
    if (!captured) return unavailableDestination(operation.unchanged() ? "uncertain" : "superseded");
    return resolveAuthDestination(operation, captured, connection);
  } catch {
    return unavailableDestination(operation.unchanged() ? "request_error" : "superseded");
  }
}
