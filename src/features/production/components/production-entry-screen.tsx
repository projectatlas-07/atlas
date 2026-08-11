"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { buildProductionSavePayload, prepareProductionEntryState, type ActiveProductionLabourer, type ProductionSavePayload, type SavedProductionEntry } from "@/features/production/production-entry-model";
import { productionRecordSchema } from "@/features/production/schemas/production-record-schema";
import { getLocalDate } from "@/lib/local-date";
import { supabase } from "@/lib/supabase/client";

type EntryFormValues = Record<string, { quantity: string }>;

type PendingSave = {
  payload: ProductionSavePayload;
  retryAttempts: number;
  isRetrying: boolean;
  version: number;
};

type FactoryAccessState =
  | { status: "loading"; message: string }
  | { status: "ready"; factoryId: string }
  | { status: "access_denied"; message: string }
  | { status: "request_failed"; message: string };

const retryDelays = [3_000, 8_000, 15_000];
const today = getLocalDate();

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: "", name: "", status: undefined };
  const failure = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };
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

function isTransientSaveFailure(error: unknown) {
  if (!error || typeof error !== "object") return typeof navigator !== "undefined" && navigator.onLine === false;

  const failure = error as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
  if (failure.name === "TransientSessionRefreshError") return true;
  if (typeof failure.code === "string" && failure.code.length > 0) return false;
  if (typeof failure.status === "number" && failure.status >= 400) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return failure.name === "TypeError" && typeof failure.message === "string" && /failed to fetch|networkerror|load failed/i.test(failure.message);
}

function saveErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The save could not be completed.";
}

export function ProductionEntryScreen() {
  const router = useRouter();
  const [factoryAccess, setFactoryAccess] = useState<FactoryAccessState>({
    status: "loading",
    message: "Loading factory access...",
  });
  const [factoryResolutionAttempt, setFactoryResolutionAttempt] = useState(0);
  const [labourers, setLabourers] = useState<readonly ActiveProductionLabourer[]>([]);
  const [savedEntriesByLabourer, setSavedEntriesByLabourer] = useState<ReadonlyMap<string, SavedProductionEntry>>(() => new Map());
  const [savedLabourers, setSavedLabourers] = useState<ReadonlySet<string>>(() => new Set());
  const [recentlySavedLabourers, setRecentlySavedLabourers] = useState<ReadonlySet<string>>(() => new Set());
  const [saveMessagesByLabourer, setSaveMessagesByLabourer] = useState<ReadonlyMap<string, string>>(() => new Map());
  const pendingSavesRef = useRef<Map<string, PendingSave>>(new Map());
  const retryTimersRef = useRef<Map<string, number>>(new Map());
  const retryPendingSaveRef = useRef<(key: string) => void>(() => {});
  const { register, getValues, setValue, formState: { errors } } = useForm<EntryFormValues>({ defaultValues: {} });

  function setSaveMessage(labourerId: string, message?: string) {
    setSaveMessagesByLabourer((previous) => {
      const next = new Map(previous);
      if (message) next.set(labourerId, message);
      else next.delete(labourerId);
      return next;
    });
  }

  function clearRetryTimer(key: string) {
    const timer = retryTimersRef.current.get(key);
    if (timer) window.clearTimeout(timer);
    retryTimersRef.current.delete(key);
  }

  function scheduleRetry(key: string, delay: number) {
    clearRetryTimer(key);
    const timer = window.setTimeout(() => {
      retryTimersRef.current.delete(key);
      retryPendingSaveRef.current(key);
    }, delay);
    retryTimersRef.current.set(key, timer);
  }

  useEffect(() => {
    let isMounted = true;
    setFactoryAccess({ status: "loading", message: "Loading factory access..." });

    void resolveAuthenticatedFactoryId().then((result) => {
      if (!isMounted) return;
      if (result.ok) {
        setFactoryAccess({ status: "ready", factoryId: result.factoryId });
        return;
      }
      if (result.error.code === "unauthenticated") {
        setFactoryAccess({ status: "loading", message: "Redirecting to sign in..." });
        router.replace("/login");
        return;
      }
      if (result.error.code === "request_failed") {
        console.error({
          context: "Failed to resolve production factory access",
          message: result.error.message,
          details: result.error.details,
        });
        setFactoryAccess({ status: "request_failed", message: "Unable to load factory access. Please try again." });
        return;
      }
      setFactoryAccess({ status: "access_denied", message: "Access denied. No active factory access is assigned to this account." });
    });

    return () => { isMounted = false; };
  }, [factoryResolutionAttempt, router]);

  useEffect(() => {
    if (factoryAccess.status !== "ready") return;
    const factoryId = factoryAccess.factoryId;

    void Promise.all([
      supabase
        .from("labourers")
        .select("id, factory_id, name, assigned_brick_type_id")
        .eq("factory_id", factoryId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("brick_types")
        .select("id, name")
        .eq("factory_id", factoryId),
    ]).then(async ([{ data: labourerRows, error: labourerError }, { data: brickTypeRows, error: brickTypeError }]) => {
      const masterDataError = labourerError ?? brickTypeError;
      if (masterDataError) {
        console.error({
          context: "Failed to load production labourers",
          message: masterDataError.message,
          code: masterDataError.code,
          details: masterDataError.details,
          hint: masterDataError.hint,
        });
        return;
      }

      const { data: productionEntries, error } = await supabase
        .from("production_entries")
        .select("id, labourer_id, brick_type_id, quantity")
        .eq("factory_id", factoryId)
        .eq("production_date", today);

      if (error) {
        console.error({
          context: "Failed to load today's production entries",
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        return;
      }

      const preparedState = prepareProductionEntryState({
        labourerRows: labourerRows ?? [],
        brickTypeRows: brickTypeRows ?? [],
        productionRows: productionEntries,
      });
      setLabourers(preparedState.labourers);
      setSavedEntriesByLabourer(preparedState.savedEntriesByLabourer);
      for (const [labourerId, quantity] of preparedState.quantitiesByLabourer) {
        if (!preparedState.savedLabourerIds.has(labourerId)) continue;
        setValue(`${labourerId}.quantity`, quantity);
      }
      setSavedLabourers(preparedState.savedLabourerIds);
    });
  }, [factoryAccess, setValue]);

  useEffect(() => {
    const retryTimers = retryTimersRef.current;
    const pendingSaves = pendingSavesRef.current;
    function retryPendingSavesWhenOnline() {
      for (const [key, pendingSave] of pendingSavesRef.current) {
        if (!pendingSave.isRetrying) retryPendingSaveRef.current(key);
      }
    }

    window.addEventListener("online", retryPendingSavesWhenOnline);
    return () => {
      window.removeEventListener("online", retryPendingSavesWhenOnline);
      for (const timer of retryTimers.values()) window.clearTimeout(timer);
      retryTimers.clear();
      pendingSaves.clear();
    };
  }, []);

  async function persistProductionSave(payload: ProductionSavePayload) {
    if (payload.savedEntryId) {
      const { data, error } = await supabase
        .from("production_entries")
        .update({ quantity: payload.quantity })
        .eq("id", payload.savedEntryId)
        .eq("factory_id", payload.factoryId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Access denied: the production entry was not updated.");
      if (data.length !== 1) throw new Error("Unexpected save result: more than one production entry was updated.");
      return;
    }

    const { data, error } = await supabase
      .from("production_entries")
      .insert({
        id: payload.newEntryId!,
        factory_id: payload.factoryId,
        labourer_id: payload.labourerId,
        brick_type_id: payload.brickTypeId,
        production_date: payload.productionDate,
        quantity: payload.quantity,
      })
      .select("id, brick_type_id")
      .single();
    if (error) throw error;
    return data;
  }

  async function persistProductionSaveWithSessionRefresh(payload: ProductionSavePayload) {
    try {
      return { status: "saved" as const, insertedEntry: await persistProductionSave(payload) };
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

    return { status: "saved" as const, insertedEntry: await persistProductionSave(payload) };
  }

  function completeSave(payload: ProductionSavePayload, insertedEntry?: { id: string; brick_type_id: string }) {
    if (insertedEntry) {
      setSavedEntriesByLabourer((previous) => new Map(previous).set(payload.labourerId, {
        id: insertedEntry.id,
        brickTypeId: insertedEntry.brick_type_id,
      }));
    }
    setSavedLabourers((previous) => new Set(previous).add(payload.labourerId));
    setSaveMessage(payload.labourerId);
    setRecentlySavedLabourers((previous) => new Set(previous).add(payload.labourerId));
    window.setTimeout(() => setRecentlySavedLabourers((previous) => {
      const next = new Set(previous);
      next.delete(payload.labourerId);
      return next;
    }), 1_500);
  }

  async function runPendingSave(key: string, isRetry: boolean) {
    const pendingSave = pendingSavesRef.current.get(key);
    if (!pendingSave || pendingSave.isRetrying) return;

    clearRetryTimer(key);
    pendingSave.isRetrying = true;
    if (isRetry) pendingSave.retryAttempts += 1;
    const version = pendingSave.version;
    const payload = pendingSave.payload;
    if (isRetry) setSaveMessage(payload.labourerId, "Retrying save...");

    try {
      const result = await persistProductionSaveWithSessionRefresh(payload);
      if (result.status === "session_invalid") {
        const latestPendingSave = pendingSavesRef.current.get(key);
        if (latestPendingSave) latestPendingSave.isRetrying = false;
        clearRetryTimer(key);
        setSaveMessage(payload.labourerId, "Session expired. Sign in again to save this quantity.");
        try {
          const { error: signOutError } = await supabase.auth.signOut();
          if (signOutError) console.error({ context: "Failed to clear invalid Supabase session", message: signOutError.message });
        } catch (signOutError) {
          console.error({ context: "Failed to clear invalid Supabase session", error: signOutError });
        }
        router.replace("/login");
        router.refresh();
        return;
      }

      const insertedEntry = result.insertedEntry;
      const latestPendingSave = pendingSavesRef.current.get(key);
      if (!latestPendingSave) return;
      if (latestPendingSave.version !== version) {
        latestPendingSave.isRetrying = false;
        setSaveMessage(latestPendingSave.payload.labourerId, "Waiting for connection — save pending.");
        scheduleRetry(key, retryDelays[0]);
        return;
      }

      pendingSavesRef.current.delete(key);
      clearRetryTimer(key);
      completeSave(payload, insertedEntry);
    } catch (error) {
      const latestPendingSave = pendingSavesRef.current.get(key);
      if (!latestPendingSave) return;
      if (latestPendingSave.version !== version) {
        latestPendingSave.isRetrying = false;
        setSaveMessage(latestPendingSave.payload.labourerId, "Waiting for connection — save pending.");
        scheduleRetry(key, retryDelays[0]);
        return;
      }

      latestPendingSave.isRetrying = false;
      if (!isTransientSaveFailure(error)) {
        pendingSavesRef.current.delete(key);
        clearRetryTimer(key);
        setSaveMessage(payload.labourerId, `Could not save: ${saveErrorMessage(error)}`);
        return;
      }
      if (latestPendingSave.retryAttempts >= retryDelays.length) {
        pendingSavesRef.current.delete(key);
        clearRetryTimer(key);
        setSaveMessage(payload.labourerId, "Save was not completed. Please save again.");
        return;
      }

      setSaveMessage(payload.labourerId, "Waiting for connection — save pending.");
      scheduleRetry(key, retryDelays[latestPendingSave.retryAttempts]);
    }
  }

  retryPendingSaveRef.current = (key) => { void runPendingSave(key, true); };

  function save(labourer: ActiveProductionLabourer) {
    const rawQuantity = getValues(`${labourer.id}.quantity`);
    if (!/^\d+$/.test(rawQuantity)) return;
    const parsed = productionRecordSchema.safeParse({
      productionDate: today,
      labourId: labourer.id,
      labourName: labourer.name,
      brickType: labourer.brickTypeName,
      quantity: Number(rawQuantity),
    });
    if (!parsed.success) return;

    if (factoryAccess.status !== "ready") {
      setSaveMessage(labourer.id, "Could not save: Factory access is unavailable.");
      return;
    }
    const factoryId = factoryAccess.factoryId;

    const savedEntry = savedEntriesByLabourer.get(labourer.id);
    const key = `${factoryId}:${labourer.id}:${parsed.data.productionDate}`;
    const existingPendingSave = pendingSavesRef.current.get(key);
    const payload = buildProductionSavePayload({
      factoryId,
      labourer,
      productionDate: parsed.data.productionDate,
      quantity: parsed.data.quantity,
      savedEntry,
      pendingNewEntryId: existingPendingSave?.payload.newEntryId,
      newEntryId: crypto.randomUUID(),
    });
    if (existingPendingSave) {
      clearRetryTimer(payload.key);
      existingPendingSave.payload = payload;
      existingPendingSave.retryAttempts = 0;
      existingPendingSave.version += 1;
      setSaveMessage(labourer.id, "Waiting for connection — save pending.");
      if (!existingPendingSave.isRetrying) scheduleRetry(payload.key, retryDelays[0]);
      return;
    }

    pendingSavesRef.current.set(payload.key, { payload, retryAttempts: 0, isRetrying: false, version: 0 });
    setSaveMessage(labourer.id, "Saving...");
    void runPendingSave(payload.key, false);
  }

  if (factoryAccess.status === "loading") return <ProductionAccessStatus message={factoryAccess.message} />;
  if (factoryAccess.status === "access_denied") return <ProductionAccessStatus message={factoryAccess.message} />;
  if (factoryAccess.status === "request_failed") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 px-4 text-center">
        <p className="text-sm font-medium text-red-700">{factoryAccess.message}</p>
        <button type="button" onClick={() => setFactoryResolutionAttempt((attempt) => attempt + 1)} className="rounded-xl bg-orange-700 px-5 py-3 text-sm font-semibold text-white active:bg-orange-800">Retry</button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-stone-50 px-4 pb-8 pt-6 sm:px-6">
      <header className="mb-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-orange-700">Today’s production</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{formatToday(today)}</h1>
          </div>
          <LogoutButton />
        </div>
        <p className="mt-2 text-base text-slate-600">Enter the number of bricks made by each labourer.</p>
      </header>

      <section aria-label="Active labourers" className="space-y-3">
        {labourers.map((labourer) => {
          const fieldName = `${labourer.id}.quantity` as const;
          const hasError = Boolean(errors[labourer.id]?.quantity);
          const isSaved = savedLabourers.has(labourer.id);
          const wasRecentlySaved = recentlySavedLabourers.has(labourer.id);
          const saveMessage = saveMessagesByLabourer.get(labourer.id);
          return (
            <article key={labourer.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{labourer.name}</h2>
                  <p className="mt-0.5 text-sm text-slate-600">{labourer.brickTypeName}</p>
                </div>
                {isSaved && <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-emerald-100 px-2 text-lg font-bold text-emerald-700" aria-label={`${labourer.name} saved`}>✓</span>}
              </div>
              <div className="mt-4 flex gap-3">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Brick quantity for {labourer.name}</span>
                  <input
                    {...register(fieldName, { required: true, pattern: /^\d+$/ })}
                    onFocus={() => setSavedLabourers((previous) => {
                      const next = new Set(previous);
                      next.delete(labourer.id);
                      return next;
                    })}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    enterKeyHint="done"
                    placeholder="Quantity"
                    className={`h-14 w-full rounded-xl border bg-white px-4 text-lg font-semibold text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 ${hasError ? "border-red-500" : "border-stone-300"}`}
                  />
                </label>
                <button type="button" onClick={() => void save(labourer)} className="h-14 shrink-0 rounded-xl bg-orange-700 px-6 text-base font-semibold text-white active:bg-orange-800" aria-label={`Save ${labourer.name}'s production`}>
                  {wasRecentlySaved ? "Saved" : "Save"}
                </button>
              </div>
              {saveMessage && <p role="status" className={`mt-3 text-sm font-medium ${saveMessage.startsWith("Could not") || saveMessage.startsWith("Save was not") ? "text-red-700" : "text-amber-700"}`}>{saveMessage}</p>}
            </article>
          );
        })}
      </section>
    </main>
  );
}

function ProductionAccessStatus({ message }: Readonly<{ message: string }>) {
  return <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-center text-sm font-medium text-slate-600">{message}</main>;
}

function formatToday(date: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00`));
}
