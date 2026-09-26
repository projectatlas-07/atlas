"use client";

import Link from "next/link";
import { formatDateOnly } from "../../../lib/formatting";
import { getOwnerDashboardDateRanges } from "../dashboard-date-model";
import { DashboardContainer } from "./dashboard-container";

export interface DashboardFeatureProps {
  factoryId: string;
}

const SHORTCUT_CLASSES = [
  "inline-flex min-h-atlas-12 items-center justify-center rounded-atlas-button border px-atlas-4 py-atlas-2",
  "text-atlas-base font-atlas-semibold transition-colors",
  "focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus",
].join(" ");

export function DashboardFeature({ factoryId }: Readonly<DashboardFeatureProps>) {
  const ranges = getOwnerDashboardDateRanges();

  return (
    <div className="space-y-atlas-8">
      <header className="flex flex-col gap-atlas-4 border-b border-atlas-border pb-atlas-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Owner overview</p>
          <h2 className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">Today at a glance</h2>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{formatDateOnly(ranges.today.dateTo)}</p>
        </div>
        <nav aria-label="Dashboard shortcuts" className="grid gap-atlas-2 sm:flex">
          <Link href="/" className={`${SHORTCUT_CLASSES} border-atlas-border-strong bg-atlas-surface text-atlas-text hover:bg-atlas-surface-hover`}>Record Production</Link>
          <a href="#new-challan" className={`${SHORTCUT_CLASSES} border-atlas-primary bg-atlas-primary text-atlas-primary-foreground hover:bg-atlas-primary-hover`}>New Challan</a>
        </nav>
      </header>

      <DashboardContainer
        factoryId={factoryId}
        businessDate={ranges.today.dateTo}
        weekStart={ranges.thisWeek.dateFrom}
      />
    </div>
  );
}
