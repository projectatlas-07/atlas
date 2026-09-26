"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
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
import { getTodaysProduction, type TodayProductionRow } from "@/features/office/services/todays-production-service";
import { listSoilDailyTrolleyEntries } from "@/features/soil/services/soil-daily-entry-service";
import type { SoilDailyTrolleyEntry } from "@/features/soil/types";
import { listTransportDailyOperations } from "@/features/transport/services/transport-daily-operations-service";
import type { TransportDailyOperationsEntry } from "@/features/transport/types";
import { formatDateOnly, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type ProductionWorkspaceArea = "brick" | "chamber" | "soil";

const WORKSPACE_AREAS = [
  { id: "brick", label: "Brick Production" },
  { id: "chamber", label: "Chamber Transport" },
  { id: "soil", label: "Soil / Trolley" },
] as const satisfies ReadonlyArray<{ id: ProductionWorkspaceArea; label: string }>;

const RECORDING_LINK_CLASSES = [
  "inline-flex min-h-atlas-12 items-center justify-center rounded-atlas-button border border-atlas-primary",
  "bg-atlas-primary px-atlas-4 py-atlas-2 text-atlas-base font-atlas-semibold text-atlas-primary-foreground",
  "hover:bg-atlas-primary-hover focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus",
].join(" ");

export function ProductionOfficeWorkspace({ factoryId }: Readonly<{ factoryId: string }>) {
  const [activeArea, setActiveArea] = useState<ProductionWorkspaceArea>("brick");
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

  return (
    <div className="space-y-atlas-6">
      <header className="border-b border-atlas-border pb-atlas-5">
        <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Daily factory operations</p>
        <h2 className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">Production workspace</h2>
        <p className="mt-atlas-2 max-w-3xl text-atlas-sm text-atlas-text-muted">
          Record work in the existing site flows, then review the saved operational history here. Worker rates, earnings, payments, and balances remain in Workforce.
        </p>
      </header>

      <nav aria-label="Production workflows">
        <div className="grid gap-atlas-2 sm:grid-cols-3">
          {WORKSPACE_AREAS.map((area) => (
            <Button
              key={area.id}
              variant={activeArea === area.id ? "primary" : "secondary"}
              aria-pressed={activeArea === area.id}
              onClick={() => setActiveArea(area.id)}
            >
              {area.label}
            </Button>
          ))}
        </div>
      </nav>

      {activeArea === "brick" && (
        <BrickProductionWorkspace
          selectedDate={brickDate}
          onSelectedDateChange={setBrickDate}
          query={brickQuery}
        />
      )}
      {activeArea === "chamber" && (
        <ChamberTransportWorkspace
          selectedDate={chamberDate}
          onSelectedDateChange={setChamberDate}
          query={chamberQuery}
        />
      )}
      {activeArea === "soil" && (
        <SoilTrolleyWorkspace
          selectedDate={soilDate}
          onSelectedDateChange={setSoilDate}
          query={soilQuery}
        />
      )}
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
  selectedDate,
  onSelectedDateChange,
  query,
}: Readonly<{
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  query: QueryState<TodayProductionRow[]>;
}>) {
  const entries = query.data ?? [];
  const totalProduction = entries.reduce((total, entry) => total + entry.quantity, 0);

  return (
    <WorkspacePanel
      heading="Brick Production"
      description="Daily raw brick quantities saved against Production labourers."
      recordingHref="/#brick-production"
      recordingLabel="Record Brick Production"
      historyLabel="Daily history / totals"
      selectedDate={selectedDate}
      onSelectedDateChange={onSelectedDateChange}
    >
      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        loadingLabel="Loading Brick Production history..."
        onRetry={query.refetch}
      >
        {entries.length === 0 ? (
          <EmptyHistory title="No Brick Production recorded" selectedDate={selectedDate} />
        ) : (
          <>
            <OperationalTotals items={[
              { label: "Total production", value: formatIndianNumber(totalProduction) },
              { label: "Labourers recorded", value: formatIndianNumber(entries.length) },
            ]} />
            <TableContainer>
              <Table>
                <TableCaption visuallyHidden>Brick Production entries for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow><TableHeaderCell>Labourer</TableHeaderCell><TableHeaderCell numeric>Raw quantity</TableHeaderCell></TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.labourerId}>
                      <TableCell>{entry.labourerName}</TableCell>
                      <TableCell numeric>{formatIndianNumber(entry.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </QueryBoundary>
    </WorkspacePanel>
  );
}

function ChamberTransportWorkspace({
  selectedDate,
  onSelectedDateChange,
  query,
}: Readonly<{
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  query: QueryState<TransportDailyOperationsEntry[]>;
}>) {
  const entries = query.data ?? [];
  const totalPaya = entries.reduce((total, entry) => total + entry.payaQuantity, 0);

  return (
    <WorkspacePanel
      heading="Chamber Transport"
      description="Daily Transport Group movement, saved attendance, and paya quantities."
      recordingHref="/#chamber-transport"
      recordingLabel="Record Chamber Transport"
      historyLabel="Operational history / totals"
      selectedDate={selectedDate}
      onSelectedDateChange={onSelectedDateChange}
    >
      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        loadingLabel="Loading Chamber Transport history..."
        onRetry={query.refetch}
      >
        {entries.length === 0 ? (
          <EmptyHistory title="No Chamber Transport recorded" selectedDate={selectedDate} />
        ) : (
          <>
            <OperationalTotals items={[
              { label: "Transport Groups recorded", value: formatIndianNumber(entries.length) },
              { label: "Total paya", value: formatIndianNumber(totalPaya, { maximumFractionDigits: 20 }) },
            ]} />
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Chamber Transport entries for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow><TableHeaderCell>Transport Group</TableHeaderCell><TableHeaderCell numeric>Attendance</TableHeaderCell><TableHeaderCell numeric>Paya</TableHeaderCell></TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.dailyEntryId}>
                      <TableCell>
                        <span className="font-atlas-semibold">{entry.transportGroupName}</span>
                        <details className="mt-atlas-2 text-atlas-xs text-atlas-text-muted">
                          <summary className="cursor-pointer font-atlas-medium text-atlas-primary">Saved attendance</summary>
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
          </>
        )}
      </QueryBoundary>
    </WorkspacePanel>
  );
}

function SoilTrolleyWorkspace({
  selectedDate,
  onSelectedDateChange,
  query,
}: Readonly<{
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  query: QueryState<SoilDailyTrolleyEntry[]>;
}>) {
  const entries = query.data ?? [];
  const totalTrolleys = entries.reduce((total, entry) => total + entry.trolleyQuantity, 0);

  return (
    <WorkspacePanel
      heading="Soil / Trolley"
      description="Daily trolley quantities only. Worker accounts and financial history remain in Workforce."
      recordingHref="/#soil"
      recordingLabel="Record Soil / Trolley"
      historyLabel="Operational history"
      selectedDate={selectedDate}
      onSelectedDateChange={onSelectedDateChange}
    >
      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        loadingLabel="Loading Soil / Trolley history..."
        onRetry={query.refetch}
      >
        {entries.length === 0 ? (
          <EmptyHistory title="No Soil / Trolley work recorded" selectedDate={selectedDate} />
        ) : (
          <>
            <OperationalTotals items={[
              { label: "Workers recorded", value: formatIndianNumber(entries.length) },
              { label: "Total trolleys", value: formatIndianNumber(totalTrolleys) },
            ]} />
            <TableContainer>
              <Table>
                <TableCaption visuallyHidden>Soil / Trolley entries for {formatDateOnly(selectedDate)}</TableCaption>
                <TableHeader>
                  <TableRow><TableHeaderCell>Soil worker</TableHeaderCell><TableHeaderCell numeric>Trolley quantity</TableHeaderCell></TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.soilWorkerName}</TableCell>
                      <TableCell numeric>{formatIndianNumber(entry.trolleyQuantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </QueryBoundary>
    </WorkspacePanel>
  );
}

function WorkspacePanel({
  heading,
  description,
  recordingHref,
  recordingLabel,
  historyLabel,
  selectedDate,
  onSelectedDateChange,
  children,
}: Readonly<{
  heading: string;
  description: string;
  recordingHref: string;
  recordingLabel: string;
  historyLabel: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  children: React.ReactNode;
}>) {
  return (
    <section aria-labelledby={`production-${heading.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-heading`} className="space-y-atlas-6">
      <div className="flex flex-col gap-atlas-4 border-y border-atlas-border py-atlas-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id={`production-${heading.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-heading`} className="text-atlas-xl font-atlas-semibold text-atlas-text">{heading}</h3>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{description}</p>
        </div>
        <Link href={recordingHref} className={RECORDING_LINK_CLASSES}>{recordingLabel}</Link>
      </div>

      <section aria-labelledby="production-history-heading">
        <div className="mb-atlas-4 flex flex-col gap-atlas-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="production-history-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{historyLabel}</h3>
            <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Saved operations for the selected business date.</p>
          </div>
          <div className="w-full sm:max-w-xs">
            <FormField label="Business date">
              <Input type="date" value={selectedDate} onChange={(event) => onSelectedDateChange(event.target.value)} />
            </FormField>
          </div>
        </div>
        <div className="space-y-atlas-4">{children}</div>
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

function OperationalTotals({ items }: Readonly<{ items: ReadonlyArray<{ label: string; value: string }> }>) {
  return (
    <dl className="grid gap-atlas-3 border-y border-atlas-border py-atlas-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">{item.label}</dt>
          <dd className="mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums text-atlas-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
