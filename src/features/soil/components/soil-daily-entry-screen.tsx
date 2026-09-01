"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import {
  listActiveSoilWorkers,
  listSoilDailyTrolleyEntries,
  saveSoilDailyTrolleyEntries,
} from "@/features/soil/services/soil-daily-entry-service";
import {
  applySavedSoilDailyEntries,
  buildSoilDailyEntrySaveInput,
  prepareSoilDailyEntryForm,
  soilDailyEntryErrorMessage,
  updateSoilDailyEntryQuantity,
  type SoilDailyEntryFormRow,
} from "@/features/soil/soil-daily-entry-model";
import { getLocalDate } from "@/lib/local-date";

type FactoryAccessState =
  | { status: "loading"; message: string }
  | { status: "ready"; factoryId: string }
  | { status: "access_denied"; message: string }
  | { status: "request_failed"; message: string };

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState =
  | { status: "idle" }
  | { status: "saving" | "saved" | "error"; message: string };

const today = getLocalDate();

export function SoilDailyEntryScreen() {
  const router = useRouter();
  const saveInProgressRef = useRef(false);
  const [factoryAccess, setFactoryAccess] = useState<FactoryAccessState>({
    status: "loading",
    message: "Loading factory access...",
  });
  const [factoryResolutionAttempt, setFactoryResolutionAttempt] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [workDate, setWorkDate] = useState(today);
  const [rows, setRows] = useState<SoilDailyEntryFormRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

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
          context: "Failed to resolve Soil factory access",
          message: result.error.message,
          details: result.error.details,
        });
        setFactoryAccess({
          status: "request_failed",
          message: "Unable to load factory access. Please try again.",
        });
        return;
      }
      setFactoryAccess({
        status: "access_denied",
        message: "Access denied. No active factory access is assigned to this account.",
      });
    });

    return () => { isMounted = false; };
  }, [factoryResolutionAttempt, router]);

  useEffect(() => {
    if (factoryAccess.status !== "ready" || !workDate) {
      setRows([]);
      setLoadState("idle");
      setLoadedScopeKey(null);
      setLoadError("");
      setSaveState({ status: "idle" });
      return;
    }

    let isCurrent = true;
    const scopeKey = `${factoryAccess.factoryId}:${workDate}`;
    setRows([]);
    setLoadState("loading");
    setLoadedScopeKey(null);
    setLoadError("");
    setSaveState({ status: "idle" });

    void Promise.all([
      listActiveSoilWorkers(factoryAccess.factoryId),
      listSoilDailyTrolleyEntries({
        factoryId: factoryAccess.factoryId,
        workDate,
      }),
    ]).then(([activeWorkers, existingEntries]) => {
      if (!isCurrent) return;
      setRows(prepareSoilDailyEntryForm({ activeWorkers, existingEntries }));
      setLoadState("ready");
      setLoadedScopeKey(scopeKey);
    }).catch((error: unknown) => {
      if (!isCurrent) return;
      console.error({ context: "Failed to load Soil daily entry", error });
      setLoadState("error");
      setLoadError(soilDailyEntryErrorMessage(error));
    });

    return () => { isCurrent = false; };
  }, [loadAttempt, factoryAccess, workDate]);

  const isSaving = saveState.status === "saving";
  const currentScopeKey = factoryAccess.status === "ready" && workDate
    ? `${factoryAccess.factoryId}:${workDate}`
    : null;
  const canSave = factoryAccess.status === "ready"
    && loadState === "ready"
    && loadedScopeKey === currentScopeKey
    && rows.some((row) => row.soilWorkerIsActive && row.quantityInput.trim())
    && !isSaving;

  function setQuantity(soilWorkerId: string, quantityInput: string): void {
    setRows((currentRows) =>
      updateSoilDailyEntryQuantity(currentRows, soilWorkerId, quantityInput),
    );
    if (saveState.status !== "saving") setSaveState({ status: "idle" });
  }

  async function save(): Promise<void> {
    if (!canSave || saveInProgressRef.current || factoryAccess.status !== "ready") return;

    let input;
    try {
      input = buildSoilDailyEntrySaveInput({
        factoryId: factoryAccess.factoryId,
        workDate,
        rows,
      });
    } catch (error) {
      setSaveState({ status: "error", message: soilDailyEntryErrorMessage(error) });
      return;
    }

    saveInProgressRef.current = true;
    setSaveState({ status: "saving", message: "Saving..." });
    try {
      const savedEntries = await saveSoilDailyTrolleyEntries(input);
      setRows((currentRows) =>
        applySavedSoilDailyEntries(currentRows, savedEntries),
      );
      setSaveState({
        status: "saved",
        message: `Saved — ${savedEntries.length} ${savedEntries.length === 1 ? "worker" : "workers"} recorded.`,
      });
    } catch (error) {
      console.error({ context: "Failed to save Soil daily trolley entries", error });
      setSaveState({ status: "error", message: soilDailyEntryErrorMessage(error) });
    } finally {
      saveInProgressRef.current = false;
    }
  }

  if (factoryAccess.status === "loading" || factoryAccess.status === "access_denied") {
    return <SoilAccessStatus message={factoryAccess.message} />;
  }
  if (factoryAccess.status === "request_failed") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 px-4 text-center">
        <p className="text-sm font-medium text-red-700">{factoryAccess.message}</p>
        <button
          type="button"
          onClick={() => setFactoryResolutionAttempt((attempt) => attempt + 1)}
          className="rounded-xl bg-orange-700 px-5 py-3 text-sm font-semibold text-white active:bg-orange-800"
        >
          Retry
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-stone-50 px-4 pb-10 pt-6 sm:px-6">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-orange-700">Soil supply</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              Daily trolley entry
            </h1>
          </div>
          <LogoutButton />
        </div>
        <p className="mt-2 text-base text-slate-600">
          Enter how many trolleys each worker brought.
        </p>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <label>
            <span className="mb-2 block text-sm font-semibold text-slate-800">Work date</span>
            <input
              type="date"
              required
              disabled={isSaving}
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
              className="h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-medium text-slate-950 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
            />
          </label>
        </section>

        <section aria-labelledby="soil-workers-heading" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 id="soil-workers-heading" className="text-lg font-semibold text-slate-900">
            Soil workers
          </h2>
          <p className="mt-1 text-sm text-slate-600">Leave workers with no trolley work blank.</p>

          {loadState === "loading" && (
            <p className="mt-4 text-sm font-medium text-slate-600">Loading workers and saved quantities...</p>
          )}
          {loadState === "error" && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p role="alert" className="text-sm font-medium text-red-700">{loadError}</p>
              <button
                type="button"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                className="shrink-0 text-sm font-semibold text-orange-700"
              >
                Retry
              </button>
            </div>
          )}
          {loadState === "ready" && rows.length === 0 && (
            <p className="mt-4 text-sm font-medium text-slate-600">No active Soil workers are available.</p>
          )}

          {loadState === "ready" && rows.length > 0 && (
            <div className="mt-4 space-y-3">
              {rows.map((row) => (
                <label
                  key={row.soilWorkerId}
                  className={`block rounded-xl border p-4 ${row.isPreviouslyRecorded ? "border-emerald-300 bg-emerald-50/50" : "border-stone-200 bg-white"}`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">
                      {row.soilWorkerName}
                      {!row.soilWorkerIsActive && <span className="ml-2 text-xs text-slate-500">Archived · read-only</span>}
                    </span>
                    {row.isPreviouslyRecorded && (
                      <span className="text-xs font-semibold text-emerald-700">Previously recorded</span>
                    )}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    disabled={isSaving || !row.soilWorkerIsActive}
                    value={row.quantityInput}
                    onChange={(event) => setQuantity(row.soilWorkerId, event.target.value)}
                    placeholder="Trolleys"
                    aria-label={`${row.soilWorkerName} trolley quantity`}
                    className="mt-3 h-12 w-full rounded-xl border border-stone-300 bg-white px-4 text-lg font-semibold text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-600"
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        <button
          type="submit"
          disabled={!canSave}
          className="h-14 w-full rounded-xl bg-orange-700 px-6 text-base font-semibold text-white active:bg-orange-800 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
        >
          {isSaving ? "Saving..." : "Save Soil trolley entries"}
        </button>

        {saveState.status !== "idle" && (
          <p
            role={saveState.status === "error" ? "alert" : "status"}
            className={`text-center text-sm font-semibold ${saveState.status === "saved" ? "text-emerald-700" : saveState.status === "error" ? "text-red-700" : "text-amber-700"}`}
          >
            {saveState.message}
          </p>
        )}
      </form>
    </main>
  );
}

function SoilAccessStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-center text-sm font-medium text-slate-600">
      {message}
    </main>
  );
}
