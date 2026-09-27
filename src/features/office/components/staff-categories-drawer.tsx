"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import {
  buildStaffCategoryCreateInput,
  buildStaffCategoryUpdateInput,
  staffOfficeErrorMessage,
} from "@/features/office/staff-office-model";
import { staffCategoriesQueryKey } from "@/features/office/staff-office-query-keys";
import {
  createStaffCategory,
  deleteStaffCategory,
  updateStaffCategory,
} from "@/features/staff/services/staff-worker-service";
import type { StaffCategory, StaffWorker } from "@/features/staff/types";
import { formatIndianNumber } from "@/lib/formatting";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type CategoryAction = "create" | "rename" | "delete" | "";

function sortCategories(categories: StaffCategory[]): StaffCategory[] {
  return [...categories].sort((left, right) => (
    left.name.localeCompare(right.name, "en-IN") || left.id.localeCompare(right.id)
  ));
}

export function StaffCategoriesDrawer({
  factoryId,
  categories,
  workers,
  isLoading,
  loadError,
  workersLoading,
  workersError,
  onClose,
}: Readonly<{
  factoryId: string;
  categories: readonly StaffCategory[];
  workers: readonly StaffWorker[];
  isLoading: boolean;
  loadError: Error | null;
  workersLoading: boolean;
  workersError: Error | null;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [name, setName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState("");
  const [categoryAction, setCategoryAction] = useState<CategoryAction>("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  function assignedStaffCount(categoryId: string): number {
    return workers.filter((worker) => worker.staffCategoryId === categoryId).length;
  }

  async function refreshCategories() {
    await queryClient.invalidateQueries({ queryKey: staffCategoriesQueryKey(factoryId) });
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categoryAction) return;
    const input = buildStaffCategoryCreateInput(factoryId, name);
    if (!input) {
      setError("Category name is required.");
      return;
    }

    setCategoryAction("create");
    clearFeedback();
    try {
      const createdCategory = await createStaffCategory(input);
      queryClient.setQueryData<StaffCategory[]>(
        staffCategoriesQueryKey(factoryId),
        (current = []) => sortCategories([
          ...current.filter((category) => category.id !== createdCategory.id),
          createdCategory,
        ]),
      );
      setName("");
      setSuccess("Staff category added.");
      await refreshCategories();
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not add the Staff category."));
    } finally {
      setCategoryAction("");
    }
  }

  function startEdit(category: StaffCategory) {
    setEditingCategoryId(category.id);
    setEditName(category.name);
    setConfirmingDeleteId("");
    clearFeedback();
  }

  function cancelEdit() {
    setEditingCategoryId("");
    setEditName("");
    setConfirmingDeleteId("");
    clearFeedback();
  }

  async function renameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categoryAction) return;
    const input = buildStaffCategoryUpdateInput(factoryId, editingCategoryId, editName);
    if (!input) {
      setError("Category name is required.");
      return;
    }

    setCategoryAction("rename");
    clearFeedback();
    try {
      const updatedCategory = await updateStaffCategory(input);
      queryClient.setQueryData<StaffCategory[]>(
        staffCategoriesQueryKey(factoryId),
        (current = []) => sortCategories(current.map((category) => (
          category.id === updatedCategory.id ? updatedCategory : category
        ))),
      );
      setEditingCategoryId("");
      setEditName("");
      setSuccess("Staff category renamed.");
      await refreshCategories();
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not rename the Staff category."));
    } finally {
      setCategoryAction("");
    }
  }

  async function removeCategory(category: StaffCategory) {
    if (
      categoryAction || workersLoading || workersError
      || assignedStaffCount(category.id) > 0
    ) return;
    setCategoryAction("delete");
    clearFeedback();
    try {
      await deleteStaffCategory({ factoryId, staffCategoryId: category.id });
      queryClient.setQueryData<StaffCategory[]>(
        staffCategoriesQueryKey(factoryId),
        (current = []) => current.filter((item) => item.id !== category.id),
      );
      setEditingCategoryId("");
      setEditName("");
      setConfirmingDeleteId("");
      setSuccess("Staff category deleted.");
      await refreshCategories();
    } catch (failure) {
      setError(staffOfficeErrorMessage(failure, "Could not delete the Staff category."));
      setConfirmingDeleteId("");
    } finally {
      setCategoryAction("");
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* ui-exception: A modal category drawer requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Close Staff categories" className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-categories-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-atlas-border-strong bg-atlas-surface shadow-atlas-high sm:max-w-md"
      >
        <header className="flex items-start justify-between gap-atlas-3 border-b border-atlas-border px-atlas-5 py-atlas-4">
          <div>
            <h2 id="staff-categories-title" className="text-atlas-xl font-atlas-semibold text-atlas-text">Staff categories</h2>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Categories organize Staff members by role.</p>
          </div>
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close Staff categories drawer" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-atlas-5 py-atlas-5">
          <Card surface="muted">
            <form onSubmit={(event) => void createCategory(event)}>
              <FormField label="Category name">
                <Input
                  value={name}
                  onChange={(event) => { setName(event.target.value); clearFeedback(); }}
                  placeholder="e.g. Field Supervisor or Maintenance"
                  autoComplete="off"
                  disabled={Boolean(categoryAction) || isLoading || Boolean(loadError)}
                  aria-invalid={Boolean(error)}
                />
              </FormField>
              <div className="mt-atlas-3 flex justify-end gap-atlas-2">
                <Button variant="ghost" disabled={Boolean(categoryAction) || !name} onClick={() => { setName(""); clearFeedback(); }}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                <Button type="submit" loading={categoryAction === "create"} loadingLabel="Adding..." disabled={isLoading || Boolean(loadError)}>Add category</Button>
              </div>
            </form>
          </Card>

          {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
          {success && <div className="mt-atlas-3"><Feedback role="status" tone="success">{success}</Feedback></div>}

          <section aria-labelledby="existing-staff-categories-heading" className="mt-atlas-5">
            <div className="flex items-center justify-between gap-atlas-3 border-b border-atlas-border pb-atlas-2">
              <h3 id="existing-staff-categories-heading" className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Existing categories</h3>
              <p className="text-atlas-xs text-atlas-text-subtle">{formatIndianNumber(categories.length)} total</p>
            </div>

            {isLoading && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">Loading Staff categories...</Feedback></div>}
            {loadError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{staffOfficeErrorMessage(loadError, "Could not load Staff categories.")}</Feedback></div>}
            {!isLoading && !loadError && categories.length === 0 && (
              <EmptyState title="No Staff categories yet" description="Add the first category above before creating Staff members." />
            )}

            {!isLoading && !loadError && categories.length > 0 && (
              <ul className="divide-y divide-atlas-border border-b border-atlas-border">
                {categories.map((category) => {
                  const staffCount = assignedStaffCount(category.id);
                  const assignmentCountUnavailable = workersLoading || Boolean(workersError);
                  const isEditing = editingCategoryId === category.id;
                  const isConfirmingDelete = confirmingDeleteId === category.id;
                  return (
                    <li key={category.id} className="py-atlas-3">
                      {!isEditing ? (
                        <div className="flex min-h-atlas-12 items-center justify-between gap-atlas-3">
                          <div className="flex min-w-0 items-center gap-atlas-2">
                            <span className="truncate text-atlas-base font-atlas-medium text-atlas-text">{category.name}</span>
                            {/* ui-exception: This pill is a numeric Staff-assignment count, not an entity status. */}
                            <span className="shrink-0 rounded-atlas-pill border border-atlas-border bg-atlas-surface-muted px-atlas-2 py-atlas-1 text-atlas-xs text-atlas-text-muted">
                              {workersLoading
                                ? ATLAS_UI_STRINGS.feedback.loading
                                : workersError
                                  ? ATLAS_UI_STRINGS.feedback.unavailable
                                  : `${formatIndianNumber(staffCount)} ${staffCount === 1 ? "Staff member" : "Staff members"}`}
                            </span>
                          </div>
                          <Button variant="ghost" disabled={Boolean(categoryAction)} onClick={() => startEdit(category)}>{ATLAS_UI_STRINGS.actions.edit}</Button>
                        </div>
                      ) : (
                        <Card surface="muted">
                          <form onSubmit={(event) => void renameCategory(event)}>
                            <FormField label="Category name">
                              <Input
                                autoFocus
                                value={editName}
                                onChange={(event) => { setEditName(event.target.value); clearFeedback(); }}
                                disabled={Boolean(categoryAction)}
                                aria-invalid={Boolean(error)}
                              />
                            </FormField>
                            <div className="mt-atlas-3 flex flex-wrap justify-end gap-atlas-2">
                              <Button variant="ghost" disabled={Boolean(categoryAction)} onClick={cancelEdit}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                              <Button type="submit" loading={categoryAction === "rename"} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save name</Button>
                            </div>
                          </form>

                          <div className="mt-atlas-4 border-t border-atlas-border pt-atlas-4">
                            {assignmentCountUnavailable ? (
                              <p className="text-atlas-xs text-atlas-text-subtle">Staff assignments are unavailable, so deletion is disabled.</p>
                            ) : staffCount > 0 ? (
                              <p className="text-atlas-xs text-atlas-text-subtle">
                                Assigned to {formatIndianNumber(staffCount)} {staffCount === 1 ? "Staff member" : "Staff members"}. This category cannot be deleted.
                              </p>
                            ) : isConfirmingDelete ? (
                              <Feedback role="alert" tone="danger">
                                <p className="font-atlas-semibold">Delete {category.name}?</p>
                                <p className="mt-atlas-1">This unused category will be removed permanently.</p>
                                <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
                                  <Button variant="danger" loading={categoryAction === "delete"} loadingLabel="Deleting..." onClick={() => void removeCategory(category)}>Confirm delete</Button>
                                  <Button variant="secondary" disabled={Boolean(categoryAction)} onClick={() => setConfirmingDeleteId("")}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
                                </div>
                              </Feedback>
                            ) : (
                              <div className="flex items-center justify-between gap-atlas-3">
                                <p className="text-atlas-xs text-atlas-text-subtle">Unused categories can be permanently deleted.</p>
                                <Button variant="danger" disabled={Boolean(categoryAction)} onClick={() => { clearFeedback(); setConfirmingDeleteId(category.id); }}>Delete category</Button>
                              </div>
                            )}
                          </div>
                        </Card>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="border-t border-atlas-border bg-atlas-surface-muted px-atlas-5 py-atlas-4 shadow-atlas-medium">
          <p className="text-atlas-xs text-atlas-text-subtle">Staff categories organize Staff only and do not determine salary, payments, attendance, or accounting rules.</p>
          <div className="mt-atlas-3 flex flex-col">
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
