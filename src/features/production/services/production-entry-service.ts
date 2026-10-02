import { supabase } from "../../../lib/supabase/client.ts";
import type { ProductionSavePayload } from "../production-entry-model.ts";

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { code: "", message: "", name: "", status: undefined };
  }

  const failure = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    status?: unknown;
  };
  return {
    code: typeof failure.code === "string" ? failure.code.toLowerCase() : "",
    message: typeof failure.message === "string" ? failure.message.toLowerCase() : "",
    name: typeof failure.name === "string" ? failure.name : "",
    status: typeof failure.status === "number" ? failure.status : undefined,
  };
}

function isAuthenticationSaveFailure(error: unknown) {
  const failure = errorDetails(error);
  if (failure.status === 401 || failure.code === "401") return true;
  if (["bad_jwt", "jwt_expired", "pgrst301"].includes(failure.code)) return true;
  return /(?:expired|invalid|missing)(?:\s+or\s+invalid)?\s+(?:jwt|access token)|(?:jwt|access token)\s+(?:is\s+)?(?:expired|invalid|missing)|no access token/.test(failure.message);
}

function isTransientRefreshFailure(error: unknown) {
  const failure = errorDetails(error);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (failure.status === 429 || (failure.status !== undefined && failure.status >= 500)) return true;
  return failure.name === "TypeError"
    || failure.name === "AuthRetryableFetchError"
    || /failed to fetch|networkerror|network request|load failed|fetch failed/.test(failure.message);
}

function isInvalidRefreshTokenFailure(error: unknown) {
  const failure = errorDetails(error);
  if (["refresh_token_not_found", "refresh_token_already_used", "session_not_found"].includes(failure.code)) return true;
  return /refresh token.*(?:invalid|expired|revoked|missing|not found|already used)|(?:invalid|expired|revoked|missing) refresh token|auth session missing/.test(failure.message);
}

function transientRefreshError() {
  const error = new Error("The session could not be refreshed because of a network problem.");
  error.name = "TransientSessionRefreshError";
  return error;
}

export function isTransientProductionSaveFailure(error: unknown) {
  if (!error || typeof error !== "object") {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  const failure = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    name?: unknown;
  };
  if (failure.name === "TransientSessionRefreshError") return true;
  if (typeof failure.code === "string" && failure.code.length > 0) return false;
  if (typeof failure.status === "number" && failure.status >= 400) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return failure.name === "TypeError"
    && typeof failure.message === "string"
    && /failed to fetch|networkerror|load failed/i.test(failure.message);
}

export function productionSaveErrorMessage(error: unknown) {
  const failure = errorDetails(error);
  const message = error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
  if (["p2520", "p3306"].includes(failure.code) && message) return message;
  if (failure.code === "42501") return "You do not have access to save this Production entry.";
  if (failure.code === "22023" && message) return message;
  return "The Production save could not be completed. Please try again.";
}

async function saveProductionEntry(payload: ProductionSavePayload) {
  const { data, error } = await supabase.rpc("save_production_entry", {
    p_factory_id: payload.factoryId,
    p_entry_id: payload.savedEntryId ?? payload.newEntryId!,
    p_labourer_id: payload.labourerId,
    p_production_date: payload.productionDate,
    p_quantity: payload.quantity,
  });
  if (error) throw error;
  const savedEntry = data?.[0];
  if (!savedEntry) throw new Error("Production save returned no entry.");
  return { id: savedEntry.id };
}

export async function saveProductionEntryWithSessionRefresh(
  payload: ProductionSavePayload,
) {
  try {
    return { status: "saved" as const, savedEntry: await saveProductionEntry(payload) };
  } catch (error) {
    if (!isAuthenticationSaveFailure(error)) throw error;
  }

  let refreshResult: Awaited<ReturnType<typeof supabase.auth.refreshSession>>;
  try {
    refreshResult = await supabase.auth.refreshSession();
  } catch (refreshError) {
    if (isTransientRefreshFailure(refreshError)) throw transientRefreshError();
    if (isInvalidRefreshTokenFailure(refreshError)) return { status: "session_invalid" as const };
    throw refreshError;
  }

  if (refreshResult.error) {
    if (isTransientRefreshFailure(refreshResult.error)) throw transientRefreshError();
    if (isInvalidRefreshTokenFailure(refreshResult.error)) return { status: "session_invalid" as const };
    throw refreshResult.error;
  }
  if (!refreshResult.data.session) return { status: "session_invalid" as const };

  return { status: "saved" as const, savedEntry: await saveProductionEntry(payload) };
}
