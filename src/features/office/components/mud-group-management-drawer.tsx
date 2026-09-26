"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
import {
  createMudGroup,
  editMudGroupMembers,
  restartMudGroupEarning,
  setMudGroupRate,
  stopMudGroupEarning,
  type MudAccountingMode,
  type MudGroupConfiguration,
} from "@/features/wages/services/mud-group-configuration-service";
import type { MudGroupRangeAllocation } from "@/features/wages/services/mud-multi-group-allocation-service";
import { formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type MudGroupManagementDrawerProps = Readonly<{
  factoryId: string;
  groups: readonly MudGroupConfiguration[];
  groupsLoading: boolean;
  groupsError: boolean;
  mode: MudAccountingMode | undefined;
  rangeAllocations: MudGroupRangeAllocation["groups"] | undefined;
  rangeLoading: boolean;
  rangeError: boolean;
  accountingDiagnostics?: ReactNode;
  onChanged: () => Promise<void>;
  onClose: () => void;
}>;

export function MudGroupManagementDrawer({
  factoryId,
  groups,
  groupsLoading,
  groupsError,
  mode,
  rangeAllocations,
  rangeLoading,
  rangeError,
  accountingDiagnostics,
  onChanged,
  onClose,
}: MudGroupManagementDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [showAddGroup, setShowAddGroup] = useState(false);

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

  function operationalPreview(groupId: string) {
    return rangeAllocations?.find((allocation) => allocation.labourGroupId === groupId) ?? null;
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: Full-screen dismissal target behind the modal management drawer requires native overlay positioning. */}
      <button type="button" aria-label="Close Mud group management" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="mud-group-management-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border bg-atlas-background shadow-atlas-high sm:max-w-md"
      >
        <header className="border-b border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <div className="flex items-start justify-between gap-atlas-3">
            <div>
              <h2 id="mud-group-management-title" className="text-atlas-lg font-atlas-semibold text-atlas-text">Mud Group Management</h2>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Manage group membership, effective-dated operational rates and earning periods.</p>
            </div>
            <Button ref={closeButtonRef} variant="ghost" aria-label="Close Mud group management" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </Button>
          </div>
          {mode === "SHADOW" && <div className="mt-atlas-3"><Feedback role="status" tone="warning">Operational allocation previews are SHADOW previews. They are not payable balances.</Feedback></div>}
          <div className="mt-atlas-3 grid">
            <Button variant="secondary" aria-expanded={showAddGroup} onClick={() => setShowAddGroup((current) => !current)}>
              {showAddGroup ? "Close add group" : "+ Add Mud Group"}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          {showAddGroup && <AddMudGroupForm factoryId={factoryId} onChanged={onChanged} />}
          {groupsLoading ? (
            <Feedback role="status" tone="neutral">Loading Mud groups...</Feedback>
          ) : groupsError ? (
            <Feedback role="alert" tone="danger">Could not load Mud groups.</Feedback>
          ) : groups.length === 0 ? (
            <EmptyState title="No Mud groups yet" description="Add the first group using the action above." />
          ) : (
            <div className="space-y-atlas-4">
              {groups.map((group) => (
                <MudGroupManagementCard
                  key={group.groupId}
                  factoryId={factoryId}
                  group={group}
                  preview={operationalPreview(group.groupId)}
                  previewLoading={rangeLoading}
                  previewError={rangeError}
                  onChanged={onChanged}
                />
              ))}
            </div>
          )}

          {accountingDiagnostics && <details className="mt-atlas-5 border-t border-atlas-border pt-atlas-3">
            <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-sm font-atlas-medium text-atlas-text-muted">Advanced / Accounting diagnostics</summary>
            <div className="pb-atlas-3">{accountingDiagnostics}</div>
          </details>}
        </div>

        <footer className="flex items-center justify-between gap-atlas-3 border-t border-atlas-border bg-atlas-surface px-atlas-5 py-atlas-4">
          <p className="text-atlas-xs text-atlas-text-subtle">Changes preserve effective-dated Mud history.</p>
          <Button onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  );
}

function AddMudGroupForm({ factoryId, onChanged }: Readonly<{
  factoryId: string;
  onChanged: () => Promise<void>;
}>) {
  const today = getLocalDate();
  const [name, setName] = useState("");
  const [memberCount, setMemberCount] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState(today);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setSaved(false);
    try {
      await createMudGroup({
        factoryId,
        name,
        memberCount: Number(memberCount),
        earningStartDate: startDate,
        initialRate: Number(rate),
        rateEffectiveDate: rateDate,
      });
      setName("");
      setMemberCount("");
      setRate("");
      setStartDate(today);
      setRateDate(today);
      setSaved(true);
      await onChanged();
    } catch (submitError) {
      setError(managementErrorMessage(submitError, "Could not add Mud group."));
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="my-atlas-3"><Card surface="muted">
    <h3 className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text">Add Mud Group</h3>
    <form className="mt-atlas-3 space-y-atlas-3" onSubmit={(event) => void submit(event)}>
      <FormField label="Group name"><Input value={name} onChange={(event) => setName(event.target.value)} required disabled={submitting} autoComplete="off" /></FormField>
      <div className="grid gap-atlas-3 sm:grid-cols-2">
        <FormField label="Members"><Input type="text" inputMode="numeric" value={memberCount} onChange={(event) => setMemberCount(event.target.value)} required disabled={submitting} autoComplete="off" /></FormField>
        <FormField label="Earning starts"><Input type="date" value={startDate} onChange={(event) => { const previous = startDate; setStartDate(event.target.value); if (rateDate === previous) setRateDate(event.target.value); }} required disabled={submitting} /></FormField>
        <FormField label="Initial rate / 1,000"><Input type="text" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} required disabled={submitting} autoComplete="off" /></FormField>
        <FormField label="Rate effective"><Input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required disabled={submitting} /></FormField>
      </div>
      <Button type="submit" loading={submitting} loadingLabel="Adding group...">Add Mud Group</Button>
    </form>
    {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    {saved && <div className="mt-atlas-3"><Feedback role="status" tone="success">Mud group added.</Feedback></div>}
  </Card></div>;
}

type EditingSection = "members" | "rate" | "status" | null;

function MudGroupManagementCard({
  factoryId,
  group,
  preview,
  previewLoading,
  previewError,
  onChanged,
}: Readonly<{
  factoryId: string;
  group: MudGroupConfiguration;
  preview: MudGroupRangeAllocation["groups"][number] | null;
  previewLoading: boolean;
  previewError: boolean;
  onChanged: () => Promise<void>;
}>) {
  const today = getLocalDate();
  const [editingSection, setEditingSection] = useState<EditingSection>(null);
  const [members, setMembers] = useState(String(group.currentMemberCount ?? ""));
  const [memberDate, setMemberDate] = useState(today);
  const [rate, setRate] = useState(String(group.currentRatePer1000Bricks ?? ""));
  const [rateDate, setRateDate] = useState(today);
  const [statusDate, setStatusDate] = useState(today);
  const [restartMembers, setRestartMembers] = useState(String(group.currentMemberCount ?? ""));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [working, setWorking] = useState(false);

  function beginEdit(section: Exclude<EditingSection, null>) {
    setMembers(String(group.currentMemberCount ?? ""));
    setRate(String(group.currentRatePer1000Bricks ?? ""));
    setRestartMembers(String(group.currentMemberCount ?? ""));
    setMemberDate(today);
    setRateDate(today);
    setStatusDate(today);
    setError("");
    setSuccess("");
    setEditingSection(section);
  }

  function cancelEdit() {
    setEditingSection(null);
    setError("");
  }

  async function mutate(action: () => Promise<unknown>, successMessage: string) {
    if (working) return;
    setWorking(true);
    setError("");
    setSuccess("");
    try {
      await action();
      await onChanged();
      setEditingSection(null);
      setSuccess(successMessage);
    } catch (mutationError) {
      setError(managementErrorMessage(mutationError, "Could not update Mud group."));
    } finally {
      setWorking(false);
    }
  }

  const initial = group.name.trim().charAt(0).toLocaleUpperCase("en-IN") || "M";

  return <Card as="article">
    <div className="flex items-center justify-between gap-atlas-3 border-b border-atlas-border pb-atlas-3">
      <div className="flex min-w-0 items-center gap-atlas-3">
        <div aria-hidden="true" className="flex h-atlas-8 w-atlas-8 shrink-0 items-center justify-center rounded-atlas-control bg-atlas-surface-muted text-atlas-sm font-atlas-semibold text-atlas-text">{initial}</div>
        <h3 className="truncate text-atlas-base font-atlas-semibold text-atlas-text">{group.name}</h3>
      </div>
      <StatusPill label={group.isEarning ? "Earning" : "Stopped"} tone={group.isEarning ? "success" : "archive"} />
    </div>

    <p className="mt-atlas-3 text-atlas-xs text-atlas-text-muted">
      {group.currentMemberCount === null ? "Members not set" : `${formatIndianNumber(group.currentMemberCount)} members`}
      {" · Current rate "}
      {group.currentRatePer1000Bricks === null ? "not set" : `${formatIndianCurrency(group.currentRatePer1000Bricks)} / 1,000`}
    </p>

    <div className="mt-atlas-3 divide-y divide-atlas-border text-atlas-sm">
      <div className="flex min-h-atlas-12 items-center justify-between gap-atlas-3 py-atlas-2">
        <div className="grid flex-1 grid-cols-2 items-center gap-atlas-3"><span className="text-atlas-text-muted">Members</span><span className="font-atlas-medium tabular-nums text-atlas-text">{group.currentMemberCount === null ? ATLAS_UI_STRINGS.feedback.unavailable : `${formatIndianNumber(group.currentMemberCount)} members`}</span></div>
        <Button variant="ghost" disabled={!group.isEarning} aria-expanded={editingSection === "members"} onClick={() => beginEdit("members")}>{ATLAS_UI_STRINGS.actions.edit}</Button>
      </div>
      {editingSection === "members" && <InlineEditor title={`Edit members for ${group.name}`}>
        <form className="space-y-atlas-3" onSubmit={(event) => { event.preventDefault(); void mutate(() => editMudGroupMembers({ factoryId, groupId: group.groupId, memberCount: Number(members), effectiveFrom: memberDate }), "Member count saved."); }}>
          <div className="grid gap-atlas-3 sm:grid-cols-2">
            <FormField label="Members"><Input type="text" inputMode="numeric" value={members} onChange={(event) => setMembers(event.target.value)} required disabled={working} autoComplete="off" /></FormField>
            <FormField label="Effective from"><Input type="date" value={memberDate} onChange={(event) => setMemberDate(event.target.value)} required disabled={working} /></FormField>
          </div>
          <EditorActions working={working} loadingLabel="Saving members..." primaryLabel="Save members" onCancel={cancelEdit} />
        </form>
      </InlineEditor>}

      <div className="flex min-h-atlas-12 items-center justify-between gap-atlas-3 py-atlas-2">
        <div className="grid flex-1 grid-cols-2 items-center gap-atlas-3"><span className="text-atlas-text-muted">Current rate</span><span className="font-atlas-medium tabular-nums text-atlas-text">{group.currentRatePer1000Bricks === null ? ATLAS_UI_STRINGS.feedback.unavailable : `${formatIndianCurrency(group.currentRatePer1000Bricks)} / 1,000`}</span></div>
        <Button variant="ghost" aria-expanded={editingSection === "rate"} onClick={() => beginEdit("rate")}>Change</Button>
      </div>
      {editingSection === "rate" && <InlineEditor title={`Revise rate for ${group.name}`} detail="Per 1,000 bricks">
        <form className="space-y-atlas-3" onSubmit={(event) => { event.preventDefault(); void mutate(() => setMudGroupRate({ factoryId, groupId: group.groupId, ratePer1000Bricks: Number(rate), effectiveFrom: rateDate }), "Group rate saved."); }}>
          <div className="grid gap-atlas-3 sm:grid-cols-2">
            <FormField label="New rate"><Input type="text" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} required disabled={working} autoComplete="off" /></FormField>
            <FormField label="Effective from"><Input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required disabled={working} /></FormField>
          </div>
          <EditorActions working={working} loadingLabel="Saving rate..." primaryLabel="Save rate" onCancel={cancelEdit} />
        </form>
      </InlineEditor>}

      <div className="flex min-h-atlas-12 items-center justify-between gap-atlas-3 py-atlas-2">
        <div className="grid flex-1 grid-cols-2 items-center gap-atlas-3"><span className="text-atlas-text-muted">Earning status</span><span className={group.isEarning ? "font-atlas-medium text-atlas-success-text" : "font-atlas-medium text-atlas-text-muted"}>{group.isEarning ? "Active" : "Stopped"}</span></div>
        <Button variant={group.isEarning ? "danger" : "ghost"} aria-expanded={editingSection === "status"} onClick={() => beginEdit("status")}>{group.isEarning ? "Stop" : "Restart"}</Button>
      </div>
      {editingSection === "status" && <InlineEditor title={group.isEarning ? `Stop earning for ${group.name}` : `Restart earning for ${group.name}`}>
        <form className="space-y-atlas-3" onSubmit={(event) => { event.preventDefault(); void mutate(
          () => group.isEarning
            ? stopMudGroupEarning({ factoryId, groupId: group.groupId, stopDate: statusDate })
            : restartMudGroupEarning({ factoryId, groupId: group.groupId, memberCount: Number(restartMembers), restartDate: statusDate }),
          group.isEarning ? "Group earning stopped." : "Group earning restarted.",
        ); }}>
          {!group.isEarning && <FormField label="Members"><Input type="text" inputMode="numeric" value={restartMembers} onChange={(event) => setRestartMembers(event.target.value)} required disabled={working} autoComplete="off" /></FormField>}
          <FormField label={group.isEarning ? "First non-earning date" : "Restart date"}><Input type="date" value={statusDate} onChange={(event) => setStatusDate(event.target.value)} required disabled={working} /></FormField>
          <EditorActions working={working} loadingLabel={group.isEarning ? "Stopping..." : "Restarting..."} primaryLabel={group.isEarning ? "Stop earning" : "Restart earning"} primaryVariant={group.isEarning ? "danger" : "primary"} onCancel={cancelEdit} />
        </form>
      </InlineEditor>}
    </div>

    {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
    {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}

    <details className="mt-atlas-2 border-t border-atlas-border pt-atlas-2">
      <summary className="min-h-atlas-12 cursor-pointer py-atlas-3 text-atlas-xs font-atlas-medium text-atlas-text-muted">Operational preview</summary>
      {previewLoading ? <Feedback role="status" tone="neutral">Loading operational preview...</Feedback>
        : previewError ? <Feedback role="alert" tone="danger">Operational preview is unavailable.</Feedback>
          : <dl className="grid gap-atlas-3 pb-atlas-2 sm:grid-cols-3">
            <PreviewMetric label="Allocated production" value={preview ? formatIndianNumber(preview.allocatedProduction) : "—"} />
            <PreviewMetric label="Allocation value" value={preview ? formatIndianCurrency(preview.earnedAmount) : "—"} />
            <PreviewMetric label="Per-member share" value={preview ? formatIndianCurrency(preview.informationalPerMemberEarned) : "—"} />
          </dl>}
      <p className="pb-atlas-2 text-atlas-xs text-atlas-warning-text">Operational SHADOW context only. These values are not payable balances.</p>
    </details>
  </Card>;
}

function InlineEditor({ title, detail, children }: Readonly<{
  title: string;
  detail?: string;
  children: ReactNode;
}>) {
  return <div className="my-atlas-2 rounded-atlas-control border border-atlas-border bg-atlas-surface-muted p-atlas-3">
    <div className="mb-atlas-3 flex items-start justify-between gap-atlas-3">
      <h4 className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text">{title}</h4>
      {detail && <span className="text-atlas-xs text-atlas-text-subtle">{detail}</span>}
    </div>
    {children}
  </div>;
}

function EditorActions({
  working,
  loadingLabel,
  primaryLabel,
  primaryVariant = "primary",
  onCancel,
}: Readonly<{
  working: boolean;
  loadingLabel: string;
  primaryLabel: string;
  primaryVariant?: "primary" | "danger";
  onCancel: () => void;
}>) {
  return <div className="flex flex-col-reverse gap-atlas-2 sm:flex-row sm:justify-end">
    <Button variant="ghost" onClick={onCancel} disabled={working}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
    <Button type="submit" variant={primaryVariant} loading={working} loadingLabel={loadingLabel}>{primaryLabel}</Button>
  </div>;
}

function PreviewMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt className="text-atlas-xs text-atlas-text-subtle">{label}</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{value}</dd></div>;
}

function managementErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
