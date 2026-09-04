"use client";

import { useEffect, useId, useState } from "react";
import { resolveDashboardDateSelection } from "../dashboard-date-controls-model";
import type { DashboardDateMode, DashboardDateRange } from "../dashboard-date-model";

export interface DashboardDateControlsProps {
  mode: DashboardDateMode;
  range: DashboardDateRange;
  onChange: (mode: DashboardDateMode, range: DashboardDateRange) => void;
}

const modes: Array<{ value: DashboardDateMode; label: string }> = [
  { value: "today", label: "Today" },
  { value: "single-date", label: "Single Date" },
  { value: "range", label: "Date Range" },
];

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950";

export function DashboardDateControls({
  mode,
  range,
  onChange,
}: Readonly<DashboardDateControlsProps>) {
  const [draft, setDraft] = useState<DashboardDateRange>(range);
  const [error, setError] = useState<string | null>(null);
  const controlId = useId();
  const errorId = `${controlId}-error`;

  useEffect(() => {
    setDraft({ dateFrom: range.dateFrom, dateTo: range.dateTo });
    setError(null);
  }, [mode, range.dateFrom, range.dateTo]);

  function select(nextMode: DashboardDateMode, nextDraft: DashboardDateRange) {
    const selection = resolveDashboardDateSelection(nextMode, nextDraft);
    setError(selection.error);
    if (selection.range) onChange(nextMode, selection.range);
  }

  function edit(field: keyof DashboardDateRange, value: string) {
    const nextDraft = { ...draft, [field]: value };
    setDraft(nextDraft);
    select(mode, nextDraft);
  }

  return (
    <fieldset className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <legend className="sr-only">Dashboard dates</legend>
      <div className="flex flex-wrap gap-2">
        {modes.map((option) => <button
          key={option.value}
          type="button"
          aria-pressed={mode === option.value}
          onClick={() => select(option.value, range)}
          className={`h-9 rounded-lg border px-3 text-sm font-semibold ${mode === option.value ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
        >{option.label}</button>)}
      </div>

      {mode === "single-date" && <label className="mt-4 block max-w-xs text-xs font-medium text-slate-600">
        Date
        <input
          type="date"
          value={draft.dateFrom}
          onChange={(event) => edit("dateFrom", event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={inputClass}
        />
      </label>}

      {mode === "range" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">
          From
          <input
            type="date"
            value={draft.dateFrom}
            onChange={(event) => edit("dateFrom", event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          To
          <input
            type="date"
            value={draft.dateTo}
            onChange={(event) => edit("dateTo", event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={inputClass}
          />
        </label>
      </div>}

      {error && <p id={errorId} role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    </fieldset>
  );
}
