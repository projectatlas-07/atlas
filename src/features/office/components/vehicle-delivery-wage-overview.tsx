"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
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
import { VehicleWageAccountDrawer } from "@/features/office/components/vehicle-wage-account-drawer";
import {
  vehicleWageAccountQueryKey,
  vehicleWagePaymentsQueryKey,
} from "@/features/office/vehicle-wage-office-query-keys";
import {
  filterVehicleWageOverviewAccounts,
  formatVehicleWageLastPaid,
  latestEffectiveVehicleWagePayment,
  type VehicleWageLifecycleFilter,
} from "@/features/office/vehicle-wage-overview-model";
import {
  buildVehicleWageAccounts,
  resolveVehicleWageDateRange,
  summarizeVehicleWageRange,
  type VehicleWageAccountSummary,
  type VehicleWageDatePreset,
} from "@/features/sales/vehicle-wage-model";
import { buildVehicleTripHistories, type VehicleTrip } from "@/features/sales/vehicle-trip-model";
import {
  getVehicleWageLifetimeAccount,
  listAllVehicleWageTrips,
  listVehicleWagePayments,
  listVehicleWageTrips,
} from "@/features/sales/services/vehicle-wage-service";
import {
  archiveVehicle,
  restoreVehicle,
  setVehicleDeliveryWageTracking,
} from "@/features/sales/services/vehicle-service";
import { listVehicleTrips } from "@/features/sales/services/vehicle-trip-service";
import { formatChallanLabel, type Vehicle } from "@/features/sales/types";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type VehicleWageOverviewPreset = VehicleWageDatePreset | "all_time";
type VehicleRareAction = "tracking_off" | "tracking_on" | "archive" | "restore";
type VehicleRareActionsLayout = "desktop" | "mobile";

function vehicleRareActionsMenuKey(
  layout: VehicleRareActionsLayout,
  vehicleId: string,
): string {
  return `${layout}:${vehicleId}`;
}

const PERIOD_OPTIONS: ReadonlyArray<{
  value: VehicleWageOverviewPreset;
  label: string;
}> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom" },
  { value: "all_time", label: "All Time" },
];

export function VehicleDeliveryWageOverview({
  factoryId,
  vehicles,
  onVehicleSaved,
}: Readonly<{
  factoryId: string;
  vehicles: readonly Vehicle[];
  onVehicleSaved: (vehicle: Vehicle) => void;
}>) {
  const [localToday] = useState(getLocalDate);
  const [preset, setPreset] = useState<VehicleWageOverviewPreset>("this_week");
  const [customFrom, setCustomFrom] = useState(localToday);
  const [customTo, setCustomTo] = useState(localToday);
  const [lifecycleFilter, setLifecycleFilter] = useState<VehicleWageLifecycleFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedVehicleId, setExpandedVehicleId] = useState("");
  const [showAllTripsVehicleId, setShowAllTripsVehicleId] = useState("");
  const [accountVehicleId, setAccountVehicleId] = useState("");
  const [openMenuKey, setOpenMenuKey] = useState("");
  const [pendingVehicleAction, setPendingVehicleAction] = useState<Readonly<{
    vehicleId: string;
    action: VehicleRareAction;
  }> | null>(null);
  const [vehicleActionError, setVehicleActionError] = useState("");
  const [isVehicleActionSubmitting, setIsVehicleActionSubmitting] = useState(false);
  const vehicleActionSubmittingRef = useRef(false);
  const range = preset === "all_time"
    ? null
    : resolveVehicleWageDateRange(preset, localToday, customFrom, customTo);
  const rangeIsValid = preset === "all_time" || range !== null;
  const periodLabel = PERIOD_OPTIONS.find((option) => option.value === preset)?.label
    ?? "Selected period";

  const wageTripsQuery = useQuery({
    queryKey: [
      "office-vehicle-wages",
      factoryId,
      "overview-trips",
      preset,
      range?.fromDate,
      range?.toDate,
    ],
    queryFn: () => preset === "all_time"
      ? listAllVehicleWageTrips(factoryId)
      : listVehicleWageTrips(factoryId, range!),
    enabled: rangeIsValid,
  });
  const tripHistoryQuery = useQuery({
    queryKey: ["office-vehicle-trips", factoryId],
    queryFn: () => listVehicleTrips(factoryId),
  });
  const accounts = buildVehicleWageAccounts(vehicles, wageTripsQuery.data ?? []);
  const rangeSummary = summarizeVehicleWageRange(accounts);
  const tripHistories = buildVehicleTripHistories(vehicles, tripHistoryQuery.data ?? []);
  const tripEvidenceById = new Map<string, VehicleTrip>();
  for (const history of tripHistories) {
    for (const trip of history.trips) tripEvidenceById.set(trip.challanId, trip);
  }

  const lifetimeQueries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: vehicleWageAccountQueryKey(factoryId, account.vehicleId),
      queryFn: () => getVehicleWageLifetimeAccount(factoryId, account.vehicleId),
      refetchInterval: 30_000,
    })),
  });
  const paymentQueries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: vehicleWagePaymentsQueryKey(factoryId, account.vehicleId),
      queryFn: () => listVehicleWagePayments(factoryId, account.vehicleId),
      refetchInterval: 30_000,
    })),
  });
  const accountIndexByVehicleId = new Map(
    accounts.map((account, index) => [account.vehicleId, index]),
  );
  const activeCount = accounts.filter((account) => account.isActive).length;
  const archivedCount = accounts.length - activeCount;
  const visibleAccounts = filterVehicleWageOverviewAccounts({
    accounts,
    lifecycle: lifecycleFilter,
    search,
  });
  const accountQueriesLoading = lifetimeQueries.some((query) => query.isLoading);
  const accountQueriesError = lifetimeQueries.some((query) => Boolean(query.error));
  const paymentQueriesError = paymentQueries.some((query) => Boolean(query.error));
  const totalAvailable = accountQueriesLoading || accountQueriesError
    ? null
    : lifetimeQueries.reduce((total, query) => total + (query.data?.availableBalance ?? 0), 0);
  const accountVehicle = vehicles.find((vehicle) => vehicle.id === accountVehicleId);
  const actionVehicle = vehicles.find((vehicle) => vehicle.id === pendingVehicleAction?.vehicleId);

  function changePreset(nextPreset: VehicleWageOverviewPreset) {
    setPreset(nextPreset);
    setExpandedVehicleId("");
    setShowAllTripsVehicleId("");
  }

  function toggleTrips(vehicleId: string) {
    setExpandedVehicleId((current) => current === vehicleId ? "" : vehicleId);
    setShowAllTripsVehicleId("");
  }

  function requestVehicleAction(vehicleId: string, action: VehicleRareAction) {
    setOpenMenuKey("");
    setVehicleActionError("");
    setPendingVehicleAction({ vehicleId, action });
  }

  function closeVehicleAction() {
    if (isVehicleActionSubmitting) return;
    setPendingVehicleAction(null);
    setVehicleActionError("");
  }

  async function confirmVehicleAction() {
    if (!pendingVehicleAction || !actionVehicle || isVehicleActionSubmitting
      || vehicleActionSubmittingRef.current) return;
    vehicleActionSubmittingRef.current = true;
    setIsVehicleActionSubmitting(true);
    setVehicleActionError("");
    try {
      const saved = pendingVehicleAction.action === "tracking_off"
        ? await setVehicleDeliveryWageTracking({
          factoryId,
          vehicleId: actionVehicle.id,
          enabled: false,
        })
        : pendingVehicleAction.action === "tracking_on"
          ? await setVehicleDeliveryWageTracking({
            factoryId,
            vehicleId: actionVehicle.id,
            enabled: true,
          })
          : pendingVehicleAction.action === "archive"
            ? await archiveVehicle(factoryId, actionVehicle.id)
            : await restoreVehicle(factoryId, actionVehicle.id);
      onVehicleSaved(saved);
      setPendingVehicleAction(null);
      setOpenMenuKey("");
    } catch (error) {
      setVehicleActionError(error instanceof Error ? error.message : "Could not update this Vehicle.");
    } finally {
      vehicleActionSubmittingRef.current = false;
      setIsVehicleActionSubmitting(false);
    }
  }

  function accountData(account: VehicleWageAccountSummary) {
    const index = accountIndexByVehicleId.get(account.vehicleId);
    return index === undefined ? undefined : lifetimeQueries[index];
  }

  function paymentData(account: VehicleWageAccountSummary) {
    const index = accountIndexByVehicleId.get(account.vehicleId);
    return index === undefined ? undefined : paymentQueries[index];
  }

  function availableLabel(account: VehicleWageAccountSummary): string {
    const query = accountData(account);
    if (!query || query.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (query.error || !query.data) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatIndianCurrency(query.data.availableBalance);
  }

  function lastPaidLabel(account: VehicleWageAccountSummary): string {
    const query = paymentData(account);
    if (!query || query.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (query.error) return ATLAS_UI_STRINGS.feedback.unavailable;
    const latestPayment = latestEffectiveVehicleWagePayment(query.data ?? []);
    return formatVehicleWageLastPaid(latestPayment?.paymentDate ?? null, localToday);
  }

  const periodContext = preset === "all_time"
    ? "All recorded eligible Challans"
    : range
      ? `${formatDateOnly(range.fromDate)} — ${formatDateOnly(range.toDate)}, inclusive`
      : "";

  return (
    <section aria-labelledby="vehicle-delivery-wages-heading">
      <header className="border-b border-atlas-border pb-atlas-5">
        <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
          Workforce / Vehicle Delivery Wages
        </p>
        <div className="mt-atlas-1 flex flex-col gap-atlas-2 sm:flex-row sm:items-center">
          <h2 id="vehicle-delivery-wages-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">
            Vehicle Delivery Wages
          </h2>
          <div className="w-full sm:w-44">
            <Select
              aria-label="Vehicle wage period"
              value={preset}
              onChange={(event) => changePreset(event.target.value as VehicleWageOverviewPreset)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
          {wageTripsQuery.isLoading
            ? ATLAS_UI_STRINGS.feedback.loading
            : wageTripsQuery.error || !rangeIsValid
              ? ATLAS_UI_STRINGS.feedback.unavailable
              : `${formatIndianCurrency(rangeSummary.earnedAmount)} earned · ${formatIndianNumber(rangeSummary.qualifyingTripCount)} wage ${rangeSummary.qualifyingTripCount === 1 ? "trip" : "trips"}`} · {accountQueriesLoading
            ? ATLAS_UI_STRINGS.feedback.loading
            : accountQueriesError || totalAvailable === null
              ? ATLAS_UI_STRINGS.feedback.unavailable
              : `${formatIndianCurrency(totalAvailable)} available`}
        </p>

        {preset === "custom" && (
          <div className="mt-atlas-4 grid max-w-xl gap-atlas-3 sm:grid-cols-2">
            <label className="text-atlas-sm font-atlas-medium text-atlas-text-muted">
              <span className="mb-atlas-1 block">From</span>
              <Input type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setExpandedVehicleId(""); setShowAllTripsVehicleId(""); }} />
            </label>
            <label className="text-atlas-sm font-atlas-medium text-atlas-text-muted">
              <span className="mb-atlas-1 block">To</span>
              <Input type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setExpandedVehicleId(""); setShowAllTripsVehicleId(""); }} />
            </label>
          </div>
        )}
        {preset === "custom" && !range && (
          <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>
        )}
        {rangeIsValid && <p className="mt-atlas-3 text-atlas-xs text-atlas-text-subtle">{periodContext}. Trips and Earned use this period; Available remains the current lifetime balance.</p>}
      </header>

      <div className="mt-atlas-5 flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
        <div aria-label="Filter vehicles" className="flex gap-atlas-2 overflow-x-auto pb-atlas-1">
          {([
            ["all", `All ${formatIndianNumber(accounts.length)}`],
            ["active", `Active ${formatIndianNumber(activeCount)}`],
            ["archived", `Archived ${formatIndianNumber(archivedCount)}`],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              variant={lifecycleFilter === value ? "primary" : "ghost"}
              aria-pressed={lifecycleFilter === value}
              onClick={() => setLifecycleFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="w-full sm:max-w-xs">
          <Input
            type="search"
            aria-label="Search vehicles"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search vehicle..."
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {wageTripsQuery.error && <Feedback role="alert" tone="danger">Could not load Vehicle wage earnings.</Feedback>}
        {tripHistoryQuery.error && <Feedback role="alert" tone="danger">Could not load Challan trip evidence.</Feedback>}
        {accountQueriesError && <Feedback role="alert" tone="danger">Could not load one or more available balances.</Feedback>}
        {paymentQueriesError && <Feedback role="alert" tone="danger">Could not load one or more payment histories.</Feedback>}
      </div>

      {!rangeIsValid ? null : wageTripsQuery.isLoading ? (
        <div className="mt-atlas-4"><Feedback role="status" tone="neutral">Loading Vehicle wage earnings...</Feedback></div>
      ) : wageTripsQuery.error ? null : visibleAccounts.length === 0 ? (
        <EmptyState
          title={accounts.length === 0 ? "No Vehicles yet" : "No Vehicles match these filters"}
          description={accounts.length === 0 ? "Eligible Challan wages will appear here after a Vehicle is recorded." : "Clear the search or choose another lifecycle filter."}
        />
      ) : (
        <>
          <div className="mt-atlas-4 hidden md:block">
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Vehicle Delivery Wages overview for {periodLabel}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Vehicle</TableHeaderCell>
                    <TableHeaderCell numeric>Trips</TableHeaderCell>
                    <TableHeaderCell numeric>Earned</TableHeaderCell>
                    <TableHeaderCell numeric>Available</TableHeaderCell>
                    <TableHeaderCell>Last paid</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleAccounts.map((account) => {
                    const menuKey = vehicleRareActionsMenuKey("desktop", account.vehicleId);
                    return (
                      <DesktopVehicleRows
                        key={account.vehicleId}
                        account={account}
                        periodLabel={periodLabel}
                        periodContext={periodContext}
                        tripEvidenceById={tripEvidenceById}
                        expanded={expandedVehicleId === account.vehicleId}
                        showAllTrips={showAllTripsVehicleId === account.vehicleId}
                        availableLabel={availableLabel(account)}
                        lastPaidLabel={lastPaidLabel(account)}
                        onToggleTrips={() => toggleTrips(account.vehicleId)}
                        onToggleShowAll={() => setShowAllTripsVehicleId((current) => current === account.vehicleId ? "" : account.vehicleId)}
                        onOpenAccount={() => setAccountVehicleId(account.vehicleId)}
                        menuOpen={openMenuKey === menuKey}
                        onToggleMenu={() => setOpenMenuKey((current) => current === menuKey ? "" : menuKey)}
                        onCloseMenu={() => setOpenMenuKey("")}
                        onRequestAction={(action) => requestVehicleAction(account.vehicleId, action)}
                      />
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex flex-col gap-atlas-1 border-t border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 text-atlas-xs text-atlas-text-subtle sm:flex-row sm:items-center sm:justify-between">
                <p>Showing {formatIndianNumber(visibleAccounts.length)} of {formatIndianNumber(accounts.length)} Vehicles</p>
                <p>Available is the authoritative lifetime balance, not period-dependent.</p>
              </div>
            </TableContainer>
          </div>

          <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
            {visibleAccounts.map((account) => {
              const expanded = expandedVehicleId === account.vehicleId;
              const menuKey = vehicleRareActionsMenuKey("mobile", account.vehicleId);
              return (
                <article key={account.vehicleId} className={expanded ? "bg-atlas-primary-surface py-atlas-4" : "py-atlas-4"}>
                  <div className="flex items-start justify-between gap-atlas-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-atlas-2">
                        <h3 className="text-atlas-base font-atlas-semibold text-atlas-text">{account.vehicleNumber}</h3>
                        {!account.isActive && <StatusPill label="Archived" tone="archive" />}
                      </div>
                      <WageTrackingState enabled={account.deliveryWageTrackingEnabled} />
                    </div>
                    <Button variant="ghost" aria-expanded={expanded} onClick={() => toggleTrips(account.vehicleId)} disabled={account.qualifyingTripCount === 0}>
                      {formatIndianNumber(account.qualifyingTripCount)} {account.qualifyingTripCount === 1 ? "trip" : "trips"}
                    </Button>
                  </div>
                  <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 text-atlas-sm">
                    <div><dt className="text-atlas-xs text-atlas-text-subtle">Earned · {periodLabel}</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(account.earnedAmount)}</dd></div>
                    <div><dt className="text-right text-atlas-xs text-atlas-text-subtle">Available</dt><dd className="mt-atlas-1 text-right font-atlas-semibold tabular-nums text-atlas-text">{availableLabel(account)}</dd></div>
                  </dl>
                  <p className="mt-atlas-3 text-atlas-xs text-atlas-text-muted">{lastPaidLabel(account)}</p>
                  <div className="mt-atlas-3 flex flex-wrap items-center gap-atlas-2">
                    <Button onClick={() => setAccountVehicleId(account.vehicleId)}>Account &amp; payment</Button>
                    <VehicleRareActions
                      vehicle={account}
                      open={openMenuKey === menuKey}
                      onToggle={() => setOpenMenuKey((current) => current === menuKey ? "" : menuKey)}
                      onClose={() => setOpenMenuKey("")}
                      onRequestAction={(action) => requestVehicleAction(account.vehicleId, action)}
                    />
                  </div>
                  {expanded && (
                    <div className="mt-atlas-4">
                      <TripEvidence
                        account={account}
                        periodLabel={periodLabel}
                        periodContext={periodContext}
                        tripEvidenceById={tripEvidenceById}
                        showAll={showAllTripsVehicleId === account.vehicleId}
                        onToggleShowAll={() => setShowAllTripsVehicleId((current) => current === account.vehicleId ? "" : account.vehicleId)}
                      />
                    </div>
                  )}
                </article>
              );
            })}
            <p className="py-atlas-3 text-atlas-xs text-atlas-text-subtle">Available is the authoritative lifetime balance, not period-dependent.</p>
          </div>
        </>
      )}

      {accountVehicle && (
        <VehicleWageAccountDrawer
          key={accountVehicle.id}
          factoryId={factoryId}
          vehicle={accountVehicle}
          onClose={() => setAccountVehicleId("")}
        />
      )}
      {pendingVehicleAction && actionVehicle && (
        <VehicleActionConfirmation
          vehicleNumber={actionVehicle.vehicleNumber}
          action={pendingVehicleAction.action}
          error={vehicleActionError}
          submitting={isVehicleActionSubmitting}
          onCancel={closeVehicleAction}
          onConfirm={() => void confirmVehicleAction()}
        />
      )}
    </section>
  );
}

function DesktopVehicleRows({
  account,
  periodLabel,
  periodContext,
  tripEvidenceById,
  expanded,
  showAllTrips,
  availableLabel,
  lastPaidLabel,
  onToggleTrips,
  onToggleShowAll,
  onOpenAccount,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onRequestAction,
}: Readonly<{
  account: VehicleWageAccountSummary;
  periodLabel: string;
  periodContext: string;
  tripEvidenceById: ReadonlyMap<string, VehicleTrip>;
  expanded: boolean;
  showAllTrips: boolean;
  availableLabel: string;
  lastPaidLabel: string;
  onToggleTrips: () => void;
  onToggleShowAll: () => void;
  onOpenAccount: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRequestAction: (action: VehicleRareAction) => void;
}>) {
  return (
    <>
      <TableRow hoverable selected={expanded}>
        <TableCell>
          <div className="flex flex-wrap items-center gap-atlas-2">
            <span className="font-atlas-semibold text-atlas-text">{account.vehicleNumber}</span>
            {!account.isActive && <StatusPill label="Archived" tone="archive" />}
          </div>
          <WageTrackingState enabled={account.deliveryWageTrackingEnabled} />
        </TableCell>
        <TableCell numeric>
          <Button variant="ghost" aria-expanded={expanded} onClick={onToggleTrips} disabled={account.qualifyingTripCount === 0}>
            {formatIndianNumber(account.qualifyingTripCount)} {account.qualifyingTripCount === 1 ? "trip" : "trips"}
          </Button>
        </TableCell>
        <TableCell numeric><span className="font-atlas-semibold text-atlas-text">{formatIndianCurrency(account.earnedAmount)}</span></TableCell>
        <TableCell numeric><span className="font-atlas-semibold text-atlas-text">{availableLabel}</span></TableCell>
        <TableCell><span className="text-atlas-sm text-atlas-text-muted">{lastPaidLabel}</span></TableCell>
        <TableCell>
          <div className="flex items-center gap-atlas-2">
            <Button onClick={onOpenAccount}>Account &amp; payment</Button>
            <VehicleRareActions
              vehicle={account}
              open={menuOpen}
              onToggle={onToggleMenu}
              onClose={onCloseMenu}
              onRequestAction={onRequestAction}
            />
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6}>
            <TripEvidence
              account={account}
              periodLabel={periodLabel}
              periodContext={periodContext}
              tripEvidenceById={tripEvidenceById}
              showAll={showAllTrips}
              onToggleShowAll={onToggleShowAll}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function VehicleRareActions({
  vehicle,
  open,
  onToggle,
  onClose,
  onRequestAction,
}: Readonly<{
  vehicle: Pick<
    VehicleWageAccountSummary,
    "vehicleId" | "vehicleNumber" | "deliveryWageTrackingEnabled" | "isActive"
  >;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRequestAction: (action: VehicleRareAction) => void;
}>) {
  const menuId = `vehicle-actions-${vehicle.vehicleId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<Readonly<{
    left: number;
    top: number;
  }> | null>(null);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    function positionMenu() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      const menuWidth = 224;
      const menuHeight = 104;
      const gap = 4;
      const viewportPadding = 8;
      const opensAbove = window.innerHeight - bounds.bottom < menuHeight + gap
        && bounds.top >= menuHeight + gap;
      setMenuPosition({
        left: Math.max(
          viewportPadding,
          Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - viewportPadding),
        ),
        top: opensAbove ? bounds.top - menuHeight - gap : bounds.bottom + gap,
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <div className="relative inline-flex">
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-label={`More actions for ${vehicle.vehicleNumber}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onToggle}
      >
        <span aria-hidden="true">⋯</span>
      </Button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${vehicle.vehicleNumber}`}
          className="fixed z-50 w-56 overflow-hidden rounded-atlas-control border border-atlas-border-strong bg-atlas-surface py-atlas-1 shadow-atlas-medium"
          style={menuPosition}
        >
          {/* ui-exception: Anchored menus require full-width, left-aligned menu items that the shared centered Button does not support. */}
          <button type="button" role="menuitem" className="flex min-h-atlas-12 w-full items-center px-atlas-3 py-atlas-2 text-left text-atlas-sm font-atlas-medium text-atlas-text transition-colors hover:bg-atlas-surface-hover focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-inset" onClick={() => onRequestAction(vehicle.deliveryWageTrackingEnabled ? "tracking_off" : "tracking_on")}>
            Turn wage tracking {vehicle.deliveryWageTrackingEnabled ? "OFF" : "ON"}
          </button>
          {/* ui-exception: Anchored menus require full-width, left-aligned menu items that the shared centered Button does not support. */}
          <button type="button" role="menuitem" className="flex min-h-atlas-12 w-full items-center border-t border-atlas-border px-atlas-3 py-atlas-2 text-left text-atlas-sm font-atlas-medium text-atlas-text-muted transition-colors hover:bg-atlas-surface-hover hover:text-atlas-text focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-inset" onClick={() => onRequestAction(vehicle.isActive ? "archive" : "restore")}>
            {vehicle.isActive ? "Archive vehicle" : "Restore vehicle"}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function VehicleActionConfirmation({
  vehicleNumber,
  action,
  error,
  submitting,
  onCancel,
  onConfirm,
}: Readonly<{
  vehicleNumber: string;
  action: VehicleRareAction;
  error: string;
  submitting: boolean;
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const isDanger = action === "tracking_off" || action === "archive";
  const title = action === "tracking_off"
    ? `Turn wage tracking OFF for ${vehicleNumber}?`
    : action === "tracking_on"
      ? `Turn wage tracking ON for ${vehicleNumber}?`
      : action === "archive"
        ? `Archive ${vehicleNumber}?`
        : `Restore ${vehicleNumber}?`;
  const body = action === "tracking_off"
    ? "Future trips will not earn delivery wages."
    : action === "tracking_on"
      ? "Future eligible trips can earn delivery wages."
      : action === "archive"
        ? "It will be removed from active vehicle selection."
        : "It will return to active vehicle selection.";
  const confirmLabel = action === "tracking_off"
    ? "Turn OFF"
    : action === "tracking_on"
      ? "Turn ON"
      : action === "archive"
        ? ATLAS_UI_STRINGS.actions.archive
        : ATLAS_UI_STRINGS.actions.restore;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-atlas-4">
      {/* ui-exception: A centered confirmation requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Cancel Vehicle action" disabled={submitting} className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onCancel} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="vehicle-action-confirmation-title"
        aria-describedby="vehicle-action-confirmation-description"
        className="relative w-full max-w-md rounded-atlas-dialog border border-atlas-border-strong bg-atlas-surface p-atlas-5 shadow-atlas-high"
      >
        <div className="flex items-start justify-between gap-atlas-3">
          <div className="min-w-0">
            <h2 id="vehicle-action-confirmation-title" className="text-atlas-lg font-atlas-semibold text-atlas-text">{title}</h2>
            <p id="vehicle-action-confirmation-description" className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">{body}</p>
          </div>
          <Button variant="ghost" aria-label="Close confirmation" disabled={submitting} onClick={onCancel}><span aria-hidden="true">×</span></Button>
        </div>
        {error && <div className="mt-atlas-4"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
        <div className="mt-atlas-5 flex flex-col gap-atlas-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={submitting} onClick={onCancel}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
          <Button
            ref={confirmButtonRef}
            variant={isDanger ? "danger" : "primary"}
            loading={submitting}
            loadingLabel="Updating..."
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

function WageTrackingState({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <p className="mt-atlas-1 flex items-center gap-atlas-2 text-atlas-xs text-atlas-text-muted">
      <span aria-hidden="true" className={enabled ? "h-atlas-2 w-atlas-2 rounded-atlas-pill bg-atlas-success" : "h-atlas-2 w-atlas-2 rounded-atlas-pill bg-atlas-text-disabled"} />
      Wage {enabled ? "ON" : "OFF"}
    </p>
  );
}

function TripEvidence({
  account,
  periodLabel,
  periodContext,
  tripEvidenceById,
  showAll,
  onToggleShowAll,
}: Readonly<{
  account: VehicleWageAccountSummary;
  periodLabel: string;
  periodContext: string;
  tripEvidenceById: ReadonlyMap<string, VehicleTrip>;
  showAll: boolean;
  onToggleShowAll: () => void;
}>) {
  const visibleTrips = showAll ? account.trips : account.trips.slice(0, 7);
  const remainingCount = Math.max(0, account.trips.length - 7);

  return (
    <section aria-label={`${account.vehicleNumber} Challan trip evidence`} className="overflow-hidden rounded-atlas-card border border-atlas-border bg-atlas-surface">
      <div className="flex flex-col gap-atlas-2 border-b border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-atlas-semibold text-atlas-text">{periodLabel}</p>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{periodContext} · Challan trip breakdown</p>
        </div>
        <p className="text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(account.qualifyingTripCount)} wage {account.qualifyingTripCount === 1 ? "trip" : "trips"} · {formatIndianCurrency(account.earnedAmount)} total</p>
      </div>
      <ul className="divide-y divide-atlas-border">
        {visibleTrips.map((trip) => {
          const evidence = tripEvidenceById.get(trip.challanId);
          const route = [evidence?.customerNameSnapshot, evidence?.destinationSnapshot]
            .filter((value): value is string => Boolean(value?.trim()))
            .join(" · ") || "Saved Challan";
          return (
            <li key={trip.challanId} className="flex flex-col gap-atlas-2 px-atlas-3 py-atlas-3 text-atlas-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 sm:flex sm:items-center sm:gap-atlas-4">
                <span className="whitespace-nowrap text-atlas-xs font-atlas-medium text-atlas-text-muted">{formatDateOnly(trip.challanDate)}</span>
                <span className="mt-atlas-1 block truncate font-atlas-medium text-atlas-text sm:mt-atlas-0">{route}</span>
              </div>
              <div className="flex flex-wrap items-center gap-atlas-4 sm:justify-end">
                <span className="text-atlas-text-muted">Trip wage <strong className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(trip.tripLabourWage)}</strong></span>
                <Link href={`/office/challans/${trip.challanId}`} target="_blank" rel="noreferrer" className="font-atlas-semibold text-atlas-primary hover:underline">
                  {formatChallanLabel(trip.challanNumber)} ↗
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-atlas-2 border-t border-atlas-border bg-atlas-surface-muted px-atlas-3 py-atlas-3 text-atlas-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-atlas-2">
          {remainingCount > 0 && (
            <Button variant="ghost" onClick={onToggleShowAll}>
              {showAll ? "Show latest 7 trips" : `Show remaining ${formatIndianNumber(remainingCount)} trips`}
            </Button>
          )}
          <span className="text-atlas-text-subtle">Trip wages are recorded on individual Challans and summed into period earnings.</span>
        </div>
        <p className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(account.qualifyingTripCount)} trips · Total wage {formatIndianCurrency(account.earnedAmount)}</p>
      </div>
    </section>
  );
}
