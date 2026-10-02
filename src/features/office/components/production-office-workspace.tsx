"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Checkbox, Input, Select } from "@/components/ui/form-controls";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import {
  getOfficeProductionHash,
  OFFICE_PRODUCTION_AREAS,
  resolveOfficeProductionAreaFromHash,
  type OfficeProductionAreaId,
} from "@/features/office/office-navigation";
import { getTodaysProduction, type TodayProductionRow } from "@/features/office/services/todays-production-service";
import {
  buildProductionSavePayload,
  type ActiveProductionLabourer,
} from "@/features/production/production-entry-model";
import { productionRecordSchema } from "@/features/production/schemas/production-record-schema";
import {
  productionSaveErrorMessage,
  saveProductionEntryWithSessionRefresh,
} from "@/features/production/services/production-entry-service";
import { getBrickProductionEditability } from "@/features/production/services/brick-production-editability-service";
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
import type { SoilDailyTrolleyEntry } from "@/features/soil/types";
import { saveTransportDailyEntry } from "@/features/transport/services/transport-daily-entry-service";
import { listTransportDailyOperations } from "@/features/transport/services/transport-daily-operations-service";
import {
  buildTransportDailyEntrySaveInput,
  loadActiveTransportGroups,
  loadTransportDailyEntrySelection,
  parseTransportPayaInput,
  selectAllTransportWorkers,
  toggleTransportWorkerSelection,
  transportDailyEntryErrorMessage,
} from "@/features/transport/transport-daily-entry-screen-model";
import type {
  TransportDailyEntryWorkerChoice,
  TransportDailyOperationsEntry,
} from "@/features/transport/types";
import { formatDateOnly, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type ProductionLabourer = ActiveProductionLabourer & {
  isActive: boolean;
};

export function ProductionOfficeWorkspace({
  factoryId,
  labourers,
  isLoadingLabourers,
  labourersError,
}: Readonly<{
  factoryId: string;
  labourers: readonly ProductionLabourer[];
  isLoadingLabourers: boolean;
  labourersError: string;
}>) {
  const [activeArea, setActiveArea] = useState<OfficeProductionAreaId>("brick");
  const [brickDate, setBrickDate] = useState(() => getLocalDate());
  const [chamberDate, setChamberDate] = useState(() => getLocalDate());
  const [soilDate, setSoilDate] = useState(() => getLocalDate());

  const brickQuery = useQuery({
    queryKey: ["office-production", factoryId, brickDate],
    queryFn: () => getTodaysProduction(factoryId, brickDate),
    enabled: activeArea === "brick",
    refetchInterval: 30_000,
  });
  const chamberQuery = useQuery({
    queryKey: ["office-transport-daily-operations", factoryId, chamberDate],
    queryFn: () => listTransportDailyOperations({ factoryId, workDate: chamberDate }),
    enabled: activeArea === "chamber",
    refetchInterval: 30_000,
  });
  const soilQuery = useQuery({
    queryKey: ["office-soil-daily-operations", factoryId, soilDate],
    queryFn: () => listSoilDailyTrolleyEntries({ factoryId, workDate: soilDate }),
    enabled: activeArea === "soil",
    refetchInterval: 30_000,
  });

  useEffect(() => {
    function syncProductionAreaFromHash() {
      const area = resolveOfficeProductionAreaFromHash(window.location.hash);
      if (area) setActiveArea(area);
    }

    syncProductionAreaFromHash();
    window.addEventListener("hashchange", syncProductionAreaFromHash);
    return () => window.removeEventListener("hashchange", syncProductionAreaFromHash);
  }, []);

  function selectProductionArea(area: OfficeProductionAreaId) {
    setActiveArea(area);
    window.location.hash = getOfficeProductionHash(area);
  }

  return (
    <div className="space-y-atlas-3">
      <nav aria-label="Production areas" className="overflow-x-auto pb-atlas-1">
        <div className="flex min-w-max gap-atlas-2">
          {OFFICE_PRODUCTION_AREAS.map((area) => (
            <Button
              key={area.id}
              variant={activeArea === area.id ? "primary" : "ghost"}
              aria-pressed={activeArea === area.id}
              onClick={() => selectProductionArea(area.id)}
            >
              {area.label}
            </Button>
          ))}
        </div>
      </nav>

      <div className="max-w-5xl">
        {activeArea === "brick" && (
          <BrickProductionWorkspace
            factoryId={factoryId}
            labourers={labourers}
            isLoadingLabourers={isLoadingLabourers}
            labourersError={labourersError}
            selectedDate={brickDate}
            onSelectedDateChange={setBrickDate}
            query={brickQuery}
          />
        )}
        {activeArea === "chamber" && (
          <ChamberTransportWorkspace
            factoryId={factoryId}
            selectedDate={chamberDate}
            onSelectedDateChange={setChamberDate}
            query={chamberQuery}
          />
        )}
        {activeArea === "soil" && (
          <SoilTrolleyWorkspace
            factoryId={factoryId}
            selectedDate={soilDate}
            onSelectedDateChange={setSoilDate}
            query={soilQuery}
          />
        )}
      </div>
    </div>
  );
}

type QueryState<T> = Readonly<{
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}>;

function BrickProductionWorkspace({
  factoryId,
  labourers,
  isLoadingLabourers,
  labourersError,
  selectedDate,
  onSelectedDateChange,
  query,
}: Readonly<{
  factoryId: string;
  labourers: readonly ProductionLabourer[];
  isLoadingLabourers: boolean;
  labourersError: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  query: QueryState<TodayProductionRow[]>;
}>) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger" | "warning";
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const dirtyLabourerIdsRef = useRef(new Set<string>());
  const loadedDateRef = useRef(selectedDate);
  const activeLabourers = useMemo(
    () => labourers.filter((labourer) => labourer.isActive),
    [labourers],
  );
  const activeLabourerIds = useMemo(
    () => activeLabourers.map((labourer) => labourer.id),
    [activeLabourers],
  );
  const editabilityQuery = useQuery({
    queryKey: ["brick-production-editability", factoryId, selectedDate, activeLabourerIds],
    queryFn: () => getBrickProductionEditability({
      factoryId,
      labourerIds: activeLabourerIds,
      businessDate: selectedDate,
    }),
    enabled: !isLoadingLabourers && !labourersError && activeLabourerIds.length > 0,
    refetchInterval: 30_000,
  });
  const entries = query.data ?? [];
  const totalProduction = entries.reduce((total, entry) => total + entry.quantity, 0);
  const savedEntriesByLabourer = new Map(entries.map((entry) => [entry.labourerId, entry]));
  const savedEntriesHeading = selectedDate === getLocalDate()
    ? "Today’s saved entries"
    : "Saved entries";
  const allLabourersLocked = Boolean(editabilityQuery.data)
    && activeLabourers.every((labourer) => editabilityQuery.data?.labourers[labourer.id]?.isLocked);

  useEffect(() => {
    const dateChanged = loadedDateRef.current !== selectedDate;
    if (dateChanged) {
      loadedDateRef.current = selectedDate;
      dirtyLabourerIdsRef.current.clear();
      setValidationErrors({});
      setFeedback(null);
    }

    const savedQuantityByLabourer = new Map(
      (query.data ?? []).map((entry) => [entry.labourerId, String(entry.quantity)]),
    );
    setQuantities((current) => Object.fromEntries(activeLabourers.map((labourer) => [
      labourer.id,
      !dateChanged && dirtyLabourerIdsRef.current.has(labourer.id)
        ? current[labourer.id] ?? ""
        : savedQuantityByLabourer.get(labourer.id) ?? "",
    ])));
  }, [activeLabourers, query.data, selectedDate]);

  function updateQuantity(labourerId: string, value: string) {
    if (editabilityQuery.data?.labourers[labourerId]?.isLocked !== false) return;
    if (!/^\d*$/.test(value)) return;
    dirtyLabourerIdsRef.current.add(labourerId);
    setQuantities((current) => ({ ...current, [labourerId]: value }));
    setValidationErrors((current) => {
      if (!(labourerId in current)) return current;
      const next = { ...current };
      delete next[labourerId];
      return next;
    });
    setFeedback(null);
  }

  async function saveProductionEntries(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingRef.current) return;
    if (!editabilityQuery.data) {
      setFeedback({ tone: "danger", message: "Production editability could not be confirmed. Refresh and try again." });
      return;
    }

    const errors: Record<string, string> = {};
    const entriesToSave: Array<{
      labourer: ProductionLabourer;
      quantity: number;
    }> = [];
    for (const labourer of activeLabourers) {
      if (editabilityQuery.data.labourers[labourer.id]?.isLocked !== false) continue;
      if (!dirtyLabourerIdsRef.current.has(labourer.id)) continue;
      const rawQuantity = quantities[labourer.id]?.trim() ?? "";
      if (!rawQuantity) continue;
      const parsed = productionRecordSchema.safeParse({
        productionDate: selectedDate,
        labourId: labourer.id,
        labourName: labourer.name,
        quantity: Number(rawQuantity),
      });
      if (!parsed.success) {
        errors[labourer.id] = "Enter a whole number greater than zero.";
        continue;
      }
      entriesToSave.push({ labourer, quantity: parsed.data.quantity });
    }

    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFeedback({ tone: "danger", message: "Correct the highlighted quantities before saving." });
      return;
    }
    if (entriesToSave.length === 0) {
      setFeedback({ tone: "warning", message: "Enter or change at least one production quantity." });
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setFeedback(null);
    let savedCount = 0;
    try {
      for (const entry of entriesToSave) {
        const savedEntry = savedEntriesByLabourer.get(entry.labourer.id);
        const result = await saveProductionEntryWithSessionRefresh(buildProductionSavePayload({
          factoryId,
          labourer: entry.labourer,
          productionDate: selectedDate,
          quantity: entry.quantity,
          savedEntry: savedEntry ? { id: savedEntry.id } : undefined,
          newEntryId: crypto.randomUUID(),
        }));
        if (result.status === "session_invalid") {
          await query.refetch();
          setFeedback({
            tone: "danger",
            message: savedCount > 0
              ? `${savedCount} ${savedCount === 1 ? "entry was" : "entries were"} saved before the session expired. Sign in again before saving Production.`
              : "Session expired. Sign in again before saving Production.",
          });
          return;
        }
        savedCount += 1;
        dirtyLabourerIdsRef.current.delete(entry.labourer.id);
      }

      await query.refetch();
      setFeedback({
        tone: "success",
        message: `${savedCount} ${savedCount === 1 ? "entry" : "entries"} saved.`,
      });
    } catch (error) {
      await Promise.all([query.refetch(), editabilityQuery.refetch()]);
      setFeedback({
        tone: "danger",
        message: savedCount > 0
          ? `${savedCount} ${savedCount === 1 ? "entry was" : "entries were"} saved before the save stopped. ${productionSaveErrorMessage(error)}`
          : productionSaveErrorMessage(error),
      });
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <section aria-label="Brick Production" className="max-w-3xl space-y-atlas-3">
      <div className="flex justify-end">
        <div className="w-full sm:w-48">
          <FormField label="Business date">
            <Input
              type="date"
              value={selectedDate}
              disabled={isSaving}
              onChange={(event) => onSelectedDateChange(event.target.value)}
            />
          </FormField>
        </div>
      </div>

      <form onSubmit={saveProductionEntries} className="space-y-atlas-3">
        <Card as="section" aria-labelledby="record-production-heading">
          <div className="mb-atlas-4">
            <h3 id="record-production-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Record production</h3>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Enter the number of raw bricks made by each labourer. Blank rows will be skipped.</p>
            {editabilityQuery.data?.isMudLocked && editabilityQuery.data.mudSettlementCutoff && (
              <p role="status" className="mt-atlas-2 text-atlas-xs font-atlas-medium text-atlas-text-muted">
                Production through {formatDateOnly(editabilityQuery.data.mudSettlementCutoff)} has already been settled. Quantities for this date are read-only.
              </p>
            )}
            {editabilityQuery.error && (
              <p role="alert" className="mt-atlas-2 text-atlas-xs font-atlas-medium text-atlas-danger-text">
                Settlement locks could not be confirmed. Production entries are read-only until this is refreshed.
              </p>
            )}
          </div>

          {(isLoadingLabourers || query.isLoading || editabilityQuery.isLoading) && (
            <Feedback role="status" aria-busy="true" tone="neutral">Loading Production labourers, saved entries and settlement status...</Feedback>
          )}
          {labourersError && <Feedback role="alert" tone="danger">Could not load Production labourers: {labourersError}</Feedback>}
          {query.error && <Feedback role="alert" tone="danger">Could not load saved Production entries.</Feedback>}
          {!isLoadingLabourers && !labourersError && !query.isLoading && !query.error && activeLabourers.length === 0 && (
            <EmptyState title="No active Production labourers" description="Add or restore a Production labourer in Workforce before recording production." />
          )}
          {!isLoadingLabourers && !labourersError && !query.isLoading && !query.error && activeLabourers.length > 0 && (
            <TableContainer>
              <Table>
                <TableCaption visuallyHidden>Production quantity entry for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Labourer name</TableHeaderCell>
                    <TableHeaderCell numeric>Raw quantity</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeLabourers.map((labourer) => {
                    const error = validationErrors[labourer.id];
                    const editability = editabilityQuery.data?.labourers[labourer.id];
                    const lockDescriptionId = editability?.isLocked
                      ? `brick-production-${labourer.id}-lock`
                      : undefined;
                    return (
                      <TableRow key={labourer.id}>
                        <TableCell><span className="font-atlas-medium text-atlas-text">{labourer.name}</span></TableCell>
                        <TableCell numeric>
                          <div className="ml-auto w-40">
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              enterKeyHint="next"
                              aria-label={`Raw brick quantity for ${labourer.name}`}
                              aria-invalid={Boolean(error)}
                              aria-describedby={error ? `brick-production-${labourer.id}-error` : lockDescriptionId}
                              placeholder="0"
                              value={quantities[labourer.id] ?? ""}
                              disabled={isSaving || editabilityQuery.isLoading || Boolean(editabilityQuery.error) || editability?.isLocked !== false}
                              onChange={(event) => updateQuantity(labourer.id, event.target.value)}
                            />
                            {error && <p id={`brick-production-${labourer.id}-error`} className="mt-atlas-1 text-atlas-xs text-atlas-danger-text">{error}</p>}
                            {editability?.isLocked && editability.settledThrough && (
                              <p id={lockDescriptionId} className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
                                Settled through {formatDateOnly(editability.settledThrough)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <div className="mt-atlas-4 flex justify-end border-t border-atlas-border pt-atlas-4">
            {allLabourersLocked || editabilityQuery.error ? (
              <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">Production for this business date is read-only.</p>
            ) : (
              <Button
                type="submit"
                loading={isSaving}
                loadingLabel="Saving production entries..."
                disabled={isLoadingLabourers || Boolean(labourersError) || query.isLoading || Boolean(query.error) || editabilityQuery.isLoading || !editabilityQuery.data || activeLabourers.length === 0}
              >
                Save production entries
              </Button>
            )}
          </div>
        </Card>

        {feedback && <Feedback role={feedback.tone === "danger" ? "alert" : "status"} tone={feedback.tone}>{feedback.message}</Feedback>}
      </form>

      <Card as="section" aria-label="Daily Production summary" surface="muted">
        <dl className="grid grid-cols-2 gap-atlas-4">
          <div>
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Total Production</dt>
            <dd className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(totalProduction)}</dd>
          </div>
          <div>
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Labourers Recorded</dt>
            <dd className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(entries.length)}</dd>
          </div>
        </dl>
      </Card>

      <section aria-labelledby="saved-production-heading" className="space-y-atlas-3">
        <div>
          <h3 id="saved-production-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{savedEntriesHeading}</h3>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Saved raw quantities for {formatDateOnly(selectedDate)}.</p>
        </div>
        <QueryBoundary
          isLoading={query.isLoading}
          error={query.error}
          loadingLabel="Loading Brick Production entries..."
          onRetry={query.refetch}
        >
          {entries.length === 0 ? (
            <EmptyHistory title="No Brick Production recorded" selectedDate={selectedDate} />
          ) : (
            <TableContainer>
              <Table>
                <TableCaption visuallyHidden>Saved Brick Production entries for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow><TableHeaderCell>Labourer</TableHeaderCell><TableHeaderCell numeric>Raw quantity</TableHeaderCell></TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.labourerName}</TableCell>
                      <TableCell numeric>{formatIndianNumber(entry.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </QueryBoundary>
      </section>
    </section>
  );
}

function ChamberTransportWorkspace({
  factoryId,
  selectedDate,
  onSelectedDateChange,
  query,
}: Readonly<{
  factoryId: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  query: QueryState<TransportDailyOperationsEntry[]>;
}>) {
  const saveInProgressRef = useRef(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [members, setMembers] = useState<TransportDailyEntryWorkerChoice[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(() => new Set());
  const [payaInput, setPayaInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger" | "warning";
    message: string;
  } | null>(null);
  const groupsQuery = useQuery({
    queryKey: ["office-transport-groups", factoryId],
    queryFn: () => loadActiveTransportGroups(factoryId),
  });
  const selectionQuery = useQuery({
    queryKey: ["office-transport-entry-selection", factoryId, selectedGroupId, selectedDate],
    queryFn: () => loadTransportDailyEntrySelection({
      factoryId,
      transportGroupId: selectedGroupId,
      workDate: selectedDate,
    }),
    enabled: Boolean(selectedGroupId),
  });
  const entries = query.data ?? [];
  const totalPaya = entries.reduce((total, entry) => total + entry.payaQuantity, 0);
  const workersPresent = entries.reduce((total, entry) => total + entry.attendanceCount, 0);
  const parsedPaya = parseTransportPayaInput(payaInput);
  const canSave = Boolean(selectedGroupId)
    && selectionQuery.isSuccess
    && selectedWorkerIds.size > 0
    && parsedPaya !== null
    && !isSaving;
  const savedEntriesHeading = selectedDate === getLocalDate()
    ? "Today’s saved entries"
    : "Saved entries";

  useEffect(() => {
    if (!groupsQuery.data || !selectedGroupId) return;
    if (!groupsQuery.data.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groupsQuery.data, selectedGroupId]);

  useEffect(() => {
    if (!selectionQuery.data) {
      setMembers([]);
      setSelectedWorkerIds(new Set());
      setPayaInput("");
      setFeedback(null);
      return;
    }
    setMembers(selectionQuery.data.members);
    setSelectedWorkerIds(new Set(selectionQuery.data.selectedWorkerIds));
    setPayaInput(selectionQuery.data.payaInput);
  }, [selectionQuery.data]);

  function markEdited() {
    setFeedback(null);
  }

  async function saveTransport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || saveInProgressRef.current) return;
    const input = buildTransportDailyEntrySaveInput({
      factoryId,
      transportGroupId: selectedGroupId,
      workDate: selectedDate,
      payaInput,
      selectedWorkerIds,
    });
    if (!input) {
      setFeedback({ tone: "warning", message: "Select at least one present worker and enter a paya quantity greater than zero." });
      return;
    }

    saveInProgressRef.current = true;
    setIsSaving(true);
    setFeedback(null);
    try {
      const result = await saveTransportDailyEntry(input);
      await Promise.all([selectionQuery.refetch(), query.refetch()]);
      setFeedback({
        tone: "success",
        message: `Transport entry saved for ${result.attendanceCount} ${result.attendanceCount === 1 ? "worker" : "workers"}.`,
      });
    } catch (error) {
      await Promise.all([selectionQuery.refetch(), query.refetch()]);
      setFeedback({ tone: "danger", message: transportDailyEntryErrorMessage(error) });
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <section aria-label="Chamber Transport" className="max-w-3xl space-y-atlas-3">
      <div className="flex justify-end">
        <div className="w-full sm:w-48">
          <FormField label="Business date">
            <Input
              type="date"
              value={selectedDate}
              disabled={isSaving}
              onChange={(event) => onSelectedDateChange(event.target.value)}
            />
          </FormField>
        </div>
      </div>

      <form onSubmit={saveTransport} className="space-y-atlas-3">
        <Card as="section" aria-labelledby="record-transport-heading">
          <div className="mb-atlas-4">
            <h3 id="record-transport-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Record transport</h3>
          </div>

          <div className="space-y-atlas-4">
            <FormField label="Transport Group">
              <Select
                value={selectedGroupId}
                disabled={groupsQuery.isLoading || isSaving}
                onChange={(event) => {
                  setSelectedGroupId(event.target.value);
                  markEdited();
                }}
              >
                <option value="">{groupsQuery.isLoading ? "Loading Transport Groups..." : "Select Transport Group"}</option>
                {(groupsQuery.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </Select>
            </FormField>

            {groupsQuery.error && (
              <Feedback role="alert" tone="danger">
                <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>Transport Groups are unavailable right now.</span>
                  <Button variant="secondary" onClick={() => { void groupsQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
                </div>
              </Feedback>
            )}
            {groupsQuery.isSuccess && groupsQuery.data.length === 0 && (
              <EmptyState title="No active Transport Groups" description="Create or restore a Transport Group in Workforce before recording transport." />
            )}

            {selectedGroupId && (
              <section aria-labelledby="present-workers-heading" className="space-y-atlas-2">
                <div className="flex items-center justify-between gap-atlas-3">
                  <div>
                    <h4 id="present-workers-heading" className="text-atlas-sm font-atlas-medium text-atlas-text-muted">Present workers</h4>
                    <p aria-live="polite" className="text-atlas-xs text-atlas-text-muted">{selectedWorkerIds.size} of {members.length} selected</p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={!selectionQuery.isSuccess || members.length === 0 || isSaving}
                    onClick={() => {
                      setSelectedWorkerIds(
                        selectedWorkerIds.size === members.length
                          ? new Set()
                          : selectAllTransportWorkers(members),
                      );
                      markEdited();
                    }}
                  >
                    {selectedWorkerIds.size === members.length && members.length > 0 ? "Deselect all" : "Select all"}
                  </Button>
                </div>

                {selectionQuery.isLoading && <Feedback role="status" aria-busy="true" tone="neutral">Loading assigned workers and saved entry...</Feedback>}
                {selectionQuery.error && (
                  <Feedback role="alert" tone="danger">
                    <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                      <span>{transportDailyEntryErrorMessage(selectionQuery.error)}</span>
                      <Button variant="secondary" onClick={() => { void selectionQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
                    </div>
                  </Feedback>
                )}
                {selectionQuery.isSuccess && members.length === 0 && (
                  <EmptyState title="No assigned workers" description="Assign an active worker to this Transport Group in Workforce before recording transport." />
                )}
                {selectionQuery.isSuccess && members.length > 0 && (
                  <div className="space-y-atlas-2 rounded-atlas-control bg-atlas-surface-muted p-atlas-1">
                    {members.map((member) => {
                      const isSelected = selectedWorkerIds.has(member.transportWorkerId);
                      return (
                        <label
                          key={member.transportWorkerId}
                          className={`flex min-h-atlas-12 cursor-pointer items-center gap-atlas-3 rounded-atlas-control border px-atlas-3 py-atlas-2 ${isSelected ? "border-atlas-primary-border bg-atlas-primary-surface" : "border-atlas-border bg-atlas-surface"}`}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={isSaving}
                            onChange={() => {
                              setSelectedWorkerIds((current) => toggleTransportWorkerSelection(current, member.transportWorkerId));
                              markEdited();
                            }}
                          />
                          <span className="min-w-0 flex-1 text-atlas-base font-atlas-medium text-atlas-text">{member.transportWorkerName}</span>
                          {member.isPreviouslyRecorded && <span className="text-atlas-xs text-atlas-text-muted">Previously recorded</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            <FormField label="Paya / Chamber quantity">
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0"
                value={payaInput}
                disabled={isSaving || !selectedGroupId || !selectionQuery.isSuccess}
                aria-invalid={Boolean(payaInput && parsedPaya === null)}
                aria-describedby={payaInput && parsedPaya === null ? "transport-paya-error" : undefined}
                onChange={(event) => {
                  setPayaInput(event.target.value);
                  markEdited();
                }}
              />
            </FormField>
            {payaInput && parsedPaya === null && <p id="transport-paya-error" className="text-atlas-xs text-atlas-danger-text">Enter a paya quantity greater than zero.</p>}
          </div>

          <div className="mt-atlas-4 flex justify-end border-t border-atlas-border pt-atlas-4">
            <Button type="submit" loading={isSaving} loadingLabel="Saving transport entry..." disabled={!canSave}>Save transport entry</Button>
          </div>
        </Card>
        {feedback && <Feedback role={feedback.tone === "danger" ? "alert" : "status"} tone={feedback.tone}>{feedback.message}</Feedback>}
      </form>

      <Card as="section" aria-label="Daily Chamber Transport summary" surface="muted">
        <dl className="grid grid-cols-2 gap-atlas-4 sm:grid-cols-3">
          <div>
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Transport Groups Recorded</dt>
            <dd className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(entries.length)}</dd>
          </div>
          <div>
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Total Paya</dt>
            <dd className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(totalPaya, { maximumFractionDigits: 20 })}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Workers Present</dt>
            <dd className="mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text-muted">{formatIndianNumber(workersPresent)}</dd>
          </div>
        </dl>
      </Card>

      <section aria-labelledby="saved-transport-heading" className="space-y-atlas-3">
        <div>
          <h3 id="saved-transport-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{savedEntriesHeading}</h3>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Saved Transport Group entries for {formatDateOnly(selectedDate)}.</p>
        </div>
        <QueryBoundary isLoading={query.isLoading} error={query.error} loadingLabel="Loading Chamber Transport entries..." onRetry={query.refetch}>
          {entries.length === 0 ? (
            <EmptyHistory title="No Chamber Transport recorded" selectedDate={selectedDate} />
          ) : (
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Chamber Transport entries for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow><TableHeaderCell>Transport Group</TableHeaderCell><TableHeaderCell numeric>Present count</TableHeaderCell><TableHeaderCell numeric>Paya</TableHeaderCell></TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.dailyEntryId}>
                      <TableCell>
                        <span className="font-atlas-semibold">{entry.transportGroupName}</span>
                        <details className="mt-atlas-2 text-atlas-xs text-atlas-text-muted">
                          <summary className="cursor-pointer font-atlas-medium text-atlas-primary">Saved workers</summary>
                          <ul className="mt-atlas-2 space-y-atlas-1">
                            {entry.attendanceWorkers.map((worker) => <li key={worker.transportWorkerId}>{worker.transportWorkerName}{worker.transportWorkerIsActive ? "" : " · Inactive"}</li>)}
                          </ul>
                        </details>
                      </TableCell>
                      <TableCell numeric>{formatIndianNumber(entry.attendanceCount)}</TableCell>
                      <TableCell numeric>{formatIndianNumber(entry.payaQuantity, { maximumFractionDigits: 20 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </QueryBoundary>
      </section>
    </section>
  );
}

function SoilTrolleyWorkspace({
  factoryId,
  selectedDate,
  onSelectedDateChange,
  query,
}: Readonly<{
  factoryId: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  query: QueryState<SoilDailyTrolleyEntry[]>;
}>) {
  const saveInProgressRef = useRef(false);
  const dirtyWorkerIdsRef = useRef(new Set<string>());
  const loadedScopeRef = useRef(`${factoryId}:${selectedDate}`);
  const [rows, setRows] = useState<SoilDailyEntryFormRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger" | "warning";
    message: string;
  } | null>(null);
  const workersQuery = useQuery({
    queryKey: ["office-soil-workers", factoryId],
    queryFn: () => listActiveSoilWorkers(factoryId),
  });
  const entries = query.data ?? [];
  const totalTrolleys = entries.reduce((total, entry) => total + entry.trolleyQuantity, 0);
  const savedEntriesHeading = selectedDate === getLocalDate()
    ? "Today’s saved entries"
    : "Saved entries";
  const hasEditableQuantity = rows.some(
    (row) => row.soilWorkerIsActive && row.quantityInput.trim(),
  );
  const canSave = workersQuery.isSuccess
    && query.data !== undefined
    && hasEditableQuantity
    && !isSaving;

  useEffect(() => {
    if (!workersQuery.data || !query.data) {
      setRows([]);
      return;
    }

    const scope = `${factoryId}:${selectedDate}`;
    const scopeChanged = loadedScopeRef.current !== scope;
    if (scopeChanged) {
      loadedScopeRef.current = scope;
      dirtyWorkerIdsRef.current.clear();
      setFeedback(null);
    }

    const preparedRows = prepareSoilDailyEntryForm({
      activeWorkers: workersQuery.data,
      existingEntries: query.data,
    });
    setRows((currentRows) => {
      if (scopeChanged) return preparedRows;
      const currentByWorker = new Map(currentRows.map((row) => [row.soilWorkerId, row]));
      return preparedRows.map((row) => {
        const current = currentByWorker.get(row.soilWorkerId);
        return current && dirtyWorkerIdsRef.current.has(row.soilWorkerId)
          ? { ...row, quantityInput: current.quantityInput }
          : row;
      });
    });
  }, [factoryId, query.data, selectedDate, workersQuery.data]);

  function setQuantity(soilWorkerId: string, quantityInput: string) {
    dirtyWorkerIdsRef.current.add(soilWorkerId);
    setRows((currentRows) =>
      updateSoilDailyEntryQuantity(currentRows, soilWorkerId, quantityInput),
    );
    setFeedback(null);
  }

  async function saveTrolleyEntries(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || saveInProgressRef.current) return;

    let input;
    try {
      input = buildSoilDailyEntrySaveInput({
        factoryId,
        workDate: selectedDate,
        rows,
      });
    } catch (error) {
      setFeedback({ tone: "warning", message: soilDailyEntryErrorMessage(error) });
      return;
    }

    saveInProgressRef.current = true;
    setIsSaving(true);
    setFeedback(null);
    try {
      const savedEntries = await saveSoilDailyTrolleyEntries(input);
      dirtyWorkerIdsRef.current.clear();
      setRows((currentRows) => applySavedSoilDailyEntries(currentRows, savedEntries));
      await query.refetch();
      setFeedback({
        tone: "success",
        message: `Trolley entries saved for ${savedEntries.length} ${savedEntries.length === 1 ? "worker" : "workers"}.`,
      });
    } catch (error) {
      await Promise.all([workersQuery.refetch(), query.refetch()]);
      setFeedback({ tone: "danger", message: soilDailyEntryErrorMessage(error) });
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <section aria-label="Soil / Trolley" className="max-w-3xl space-y-atlas-3">
      <div className="flex justify-end">
        <div className="w-full sm:w-48">
          <FormField label="Business date">
            <Input
              type="date"
              value={selectedDate}
              disabled={isSaving}
              onChange={(event) => onSelectedDateChange(event.target.value)}
            />
          </FormField>
        </div>
      </div>

      <form onSubmit={saveTrolleyEntries} className="space-y-atlas-3">
        <Card as="section" aria-labelledby="record-trolley-heading">
          <div className="mb-atlas-4">
            <h3 id="record-trolley-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Record trolley entries</h3>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Enter each Soil worker’s trolley quantity. Blank rows will be skipped.</p>
          </div>

          {(workersQuery.isLoading || query.isLoading) && (
            <Feedback role="status" aria-busy="true" tone="neutral">Loading Soil workers and saved quantities...</Feedback>
          )}
          {(workersQuery.error || query.error) && (
            <Feedback role="alert" tone="danger">
              <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{soilDailyEntryErrorMessage(workersQuery.error ?? query.error)}</span>
                <Button variant="secondary" onClick={() => { void Promise.all([workersQuery.refetch(), query.refetch()]); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
              </div>
            </Feedback>
          )}
          {workersQuery.isSuccess && query.data !== undefined && rows.length === 0 && (
            <EmptyState title="No Soil workers available" description="Add or restore a Soil worker in Workforce before recording trolley work." />
          )}

          {rows.length > 0 && (
            <div className="overflow-hidden rounded-atlas-control border border-atlas-border">
              <div className="flex items-center gap-atlas-3 bg-atlas-surface-muted px-atlas-3 py-atlas-2 text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
                <span className="min-w-0 flex-1">Soil worker</span>
                <span className="w-32 text-right sm:w-44">Trolley quantity</span>
              </div>
              <div className="divide-y divide-atlas-border">
                {rows.map((row) => (
                  <label key={row.soilWorkerId} className="flex min-h-atlas-12 items-center gap-atlas-3 bg-atlas-surface px-atlas-3 py-atlas-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-atlas-base font-atlas-medium text-atlas-text">{row.soilWorkerName}</span>
                      {!row.soilWorkerIsActive && <span className="block text-atlas-xs text-atlas-text-muted">Archived · read-only</span>}
                    </span>
                    <span className="w-32 sm:w-44">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={row.quantityInput}
                        placeholder="—"
                        disabled={isSaving || !row.soilWorkerIsActive}
                        aria-label={`${row.soilWorkerName} trolley quantity`}
                        onChange={(event) => setQuantity(row.soilWorkerId, event.target.value)}
                      />
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-atlas-4 flex justify-end border-t border-atlas-border pt-atlas-4">
            <Button type="submit" loading={isSaving} loadingLabel="Saving trolley entries..." disabled={!canSave}>Save trolley entries</Button>
          </div>
        </Card>
        {feedback && <Feedback role={feedback.tone === "danger" ? "alert" : "status"} tone={feedback.tone}>{feedback.message}</Feedback>}
      </form>

      <Card as="section" aria-label="Daily Soil trolley summary" surface="muted">
        <dl className="grid grid-cols-2 gap-atlas-4">
          <div>
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Workers Recorded</dt>
            <dd className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(entries.length)}</dd>
          </div>
          <div>
            <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Total Trolleys</dt>
            <dd className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-primary">{formatIndianNumber(totalTrolleys, { maximumFractionDigits: 3 })}</dd>
          </div>
        </dl>
      </Card>

      <section aria-labelledby="saved-soil-heading" className="space-y-atlas-3">
        <div>
          <h3 id="saved-soil-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{savedEntriesHeading}</h3>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Saved Soil / Trolley entries for {formatDateOnly(selectedDate)}.</p>
        </div>
        <QueryBoundary isLoading={query.isLoading} error={query.error} loadingLabel="Loading Soil / Trolley entries..." onRetry={query.refetch}>
          {entries.length === 0 ? (
            <EmptyHistory title="No Soil / Trolley work recorded" selectedDate={selectedDate} />
          ) : (
            <TableContainer>
              <Table>
                <TableCaption visuallyHidden>Soil / Trolley entries for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow><TableHeaderCell>Soil Worker</TableHeaderCell><TableHeaderCell numeric>Trolley Quantity</TableHeaderCell></TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.soilWorkerName}</TableCell>
                      <TableCell numeric>{formatIndianNumber(entry.trolleyQuantity, { maximumFractionDigits: 3 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </QueryBoundary>
      </section>
    </section>
  );
}

function QueryBoundary({
  isLoading,
  error,
  loadingLabel,
  onRetry,
  children,
}: Readonly<{
  isLoading: boolean;
  error: Error | null;
  loadingLabel: string;
  onRetry: () => Promise<unknown>;
  children: React.ReactNode;
}>) {
  if (isLoading) return <Feedback role="status" aria-busy="true" tone="neutral">{loadingLabel}</Feedback>;
  if (error) {
    return (
      <Feedback role="alert" tone="danger">
        <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Operational history is unavailable right now.</span>
          <Button variant="secondary" onClick={() => { void onRetry(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
        </div>
      </Feedback>
    );
  }
  return children;
}

function EmptyHistory({ title, selectedDate }: Readonly<{ title: string; selectedDate: string }>) {
  return (
    <Card surface="muted">
      <EmptyState title={title} description={`No saved operational entry exists for ${formatDateOnly(selectedDate)}.`} />
    </Card>
  );
}
