"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
import {
  createBrickType,
  deactivateBrickType,
  deleteUnusedBrickType,
  reactivateBrickType,
  renameBrickType,
  type BrickType,
} from "@/features/sales/services/brick-type-service";
import { formatIndianNumber } from "@/lib/formatting";
import {
  BRICK_TYPE_LIFECYCLE_STATUS,
  resolveBooleanStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type BrickTypeAction = "create" | "rename" | "deactivate" | "reactivate" | "delete" | "";
type PendingConfirmation = Readonly<{
  kind: "deactivate" | "delete";
  brickType: BrickType;
}> | null;

export function BrickTypeManagementDrawer({
  factoryId,
  brickTypes,
  isLoading,
  loadError,
  onBrickTypesChanged,
  onBrickTypeUnavailable,
  onClose,
}: Readonly<{
  factoryId: string;
  brickTypes: readonly BrickType[];
  isLoading: boolean;
  loadError: string;
  onBrickTypesChanged: () => Promise<void>;
  onBrickTypeUnavailable: (brickTypeId: string) => void;
  onClose: () => void;
}>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const confirmationRef = useRef<PendingConfirmation>(null);
  const actionRef = useRef<BrickTypeAction>("");
  onCloseRef.current = onClose;

  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);
  const [action, setAction] = useState<BrickTypeAction>("");
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  confirmationRef.current = confirmation;
  actionRef.current = action;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (confirmationRef.current || actionRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || confirmationRef.current) return;

      const drawer = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  function clearFeedback() {
    setError("");
    setSuccess("");
  }

  function requestClose() {
    if (action) return;
    onClose();
  }

  async function refreshBrickTypes() {
    await onBrickTypesChanged();
  }

  async function addBrickType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action) return;
    setAction("create");
    setActionId("");
    clearFeedback();
    try {
      await createBrickType({ factoryId, name });
      await refreshBrickTypes();
      setName("");
      setSuccess("Brick type added.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add the Brick Type.");
    } finally {
      setAction("");
    }
  }

  function startEdit(brickType: BrickType) {
    setEditingId(brickType.id);
    setEditName(brickType.name);
    setConfirmation(null);
    clearFeedback();
  }

  function cancelEdit() {
    setEditingId("");
    setEditName("");
    clearFeedback();
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action || !editingId) return;
    setAction("rename");
    setActionId(editingId);
    clearFeedback();
    try {
      await renameBrickType({ factoryId, brickTypeId: editingId, name: editName });
      await refreshBrickTypes();
      setEditingId("");
      setEditName("");
      setSuccess("Brick type renamed.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not rename the Brick Type.");
    } finally {
      setAction("");
      setActionId("");
    }
  }

  async function reactivate(brickType: BrickType) {
    if (action) return;
    setAction("reactivate");
    setActionId(brickType.id);
    clearFeedback();
    try {
      await reactivateBrickType({ factoryId, brickTypeId: brickType.id });
      await refreshBrickTypes();
      setSuccess("Brick type reactivated.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reactivate the Brick Type.");
    } finally {
      setAction("");
      setActionId("");
    }
  }

  async function confirmLifecycleAction() {
    if (!confirmation || action) return;
    const { brickType, kind } = confirmation;
    setAction(kind);
    setActionId(brickType.id);
    clearFeedback();
    try {
      if (kind === "deactivate") {
        await deactivateBrickType({ factoryId, brickTypeId: brickType.id });
      } else {
        await deleteUnusedBrickType({ factoryId, brickTypeId: brickType.id });
      }
      onBrickTypeUnavailable(brickType.id);
      await refreshBrickTypes();
      setConfirmation(null);
      setEditingId("");
      setEditName("");
      setSuccess(kind === "deactivate" ? "Brick type deactivated." : "Brick type deleted permanently.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Could not ${kind} the Brick Type.`);
    } finally {
      setAction("");
      setActionId("");
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal management drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Brick Types" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={requestClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="brick-types-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-start justify-between gap-atlas-3 border-b border-atlas-border px-atlas-5 py-atlas-4">
          <div>
            <h2 id="brick-types-drawer-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">Brick Types</h2>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Manage finished Brick Types available for Sales / Challans.</p>
          </div>
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close Brick Types drawer" disabled={Boolean(action)} onClick={requestClose}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          <Card surface="muted" as="section" aria-labelledby="add-brick-type-heading">
            <h3 id="add-brick-type-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Add Brick Type</h3>
            <form className="mt-atlas-3" onSubmit={(event) => void addBrickType(event)}>
              <FormField label="Brick type name">
                <Input
                  value={name}
                  onChange={(event) => { setName(event.target.value); clearFeedback(); }}
                  placeholder="e.g. 1st Class Modular"
                  autoComplete="off"
                  disabled={Boolean(action) || isLoading || Boolean(loadError)}
                  aria-invalid={Boolean(error)}
                />
              </FormField>
              <div className="mt-atlas-3 flex justify-end">
                <Button type="submit" loading={action === "create"} loadingLabel="Adding..." disabled={isLoading || Boolean(loadError)}>Add brick type</Button>
              </div>
            </form>
          </Card>

          {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
          {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}

          <section aria-labelledby="existing-brick-types-heading" className="mt-atlas-5">
            <div className="flex items-center justify-between gap-atlas-3 border-b border-atlas-border pb-atlas-2">
              <h3 id="existing-brick-types-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Existing Brick Types</h3>
              <p className="text-atlas-xs text-atlas-text-subtle">{formatIndianNumber(brickTypes.length)} total</p>
            </div>

            {isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading Brick Types...</Feedback></div>}
            {loadError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">
              <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Could not load Brick Types: {loadError}</span>
                <Button variant="secondary" disabled={Boolean(action)} onClick={() => void refreshBrickTypes()}>{ATLAS_UI_STRINGS.actions.retry}</Button>
              </div>
            </Feedback></div>}
            {!isLoading && !loadError && brickTypes.length === 0 && (
              <EmptyState title="No Brick Types yet" description="Add the first finished Brick Type above." />
            )}

            {!isLoading && !loadError && brickTypes.length > 0 && (
              <ul className="divide-y divide-atlas-border border-b border-atlas-border">
                {brickTypes.map((brickType) => {
                  const status = resolveBooleanStatusPresentation(BRICK_TYPE_LIFECYCLE_STATUS, brickType.isActive);
                  const isEditing = editingId === brickType.id;
                  const isWorking = Boolean(action) && actionId === brickType.id;
                  return (
                    <li key={brickType.id} className="py-atlas-3">
                      {isEditing ? (
                        <Card surface="muted">
                          <form onSubmit={(event) => void rename(event)}>
                            <FormField label="Brick type name">
                              <Input
                                autoFocus
                                value={editName}
                                onChange={(event) => { setEditName(event.target.value); clearFeedback(); }}
                                disabled={Boolean(action)}
                                aria-invalid={Boolean(error)}
                              />
                            </FormField>
                            <div className="mt-atlas-3 flex flex-wrap justify-end gap-atlas-2">
                              <Button variant="ghost" disabled={Boolean(action)} onClick={cancelEdit}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                              <Button type="submit" loading={action === "rename" && isWorking} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save name</Button>
                            </div>
                          </form>
                        </Card>
                      ) : (
                        <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-atlas-2">
                            <span className="truncate text-atlas-base font-atlas-medium text-atlas-text">{brickType.name}</span>
                            <StatusPill label={status.label} tone={status.tone} />
                          </div>
                          <div className="flex flex-wrap items-center gap-atlas-1">
                            <Button variant="ghost" disabled={Boolean(action)} onClick={() => startEdit(brickType)}>{ATLAS_UI_STRINGS.actions.edit}</Button>
                            {brickType.isActive ? (
                              <Button variant="ghost" disabled={Boolean(action)} onClick={() => { clearFeedback(); setConfirmation({ kind: "deactivate", brickType }); }}>Deactivate</Button>
                            ) : (
                              <Button variant="ghost" loading={action === "reactivate" && isWorking} loadingLabel="Reactivating..." disabled={Boolean(action) && !isWorking} onClick={() => void reactivate(brickType)}>Reactivate</Button>
                            )}
                            {!brickType.everUsed && (
                              <Button variant="danger" disabled={Boolean(action)} onClick={() => { clearFeedback(); setConfirmation({ kind: "delete", brickType }); }}>{ATLAS_UI_STRINGS.actions.delete}</Button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="border-t border-atlas-border bg-atlas-surface-muted px-atlas-5 py-atlas-4 shadow-atlas-medium">
          <p className="text-atlas-xs text-atlas-text-subtle">Changes apply immediately to new Challan Brick Type choices.</p>
          <div className="mt-atlas-3 flex flex-col">
            <Button variant="secondary" disabled={Boolean(action)} onClick={requestClose}>{ATLAS_UI_STRINGS.actions.close}</Button>
          </div>
        </footer>
      </aside>

      {confirmation && (
        <BrickTypeConfirmation
          kind={confirmation.kind}
          submitting={action === confirmation.kind}
          error={error}
          onCancel={() => { if (!action) { setConfirmation(null); clearFeedback(); } }}
          onConfirm={() => void confirmLifecycleAction()}
        />
      )}
    </div>
  );
}

function BrickTypeConfirmation({
  kind,
  submitting,
  error,
  onCancel,
  onConfirm,
}: Readonly<{
  kind: "deactivate" | "delete";
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  const submittingRef = useRef(submitting);
  cancelRef.current = onCancel;
  submittingRef.current = submitting;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    confirmButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submittingRef.current) {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = confirmButtonRef.current?.closest('[role="dialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
      previouslyFocused?.focus();
    };
  }, []);

  const deleting = kind === "delete";
  const title = deleting ? "Delete brick type permanently?" : "Deactivate brick type?";
  const message = deleting
    ? "This brick type has never been used in a saved Challan. Deleting it cannot be undone."
    : "This brick type will no longer be available for new Challans. Existing Challans that already use it will remain unchanged.";
  const confirmLabel = deleting ? "Delete permanently" : "Deactivate brick type";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-atlas-4">
      {/* ui-exception: A centered confirmation requires a full-screen dismissal target above the open drawer. */}
      <button type="button" aria-label="Cancel Brick Type action" disabled={submitting} className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onCancel} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="brick-type-confirmation-title"
        aria-describedby="brick-type-confirmation-description"
        className="relative w-full max-w-md rounded-atlas-dialog border border-atlas-border-strong bg-atlas-surface p-atlas-5 shadow-atlas-high"
      >
        <div className="flex items-start justify-between gap-atlas-3">
          <div className="min-w-0">
            <h2 id="brick-type-confirmation-title" className="text-atlas-lg font-atlas-semibold text-atlas-text">{title}</h2>
            <p id="brick-type-confirmation-description" className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">{message}</p>
          </div>
          <Button variant="ghost" aria-label="Close confirmation" disabled={submitting} onClick={onCancel}><span aria-hidden="true">×</span></Button>
        </div>
        {error && <div className="mt-atlas-4"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
        <div className="mt-atlas-5 flex flex-col gap-atlas-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={submitting} onClick={onCancel}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
          <Button ref={confirmButtonRef} variant="danger" loading={submitting} loadingLabel={deleting ? "Deleting..." : "Deactivating..."} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
