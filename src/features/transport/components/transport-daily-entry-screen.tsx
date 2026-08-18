"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { saveTransportDailyEntry } from "@/features/transport/services/transport-daily-entry-service";
import {
  buildTransportDailyEntrySaveInput,
  formatTransportWorkDirection,
  loadActiveTransportCrews,
  loadTransportDailyEntrySelection,
  parseTransportPayaInput,
  selectAllTransportWorkers,
  toggleTransportWorkerSelection,
  transportDailyEntryErrorMessage,
} from "@/features/transport/transport-daily-entry-screen-model";
import type {
  TransportCrew,
  TransportDailyEntryWorkerChoice,
} from "@/features/transport/types";
import { getLocalDate } from "@/lib/local-date";

type FactoryAccessState =
  | { status: "loading"; message: string }
  | { status: "ready"; factoryId: string }
  | { status: "access_denied"; message: string }
  | { status: "request_failed"; message: string };

type LoadState = "idle" | "loading" | "ready" | "error";

type SaveState =
  | { status: "idle" }
  | { status: "saving"; message: string }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

const today = getLocalDate();

export function TransportDailyEntryScreen() {
  const router = useRouter();
  const saveInProgressRef = useRef(false);
  const [factoryAccess, setFactoryAccess] = useState<FactoryAccessState>({
    status: "loading",
    message: "Loading factory access...",
  });
  const [factoryResolutionAttempt, setFactoryResolutionAttempt] = useState(0);
  const [crewLoadAttempt, setCrewLoadAttempt] = useState(0);
  const [entryLoadAttempt, setEntryLoadAttempt] = useState(0);
  const [crews, setCrews] = useState<TransportCrew[]>([]);
  const [crewLoadState, setCrewLoadState] = useState<LoadState>("idle");
  const [crewLoadError, setCrewLoadError] = useState("");
  const [selectedCrewId, setSelectedCrewId] = useState("");
  const [workDate, setWorkDate] = useState(today);
  const [members, setMembers] = useState<TransportDailyEntryWorkerChoice[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [payaInput, setPayaInput] = useState("");
  const [entryLoadState, setEntryLoadState] = useState<LoadState>("idle");
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [entryLoadError, setEntryLoadError] = useState("");
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
          context: "Failed to resolve transport factory access",
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
    if (factoryAccess.status !== "ready") return;
    let isCurrent = true;
    setCrewLoadState("loading");
    setCrewLoadError("");

    void loadActiveTransportCrews(factoryAccess.factoryId)
      .then((loadedCrews) => {
        if (!isCurrent) return;
        setCrews(loadedCrews);
        setSelectedCrewId((currentCrewId) =>
          loadedCrews.some((crew) => crew.id === currentCrewId)
            ? currentCrewId
            : "",
        );
        setCrewLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        console.error({ context: "Failed to load transport crews", error });
        setCrews([]);
        setCrewLoadState("error");
        setCrewLoadError(transportDailyEntryErrorMessage(error));
      });

    return () => { isCurrent = false; };
  }, [crewLoadAttempt, factoryAccess]);

  useEffect(() => {
    if (factoryAccess.status !== "ready" || !selectedCrewId || !workDate) {
      setMembers([]);
      setSelectedWorkerIds(new Set());
      setPayaInput("");
      setEntryLoadState("idle");
      setLoadedScopeKey(null);
      setEntryLoadError("");
      setSaveState({ status: "idle" });
      return;
    }

    let isCurrent = true;
    setMembers([]);
    setSelectedWorkerIds(new Set());
    setPayaInput("");
    setEntryLoadState("loading");
    setLoadedScopeKey(null);
    setEntryLoadError("");
    setSaveState({ status: "idle" });

    void loadTransportDailyEntrySelection({
      factoryId: factoryAccess.factoryId,
      transportCrewId: selectedCrewId,
      workDate,
    }).then((loadedState) => {
      if (!isCurrent) return;
      setMembers(loadedState.members);
      setSelectedWorkerIds(loadedState.selectedWorkerIds);
      setPayaInput(loadedState.payaInput);
      setEntryLoadState("ready");
      setLoadedScopeKey(`${factoryAccess.factoryId}:${selectedCrewId}:${workDate}`);
    }).catch((error: unknown) => {
      if (!isCurrent) return;
      console.error({ context: "Failed to load transport daily entry", error });
      setEntryLoadState("error");
      setEntryLoadError(transportDailyEntryErrorMessage(error));
    });

    return () => { isCurrent = false; };
  }, [entryLoadAttempt, factoryAccess, selectedCrewId, workDate]);

  const selectedCrew = useMemo(
    () => crews.find((crew) => crew.id === selectedCrewId) ?? null,
    [crews, selectedCrewId],
  );
  const parsedPaya = parseTransportPayaInput(payaInput);
  const currentScopeKey = factoryAccess.status === "ready" && selectedCrewId && workDate
    ? `${factoryAccess.factoryId}:${selectedCrewId}:${workDate}`
    : null;
  const isSaving = saveState.status === "saving";
  const canSave = factoryAccess.status === "ready"
    && Boolean(selectedCrewId)
    && entryLoadState === "ready"
    && loadedScopeKey === currentScopeKey
    && selectedWorkerIds.size > 0
    && parsedPaya !== null
    && !isSaving;

  function markEdited(): void {
    if (saveState.status !== "saving") setSaveState({ status: "idle" });
  }

  async function save(): Promise<void> {
    if (!canSave || saveInProgressRef.current || factoryAccess.status !== "ready") return;

    const input = buildTransportDailyEntrySaveInput({
      factoryId: factoryAccess.factoryId,
      transportCrewId: selectedCrewId,
      workDate,
      payaInput,
      selectedWorkerIds,
    });
    if (!input) return;

    saveInProgressRef.current = true;
    setSaveState({ status: "saving", message: "Saving..." });
    try {
      const result = await saveTransportDailyEntry(input);
      setSaveState({
        status: "saved",
        message: `Saved — ${result.attendanceCount} ${result.attendanceCount === 1 ? "worker" : "workers"}.`,
      });
    } catch (error) {
      console.error({ context: "Failed to save transport daily entry", error });
      setSaveState({
        status: "error",
        message: transportDailyEntryErrorMessage(error),
      });
    } finally {
      saveInProgressRef.current = false;
    }
  }

  if (factoryAccess.status === "loading") {
    return <TransportAccessStatus message={factoryAccess.message} />;
  }
  if (factoryAccess.status === "access_denied") {
    return <TransportAccessStatus message={factoryAccess.message} />;
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
            <p className="text-sm font-medium text-orange-700">Chamber transport</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              Daily entry
            </h1>
          </div>
          <LogoutButton />
        </div>
        <p className="mt-2 text-base text-slate-600">
          Choose a crew, mark present workers, and enter paya.
        </p>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
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

            <label>
              <span className="mb-2 block text-sm font-semibold text-slate-800">Crew</span>
              <select
                value={selectedCrewId}
                onChange={(event) => setSelectedCrewId(event.target.value)}
                disabled={crewLoadState === "loading" || isSaving}
                className="h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-medium text-slate-950 outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100"
              >
                <option value="">
                  {crewLoadState === "loading" ? "Loading crews..." : "Select crew"}
                </option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name} — {formatTransportWorkDirection(crew.workDirection)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedCrew && (
            <p className="mt-3 text-sm text-slate-600">
              {selectedCrew.name} · {formatTransportWorkDirection(selectedCrew.workDirection)}
            </p>
          )}
          {crewLoadState === "ready" && crews.length === 0 && (
            <p className="mt-3 text-sm font-medium text-slate-600">No active transport crews are available.</p>
          )}
          {crewLoadState === "error" && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p role="alert" className="text-sm font-medium text-red-700">{crewLoadError}</p>
              <button
                type="button"
                onClick={() => setCrewLoadAttempt((attempt) => attempt + 1)}
                className="shrink-0 text-sm font-semibold text-orange-700"
              >
                Retry
              </button>
            </div>
          )}
        </section>

        {selectedCrewId && (
          <section aria-labelledby="present-workers-heading" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="present-workers-heading" className="text-lg font-semibold text-slate-900">
                  Present workers
                </h2>
                <p aria-live="polite" className="mt-0.5 text-sm text-slate-600">
                  {selectedWorkerIds.size} of {members.length} selected
                </p>
              </div>
              <button
                type="button"
                disabled={entryLoadState !== "ready" || members.length === 0 || isSaving}
                onClick={() => {
                  setSelectedWorkerIds(selectAllTransportWorkers(members));
                  markEdited();
                }}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-orange-700 active:bg-orange-50 disabled:text-slate-400"
              >
                Select All
              </button>
            </div>

            {entryLoadState === "loading" && (
              <p className="mt-4 text-sm font-medium text-slate-600">Loading workers and saved entry...</p>
            )}
            {entryLoadState === "error" && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p role="alert" className="text-sm font-medium text-red-700">{entryLoadError}</p>
                <button
                  type="button"
                  onClick={() => setEntryLoadAttempt((attempt) => attempt + 1)}
                  className="shrink-0 text-sm font-semibold text-orange-700"
                >
                  Retry
                </button>
              </div>
            )}
            {entryLoadState === "ready" && members.length === 0 && (
              <p className="mt-4 text-sm font-medium text-slate-600">No active workers are assigned to this crew.</p>
            )}

            {entryLoadState === "ready" && members.length > 0 && (
              <div className="mt-4 space-y-2">
                {members.map((member) => {
                  const isSelected = selectedWorkerIds.has(member.transportWorkerId);
                  return (
                    <label
                      key={member.transportWorkerId}
                      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${isSelected ? "border-orange-400 bg-orange-50" : "border-stone-200 bg-white"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isSaving}
                        onChange={() => {
                          setSelectedWorkerIds((current) =>
                            toggleTransportWorkerSelection(
                              current,
                              member.transportWorkerId,
                            ),
                          );
                          markEdited();
                        }}
                        className="h-5 w-5 rounded border-stone-300 accent-orange-700"
                      />
                      <span className="min-w-0 flex-1 text-base font-medium text-slate-900">
                        {member.transportWorkerName}
                      </span>
                      {member.isPreviouslyRecorded && (
                        <span className="text-right text-xs font-medium text-slate-500">Previously recorded</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <label>
            <span className="mb-2 block text-sm font-semibold text-slate-800">
              Paya / Chamber quantity
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              disabled={isSaving}
              value={payaInput}
              onChange={(event) => {
                setPayaInput(event.target.value);
                markEdited();
              }}
              placeholder="6.5"
              className="h-14 w-full rounded-xl border border-stone-300 bg-white px-4 text-lg font-semibold text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          {payaInput && parsedPaya === null && (
            <p className="mt-2 text-sm font-medium text-red-700">Enter a paya quantity greater than zero.</p>
          )}
        </section>

        <button
          type="submit"
          disabled={!canSave}
          className="h-14 w-full rounded-xl bg-orange-700 px-6 text-base font-semibold text-white active:bg-orange-800 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
        >
          {saveState.status === "saving" ? "Saving..." : "Save transport entry"}
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

function TransportAccessStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-center text-sm font-medium text-slate-600">
      {message}
    </main>
  );
}
