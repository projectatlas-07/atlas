"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { MudGroupAccountDrawer } from "@/features/office/components/mud-group-account-drawer";
import { MudGroupManagementDrawer } from "@/features/office/components/mud-group-management-drawer";
import { formatMudGroupLastPaid } from "@/features/office/mud-group-overview-model";
import { getLabourGroupAvailableBalance } from "@/features/wages/services/labour-group-available-balance-service";
import { getLabourGroupWithdrawalHistory } from "@/features/wages/services/labour-group-withdrawal-history-service";
import { getLabourGroups } from "@/features/wages/services/labour-group-read-service";
import {
  getMudAccountingMode,
  listMudGroupConfigurations,
  MudGroupConfigurationError,
  type MudGroupConfiguration,
} from "@/features/wages/services/mud-group-configuration-service";
import { getMudGroupRangeAllocation } from "@/features/wages/services/mud-multi-group-allocation-service";
import { executeMudSettlementCutover, getMudCutoverReadiness } from "@/features/wages/services/mud-cutover-readiness-service";
import { getMudShadowCertification } from "@/features/wages/services/mud-shadow-certification-service";
import {
  createMudSettlementWithdrawal,
  getDefaultMudSettlementCutoff,
  getMudSettlementAccount,
  MudSettlementAccountError,
} from "@/features/wages/services/mud-settlement-account-service";
import { getWageRatesForFactory } from "@/features/wages/services/wage-rate-read-service";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const rangePresets: Array<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom" },
];

export function MudGroupManagement({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const today = getLocalDate();
  const configurationsQuery = useQuery({
    queryKey: ["mud-group-configurations", factoryId, today],
    queryFn: () => listMudGroupConfigurations({ factoryId, asOfDate: today }),
  });
  const modeQuery = useQuery({
    queryKey: ["mud-accounting-mode", factoryId],
    queryFn: () => getMudAccountingMode(factoryId),
  });
  const certificationQuery = useQuery({
    queryKey: ["mud-shadow-certification", factoryId],
    queryFn: () => getMudShadowCertification(factoryId),
    enabled: modeQuery.data === "SHADOW",
  });
  const cutoverReadinessQuery = useQuery({
    queryKey: ["mud-cutover-readiness", factoryId],
    queryFn: () => getMudCutoverReadiness(factoryId),
    enabled: modeQuery.data === "SHADOW",
  });
  const legacyGroupsQuery = useQuery({
    queryKey: ["office-labour-groups", factoryId],
    queryFn: () => getLabourGroups(factoryId),
    enabled: modeQuery.isSuccess && modeQuery.data !== "SETTLEMENT",
  });
  const legacyRatesQuery = useQuery({
    queryKey: ["office-wage-rates", factoryId],
    queryFn: () => getWageRatesForFactory(factoryId),
    enabled: modeQuery.isSuccess && modeQuery.data !== "SETTLEMENT",
  });
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>(DEFAULT_WAGE_EARNINGS_DATE_PRESET);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<"all" | "earning" | "stopped">("all");
  const [showAdministration, setShowAdministration] = useState(false);
  const [showLegacyAccount, setShowLegacyAccount] = useState(false);
  const range = resolveWageEarningsDateRange(rangePreset, today, customFrom, customTo);
  const rangeQuery = useQuery({
    queryKey: ["mud-group-range-allocation", factoryId, range?.fromDate, range?.toDate],
    queryFn: () => getMudGroupRangeAllocation({ factoryId, range: range! }),
    enabled: range !== null,
    refetchInterval: 30_000,
  });

  async function refreshConfiguration() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mud-group-configurations", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-group-range-allocation", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-shadow-certification", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-cutover-readiness", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-labour-groups", factoryId] }),
    ]);
  }

  async function refreshAfterCutover() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mud-accounting-mode", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-group-configurations", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-settlement-account", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-shadow-certification", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["mud-cutover-readiness", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-labour-groups", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-wage-rates", factoryId] }),
    ]);
  }

  const configurations = configurationsQuery.data ?? [];
  const mode = modeQuery.data ?? configurations[0]?.accountingMode;
  const activeLegacyGroup = (legacyGroupsQuery.data ?? []).find((group) => group.isActive) ?? null;
  const legacyAuthorityEnabled = mode === "LEGACY_WEEKLY" || mode === "SHADOW";
  const legacyBalanceQuery = useQuery({
    queryKey: ["labour-group-available-balance", factoryId, activeLegacyGroup?.groupId, today],
    queryFn: () => getLabourGroupAvailableBalance({
      factoryId,
      labourGroupId: activeLegacyGroup!.groupId,
      asOfDate: today,
    }),
    enabled: legacyAuthorityEnabled && activeLegacyGroup !== null,
  });
  const legacyHistoryQuery = useQuery({
    queryKey: ["labour-group-withdrawal-history", factoryId, activeLegacyGroup?.groupId],
    queryFn: () => getLabourGroupWithdrawalHistory(factoryId, activeLegacyGroup!.groupId),
    enabled: legacyAuthorityEnabled && activeLegacyGroup !== null,
  });
  const normalizedSearch = groupSearch.trim().toLocaleLowerCase("en-IN");
  const visibleConfigurations = configurations.filter((group) => {
    if (groupFilter === "earning" && !group.isEarning) return false;
    if (groupFilter === "stopped" && group.isEarning) return false;
    return !normalizedSearch || group.name.toLocaleLowerCase("en-IN").includes(normalizedSearch);
  });
  const earningCount = configurations.filter((group) => group.isEarning).length;
  const latestLegacyPayment = legacyHistoryQuery.data?.[0] ?? null;

  function operationalAllocation(groupId: string) {
    return rangeQuery.data?.groups.find((row) => row.labourGroupId === groupId) ?? null;
  }

  function isAuthoritativeLegacyGroup(groupId: string) {
    return legacyAuthorityEnabled && activeLegacyGroup?.groupId === groupId;
  }

  function legacyBalanceLabel(groupId: string) {
    if (!isAuthoritativeLegacyGroup(groupId)) return "Not in weekly account";
    if (legacyBalanceQuery.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (legacyBalanceQuery.error || !legacyBalanceQuery.data) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatIndianCurrency(legacyBalanceQuery.data.availableBalance, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function lastPaidLabel(groupId: string) {
    if (!isAuthoritativeLegacyGroup(groupId)) return "No legacy account";
    if (legacyHistoryQuery.isLoading) return ATLAS_UI_STRINGS.feedback.loading;
    if (legacyHistoryQuery.error) return ATLAS_UI_STRINGS.feedback.unavailable;
    return formatMudGroupLastPaid(latestLegacyPayment?.withdrawalDate ?? null, today);
  }

  return (
    <section aria-labelledby="mud-supply-heading">
      <header className="flex flex-col gap-atlas-3 border-b border-atlas-border pb-atlas-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
            Group workforce · {formatDate(today)}
          </p>
          <h3 id="mud-supply-heading" className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">Mud Supply</h3>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
            {formatIndianNumber(earningCount)} earning · {formatIndianNumber(configurations.length - earningCount)} stopped
          </p>
        </div>
        <div className="flex max-w-xl flex-col items-start gap-atlas-3 sm:items-end">
          <p className="text-atlas-sm text-atlas-text-muted sm:text-right">
            Mud is managed and paid as a group. Production below is operational context, not payable earnings.
          </p>
          <Button variant="secondary" aria-expanded={showAdministration} onClick={() => setShowAdministration((current) => !current)}>
            Group setup
          </Button>
        </div>
      </header>

      <div className="mt-atlas-4 space-y-atlas-3">
        {modeQuery.error && <Feedback role="alert" tone="danger">Could not load Mud accounting mode.</Feedback>}
        {legacyGroupsQuery.error && <Feedback role="alert" tone="danger">Could not load the authoritative weekly Mud group account.</Feedback>}
        {mode === "SHADOW" && <Feedback role="status" tone="info">Legacy weekly accounting remains the authoritative source for Mud payable balances while shadow validation runs.</Feedback>}
        {legacyBalanceQuery.error && <Feedback role="alert" tone="danger">Could not load the authoritative legacy Mud balance.</Feedback>}
        {legacyHistoryQuery.error && <Feedback role="alert" tone="danger">Could not load real Mud payment history.</Feedback>}
      </div>

      <section aria-label="Mud operational period" className="mt-atlas-4 border-y border-atlas-border py-atlas-4">
        <div className="flex flex-col gap-atlas-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Operational production period</p>
            <div className="mt-atlas-2 flex gap-atlas-2 overflow-x-auto pb-atlas-1">
              {rangePresets.map((option) => <Button key={option.value} variant={rangePreset === option.value ? "primary" : "ghost"} aria-pressed={rangePreset === option.value} onClick={() => setRangePreset(option.value)}>{option.label}</Button>)}
            </div>
          </div>
          <div className="text-atlas-sm text-atlas-text-muted lg:text-right">
            {range && <p>{formatDate(range.fromDate)} → {formatDate(range.toDate)}</p>}
            {rangeQuery.data && <p className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{formatIndianNumber(rangeQuery.data.rangeProduction)} eligible bricks</p>}
          </div>
        </div>
        {rangePreset === "custom" && <div className="mt-atlas-4 grid max-w-xl gap-atlas-3 sm:grid-cols-2">
          <FormField label="From"><Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></FormField>
          <FormField label="To"><Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></FormField>
        </div>}
        {rangePreset === "custom" && !range && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Choose a valid inclusive date range.</Feedback></div>}
        {rangeQuery.isLoading && <p className="mt-atlas-3 text-atlas-sm text-atlas-text-muted">Loading operational allocation...</p>}
        {rangeQuery.error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{errorMessage(rangeQuery.error, "Could not calculate operational Mud allocation.")}</Feedback></div>}
      </section>

      <div className="mt-atlas-4 flex flex-col gap-atlas-3 lg:flex-row lg:items-end lg:justify-between">
        <div aria-label="Filter Mud groups" className="flex gap-atlas-2 overflow-x-auto pb-atlas-1">
          {([
            ["all", `All ${formatIndianNumber(configurations.length)}`],
            ["earning", `Earning ${formatIndianNumber(earningCount)}`],
            ["stopped", `Stopped ${formatIndianNumber(configurations.length - earningCount)}`],
          ] as const).map(([value, label]) => <Button key={value} variant={groupFilter === value ? "primary" : "ghost"} aria-pressed={groupFilter === value} onClick={() => setGroupFilter(value)}>{label}</Button>)}
        </div>
        <div className="w-full lg:max-w-sm">
          <FormField label="Search Mud groups"><Input type="search" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search group" autoComplete="off" /></FormField>
        </div>
      </div>

      {configurationsQuery.isLoading ? (
        <div className="mt-atlas-4"><Feedback role="status" tone="neutral">Loading Mud groups...</Feedback></div>
      ) : configurationsQuery.error ? (
        <div className="mt-atlas-4"><Feedback role="alert" tone="danger">{errorMessage(configurationsQuery.error, "Could not load Mud groups.")}</Feedback></div>
      ) : visibleConfigurations.length === 0 ? (
        <EmptyState title={configurations.length === 0 ? "No Mud groups yet" : "No groups match these filters"} description={configurations.length === 0 ? "Use Group setup to create the first Mud group." : "Clear the search or choose another earning filter."} />
      ) : <>
        <div className="mt-atlas-4 hidden md:block">
          <TableContainer>
            <Table wide>
              <TableCaption visuallyHidden>Mud Supply group overview for {formatDate(today)}</TableCaption>
              <TableHeader><TableRow>
                <TableHeaderCell>Mud group</TableHeaderCell>
                <TableHeaderCell numeric>Members</TableHeaderCell>
                <TableHeaderCell numeric>Operational rate</TableHeaderCell>
                <TableHeaderCell numeric>Production</TableHeaderCell>
                <TableHeaderCell numeric>Weekly balance</TableHeaderCell>
                <TableHeaderCell>Last paid</TableHeaderCell>
                <TableHeaderCell>Action</TableHeaderCell>
              </TableRow></TableHeader>
              <TableBody>{visibleConfigurations.map((group) => {
                const allocation = operationalAllocation(group.groupId);
                const isLegacyAccount = isAuthoritativeLegacyGroup(group.groupId);
                return <TableRow key={group.groupId} hoverable>
                  <TableCell><p className="font-atlas-semibold text-atlas-text">{group.name}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Operational allocation {group.isEarning ? "active" : "stopped"}</p></TableCell>
                  <TableCell numeric>{group.currentMemberCount === null ? "Not set" : formatIndianNumber(group.currentMemberCount)}</TableCell>
                  <TableCell numeric>{group.currentRatePer1000Bricks === null ? "Not set" : `${formatIndianCurrency(group.currentRatePer1000Bricks)} / 1,000`}</TableCell>
                  <TableCell numeric><p className="font-atlas-medium text-atlas-text">{rangeQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : rangeQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : allocation ? `${formatIndianNumber(allocation.allocatedProduction)} bricks` : "—"}</p><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Selected period</p></TableCell>
                  <TableCell numeric><p className={isLegacyAccount ? "font-atlas-semibold text-atlas-text" : "text-atlas-xs text-atlas-text-subtle"}>{legacyBalanceLabel(group.groupId)}</p>{isLegacyAccount && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Authoritative legacy weekly</p>}</TableCell>
                  <TableCell><p className="text-atlas-sm font-atlas-medium text-atlas-text-muted">{lastPaidLabel(group.groupId)}</p></TableCell>
                  <TableCell>{isLegacyAccount ? <Button aria-expanded={showLegacyAccount} onClick={() => setShowLegacyAccount(true)}>Account &amp; payment</Button> : <span className="text-atlas-xs text-atlas-text-subtle">Managed in Group setup</span>}</TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </TableContainer>
        </div>

        <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
          {visibleConfigurations.map((group) => {
            const allocation = operationalAllocation(group.groupId);
            const isLegacyAccount = isAuthoritativeLegacyGroup(group.groupId);
            return <article key={group.groupId} className="py-atlas-4">
              <div className="flex items-start justify-between gap-atlas-3"><div><h4 className="text-atlas-base font-atlas-semibold text-atlas-text">{group.name}</h4><p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Operational allocation {group.isEarning ? "active" : "stopped"}</p></div><p className="text-atlas-sm tabular-nums text-atlas-text-muted">{group.currentMemberCount === null ? "Members not set" : `${formatIndianNumber(group.currentMemberCount)} members`}</p></div>
              <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 text-atlas-sm">
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Operational rate</dt><dd className="mt-atlas-1 tabular-nums text-atlas-text-muted">{group.currentRatePer1000Bricks === null ? "Not set" : `${formatIndianCurrency(group.currentRatePer1000Bricks)} / 1,000`}</dd></div>
                <div><dt className="text-right text-atlas-xs text-atlas-text-subtle">Selected-period production</dt><dd className="mt-atlas-1 text-right font-atlas-medium tabular-nums text-atlas-text">{rangeQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : rangeQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : allocation ? `${formatIndianNumber(allocation.allocatedProduction)} bricks` : "—"}</dd></div>
                <div><dt className="text-atlas-xs text-atlas-text-subtle">Legacy weekly balance</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{legacyBalanceLabel(group.groupId)}</dd></div>
                <div><dt className="text-right text-atlas-xs text-atlas-text-subtle">{ATLAS_UI_STRINGS.payment.history}</dt><dd className="mt-atlas-1 text-right text-atlas-text-muted">{lastPaidLabel(group.groupId)}</dd></div>
              </dl>
              {isLegacyAccount && <div className="mt-atlas-3"><Button aria-expanded={showLegacyAccount} onClick={() => setShowLegacyAccount(true)}>Account &amp; payment</Button></div>}
            </article>;
          })}
        </div>
      </>}

      {showAdministration && <MudGroupManagementDrawer
        factoryId={factoryId}
        groups={configurations}
        groupsLoading={configurationsQuery.isLoading}
        groupsError={Boolean(configurationsQuery.error)}
        mode={mode}
        rangeAllocations={rangeQuery.data?.groups}
        rangeLoading={rangeQuery.isLoading}
        rangeError={Boolean(rangeQuery.error)}
        accountingDiagnostics={mode === "SHADOW" ? <>
          <MudShadowCertificationMessage loading={certificationQuery.isLoading} error={certificationQuery.error} certification={certificationQuery.data ?? null} />
          <MudCutoverReadinessMessage factoryId={factoryId} loading={cutoverReadinessQuery.isLoading} error={cutoverReadinessQuery.error} readiness={cutoverReadinessQuery.data ?? null} onCutover={refreshAfterCutover} />
        </> : undefined}
        onChanged={refreshConfiguration}
        onClose={() => setShowAdministration(false)}
      />}

      {mode === "SETTLEMENT" && <SettlementMudAccounting factoryId={factoryId} groups={configurations} />}
      {(mode === "LEGACY_WEEKLY" || mode === "SHADOW") && showLegacyAccount && activeLegacyGroup && <MudGroupAccountDrawer
        factoryId={factoryId}
        group={activeLegacyGroup}
        wageRates={legacyRatesQuery.data ?? []}
        ratesLoading={legacyRatesQuery.isLoading}
        ratesError={Boolean(legacyRatesQuery.error)}
        onClose={() => setShowLegacyAccount(false)}
      />}
    </section>
  );
}

function MudCutoverReadinessMessage({ factoryId, loading, error, readiness, onCutover }: Readonly<{
  factoryId: string;
  loading: boolean;
  error: Error | null;
  readiness: Awaited<ReturnType<typeof getMudCutoverReadiness>> | null;
  onCutover: () => Promise<void>;
}>) {
  const [confirming, setConfirming] = useState(false);
  const [confirmedPermanentChange, setConfirmedPermanentChange] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  if (loading) return <p className="mt-2 text-sm text-slate-600">Checking cutover readiness...</p>;
  if (error) return <p role="alert" className="mt-2 text-sm font-medium text-red-700">Could not load cutover readiness.</p>;
  if (!readiness) return null;

  const ready = readiness.status === "READY_FOR_CUTOVER";
  const proposedLegacyCutoff = readiness.proposedLegacyCutoff;
  const hasCompletePreview = ready && readiness.finalLegacyWeekStart && readiness.finalLegacyWeekEnd
    && proposedLegacyCutoff && readiness.settlementStartDate;

  async function confirmCutover() {
    if (!hasCompletePreview || !confirmedPermanentChange || submitting) return;
    setSubmitting(true); setFeedback("");
    try {
      await executeMudSettlementCutover({
        factoryId,
        proposedLegacyCutoff: proposedLegacyCutoff!,
      });
      await onCutover();
    } catch (cutoverError) {
      setFeedback(errorMessage(cutoverError, "Mud cutover could not be completed safely."));
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <div role="status" className={`mt-2 rounded-lg border px-3 py-2 text-sm ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <span className="font-bold">Cutover readiness: {ready ? "Ready" : "Blocked"}.</span>{" "}{readiness.reason}
      {hasCompletePreview && <span>{" "}Final legacy week: {formatDate(readiness.finalLegacyWeekStart!)}–{formatDate(readiness.finalLegacyWeekEnd!)}. Legacy cutoff: {formatDate(readiness.proposedLegacyCutoff!)}. Settlement accounting begins: {formatDate(readiness.settlementStartDate!)}.</span>}
      {ready && !hasCompletePreview && <span> Cutover preview is incomplete. Refresh before continuing.</span>}
    </div>
    {hasCompletePreview && <button type="button" onClick={() => { setConfirming(true); setConfirmedPermanentChange(false); setFeedback(""); }} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
      Switch to Settlement Accounting
    </button>}
    {confirming && hasCompletePreview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="mud-cutover-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 text-slate-950 shadow-2xl">
        <h3 id="mud-cutover-title" className="text-xl font-bold">Confirm Settlement Accounting cutover</h3>
        <p className="mt-2 text-sm text-slate-600">Review the database-authoritative cutover preview before continuing.</p>
        <dl className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Final legacy week</dt><dd className="mt-1 font-semibold">{formatDate(readiness.finalLegacyWeekStart!)}–{formatDate(readiness.finalLegacyWeekEnd!)}</dd></div>
          <div><dt className="text-slate-500">Legacy cutoff</dt><dd className="mt-1 font-semibold">{formatDate(readiness.proposedLegacyCutoff!)}</dd></div>
          <div><dt className="text-slate-500">Settlement begins</dt><dd className="mt-1 font-semibold">{formatDate(readiness.settlementStartDate!)}</dd></div>
        </dl>
        <h4 className="mt-5 font-bold">Legacy Opening preview</h4>
        <div className="mt-2 space-y-2">
          {readiness.groups.map((group) => <div key={group.labourGroupId} className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-4">
            <div><span className="text-slate-500">Group</span><p className="font-semibold">{group.groupName}</p></div>
            <div><span className="text-slate-500">Opening earned</span><p className="font-semibold tabular-nums">{formatCurrency(group.proposedOpeningAmount)}</p></div>
            <div><span className="text-slate-500">Already withdrawn</span><p className="font-semibold tabular-nums">{formatCurrency(group.existingWithdrawals)}</p></div>
            <div><span className="text-slate-500">Opening balance</span><p className="font-semibold tabular-nums">{formatCurrency(group.resultingBalance)}</p></div>
          </div>)}
        </div>
        <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">This permanently changes Mud’s financial authority from weekly legacy accounting to continuous settlement accounting. It cannot be reversed from Atlas.</p>
        <label className="mt-4 flex items-start gap-3 text-sm font-medium"><input type="checkbox" checked={confirmedPermanentChange} onChange={(event) => setConfirmedPermanentChange(event.target.checked)} disabled={submitting} className="mt-1" />I understand this permanent accounting change and want to continue.</label>
        {feedback && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{feedback}</p>}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setConfirming(false)} disabled={submitting} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-60">Cancel</button>
          <button type="button" onClick={() => void confirmCutover()} disabled={!confirmedPermanentChange || submitting} className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{submitting ? "Switching..." : "Confirm Permanent Cutover"}</button>
        </div>
      </section>
    </div>}
  </>;
}

function MudShadowCertificationMessage({ loading, error, certification }: Readonly<{
  loading: boolean;
  error: Error | null;
  certification: Awaited<ReturnType<typeof getMudShadowCertification>> | null;
}>) {
  if (loading) return <p className="mt-3 text-sm text-slate-600">Checking SHADOW certification...</p>;
  if (error) return <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load SHADOW certification.</p>;
  if (!certification) return null;

  const ready = certification.status === "READY";
  const tone = ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : certification.status === "WAITING_FOR_COMPLETED_WEEK" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900";
  return <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${tone}`}>
    <span className="font-bold">SHADOW certification: {ready ? "Ready" : "Not ready"}.</span>{" "}{certification.reason}
    {certification.certificationWeek && <span> Week of {formatDate(certification.certificationWeek)}.</span>}
  </div>;
}

function SettlementMudAccounting({ factoryId, groups }: Readonly<{
  factoryId: string;
  groups: readonly MudGroupConfiguration[];
}>) {
  return <section aria-label="Mud settlement financial accounting" className="mt-8 border-t-2 border-slate-300 pt-6">
    <h3 className="text-lg font-bold">Continuous Settlement Accounting</h3>
    <p className="mt-1 text-sm text-slate-600">Each group has its own balance. A withdrawal freezes every Mud group through one shared factory cutoff.</p>
    {groups.length === 0 && <p className="mt-4 text-sm text-slate-500">No Mud groups are configured.</p>}
    <div className="mt-4 space-y-4">
      {groups.map((group) => <SettlementMudGroupAccount key={group.groupId} factoryId={factoryId} group={group} />)}
    </div>
  </section>;
}

function SettlementMudGroupAccount({ factoryId, group }: Readonly<{
  factoryId: string;
  group: MudGroupConfiguration;
}>) {
  const queryClient = useQueryClient();
  const today = getLocalDate();
  const accountQuery = useQuery({
    queryKey: ["mud-settlement-account", factoryId, group.groupId, today],
    queryFn: () => getMudSettlementAccount({ factoryId, labourGroupId: group.groupId, asOfDate: today }),
  });
  const [withdrawalDate, setWithdrawalDate] = useState(today);
  const [settlementCutoff, setSettlementCutoff] = useState(() => getDefaultMudSettlementCutoff(today, ""));
  const [amount, setAmount] = useState("");
  const [withdrawalId, setWithdrawalId] = useState(() => crypto.randomUUID());
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setFeedback("");
    try {
      const result = await createMudSettlementWithdrawal({
        factoryId,
        withdrawalId,
        labourGroupId: group.groupId,
        withdrawalDate,
        settlementCutoff,
        amount: Number(amount),
      });
      setAmount("");
      setWithdrawalId(crypto.randomUUID());
      setFeedback(`Withdrawal recorded. Mud is settled through ${formatDate(result.settledThrough)}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mud-settlement-account", factoryId] }),
        queryClient.invalidateQueries({ queryKey: ["mud-group-range-allocation", factoryId] }),
      ]);
    } catch (error) {
      setFeedback(errorMessage(error, "Could not record Mud settlement withdrawal."));
    } finally {
      setSubmitting(false);
    }
  }

  const account = accountQuery.data;
  return <article className="rounded-lg border border-slate-200 p-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <h4 className="font-bold">{group.name}</h4>
      <p className="text-sm text-slate-600">Latest settlement cutoff: <span className="font-semibold text-slate-900">{account ? formatDate(account.latestSettlementCutoff) : "Loading..."}</span></p>
    </div>
    {accountQuery.isLoading && <p className="mt-3 text-sm text-slate-500">Loading Mud account...</p>}
    {accountQuery.error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{errorMessage(accountQuery.error, "Could not load Mud settlement account.")}</p>}
    {account && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Settled Earned" value={formatCurrency(account.settledEarned)} />
      <Metric label="Live Earned after cutoff" value={formatCurrency(account.liveEarned)} />
      <Metric label="Withdrawn" value={formatCurrency(account.totalWithdrawn)} />
      <Metric label="Available Balance" value={formatCurrency(account.availableBalance)} />
    </div>}
    <details className="mt-4 rounded-lg border border-slate-200 p-4">
      <summary className="cursor-pointer font-semibold">Withdraw</summary>
      <p className="mt-2 text-sm text-slate-600">This withdrawal settles and freezes Production, Mud group membership, and Mud rates for all Mud groups through the selected date.</p>
      <form className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end" onSubmit={(event) => void submit(event)}>
        <Field label="Amount"><input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setFeedback(""); }} required disabled={submitting} className={inputClass} /></Field>
        <Field label="Withdrawal date"><input type="date" value={withdrawalDate} onChange={(event) => { const nextDate = event.target.value; setWithdrawalDate(nextDate); setSettlementCutoff(getDefaultMudSettlementCutoff(nextDate, account?.latestSettlementCutoff ?? "")); setFeedback(""); }} required disabled={submitting} className={inputClass} /></Field>
        <Field label="Settle Production through"><input type="date" value={settlementCutoff} onChange={(event) => { setSettlementCutoff(event.target.value); setFeedback(""); }} required disabled={submitting} className={inputClass} /></Field>
        <button disabled={submitting || !account} className="h-11 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:opacity-60 sm:col-span-3">{submitting ? "Recording..." : "Record Settlement Withdrawal"}</button>
      </form>
      <p className="mt-2 text-xs text-slate-500">The default settlement cutoff is the day before the withdrawal date. All Mud groups move to the same cutoff.</p>
      {feedback && <p role="status" className={`mt-3 text-sm font-medium ${feedback.startsWith("Withdrawal recorded") ? "text-emerald-700" : "text-red-700"}`}>{feedback}</p>}
    </details>
  </article>;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) { return <label className="block flex-1 text-sm font-medium text-slate-700">{label}{children}</label>; }
function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold tabular-nums">{value}</p></div>; }
function errorMessage(error: unknown, fallback: string) { return error instanceof MudGroupConfigurationError || error instanceof MudSettlementAccountError || error instanceof Error ? error.message : fallback; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`)); }
function formatCurrency(value: number) { return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
const inputClass = "mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:bg-slate-100";
