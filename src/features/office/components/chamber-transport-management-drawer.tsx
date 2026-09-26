"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/form-controls";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { StatusPill } from "@/components/ui/status-pill";
import {
  buildTransportGroupCreateInput,
  buildTransportGroupWageRateInput,
  buildTransportWorkerCreateInput,
  getTransportRateRefreshQueryKeys,
  transportOfficeErrorMessage,
  transportRateOfficeErrorMessage,
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
  assignTransportWorkerToGroup,
  listTransportGroupAssignments,
  unassignTransportWorkerFromGroup,
} from "@/features/transport/services/transport-crew-assignment-service";
import {
  activateTransportGroup,
  createTransportGroup,
  deactivateTransportGroup,
} from "@/features/transport/services/transport-crew-service";
import {
  createTransportGroupWageRate,
  getTransportGroupWageRateForDate,
  listTransportGroupWageRates,
  TransportGroupWageRateResolutionError,
} from "@/features/transport/services/transport-crew-wage-rate-service";
import {
  listTransportWeeklyEarningDetails,
  listTransportWeeklyEarnings,
} from "@/features/transport/services/transport-weekly-earning-read-service";
import { calculateTransportWeeklyWages } from "@/features/transport/services/transport-weekly-wage-calculation-service";
import {
  activateTransportWorker,
  createTransportWorker,
  deactivateTransportWorker,
} from "@/features/transport/services/transport-worker-service";
import type {
  TransportGroup,
  TransportGroupAssignment,
  TransportWorker,
} from "@/features/transport/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  resolveBooleanStatusPresentation,
  TRANSPORT_GROUP_LIFECYCLE_STATUS,
  TRANSPORT_WORKER_LIFECYCLE_STATUS,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const workerQueryKey = (factoryId: string) => ["office-transport-workers", factoryId] as const;
const groupQueryKey = (factoryId: string) => ["office-transport-groups", factoryId] as const;
const assignmentQueryKey = (factoryId: string) => ["office-transport-assignments", factoryId] as const;
const overviewAssignmentQueryKey = (factoryId: string) => ["office-transport-overview-assignments", factoryId] as const;
const rateHistoryQueryKey = (factoryId: string, groupId: string) => ["office-transport-group-wage-rates", factoryId, groupId] as const;
const currentRateQueryKey = (factoryId: string, groupId: string, workDate: string) => ["office-transport-current-group-wage-rate", factoryId, groupId, workDate] as const;
const weeklyEarningsQueryKey = (factoryId: string, weekStart: string) => ["office-transport-weekly-earnings", factoryId, weekStart] as const;
const weeklyDetailsQueryKey = (factoryId: string, earningId: string) => ["office-transport-weekly-earning-details", factoryId, earningId] as const;

export function ChamberTransportManagementDrawer({
  factoryId,
  workers,
  workersLoading,
  workersError,
  groups,
  groupsLoading,
  groupsError,
  onClose,
}: Readonly<{
  factoryId: string;
  workers: readonly TransportWorker[];
  workersLoading: boolean;
  workersError: Error | null;
  groups: readonly TransportGroup[];
  groupsLoading: boolean;
  groupsError: Error | null;
  onClose: () => void;
}>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const assignmentsQuery = useQuery({
    queryKey: assignmentQueryKey(factoryId),
    queryFn: () => listTransportGroupAssignments({ factoryId }),
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const drawer = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal management drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Chamber Transport setup" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="chamber-transport-management-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-background shadow-atlas-high sm:max-w-lg"
      >
        <header className="border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="flex items-start justify-between gap-atlas-3">
            <div>
              <h2 id="chamber-transport-management-title" className="text-atlas-lg font-atlas-semibold text-atlas-text">Chamber Transport setup</h2>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Manage Transport Workers, multi-group assignments, effective-dated ₹/paya rates and weekly locks.</p>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Chamber Transport setup" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-atlas-6 overflow-y-auto px-atlas-5 py-atlas-5">
          <section aria-labelledby="transport-worker-management-heading">
            <div className="flex items-center justify-between gap-atlas-3">
              <h3 id="transport-worker-management-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Transport Workers</h3>
              <Button variant="ghost" aria-expanded={showAddWorker} onClick={() => setShowAddWorker((current) => !current)}>
                {showAddWorker ? ATLAS_UI_STRINGS.actions.close : "+ Add worker"}
              </Button>
            </div>
            {showAddWorker && <div className="mt-atlas-3"><AddTransportWorkerForm factoryId={factoryId} onSaved={() => setShowAddWorker(false)} /></div>}

            <div className="mt-atlas-3">
              {workersLoading ? (
                <Feedback role="status" tone="neutral">Loading Transport Workers...</Feedback>
              ) : workersError ? (
                <Feedback role="alert" tone="danger">Could not load Transport Workers.</Feedback>
              ) : workers.length === 0 ? (
                <EmptyState title="No Transport Workers yet" description="Add the first worker using the action above." />
              ) : (
                <div className="overflow-hidden rounded-atlas-card border border-atlas-border bg-atlas-surface">
                  {workers.map((worker, index) => (
                    <div key={worker.id} className={index === 0 ? "" : "border-t border-atlas-border"}>
                      <TransportWorkerManagementRow
                        factoryId={factoryId}
                        worker={worker}
                        groups={groups}
                        assignments={assignmentsQuery.data ?? []}
                        assignmentsLoading={assignmentsQuery.isLoading}
                        assignmentsError={assignmentsQuery.error}
                        expanded={selectedWorkerId === worker.id}
                        onToggleExpanded={() => setSelectedWorkerId((current) => current === worker.id ? "" : worker.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
              {!workersLoading && !workersError && workers.length > 0 && (
                <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">{formatIndianNumber(workers.length)} worker identities · workers may belong to multiple Transport Groups</p>
              )}
            </div>
          </section>

          <section aria-labelledby="transport-group-management-heading">
            <div className="flex items-center justify-between gap-atlas-3">
              <h3 id="transport-group-management-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Transport Groups</h3>
              <Button variant="ghost" aria-expanded={showAddGroup} onClick={() => setShowAddGroup((current) => !current)}>
                {showAddGroup ? ATLAS_UI_STRINGS.actions.close : "+ Add group"}
              </Button>
            </div>
            {showAddGroup && <div className="mt-atlas-3"><AddTransportGroupForm factoryId={factoryId} onSaved={() => setShowAddGroup(false)} /></div>}

            <div className="mt-atlas-3">
              {groupsLoading ? (
                <Feedback role="status" tone="neutral">Loading Transport Groups...</Feedback>
              ) : groupsError ? (
                <Feedback role="alert" tone="danger">Could not load Transport Groups.</Feedback>
              ) : groups.length === 0 ? (
                <EmptyState title="No Transport Groups yet" description="Add the first group using the action above." />
              ) : (
                <div className="space-y-atlas-3">
                  {groups.map((group) => (
                    <TransportGroupManagementCard
                      key={group.id}
                      factoryId={factoryId}
                      group={group}
                      assignments={assignmentsQuery.data ?? []}
                      assignmentsLoading={assignmentsQuery.isLoading}
                      assignmentsError={assignmentsQuery.error}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <TransportWeeklyLockingSection factoryId={factoryId} />
        </div>

        <footer className="flex items-center justify-between gap-atlas-3 border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <p className="text-atlas-xs text-atlas-text-subtle">Assignments and rate history remain authoritative.</p>
          <Button onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  );
}

function AddTransportWorkerForm({ factoryId, onSaved }: Readonly<{ factoryId: string; onSaved: () => void }>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const input = buildTransportWorkerCreateInput(factoryId, name);
    if (!input) {
      setError("Transport Worker name is required.");
      return;
    }
    setSubmitting(true); setError("");
    try {
      await createTransportWorker(input);
      await queryClient.invalidateQueries({ queryKey: workerQueryKey(factoryId) });
      onSaved();
    } catch (caught) {
      setError(transportOfficeErrorMessage(caught, "Could not add Transport Worker."));
    } finally {
      setSubmitting(false);
    }
  }

  return <Card surface="muted"><form onSubmit={(event) => void submit(event)}>
    <FormField label="Worker name"><Input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} disabled={submitting} autoComplete="off" /></FormField>
    {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    <div className="mt-atlas-3"><Button type="submit" loading={submitting} loadingLabel="Adding...">Add Transport Worker</Button></div>
  </form></Card>;
}

function AddTransportGroupForm({ factoryId, onSaved }: Readonly<{ factoryId: string; onSaved: () => void }>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const input = buildTransportGroupCreateInput({ factoryId, name });
    if (!input) {
      setError("Transport Group name is required.");
      return;
    }
    setSubmitting(true); setError("");
    try {
      await createTransportGroup(input);
      await queryClient.invalidateQueries({ queryKey: groupQueryKey(factoryId) });
      onSaved();
    } catch (caught) {
      setError(transportOfficeErrorMessage(caught, "Could not add Transport Group."));
    } finally {
      setSubmitting(false);
    }
  }

  return <Card surface="muted"><form onSubmit={(event) => void submit(event)}>
    <FormField label="Transport Group name"><Input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} disabled={submitting} autoComplete="off" /></FormField>
    {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    <div className="mt-atlas-3"><Button type="submit" loading={submitting} loadingLabel="Adding...">Add Transport Group</Button></div>
  </form></Card>;
}

function TransportWorkerManagementRow({
  factoryId,
  worker,
  groups,
  assignments,
  assignmentsLoading,
  assignmentsError,
  expanded,
  onToggleExpanded,
}: Readonly<{
  factoryId: string;
  worker: TransportWorker;
  groups: readonly TransportGroup[];
  assignments: readonly TransportGroupAssignment[];
  assignmentsLoading: boolean;
  assignmentsError: Error | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}>) {
  const queryClient = useQueryClient();
  const [updatingMembershipId, setUpdatingMembershipId] = useState("");
  const [updatingLifecycle, setUpdatingLifecycle] = useState(false);
  const [error, setError] = useState("");
  const workerAssignments = assignments.filter((assignment) => assignment.transportWorkerId === worker.id);
  const status = resolveBooleanStatusPresentation(TRANSPORT_WORKER_LIFECYCLE_STATUS, worker.isActive);

  async function refreshAssignments() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: assignmentQueryKey(factoryId) }),
      queryClient.invalidateQueries({ queryKey: overviewAssignmentQueryKey(factoryId) }),
    ]);
  }

  async function changeMembership(group: TransportGroup, shouldAssign: boolean) {
    if (updatingMembershipId) return;
    const existing = workerAssignments.find((assignment) => assignment.transportGroupId === group.id);
    if ((shouldAssign && existing) || (!shouldAssign && !existing)) return;
    setUpdatingMembershipId(group.id); setError("");
    try {
      if (shouldAssign) {
        await assignTransportWorkerToGroup({ factoryId, transportWorkerId: worker.id, transportGroupId: group.id });
      } else {
        await unassignTransportWorkerFromGroup({ factoryId, assignmentId: existing!.id });
      }
      await refreshAssignments();
    } catch (caught) {
      setError(transportOfficeErrorMessage(caught, "Could not update this Transport Group membership."));
    } finally {
      setUpdatingMembershipId("");
    }
  }

  async function toggleLifecycle() {
    if (updatingLifecycle) return;
    setUpdatingLifecycle(true); setError("");
    try {
      if (worker.isActive) {
        await deactivateTransportWorker({ factoryId, transportWorkerId: worker.id });
      } else {
        await activateTransportWorker({ factoryId, transportWorkerId: worker.id });
      }
      await queryClient.invalidateQueries({ queryKey: workerQueryKey(factoryId) });
    } catch (caught) {
      setError(transportOfficeErrorMessage(caught, "Could not update this Transport Worker."));
    } finally {
      setUpdatingLifecycle(false);
    }
  }

  return <div className="px-atlas-4 py-atlas-3">
    <div className="flex items-center justify-between gap-atlas-3">
      <div className="flex min-w-0 flex-wrap items-center gap-atlas-2"><p className="truncate text-atlas-sm font-atlas-semibold text-atlas-text">{worker.name}</p><StatusPill label={status.label} tone={status.tone} /></div>
      <Button variant="secondary" aria-expanded={expanded} onClick={onToggleExpanded}>{expanded ? ATLAS_UI_STRINGS.actions.close : "Manage"}</Button>
    </div>
    {expanded && <div className="mt-atlas-4 border-t border-atlas-border pt-atlas-3">
      <div className="flex items-center justify-between gap-atlas-3 text-atlas-sm"><span className="text-atlas-text-muted">Worker name</span><span className="font-atlas-medium text-atlas-text">{worker.name}</span></div>
      <div className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
        <div className="flex items-center justify-between gap-atlas-3"><p className="text-atlas-sm text-atlas-text-muted">Transport Groups</p><p className="text-atlas-xs text-atlas-text-subtle">Multi-group membership</p></div>
        {assignmentsLoading ? <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">{ATLAS_UI_STRINGS.feedback.loading}</p> : assignmentsError ? <div className="mt-atlas-2"><Feedback role="alert" tone="danger">Could not load memberships.</Feedback></div> : groups.length === 0 ? <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">No Transport Groups available.</p> : <div className="mt-atlas-2 space-y-atlas-2 rounded-atlas-control border border-atlas-border bg-atlas-surface-muted p-atlas-3">
          {groups.map((group) => {
            const assigned = workerAssignments.some((assignment) => assignment.transportGroupId === group.id);
            return <label key={group.id} className="flex min-h-atlas-12 cursor-pointer items-center gap-atlas-2 text-atlas-sm text-atlas-text">
              <Checkbox checked={assigned} disabled={Boolean(updatingMembershipId)} onChange={(event) => void changeMembership(group, event.target.checked)} />
              <span className="font-atlas-medium">{group.name}</span>
              {!group.isActive && <span className="text-atlas-xs text-atlas-text-subtle">Inactive</span>}
              {updatingMembershipId === group.id && <span className="text-atlas-xs text-atlas-text-subtle">Updating...</span>}
            </label>;
          })}
        </div>}
      </div>
      <div className="mt-atlas-3 flex flex-col gap-atlas-2 border-t border-atlas-border pt-atlas-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-atlas-sm text-atlas-text-muted">Worker status: <span className="font-atlas-medium text-atlas-text">{status.label}</span></p>
        <Button variant="ghost" loading={updatingLifecycle} loadingLabel="Updating..." onClick={() => void toggleLifecycle()}>{worker.isActive ? "Deactivate worker" : "Reactivate worker"}</Button>
      </div>
      {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    </div>}
  </div>;
}

function TransportGroupManagementCard({ factoryId, group, assignments, assignmentsLoading, assignmentsError }: Readonly<{
  factoryId: string;
  group: TransportGroup;
  assignments: readonly TransportGroupAssignment[];
  assignmentsLoading: boolean;
  assignmentsError: Error | null;
}>) {
  const queryClient = useQueryClient();
  const today = getLocalDate();
  const [showRateEditor, setShowRateEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [submittingRate, setSubmittingRate] = useState(false);
  const [updatingLifecycle, setUpdatingLifecycle] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const members = assignments.filter((assignment) => assignment.transportGroupId === group.id);
  const status = resolveBooleanStatusPresentation(TRANSPORT_GROUP_LIFECYCLE_STATUS, group.isActive);
  const currentRateQuery = useQuery({
    queryKey: currentRateQueryKey(factoryId, group.id, today),
    queryFn: () => getTransportGroupWageRateForDate({ factoryId, transportGroupId: group.id, workDate: today }),
  });
  const historyQuery = useQuery({
    queryKey: rateHistoryQueryKey(factoryId, group.id),
    queryFn: () => listTransportGroupWageRates({ factoryId, transportGroupId: group.id }),
    enabled: showHistory,
  });
  const currentRateMissing = currentRateQuery.error instanceof TransportGroupWageRateResolutionError
    && currentRateQuery.error.failure === "missing";
  const currentRateError = currentRateQuery.error && !currentRateMissing;

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRate) return;
    const input = buildTransportGroupWageRateInput({
      factoryId,
      selectedGroupId: group.id,
      effectiveFrom,
      rateInput,
    });
    if (!input) {
      setError("Enter a positive ₹/paya rate and valid effective date.");
      return;
    }
    setSubmittingRate(true); setError(""); setSuccess("");
    try {
      await createTransportGroupWageRate(input);
      setRateInput(""); setShowRateEditor(false); setSuccess("Transport Group rate saved.");
      const refreshKeys = getTransportRateRefreshQueryKeys(factoryId, group.id, today);
      await Promise.all(refreshKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    } catch (caught) {
      setError(transportRateOfficeErrorMessage(caught, "Could not save the Transport Group rate."));
    } finally {
      setSubmittingRate(false);
    }
  }

  async function toggleLifecycle() {
    if (updatingLifecycle) return;
    setUpdatingLifecycle(true); setError(""); setSuccess("");
    try {
      if (group.isActive) {
        await deactivateTransportGroup({ factoryId, transportGroupId: group.id });
      } else {
        await activateTransportGroup({ factoryId, transportGroupId: group.id });
      }
      await queryClient.invalidateQueries({ queryKey: groupQueryKey(factoryId) });
    } catch (caught) {
      setError(transportOfficeErrorMessage(caught, "Could not update this Transport Group."));
    } finally {
      setUpdatingLifecycle(false);
    }
  }

  const currentRateLabel = currentRateQuery.isLoading
    ? ATLAS_UI_STRINGS.feedback.loading
    : currentRateMissing
      ? "Not set"
      : currentRateError || !currentRateQuery.data
        ? ATLAS_UI_STRINGS.feedback.unavailable
        : `${formatIndianCurrency(currentRateQuery.data.ratePerPaya, { maximumFractionDigits: 20 })} / paya`;
  const memberSummary = assignmentsLoading
    ? ATLAS_UI_STRINGS.feedback.loading
    : assignmentsError
      ? ATLAS_UI_STRINGS.feedback.unavailable
      : `${formatIndianNumber(members.length)} members`;
  const memberNames = assignmentsLoading
    ? ATLAS_UI_STRINGS.feedback.loading
    : assignmentsError
      ? "Memberships unavailable"
      : members.length === 0
        ? "No assigned workers"
        : members.map((assignment) => assignment.transportWorkerName).join(", ");

  return <Card as="article">
    <div className="flex flex-wrap items-center gap-atlas-2"><h4 className="text-atlas-base font-atlas-semibold text-atlas-text">{group.name}</h4><StatusPill label={status.label} tone={status.tone} /></div>
    <p className="mt-atlas-2 text-atlas-xs text-atlas-text-muted">{memberSummary} · <span className="tabular-nums">{currentRateLabel}</span></p>
    <dl className="mt-atlas-3 divide-y divide-atlas-border border-y border-atlas-border text-atlas-sm">
      <div className="py-atlas-3"><dt className="text-atlas-text-muted">Members</dt><dd className="mt-atlas-1 font-atlas-medium text-atlas-text">{memberNames}</dd></div>
      <div className="flex flex-col gap-atlas-2 py-atlas-3 sm:flex-row sm:items-center sm:justify-between"><div><dt className="text-atlas-text-muted">Current rate</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{currentRateLabel}</dd></div><div className="flex flex-wrap gap-atlas-2"><Button variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory((current) => !current)}>{showHistory ? "Hide history" : "Rate history"}</Button><Button variant="secondary" aria-expanded={showRateEditor} onClick={() => setShowRateEditor((current) => !current)}>{showRateEditor ? ATLAS_UI_STRINGS.actions.cancel : "Change rate"}</Button></div></div>
      <div className="flex flex-col gap-atlas-2 py-atlas-3 sm:flex-row sm:items-center sm:justify-between"><div><dt className="text-atlas-text-muted">{ATLAS_UI_STRINGS.fields.status}</dt><dd className="mt-atlas-1 font-atlas-medium text-atlas-text">{status.label}</dd></div><Button variant="ghost" loading={updatingLifecycle} loadingLabel="Updating..." onClick={() => void toggleLifecycle()}>{group.isActive ? "Deactivate" : "Reactivate"}</Button></div>
    </dl>

    {showRateEditor && <form className="mt-atlas-3 space-y-atlas-3 rounded-atlas-control border border-atlas-border bg-atlas-surface-muted p-atlas-3" onSubmit={(event) => void saveRate(event)}>
      <FormField label="Rate per paya"><Input type="text" inputMode="decimal" value={rateInput} onChange={(event) => { setRateInput(event.target.value); setError(""); setSuccess(""); }} disabled={submittingRate} /></FormField>
      <FormField label="Effective from"><Input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setError(""); setSuccess(""); }} disabled={submittingRate} /></FormField>
      <Button type="submit" loading={submittingRate} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save group rate</Button>
    </form>}

    {showHistory && <div className="mt-atlas-3">
      {historyQuery.isLoading ? <Feedback role="status" tone="neutral">Loading rate history...</Feedback> : historyQuery.error ? <Feedback role="alert" tone="danger">{transportRateOfficeErrorMessage(historyQuery.error, "Could not load rate history.")}</Feedback> : (historyQuery.data ?? []).length === 0 ? <p className="text-atlas-sm text-atlas-text-subtle">No rate history recorded.</p> : <ul className="divide-y divide-atlas-border rounded-atlas-control border border-atlas-border">{(historyQuery.data ?? []).map((rate) => <li key={rate.id} className="flex flex-col gap-atlas-1 px-atlas-3 py-atlas-2 text-atlas-sm sm:flex-row sm:items-center sm:justify-between"><span className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(rate.ratePerPaya, { maximumFractionDigits: 20 })} / paya</span><span className="text-atlas-xs text-atlas-text-muted">{formatDateOnly(rate.effectiveFrom)} — {rate.effectiveTo ? formatDateOnly(rate.effectiveTo) : "Current"}</span></li>)}</ul>}
    </div>}
    {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}
  </Card>;
}

function TransportWeeklyLockingSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState("");
  const [selectedEarningId, setSelectedEarningId] = useState("");
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<TransportWeeklyCalculationOutcome | null>(null);
  const earningsQuery = useQuery({
    queryKey: weeklyEarningsQueryKey(factoryId, weekStart),
    queryFn: () => listTransportWeeklyEarnings({ factoryId, weekStart }),
    enabled: Boolean(weekStart),
  });
  const detailsQuery = useQuery({
    queryKey: weeklyDetailsQueryKey(factoryId, selectedEarningId),
    queryFn: () => listTransportWeeklyEarningDetails({ factoryId, weeklyEarningId: selectedEarningId }),
    enabled: Boolean(selectedEarningId),
  });
  const earnings = earningsQuery.data ?? [];
  const locked = earnings.length > 0;
  const selectedEarning = earnings.find((earning) => earning.weeklyEarningId === selectedEarningId) ?? null;

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (calculating || locked) return;
    let input;
    try {
      input = buildTransportWeeklyCalculationInput({ factoryId, weekStart, today: getLocalDate() });
    } catch (caught) {
      setError(transportWeeklySettlementErrorMessage(caught));
      return;
    }
    setCalculating(true); setError(""); setOutcome(null);
    try {
      const summary = await calculateTransportWeeklyWages(input);
      setOutcome(getTransportWeeklyCalculationOutcome(summary));
      await queryClient.invalidateQueries({ queryKey: weeklyEarningsQueryKey(factoryId, weekStart) });
    } catch (caught) {
      setError(transportWeeklySettlementErrorMessage(caught));
    } finally {
      setCalculating(false);
    }
  }

  return <details className="border-t border-atlas-border pt-atlas-3">
    <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">Weekly calculation &amp; locks</summary>
    <div className="pb-atlas-3">
      <p className="text-atlas-xs text-atlas-text-muted">Calculate and inspect immutable Monday–Sunday Chamber Transport earnings.</p>
      <form className="mt-atlas-3 space-y-atlas-3" onSubmit={(event) => void calculate(event)}>
        <FormField label="Week start (Monday)"><Input type="date" value={weekStart} onChange={(event) => { setWeekStart(event.target.value); setSelectedEarningId(""); setError(""); setOutcome(null); }} disabled={calculating} /></FormField>
        <Button type="submit" loading={calculating} loadingLabel="Calculating..." disabled={earningsQuery.isLoading || locked || !weekStart}>{locked ? "Already calculated" : "Calculate week"}</Button>
      </form>
      {weekStart && <p className="mt-atlas-2 text-atlas-xs text-atlas-text-subtle">{formatDateOnly(weekStart)} — {formatDateOnly(getTransportWeekEnd(weekStart))}, Monday–Sunday</p>}
      {locked && <div className="mt-atlas-3"><StatusPill label="Locked" tone="success" /></div>}
      {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
      {outcome && <div className="mt-atlas-3"><Feedback role="status" tone={outcome.status === "no_work" ? "neutral" : "success"}>{outcome.message}</Feedback></div>}
      {earningsQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{transportWeeklySettlementErrorMessage(earningsQuery.error)}</Feedback></div>}
      {weekStart && !earningsQuery.isLoading && !earningsQuery.error && earnings.length === 0 && !outcome && <p className="mt-atlas-3 text-atlas-sm text-atlas-text-subtle">Not calculated — no locked earnings exist for this week.</p>}
      {earnings.length > 0 && <div className="mt-atlas-3 space-y-atlas-2">{earnings.map((earning) => {
        const item = buildTransportWeeklyEarningDisplay(earning);
        const selected = item.weeklyEarningId === selectedEarningId;
        return <Card key={item.weeklyEarningId} surface="muted"><div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-atlas-sm font-atlas-semibold text-atlas-text">{item.workerLabel}</p><p className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{item.totalAmount}</p></div><Button variant="secondary" aria-expanded={selected} onClick={() => setSelectedEarningId((current) => current === item.weeklyEarningId ? "" : item.weeklyEarningId)}>{selected ? "Hide details" : "View details"}</Button></div></Card>;
      })}</div>}
      {selectedEarning && <div className="mt-atlas-3"><p className="text-atlas-sm font-atlas-semibold text-atlas-text">Daily contributions · {selectedEarning.transportWorkerName}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Saved snapshots are shown without recalculation.</p>{detailsQuery.isLoading ? <div className="mt-atlas-2"><Feedback role="status" tone="neutral">Loading details...</Feedback></div> : detailsQuery.error ? <div className="mt-atlas-2"><Feedback role="alert" tone="danger">{transportWeeklySettlementErrorMessage(detailsQuery.error)}</Feedback></div> : <div className="mt-atlas-2 space-y-atlas-2">{(detailsQuery.data ?? []).map((detail) => { const item = buildTransportWeeklyDetailDisplay(detail); return <Card key={item.detailId}><p className="text-atlas-sm font-atlas-semibold text-atlas-text">{formatDateOnly(item.workDate)} · {item.groupLabel}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{item.paya} paya · {item.attendanceCount} present · {item.ratePerPaya}</p><p className="mt-atlas-1 text-atlas-xs tabular-nums text-atlas-text-muted">Pool {item.dailyGroupPool} · Worker share {item.workerShare}</p></Card>; })}</div>}</div>}
    </div>
  </details>;
}
