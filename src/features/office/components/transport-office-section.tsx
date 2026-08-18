"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildTransportAssignmentInput,
  buildTransportAssignmentListItem,
  buildTransportCrewCreateInput,
  buildTransportCrewWageRateInput,
  buildTransportRateCrewOption,
  buildTransportRateHistoryItem,
  buildTransportWorkerCreateInput,
  formatTransportActiveStatus,
  formatTransportDirection,
  formatTransportRatePerPaya,
  getTransportRateRefreshQueryKeys,
  selectTransportRateCrew,
  transportOfficeErrorMessage,
  transportRateFormAfterSuccess,
  transportRateOfficeErrorMessage,
  type TransportRateFormState,
} from "@/features/office/transport-office-model";
import {
  buildTransportWeeklyCalculationInput,
  buildTransportWeeklyDetailDisplay,
  buildTransportWeeklyEarningDisplay,
  getTransportWeekEnd,
  getTransportWeeklyCalculationOutcome,
  transportWeeklySettlementErrorMessage,
  type TransportWeeklyCalculationOutcome,
} from "@/features/office/transport-weekly-earnings-model";
import {
  buildTransportBalanceDisplay,
  buildTransportFinanceWorkerOption,
  buildTransportWithdrawalHistoryItem,
  buildTransportWithdrawalInput,
  getTransportFinanceRefreshQueryKeys,
  selectTransportFinanceWorker,
  transportFinanceFormAfterSuccess,
  transportWorkerFinanceErrorMessage,
  type TransportWorkerFinanceFormState,
} from "@/features/office/transport-worker-finances-model";
import {
  assignTransportWorkerToCrew,
  listTransportCrewAssignments,
  unassignTransportWorkerFromCrew,
} from "@/features/transport/services/transport-crew-assignment-service";
import {
  activateTransportCrew,
  createTransportCrew,
  deactivateTransportCrew,
  listTransportCrews,
} from "@/features/transport/services/transport-crew-service";
import {
  createTransportCrewWageRate,
  getTransportCrewWageRateForDate,
  listTransportCrewWageRates,
  TransportCrewWageRateResolutionError,
} from "@/features/transport/services/transport-crew-wage-rate-service";
import {
  listTransportWeeklyEarningDetails,
  listTransportWeeklyEarnings,
} from "@/features/transport/services/transport-weekly-earning-read-service";
import { calculateTransportWeeklyWages } from "@/features/transport/services/transport-weekly-wage-calculation-service";
import {
  createTransportWorkerWithdrawal,
  getTransportWorkerAvailableBalance,
  listTransportWorkerWithdrawals,
} from "@/features/transport/services/transport-worker-financial-service";
import {
  activateTransportWorker,
  createTransportWorker,
  deactivateTransportWorker,
  listTransportWorkers,
} from "@/features/transport/services/transport-worker-service";
import type {
  TransportCrew,
  TransportWorker,
  TransportWorkDirection,
} from "@/features/transport/types";
import { getLocalDate } from "@/lib/local-date";

const workerQueryKey = (factoryId: string) => ["office-transport-workers", factoryId] as const;
const crewQueryKey = (factoryId: string) => ["office-transport-crews", factoryId] as const;
const assignmentQueryKey = (factoryId: string) =>
  ["office-transport-assignments", factoryId] as const;
const transportRateHistoryQueryKey = (factoryId: string, crewId: string) =>
  ["office-transport-crew-wage-rates", factoryId, crewId] as const;
const transportCurrentRateQueryKey = (factoryId: string, crewId: string, workDate: string) =>
  ["office-transport-current-crew-wage-rate", factoryId, crewId, workDate] as const;
const transportWeeklyEarningsQueryKey = (factoryId: string, weekStart: string) =>
  ["office-transport-weekly-earnings", factoryId, weekStart] as const;
const transportWeeklyEarningDetailsQueryKey = (factoryId: string, weeklyEarningId: string) =>
  ["office-transport-weekly-earning-details", factoryId, weeklyEarningId] as const;
const transportWorkerBalanceQueryKey = (
  factoryId: string,
  transportWorkerId: string,
  asOfDate: string,
) => ["office-transport-worker-balance", factoryId, transportWorkerId, asOfDate] as const;
const transportWorkerWithdrawalsQueryKey = (factoryId: string, transportWorkerId: string) =>
  ["office-transport-worker-withdrawals", factoryId, transportWorkerId] as const;

export function TransportOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const workersQuery = useQuery({
    queryKey: workerQueryKey(factoryId),
    queryFn: () => listTransportWorkers(factoryId),
  });
  const crewsQuery = useQuery({
    queryKey: crewQueryKey(factoryId),
    queryFn: () => listTransportCrews(factoryId),
  });

  return (
    <section aria-labelledby="chamber-transport-office-heading" className="mt-10 border-t-4 border-slate-300 pt-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Chamber Transport</p>
        <h2 id="chamber-transport-office-heading" className="mt-1 text-2xl font-bold">Workers, crews, rates, earnings, and finances</h2>
        <p className="mt-2 text-sm text-slate-600">Manage transport identities, assignments, crew wage rates, locked weekly earnings, and worker finances separately from production labour.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <TransportWorkerManagement
          factoryId={factoryId}
          workers={workersQuery.data ?? []}
          isLoading={workersQuery.isLoading}
          loadError={workersQuery.error}
        />
        <TransportCrewManagement
          factoryId={factoryId}
          crews={crewsQuery.data ?? []}
          isLoading={crewsQuery.isLoading}
          loadError={crewsQuery.error}
        />
      </div>

      <TransportAssignmentManagement
        factoryId={factoryId}
        workers={workersQuery.data ?? []}
        crews={crewsQuery.data ?? []}
        workersUnavailable={workersQuery.isLoading || Boolean(workersQuery.error)}
        crewsUnavailable={crewsQuery.isLoading || Boolean(crewsQuery.error)}
      />
      <TransportCrewWageRateManagement
        factoryId={factoryId}
        crews={crewsQuery.data ?? []}
        crewsUnavailable={crewsQuery.isLoading || Boolean(crewsQuery.error)}
      />
      <TransportWeeklyEarningsManagement factoryId={factoryId} />
      <TransportWorkerFinances
        factoryId={factoryId}
        workers={workersQuery.data ?? []}
        workersUnavailable={workersQuery.isLoading || Boolean(workersQuery.error)}
      />
    </section>
  );
}

function TransportWorkerManagement({
  factoryId,
  workers,
  isLoading,
  loadError,
}: Readonly<{
  factoryId: string;
  workers: readonly TransportWorker[];
  isLoading: boolean;
  loadError: Error | null;
}>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingWorkerId, setUpdatingWorkerId] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  function clearFeedback(): void {
    setMutationError("");
    setSuccessMessage("");
  }

  async function addWorker(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    const input = buildTransportWorkerCreateInput(factoryId, name);
    if (!input) {
      setMutationError("Transport worker name is required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createTransportWorker(input);
      setName("");
      setSuccessMessage("Transport worker added.");
      await queryClient.invalidateQueries({ queryKey: workerQueryKey(factoryId) });
    } catch (error) {
      setMutationError(transportOfficeErrorMessage(error, "Could not add transport worker."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleWorker(worker: TransportWorker): Promise<void> {
    if (updatingWorkerId) return;
    setUpdatingWorkerId(worker.id);
    clearFeedback();
    try {
      if (worker.isActive) {
        await deactivateTransportWorker({ factoryId, transportWorkerId: worker.id });
      } else {
        await activateTransportWorker({ factoryId, transportWorkerId: worker.id });
      }
      setSuccessMessage(worker.isActive ? "Transport worker deactivated." : "Transport worker reactivated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workerQueryKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: assignmentQueryKey(factoryId) }),
      ]);
    } catch (error) {
      setMutationError(transportOfficeErrorMessage(error, "Could not update transport worker."));
    } finally {
      setUpdatingWorkerId("");
    }
  }

  return (
    <section aria-labelledby="transport-workers-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="transport-workers-heading" className="text-xl font-bold">Transport Workers</h3>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => void addWorker(event)}>
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Worker name
          <input
            value={name}
            onChange={(event) => { setName(event.target.value); clearFeedback(); }}
            required
            disabled={isSubmitting}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {isSubmitting ? "Adding..." : "Add Worker"}
        </button>
      </form>
      {mutationError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{mutationError}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p>}

      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading transport workers...</p>}
      {loadError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">Could not load transport workers: {loadError.message}</p>}
      {!isLoading && !loadError && workers.length === 0 && <p className="mt-5 text-sm text-slate-500">No transport workers configured.</p>}
      {!isLoading && !loadError && workers.length > 0 && (
        <div className="mt-5 space-y-3">
          {workers.map((worker) => {
            const isUpdating = updatingWorkerId === worker.id;
            return (
              <article key={worker.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold">{worker.name}</h4>
                  <p className={`mt-1 text-sm font-medium ${worker.isActive ? "text-emerald-700" : "text-slate-500"}`}>
                    {formatTransportActiveStatus(worker.isActive)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(updatingWorkerId)}
                  onClick={() => void toggleWorker(worker)}
                  className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUpdating ? "Updating..." : worker.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TransportCrewManagement({
  factoryId,
  crews,
  isLoading,
  loadError,
}: Readonly<{
  factoryId: string;
  crews: readonly TransportCrew[];
  isLoading: boolean;
  loadError: Error | null;
}>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [workDirection, setWorkDirection] = useState<TransportWorkDirection | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingCrewId, setUpdatingCrewId] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  function clearFeedback(): void {
    setMutationError("");
    setSuccessMessage("");
  }

  async function addCrew(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    const input = buildTransportCrewCreateInput({ factoryId, name, workDirection });
    if (!input) {
      setMutationError("Crew name and direction are required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createTransportCrew(input);
      setName("");
      setWorkDirection("");
      setSuccessMessage("Transport crew added.");
      await queryClient.invalidateQueries({ queryKey: crewQueryKey(factoryId) });
    } catch (error) {
      setMutationError(transportOfficeErrorMessage(error, "Could not add transport crew."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleCrew(crew: TransportCrew): Promise<void> {
    if (updatingCrewId) return;
    setUpdatingCrewId(crew.id);
    clearFeedback();
    try {
      if (crew.isActive) {
        await deactivateTransportCrew({ factoryId, transportCrewId: crew.id });
      } else {
        await activateTransportCrew({ factoryId, transportCrewId: crew.id });
      }
      setSuccessMessage(crew.isActive ? "Transport crew deactivated." : "Transport crew reactivated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crewQueryKey(factoryId) }),
        queryClient.invalidateQueries({ queryKey: assignmentQueryKey(factoryId) }),
      ]);
    } catch (error) {
      setMutationError(transportOfficeErrorMessage(error, "Could not update transport crew."));
    } finally {
      setUpdatingCrewId("");
    }
  }

  return (
    <section aria-labelledby="transport-crews-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="transport-crews-heading" className="text-xl font-bold">Transport Crews</h3>
      <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void addCrew(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Crew name
          <input
            value={name}
            onChange={(event) => { setName(event.target.value); clearFeedback(); }}
            required
            disabled={isSubmitting}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Direction
          <select
            value={workDirection}
            onChange={(event) => { setWorkDirection(event.target.value as TransportWorkDirection | ""); clearFeedback(); }}
            required
            disabled={isSubmitting}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <option value="" disabled>Select direction</option>
            <option value="FIELD_TO_KILN">Field → Kiln</option>
            <option value="KILN_TO_FIELD">Kiln → Field</option>
          </select>
        </label>
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2">
          {isSubmitting ? "Adding..." : "Add Crew"}
        </button>
      </form>
      {mutationError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{mutationError}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p>}

      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading transport crews...</p>}
      {loadError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">Could not load transport crews: {loadError.message}</p>}
      {!isLoading && !loadError && crews.length === 0 && <p className="mt-5 text-sm text-slate-500">No transport crews configured.</p>}
      {!isLoading && !loadError && crews.length > 0 && (
        <div className="mt-5 space-y-3">
          {crews.map((crew) => {
            const isUpdating = updatingCrewId === crew.id;
            return (
              <article key={crew.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold">{crew.name}</h4>
                  <p className="mt-1 text-sm text-slate-600">{formatTransportDirection(crew.workDirection)}</p>
                  <p className={`mt-1 text-sm font-medium ${crew.isActive ? "text-emerald-700" : "text-slate-500"}`}>
                    {formatTransportActiveStatus(crew.isActive)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(updatingCrewId)}
                  onClick={() => void toggleCrew(crew)}
                  className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUpdating ? "Updating..." : crew.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TransportAssignmentManagement({
  factoryId,
  workers,
  crews,
  workersUnavailable,
  crewsUnavailable,
}: Readonly<{
  factoryId: string;
  workers: readonly TransportWorker[];
  crews: readonly TransportCrew[];
  workersUnavailable: boolean;
  crewsUnavailable: boolean;
}>) {
  const queryClient = useQueryClient();
  const [transportWorkerId, setTransportWorkerId] = useState("");
  const [transportCrewId, setTransportCrewId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingAssignmentId, setRemovingAssignmentId] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const assignmentsQuery = useQuery({
    queryKey: assignmentQueryKey(factoryId),
    queryFn: () => listTransportCrewAssignments({ factoryId }),
  });

  function clearFeedback(): void {
    setMutationError("");
    setSuccessMessage("");
  }

  async function addAssignment(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    const input = buildTransportAssignmentInput({
      factoryId,
      transportWorkerId,
      transportCrewId,
    });
    if (!input) {
      setMutationError("Worker and crew are required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await assignTransportWorkerToCrew(input);
      setTransportCrewId("");
      setSuccessMessage("Transport crew assignment added.");
      await queryClient.invalidateQueries({
        queryKey: assignmentQueryKey(factoryId),
      });
    } catch (error) {
      setMutationError(transportOfficeErrorMessage(error, "Could not add crew assignment."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeAssignment(assignmentId: string): Promise<void> {
    if (removingAssignmentId) return;
    setRemovingAssignmentId(assignmentId);
    clearFeedback();
    try {
      await unassignTransportWorkerFromCrew({ factoryId, assignmentId });
      setSuccessMessage("Transport crew assignment removed.");
      await queryClient.invalidateQueries({
        queryKey: assignmentQueryKey(factoryId),
      });
    } catch (error) {
      setMutationError(transportOfficeErrorMessage(error, "Could not remove crew assignment."));
    } finally {
      setRemovingAssignmentId("");
    }
  }

  return (
    <section aria-labelledby="transport-assignments-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="transport-assignments-heading" className="text-xl font-bold">Crew Assignments</h3>
      <form className="mt-5 grid gap-4 md:grid-cols-3 md:items-end" onSubmit={(event) => void addAssignment(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Worker
          <select
            value={transportWorkerId}
            onChange={(event) => { setTransportWorkerId(event.target.value); clearFeedback(); }}
            required
            disabled={isSubmitting || workersUnavailable || workers.length === 0}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <option value="" disabled>Select worker</option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name}{worker.isActive ? "" : " (Inactive)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Crew
          <select
            value={transportCrewId}
            onChange={(event) => { setTransportCrewId(event.target.value); clearFeedback(); }}
            required
            disabled={isSubmitting || crewsUnavailable || crews.length === 0}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <option value="" disabled>Select crew</option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name} — {formatTransportDirection(crew.workDirection)}{crew.isActive ? "" : " (Inactive)"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isSubmitting || workersUnavailable || crewsUnavailable || workers.length === 0 || crews.length === 0}
          className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Assigning..." : "Assign"}
        </button>
      </form>
      {workers.length === 0 && !workersUnavailable && <p className="mt-3 text-sm text-slate-500">No transport worker is available.</p>}
      {crews.length === 0 && !crewsUnavailable && <p className="mt-3 text-sm text-slate-500">No transport crew is available.</p>}
      {mutationError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{mutationError}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p>}

      {assignmentsQuery.isLoading && <p className="mt-6 text-sm text-slate-500">Loading crew assignments...</p>}
      {assignmentsQuery.error && (
        <p role="alert" className="mt-6 text-sm font-medium text-red-700">
          Could not load crew assignments: {assignmentsQuery.error.message}
        </p>
      )}
      {!assignmentsQuery.isLoading && !assignmentsQuery.error && (assignmentsQuery.data ?? []).length === 0 && (
        <p className="mt-6 text-sm text-slate-500">No crew assignments configured.</p>
      )}
      {!assignmentsQuery.isLoading && !assignmentsQuery.error && (assignmentsQuery.data ?? []).length > 0 && (
        <div className="mt-6 space-y-3">
          {(assignmentsQuery.data ?? []).map((assignment) => {
            const item = buildTransportAssignmentListItem(assignment);
            const isRemoving = removingAssignmentId === item.assignmentId;
            return (
              <article key={item.assignmentId} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold">{item.workerName} → {item.crewName}</h4>
                  <p className="mt-1 text-sm text-slate-600">{item.crewDirection}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Worker: {item.workerStatus} · Crew: {item.crewStatus}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(removingAssignmentId)}
                  onClick={() => void removeAssignment(item.assignmentId)}
                  className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRemoving ? "Unassigning..." : "Unassign"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TransportCrewWageRateManagement({
  factoryId,
  crews,
  crewsUnavailable,
}: Readonly<{
  factoryId: string;
  crews: readonly TransportCrew[];
  crewsUnavailable: boolean;
}>) {
  const queryClient = useQueryClient();
  const today = getLocalDate();
  const [form, setForm] = useState<TransportRateFormState>(() => ({
    selectedCrewId: "",
    effectiveFrom: today,
    rateInput: "",
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const selectedCrew = crews.find((crew) => crew.id === form.selectedCrewId) ?? null;
  const historyQuery = useQuery({
    queryKey: transportRateHistoryQueryKey(factoryId, form.selectedCrewId),
    queryFn: () => listTransportCrewWageRates({
      factoryId,
      transportCrewId: form.selectedCrewId,
    }),
    enabled: Boolean(form.selectedCrewId),
  });
  const currentRateQuery = useQuery({
    queryKey: transportCurrentRateQueryKey(factoryId, form.selectedCrewId, today),
    queryFn: () => getTransportCrewWageRateForDate({
      factoryId,
      transportCrewId: form.selectedCrewId,
      workDate: today,
    }),
    enabled: Boolean(form.selectedCrewId),
  });

  const currentRateMissing = currentRateQuery.error
    instanceof TransportCrewWageRateResolutionError
    && currentRateQuery.error.failure === "missing";
  const currentRateError = currentRateQuery.error && !currentRateMissing
    ? transportRateOfficeErrorMessage(
      currentRateQuery.error,
      "Could not resolve the current transport crew rate.",
    )
    : "";

  function clearFeedback(): void {
    setSubmitError("");
    setSuccessMessage("");
  }

  async function createRate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    if (!form.selectedCrewId) {
      setSubmitError("Choose a transport crew.");
      return;
    }
    const numericRate = Number(form.rateInput);
    if (!form.rateInput.trim() || !Number.isFinite(numericRate) || numericRate <= 0) {
      setSubmitError("Rate per paya must be greater than zero.");
      return;
    }

    const input = buildTransportCrewWageRateInput({ factoryId, ...form });
    if (!input) {
      setSubmitError("Enter a valid effective-from calendar date.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createTransportCrewWageRate(input);
      setForm((current) => transportRateFormAfterSuccess(current));
      setSuccessMessage("Transport crew wage rate saved.");
      const refreshKeys = getTransportRateRefreshQueryKeys(
        factoryId,
        form.selectedCrewId,
        today,
      );
      await Promise.all(refreshKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ));
    } catch (error) {
      setSubmitError(transportRateOfficeErrorMessage(
        error,
        "Could not save the transport crew wage rate.",
      ));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="transport-crew-rates-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="transport-crew-rates-heading" className="text-xl font-bold">Crew Wage Rates</h3>
      <p className="mt-2 text-sm text-slate-600">Set crew-specific ₹ per paya rates from any calendar date.</p>

      <label className="mt-5 block max-w-md text-sm font-medium text-slate-700">
        Transport crew
        <select
          value={form.selectedCrewId}
          onChange={(event) => {
            setForm((current) => selectTransportRateCrew(current, event.target.value));
            clearFeedback();
          }}
          disabled={crewsUnavailable || crews.length === 0 || isSubmitting}
          className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          <option value="">Select a crew</option>
          {crews.map((crew) => {
            const option = buildTransportRateCrewOption(crew);
            return <option key={option.id} value={option.id}>{option.label}</option>;
          })}
        </select>
      </label>
      {crews.length === 0 && !crewsUnavailable && (
        <p className="mt-3 text-sm text-slate-500">No transport crew is available.</p>
      )}

      {selectedCrew && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <h4 className="font-semibold">Current rate</h4>
            <p className="mt-1 text-sm text-slate-600">
              {selectedCrew.name} · {formatTransportActiveStatus(selectedCrew.isActive)}
            </p>
            {currentRateQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading current rate...</p>}
            {currentRateMissing && <p className="mt-4 font-semibold text-slate-700">No current rate</p>}
            {currentRateError && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{currentRateError}</p>}
            {currentRateQuery.data && (
              <div className="mt-4">
                <p className="text-lg font-bold tabular-nums">{formatTransportRatePerPaya(currentRateQuery.data.ratePerPaya)}</p>
                <p className="mt-1 text-sm text-slate-600">Effective from {currentRateQuery.data.effectiveFrom}</p>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-semibold">Rate history</h4>
            {historyQuery.isLoading && <p className="mt-3 text-sm text-slate-500">Loading rate history...</p>}
            {historyQuery.error && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-700">
                {transportRateOfficeErrorMessage(historyQuery.error, "Could not load transport crew rate history.")}
              </p>
            )}
            {!historyQuery.isLoading && !historyQuery.error && (historyQuery.data ?? []).length === 0 && (
              <p className="mt-3 text-sm text-slate-500">No transport crew wage rates recorded.</p>
            )}
            {!historyQuery.isLoading && !historyQuery.error && (historyQuery.data ?? []).length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {(historyQuery.data ?? []).map((rate) => {
                  const item = buildTransportRateHistoryItem(rate);
                  return (
                    <li key={item.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-semibold tabular-nums">{item.formattedRate}</span>
                      <span className="text-slate-600">{item.effectiveFrom} → {item.periodEndLabel}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <form className="mt-6 grid gap-4 border-t border-slate-200 pt-6 md:grid-cols-3 md:items-end" onSubmit={(event) => void createRate(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Rate per paya
          <input
            type="number"
            min="0"
            step="any"
            value={form.rateInput}
            onChange={(event) => {
              setForm((current) => ({ ...current, rateInput: event.target.value }));
              clearFeedback();
            }}
            required
            disabled={isSubmitting || !form.selectedCrewId}
            placeholder="900.5"
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Effective from
          <input
            type="date"
            value={form.effectiveFrom}
            onChange={(event) => {
              setForm((current) => ({ ...current, effectiveFrom: event.target.value }));
              clearFeedback();
            }}
            required
            disabled={isSubmitting || !form.selectedCrewId}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting || crewsUnavailable || !form.selectedCrewId}
          className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Set Crew Rate"}
        </button>
        {submitError && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-3">{submitError}</p>}
        {successMessage && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-3">{successMessage}</p>}
      </form>
    </section>
  );
}

function TransportWeeklyEarningsManagement({
  factoryId,
}: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState("");
  const [selectedEarningId, setSelectedEarningId] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState("");
  const [calculationOutcome, setCalculationOutcome] = useState<TransportWeeklyCalculationOutcome | null>(null);

  const earningsQuery = useQuery({
    queryKey: transportWeeklyEarningsQueryKey(factoryId, weekStart),
    queryFn: () => listTransportWeeklyEarnings({ factoryId, weekStart }),
    enabled: Boolean(weekStart),
  });
  const detailsQuery = useQuery({
    queryKey: transportWeeklyEarningDetailsQueryKey(factoryId, selectedEarningId),
    queryFn: () => listTransportWeeklyEarningDetails({
      factoryId,
      weeklyEarningId: selectedEarningId,
    }),
    enabled: Boolean(selectedEarningId),
  });

  const earnings = earningsQuery.data ?? [];
  const isLocked = earnings.length > 0;
  const selectedEarning = earnings.find((earning) =>
    earning.weeklyEarningId === selectedEarningId,
  ) ?? null;

  async function calculateWeek(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isCalculating || isLocked) return;

    let input;
    try {
      input = buildTransportWeeklyCalculationInput({
        factoryId,
        weekStart,
        today: getLocalDate(),
      });
    } catch (error) {
      setCalculationError(transportWeeklySettlementErrorMessage(error));
      return;
    }

    setIsCalculating(true);
    setCalculationError("");
    setCalculationOutcome(null);
    try {
      const summary = await calculateTransportWeeklyWages(input);
      setCalculationOutcome(getTransportWeeklyCalculationOutcome(summary));
      await queryClient.invalidateQueries({
        queryKey: transportWeeklyEarningsQueryKey(factoryId, weekStart),
      });
    } catch (error) {
      setCalculationError(transportWeeklySettlementErrorMessage(error));
    } finally {
      setIsCalculating(false);
    }
  }

  return (
    <section aria-labelledby="transport-weekly-earnings-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="transport-weekly-earnings-heading" className="text-xl font-bold">Weekly Earnings</h3>
          <p className="mt-2 text-sm text-slate-600">Calculate and inspect locked Monday–Sunday Chamber Transport earnings.</p>
        </div>
        {isLocked && (
          <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
            Locked
          </span>
        )}
      </div>

      <form className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={(event) => void calculateWeek(event)}>
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Week start (Monday)
          <input
            type="date"
            value={weekStart}
            onChange={(event) => {
              setWeekStart(event.target.value);
              setSelectedEarningId("");
              setCalculationError("");
              setCalculationOutcome(null);
            }}
            required
            disabled={isCalculating}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={isCalculating || earningsQuery.isLoading || isLocked || !weekStart}
          className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCalculating ? "Calculating..." : isLocked ? "Already calculated" : "Calculate Week"}
        </button>
      </form>

      {weekStart && (
        <p className="mt-3 text-sm text-slate-600">
          Selected period: {weekStart} → {getTransportWeekEnd(weekStart)} (Monday–Sunday)
        </p>
      )}
      {calculationError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{calculationError}</p>}
      {calculationOutcome && (
        <p role="status" className={`mt-3 text-sm font-medium ${calculationOutcome.status === "no_work" ? "text-slate-700" : "text-emerald-700"}`}>
          {calculationOutcome.message}
        </p>
      )}

      {!weekStart && <p className="mt-6 text-sm text-slate-500">Select a completed Monday–Sunday week.</p>}
      {weekStart && earningsQuery.isLoading && <p className="mt-6 text-sm text-slate-500">Loading locked transport earnings...</p>}
      {earningsQuery.error && (
        <p role="alert" className="mt-6 text-sm font-medium text-red-700">
          {transportWeeklySettlementErrorMessage(earningsQuery.error)}
        </p>
      )}
      {weekStart && !earningsQuery.isLoading && !earningsQuery.error && earnings.length === 0 && !calculationOutcome && (
        <p className="mt-6 text-sm text-slate-500">Not calculated — no locked transport earnings exist for this week.</p>
      )}

      {earnings.length > 0 && (
        <div className="mt-6 space-y-3">
          {earnings.map((earning) => {
            const item = buildTransportWeeklyEarningDisplay(earning);
            const isSelected = item.weeklyEarningId === selectedEarningId;
            return (
              <article key={item.weeklyEarningId} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold">{item.workerLabel}</h4>
                  <p className="mt-1 text-lg font-bold tabular-nums">{item.totalAmount}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Locked weekly earning</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEarningId((current) =>
                    current === item.weeklyEarningId ? "" : item.weeklyEarningId,
                  )}
                  className="h-10 rounded-lg border border-slate-300 px-4 font-semibold"
                >
                  {isSelected ? "Hide Details" : "View Details"}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {selectedEarning && (
        <div className="mt-6 border-t border-slate-200 pt-6">
          <h4 className="font-semibold">Daily contributions — {selectedEarning.transportWorkerName}</h4>
          <p className="mt-1 text-sm text-slate-600">Immutable calculation snapshots; values are not recalculated from current data.</p>
          {detailsQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading contribution details...</p>}
          {detailsQuery.error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-700">
              {transportWeeklySettlementErrorMessage(detailsQuery.error)}
            </p>
          )}
          {!detailsQuery.isLoading && !detailsQuery.error && (detailsQuery.data ?? []).length === 0 && (
            <p className="mt-4 text-sm text-slate-500">No immutable contribution details were found.</p>
          )}
          {!detailsQuery.isLoading && !detailsQuery.error && (detailsQuery.data ?? []).length > 0 && (
            <div className="mt-4 space-y-3">
              {(detailsQuery.data ?? []).map((detail) => {
                const item = buildTransportWeeklyDetailDisplay(detail);
                return (
                  <article key={item.detailId} className="rounded-lg border border-slate-200 p-4 text-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h5 className="font-semibold">{item.workDate} · {item.crewLabel}</h5>
                        <p className="mt-1 text-slate-600">Paya: {item.paya} · Attendance: {item.attendanceCount}</p>
                      </div>
                      <p className="font-bold tabular-nums">Share: {item.workerShare}</p>
                    </div>
                    <p className="mt-2 text-slate-600">Rate: {item.ratePerPaya} · Daily crew pool: {item.dailyCrewPool}</p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TransportWorkerFinances({
  factoryId,
  workers,
  workersUnavailable,
}: Readonly<{
  factoryId: string;
  workers: readonly TransportWorker[];
  workersUnavailable: boolean;
}>) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TransportWorkerFinanceFormState>({
    selectedWorkerId: "",
    withdrawalDate: getLocalDate(),
    amountInput: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const balanceQuery = useQuery({
    queryKey: transportWorkerBalanceQueryKey(
      factoryId,
      form.selectedWorkerId,
      form.withdrawalDate,
    ),
    queryFn: () => getTransportWorkerAvailableBalance({
      factoryId,
      transportWorkerId: form.selectedWorkerId,
      asOfDate: form.withdrawalDate,
    }),
    enabled: Boolean(form.selectedWorkerId && form.withdrawalDate),
  });
  const withdrawalsQuery = useQuery({
    queryKey: transportWorkerWithdrawalsQueryKey(factoryId, form.selectedWorkerId),
    queryFn: () => listTransportWorkerWithdrawals({
      factoryId,
      transportWorkerId: form.selectedWorkerId,
    }),
    enabled: Boolean(form.selectedWorkerId),
  });

  const selectedWorker = workers.find((worker) => worker.id === form.selectedWorkerId) ?? null;
  const balanceDisplay = balanceQuery.data
    ? buildTransportBalanceDisplay(balanceQuery.data)
    : null;

  function clearFeedback(): void {
    setSubmitError("");
    setSuccessMessage("");
  }

  async function submitWithdrawal(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    const input = buildTransportWithdrawalInput({ factoryId, ...form });
    if (!input) {
      setSubmitError("Select a worker, enter a valid date, and enter an amount greater than zero.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createTransportWorkerWithdrawal(input);
      setForm((current) => transportFinanceFormAfterSuccess(current));
      setSuccessMessage("Transport worker withdrawal recorded.");
      const queryKeys = getTransportFinanceRefreshQueryKeys({
        factoryId,
        transportWorkerId: form.selectedWorkerId,
        asOfDate: form.withdrawalDate,
      });
      await Promise.all(queryKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ));
    } catch (error) {
      setSubmitError(transportWorkerFinanceErrorMessage(
        error,
        "Could not record the transport worker withdrawal.",
      ));
      if (error && typeof error === "object" && "code" in error && error.code === "P0001") {
        await queryClient.invalidateQueries({
          queryKey: transportWorkerBalanceQueryKey(
            factoryId,
            form.selectedWorkerId,
            form.withdrawalDate,
          ),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="transport-worker-finances-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="transport-worker-finances-heading" className="text-xl font-bold">Worker Finances</h3>
      <p className="mt-2 text-sm text-slate-600">Authoritative balance and read-only withdrawal history for one transport worker.</p>

      <label className="mt-5 block text-sm font-medium text-slate-700">
        Transport worker
        <select
          value={form.selectedWorkerId}
          onChange={(event) => {
            setForm((current) => selectTransportFinanceWorker(current, event.target.value));
            clearFeedback();
          }}
          disabled={workersUnavailable || isSubmitting}
          className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          <option value="">Select worker</option>
          {workers.map((worker) => {
            const option = buildTransportFinanceWorkerOption(worker);
            return <option key={option.id} value={option.id}>{option.label}</option>;
          })}
        </select>
      </label>

      {!form.selectedWorkerId && (
        <p className="mt-5 text-sm text-slate-500">Select a worker to view their balance and withdrawal history.</p>
      )}

      {selectedWorker && (
        <div className="mt-5">
          <p className="text-sm text-slate-600">
            Selected worker: <span className="font-semibold text-slate-900">{buildTransportFinanceWorkerOption(selectedWorker).label}</span>
          </p>

          <label className="mt-4 block max-w-sm text-sm font-medium text-slate-700">
            Balance as of / withdrawal date
            <input
              type="date"
              value={form.withdrawalDate}
              onChange={(event) => {
                setForm((current) => ({ ...current, withdrawalDate: event.target.value }));
                clearFeedback();
              }}
              required
              disabled={isSubmitting}
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </label>

          {balanceQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading authoritative balance...</p>}
          {balanceQuery.error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-700">
              {transportWorkerFinanceErrorMessage(balanceQuery.error, "Could not load the transport worker balance.")}
            </p>
          )}
          {!balanceQuery.isLoading && !balanceQuery.error && balanceDisplay && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Earned</p>
                  <p className="mt-1 font-semibold tabular-nums">{balanceDisplay.earned}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Withdrawn</p>
                  <p className="mt-1 font-semibold tabular-nums">{balanceDisplay.withdrawn}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Available Balance</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{balanceDisplay.available}</p>
                </div>
              </div>
              {!balanceDisplay.hasLockedEarnings && (
                <p className="mt-3 text-sm text-slate-500">No locked Chamber Transport earnings exist through this date.</p>
              )}
              {balanceDisplay.hasLockedEarnings && !balanceDisplay.hasAvailableBalance && (
                <p className="mt-3 text-sm text-slate-500">Available balance is zero as of this date.</p>
              )}
            </>
          )}

          <form className="mt-5 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2 sm:items-end" onSubmit={(event) => void submitWithdrawal(event)}>
            <label className="block text-sm font-medium text-slate-700">
              Withdrawal amount
              <input
                type="number"
                min="0"
                step="any"
                value={form.amountInput}
                onChange={(event) => {
                  setForm((current) => ({ ...current, amountInput: event.target.value }));
                  clearFeedback();
                }}
                required
                disabled={isSubmitting}
                placeholder="500.50"
                className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting || !form.withdrawalDate}
              className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving..." : "Record Withdrawal"}
            </button>
            {submitError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">{submitError}</p>}
            {successMessage && <p role="status" className="text-sm font-medium text-emerald-700 sm:col-span-2">{successMessage}</p>}
          </form>

          <h4 className="mt-6 font-semibold">Withdrawal History</h4>
          {withdrawalsQuery.isLoading && <p className="mt-3 text-sm text-slate-500">Loading withdrawal history...</p>}
          {withdrawalsQuery.error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-700">
              {transportWorkerFinanceErrorMessage(withdrawalsQuery.error, "Could not load withdrawal history.")}
            </p>
          )}
          {!withdrawalsQuery.isLoading && !withdrawalsQuery.error && (withdrawalsQuery.data ?? []).length === 0 && (
            <p className="mt-3 text-sm text-slate-500">No withdrawals recorded for this worker.</p>
          )}
          {!withdrawalsQuery.isLoading && !withdrawalsQuery.error && (withdrawalsQuery.data ?? []).length > 0 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Withdrawal date</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(withdrawalsQuery.data ?? []).map((withdrawal) => {
                    const item = buildTransportWithdrawalHistoryItem(withdrawal);
                    return (
                      <tr key={item.withdrawalId}>
                        <td className="px-4 py-3 font-medium">{item.withdrawalDate}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{item.amount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
