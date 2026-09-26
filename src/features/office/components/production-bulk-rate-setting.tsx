"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Checkbox, Input, Select } from "@/components/ui/form-controls";
import { FormField } from "@/components/ui/form-field";
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
  ProductionRateConfigurationError,
  setProductionLabourerRates,
} from "@/features/wages/services/production-rate-configuration-service";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

export type ProductionBulkRateLabourer = Readonly<{
  id: string;
  name: string;
  originLabel: string | null;
  isActive: boolean;
}>;

export type ProductionBulkRateSettingProps = Readonly<{
  factoryId: string;
  labourers: readonly ProductionBulkRateLabourer[];
  onClose: () => void;
}>;

type TargetMode = "all" | "selected";

export function ProductionBulkRateSetting({
  factoryId,
  labourers,
  onClose,
}: ProductionBulkRateSettingProps) {
  const queryClient = useQueryClient();
  const today = getLocalDate();
  const [targetMode, setTargetMode] = useState<TargetMode>("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [selectedLabourerIds, setSelectedLabourerIds] = useState<ReadonlySet<string>>(() => new Set());
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeLabourers = labourers.filter((labourer) => labourer.isActive);
  const originOptions = [...new Set(
    activeLabourers
      .map((labourer) => labourer.originLabel)
      .filter((origin): origin is string => Boolean(origin)),
  )].sort((left, right) => left.localeCompare(right));
  const visibleLabourers = activeLabourers.filter((labourer) => {
    if (originFilter === "all") return true;
    if (originFilter === "none") return labourer.originLabel === null;
    return labourer.originLabel === originFilter;
  });
  const targetLabourerIds = targetMode === "all"
    ? visibleLabourers.map((labourer) => labourer.id)
    : visibleLabourers
      .filter((labourer) => selectedLabourerIds.has(labourer.id))
      .map((labourer) => labourer.id);
  const allVisibleSelected = visibleLabourers.length > 0
    && visibleLabourers.every((labourer) => selectedLabourerIds.has(labourer.id));
  const numericRate = Number(rate);
  const hasValidRate = Boolean(rate) && Number.isFinite(numericRate) && numericRate > 0;
  const targetCount = targetLabourerIds.length;

  function clearFeedback() {
    setSubmitError("");
    setSuccessMessage("");
  }

  function changeTargetMode(mode: TargetMode) {
    setTargetMode(mode);
    clearFeedback();
  }

  function toggleLabourer(labourerId: string) {
    setSelectedLabourerIds((current) => {
      const next = new Set(current);
      if (next.has(labourerId)) next.delete(labourerId);
      else next.add(labourerId);
      return next;
    });
    clearFeedback();
  }

  function selectAllVisible() {
    setSelectedLabourerIds((current) => {
      const next = new Set(current);
      for (const labourer of visibleLabourers) next.add(labourer.id);
      return next;
    });
    clearFeedback();
  }

  function clearSelection() {
    setSelectedLabourerIds(new Set());
    clearFeedback();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (targetCount === 0) {
      setSubmitError("Choose at least one active labourer.");
      return;
    }
    if (!hasValidRate) {
      setSubmitError("Rate per 1,000 bricks must be greater than zero.");
      return;
    }
    if (!effectiveFrom) {
      setSubmitError("Effective-from date is required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await setProductionLabourerRates({
        factoryId,
        labourerIds: targetLabourerIds,
        ratePer1000Bricks: numericRate,
        effectiveFrom,
      });
      setRate("");
      setSelectedLabourerIds(new Set());
      setSuccessMessage(
        `Rate saved for ${formatIndianNumber(targetCount)} ${targetCount === 1 ? "labourer" : "labourers"}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["office-production-wage-rates", factoryId] });
    } catch (caught) {
      setSubmitError(
        caught instanceof ProductionRateConfigurationError || caught instanceof Error
          ? caught.message
          : "Could not save Production rate.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="production-bulk-rate-heading" className="mt-atlas-4">
      <Card>
        <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Direct effective-dated rates
            </p>
            <h3 id="production-bulk-rate-heading" className="mt-atlas-1 text-atlas-xl font-atlas-semibold text-atlas-text">
              Set Production rates
            </h3>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
              Choose the active workers who should receive this new direct rate.
            </p>
          </div>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>
            {ATLAS_UI_STRINGS.actions.close}
          </Button>
        </div>

        <div className="mt-atlas-5 grid gap-atlas-4 lg:grid-cols-2">
          <div>
            <p className="text-atlas-sm font-atlas-medium text-atlas-text-muted">Target scope</p>
            <div className="mt-atlas-1 flex flex-wrap gap-atlas-2" aria-label="Production rate target scope">
              <Button
                variant={targetMode === "all" ? "primary" : "secondary"}
                aria-pressed={targetMode === "all"}
                disabled={isSubmitting}
                onClick={() => changeTargetMode("all")}
              >
                All matching workers
              </Button>
              <Button
                variant={targetMode === "selected" ? "primary" : "secondary"}
                aria-pressed={targetMode === "selected"}
                disabled={isSubmitting}
                onClick={() => changeTargetMode("selected")}
              >
                Selected workers
              </Button>
            </div>
          </div>

          <FormField label="Filter by Origin">
            <Select
              value={originFilter}
              disabled={isSubmitting}
              onChange={(event) => { setOriginFilter(event.target.value); clearFeedback(); }}
            >
              <option value="all">All Origins</option>
              <option value="none">No Origin</option>
              {originOptions.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
            </Select>
          </FormField>
        </div>

        <div className="mt-atlas-4 flex flex-col gap-atlas-2 border-y border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-atlas-semibold text-atlas-text">
            {formatIndianNumber(targetCount)} {targetCount === 1 ? "labourer" : "labourers"} targeted
          </p>
          {targetMode === "selected" && (
            <div className="flex flex-wrap gap-atlas-2">
              <Button variant="ghost" disabled={isSubmitting || visibleLabourers.length === 0 || allVisibleSelected} onClick={selectAllVisible}>
                Select all {formatIndianNumber(visibleLabourers.length)} matching
              </Button>
              <Button variant="ghost" disabled={isSubmitting || selectedLabourerIds.size === 0} onClick={clearSelection}>
                Clear selection
              </Button>
            </div>
          )}
        </div>

        <form className="mt-atlas-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-atlas-3 md:grid-cols-3 md:items-end">
            <FormField label="New rate per 1,000 bricks">
              <Input
                type="text"
                inputMode="decimal"
                value={rate}
                disabled={isSubmitting}
                onChange={(event) => { setRate(event.target.value); clearFeedback(); }}
                placeholder="0.00"
                autoComplete="off"
              />
            </FormField>
            <FormField label="Effective from">
              <Input
                type="date"
                value={effectiveFrom}
                disabled={isSubmitting}
                required
                onChange={(event) => { setEffectiveFrom(event.target.value); clearFeedback(); }}
              />
            </FormField>
            <div className="flex items-center justify-end gap-atlas-2">
              <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>
                {ATLAS_UI_STRINGS.actions.cancel}
              </Button>
              <Button
                type="submit"
                disabled={targetCount === 0}
                loading={isSubmitting}
                loadingLabel={ATLAS_UI_STRINGS.feedback.saving}
              >
                Apply to {formatIndianNumber(targetCount)}
              </Button>
            </div>
          </div>

          {hasValidRate && effectiveFrom && targetCount > 0 && (
            <p className="mt-atlas-3 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text-muted">
              {formatIndianNumber(targetCount)} {targetCount === 1 ? "labourer" : "labourers"} · {formatIndianCurrency(numericRate)} / 1,000 bricks · effective {formatDateOnly(effectiveFrom)}
            </p>
          )}
          {effectiveFrom && effectiveFrom < today && (
            <div className="mt-atlas-3">
              <Feedback tone="warning">Backdated change: live historical range earnings from this date may change.</Feedback>
            </div>
          )}
          {submitError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{submitError}</Feedback></div>}
          {successMessage && <div className="mt-atlas-3"><Feedback role="status" tone="success">{successMessage}</Feedback></div>}
        </form>
      </Card>

      <div className="mt-atlas-4 hidden md:block">
        {visibleLabourers.length === 0 ? (
          <EmptyState title="No eligible workers" description="No active Production workers match this Origin filter." />
        ) : (
          <TableContainer>
            <Table>
              <TableCaption visuallyHidden>Active Production workers available for bulk rate setting</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>
                    <label className="inline-flex min-h-atlas-12 items-center gap-atlas-2">
                      <Checkbox
                        aria-label="Select all matching Production workers"
                        checked={targetMode === "all" || allVisibleSelected}
                        disabled={isSubmitting || targetMode === "all"}
                        onChange={(event) => event.target.checked ? selectAllVisible() : clearSelection()}
                      />
                      Target
                    </label>
                  </TableHeaderCell>
                  <TableHeaderCell>Worker</TableHeaderCell>
                  <TableHeaderCell>Origin</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleLabourers.map((labourer) => {
                  const selected = targetMode === "all" || selectedLabourerIds.has(labourer.id);
                  return (
                    <TableRow key={labourer.id} selected={selected} hoverable>
                      <TableCell>
                        <label className="inline-flex min-h-atlas-12 items-center">
                          <Checkbox
                            aria-label={`Apply rate to ${labourer.name}`}
                            checked={selected}
                            disabled={isSubmitting || targetMode === "all"}
                            onChange={() => toggleLabourer(labourer.id)}
                          />
                        </label>
                      </TableCell>
                      <TableCell><span className="font-atlas-semibold text-atlas-text">{labourer.name}</span></TableCell>
                      <TableCell>{labourer.originLabel ?? "Not recorded"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
        {visibleLabourers.length === 0 ? (
          <EmptyState title="No eligible workers" description="No active Production workers match this Origin filter." />
        ) : visibleLabourers.map((labourer) => {
          const selected = targetMode === "all" || selectedLabourerIds.has(labourer.id);
          return (
            <label key={labourer.id} className={selected ? "flex min-h-atlas-12 items-center gap-atlas-3 bg-atlas-primary-surface px-atlas-3 py-atlas-3" : "flex min-h-atlas-12 items-center gap-atlas-3 px-atlas-3 py-atlas-3"}>
              <Checkbox
                checked={selected}
                disabled={isSubmitting || targetMode === "all"}
                onChange={() => toggleLabourer(labourer.id)}
              />
              <span className="min-w-0"><span className="block truncate font-atlas-semibold text-atlas-text">{labourer.name}</span><span className="mt-atlas-1 block text-atlas-xs text-atlas-text-subtle">{labourer.originLabel ?? "Origin not recorded"}</span></span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
