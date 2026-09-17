"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assertCompletedWageWeek } from "@/features/wages/services/completed-wage-week-validation";
import { getLabourGroupAvailableBalance } from "@/features/wages/services/labour-group-available-balance-service";
import { CreateLabourGroupWithdrawalError, createLabourGroupWithdrawal } from "@/features/wages/services/labour-group-withdrawal-create-service";
import { getLabourGroupWithdrawalHistory } from "@/features/wages/services/labour-group-withdrawal-history-service";
import { getLabourGroups, type LabourGroup } from "@/features/wages/services/labour-group-read-service";
import {
  createMudGroup,
  editMudGroupMembers,
  getMudAccountingMode,
  listMudGroupConfigurations,
  MudGroupConfigurationError,
  restartMudGroupEarning,
  setMudGroupRate,
  stopMudGroupEarning,
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
import { calculateInformationalPerMemberShare } from "@/features/wages/services/mud-supply-wage-calculation";
import { CalculateMudSupplyWagesError, calculateMudSupplyWages } from "@/features/wages/services/mud-supply-wage-calculation-service";
import { SetMudSupplyRateError, setMudSupplyRate } from "@/features/wages/services/mud-supply-rate-service";
import { getMudSupplyWeeklyEarning, type MudSupplyWeeklyEarning } from "@/features/wages/services/mud-supply-weekly-earning-read-service";
import { getWageRatesForFactory } from "@/features/wages/services/wage-rate-read-service";
import type { WageRateHistory } from "@/features/wages/services/wage-rate-service";
import {
  DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  resolveWageEarningsDateRange,
  type WageEarningsDatePreset,
} from "@/features/wages/wage-earnings-date-range";
import { getLocalDate } from "@/lib/local-date";

const rangePresets: Array<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
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

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Mud Supply Groups</h2>
          <p className="mt-1 text-sm text-slate-600">Configure each earning group independently. Live figures below are operational only.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Financial accounting: </span>
          <span className="font-bold text-slate-900">{mode === "LEGACY_WEEKLY" ? "Legacy Weekly" : mode === "SETTLEMENT" ? "Continuous Settlement" : mode ?? "Loading..."}</span>
        </div>
      </div>

      {modeQuery.error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load Mud accounting mode.</p>}
      {mode === "SHADOW" && <MudShadowCertificationMessage
        loading={certificationQuery.isLoading}
        error={certificationQuery.error}
        certification={certificationQuery.data ?? null}
      />}
      {mode === "SHADOW" && <MudCutoverReadinessMessage
        factoryId={factoryId}
        loading={cutoverReadinessQuery.isLoading}
        error={cutoverReadinessQuery.error}
        readiness={cutoverReadinessQuery.data ?? null}
        onCutover={refreshAfterCutover}
      />}
      <AddMudGroupForm factoryId={factoryId} onChanged={refreshConfiguration} />

      <section aria-label="Live multi-group Mud range" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium text-amber-900">Live operational period</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {rangePresets.map((option) => <button key={option.value} type="button" aria-pressed={rangePreset === option.value} onClick={() => setRangePreset(option.value)} className={`h-9 rounded-lg border px-3 text-sm font-semibold ${rangePreset === option.value ? "border-amber-700 bg-amber-700 text-white" : "border-amber-300 bg-white text-slate-700"}`}>{option.label}</button>)}
            </div>
          </div>
          {range && <p className="text-xs text-amber-900">{formatDate(range.fromDate)} → {formatDate(range.toDate)}, inclusive</p>}
        </div>
        {rangePreset === "custom" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-amber-900">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-950" /></label>
          <label className="text-xs font-medium text-amber-900">To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-950" /></label>
        </div>}
        {rangePreset === "custom" && !range && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Choose a valid inclusive date range.</p>}
        {rangeQuery.isLoading && <p className="mt-3 text-sm text-slate-600">Calculating live Mud allocation...</p>}
        {rangeQuery.error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{errorMessage(rangeQuery.error, "Could not calculate live Mud allocation.")}</p>}
        {rangeQuery.data && <div className="mt-4 rounded-lg bg-white p-4"><p className="text-sm text-slate-600">Total eligible Production</p><p className="mt-1 text-xl font-bold tabular-nums">{formatNumber(rangeQuery.data.rangeProduction)}</p></div>}
        <p className="mt-3 text-xs text-amber-900">Operational calculation only. It does not create weekly earnings, withdrawals, balances, or settlements.</p>
      </section>

      {configurationsQuery.isLoading && <p className="mt-5 text-sm text-slate-500">Loading Mud groups...</p>}
      {configurationsQuery.error && <p role="alert" className="mt-5 text-sm font-medium text-red-700">{errorMessage(configurationsQuery.error, "Could not load Mud groups.")}</p>}
      {!configurationsQuery.isLoading && !configurationsQuery.error && configurations.length === 0 && <p className="mt-5 text-sm text-slate-500">No Mud groups configured.</p>}
      <div className="mt-5 space-y-4">
        {configurations.map((group) => <MudGroupCard
          key={group.groupId}
          factoryId={factoryId}
          group={group}
          rangeAllocation={rangeQuery.data?.groups.find((row) => row.labourGroupId === group.groupId) ?? null}
          onChanged={refreshConfiguration}
        />)}
      </div>

      {mode === "SETTLEMENT" && <SettlementMudAccounting factoryId={factoryId} groups={configurations} />}
      {(mode === "LEGACY_WEEKLY" || mode === "SHADOW") && <LegacyMudAccounting
        factoryId={factoryId}
        groups={legacyGroupsQuery.data ?? []}
        groupsLoading={legacyGroupsQuery.isLoading}
        groupsError={Boolean(legacyGroupsQuery.error)}
        wageRates={legacyRatesQuery.data ?? []}
        ratesLoading={legacyRatesQuery.isLoading}
        ratesError={Boolean(legacyRatesQuery.error)}
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

function AddMudGroupForm({ factoryId, onChanged }: Readonly<{ factoryId: string; onChanged: () => Promise<void> }>) {
  const today = getLocalDate();
  const [name, setName] = useState("");
  const [memberCount, setMemberCount] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState(today);
  const [feedback, setFeedback] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setFeedback(""); setSaved(false);
    try {
      await createMudGroup({ factoryId, name, memberCount: Number(memberCount), earningStartDate: startDate, initialRate: Number(rate), rateEffectiveDate: rateDate });
      setName(""); setMemberCount(""); setRate(""); setStartDate(today); setRateDate(today); setSaved(true);
      await onChanged();
    } catch (error) { setFeedback(errorMessage(error, "Could not add Mud group.")); }
    finally { setSubmitting(false); }
  }

  return <details className="mt-5 rounded-lg border border-slate-200 p-4">
    <summary className="cursor-pointer font-semibold">Add Mud Group</summary>
    <form className="mt-4 grid gap-4 md:grid-cols-5 md:items-end" onSubmit={(event) => void submit(event)}>
      <Field label="Group name"><input value={name} onChange={(event) => setName(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <Field label="Members"><input type="number" min="1" step="1" value={memberCount} onChange={(event) => setMemberCount(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <Field label="Earning starts"><input type="date" value={startDate} onChange={(event) => { const previous = startDate; setStartDate(event.target.value); if (rateDate === previous) setRateDate(event.target.value); }} required disabled={submitting} className={inputClass} /></Field>
      <Field label="Initial rate / 1,000"><input type="number" min="0" step="any" value={rate} onChange={(event) => setRate(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <Field label="Rate effective"><input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <button type="submit" disabled={submitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:opacity-60 md:col-span-5">{submitting ? "Adding..." : "Add Mud Group"}</button>
      {feedback && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-5">{feedback}</p>}
      {saved && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-5">Mud group added.</p>}
    </form>
  </details>;
}

function MudGroupCard({ factoryId, group, rangeAllocation, onChanged }: Readonly<{
  factoryId: string;
  group: MudGroupConfiguration;
  rangeAllocation: { allocatedProduction: number; earnedAmount: number; informationalPerMemberEarned: number } | null;
  onChanged: () => Promise<void>;
}>) {
  const today = getLocalDate();
  const [members, setMembers] = useState(String(group.currentMemberCount ?? ""));
  const [memberDate, setMemberDate] = useState(today);
  const [rate, setRate] = useState(String(group.currentRatePer1000Bricks ?? ""));
  const [rateDate, setRateDate] = useState(today);
  const [statusDate, setStatusDate] = useState(today);
  const [restartMembers, setRestartMembers] = useState(String(group.currentMemberCount ?? ""));
  const [feedback, setFeedback] = useState("");
  const [working, setWorking] = useState(false);

  async function mutate(action: () => Promise<unknown>, success: string) {
    if (working) return;
    setWorking(true); setFeedback("");
    try { await action(); setFeedback(success); await onChanged(); }
    catch (error) { setFeedback(errorMessage(error, "Could not update Mud group.")); }
    finally { setWorking(false); }
  }

  return <article className="rounded-lg border border-slate-200 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="font-bold">{group.name}</h3>
        <p className={`mt-1 text-sm font-semibold ${group.isEarning ? "text-emerald-700" : "text-slate-500"}`}>{group.isEarning ? "Earning" : "Stopped"}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
        <div><dt className="text-slate-500">Current members</dt><dd className="font-semibold tabular-nums">{group.currentMemberCount ?? "Missing"}</dd></div>
        <div><dt className="text-slate-500">Current rate / 1,000</dt><dd className="font-semibold tabular-nums">{group.currentRatePer1000Bricks === null ? "Missing" : formatCurrency(group.currentRatePer1000Bricks)}</dd></div>
      </dl>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Metric label="Allocated Production" value={rangeAllocation ? formatNumber(rangeAllocation.allocatedProduction) : "—"} />
      <Metric label="Live Mud earning" value={rangeAllocation ? formatCurrency(rangeAllocation.earnedAmount) : "—"} />
      <Metric label="Per-member share (informational)" value={rangeAllocation ? formatCurrency(rangeAllocation.informationalPerMemberEarned) : "—"} />
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className={`cursor-pointer font-semibold ${!group.isEarning ? "text-slate-400" : ""}`}>Edit Members</summary>
        {group.isEarning ? <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void mutate(() => editMudGroupMembers({ factoryId, groupId: group.groupId, memberCount: Number(members), effectiveFrom: memberDate }), "Member count saved."); }}>
          <Field label="Members"><input type="number" min="1" step="1" value={members} onChange={(event) => setMembers(event.target.value)} required disabled={working} className={inputClass} /></Field>
          <Field label="Effective from"><input type="date" value={memberDate} onChange={(event) => setMemberDate(event.target.value)} required disabled={working} className={inputClass} /></Field>
          <button disabled={working} className={smallButton}>Save Members</button>
        </form> : <p className="mt-2 text-sm text-slate-500">Restart the group with its new member count.</p>}
      </details>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold">Set Rate</summary>
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void mutate(() => setMudGroupRate({ factoryId, groupId: group.groupId, ratePer1000Bricks: Number(rate), effectiveFrom: rateDate }), "Group rate saved."); }}>
          <Field label="Rate / 1,000"><input type="number" min="0" step="any" value={rate} onChange={(event) => setRate(event.target.value)} required disabled={working} className={inputClass} /></Field>
          <Field label="Effective from"><input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required disabled={working} className={inputClass} /></Field>
          <button disabled={working} className={smallButton}>Save Rate</button>
        </form>
      </details>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold">{group.isEarning ? "Stop Earning" : "Restart Earning"}</summary>
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void mutate(
          () => group.isEarning
            ? stopMudGroupEarning({ factoryId, groupId: group.groupId, stopDate: statusDate })
            : restartMudGroupEarning({ factoryId, groupId: group.groupId, memberCount: Number(restartMembers), restartDate: statusDate }),
          group.isEarning ? "Group earning stopped." : "Group earning restarted.",
        ); }}>
          {!group.isEarning && <Field label="Members"><input type="number" min="1" step="1" value={restartMembers} onChange={(event) => setRestartMembers(event.target.value)} required disabled={working} className={inputClass} /></Field>}
          <Field label={group.isEarning ? "First non-earning date" : "Restart date"}><input type="date" value={statusDate} onChange={(event) => setStatusDate(event.target.value)} required disabled={working} className={inputClass} /></Field>
          <button disabled={working} className={smallButton}>{group.isEarning ? "Stop Earning" : "Restart Earning"}</button>
        </form>
      </details>
    </div>
    {feedback && <p role="status" className={`mt-3 text-sm font-medium ${feedback.toLowerCase().includes("could not") || feedback.toLowerCase().includes("must") || feedback.toLowerCase().includes("cannot") || feedback.toLowerCase().includes("already") ? "text-red-700" : "text-emerald-700"}`}>{feedback}</p>}
  </article>;
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

function LegacyMudAccounting({ factoryId, groups, groupsLoading, groupsError, wageRates, ratesLoading, ratesError }: Readonly<{
  factoryId: string; groups: readonly LabourGroup[]; groupsLoading: boolean; groupsError: boolean;
  wageRates: readonly WageRateHistory[]; ratesLoading: boolean; ratesError: boolean;
}>) {
  const queryClient = useQueryClient();
  const activeGroup = groups.find((group) => group.isActive) ?? null;
  const [weekStart, setWeekStart] = useState("");
  const [feedback, setFeedback] = useState("");
  const [earning, setEarning] = useState<MudSupplyWeeklyEarning | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !activeGroup) return;
    try { assertCompletedWageWeek(weekStart, getLocalDate()); }
    catch (error) { setFeedback(errorMessage(error, "Choose a completed Monday–Sunday week.")); return; }
    setSubmitting(true); setFeedback(""); setEarning(null);
    try {
      const result = await calculateMudSupplyWages({ factoryId, labourGroupId: activeGroup.groupId, weekStart });
      setEarning(await getMudSupplyWeeklyEarning({ factoryId, weeklyEarningId: result.weeklyEarningId, weekStart }));
      setFeedback(result.groupsCalculated === 1 ? "Legacy weekly Mud earning calculated and locked." : "Legacy weekly Mud earning was already locked.");
      await queryClient.invalidateQueries({ queryKey: ["mud-shadow-certification", factoryId] });
      await queryClient.invalidateQueries({ queryKey: ["mud-cutover-readiness", factoryId] });
    } catch (error) { setFeedback(errorMessage(error, "Could not calculate legacy weekly Mud wage.")); }
    finally { setSubmitting(false); }
  }

  const earningGroup = earning ? groups.find((group) => group.groupId === earning.labourGroupId) : undefined;
  const perMember = earning && earningGroup?.memberCount ? calculateInformationalPerMemberShare(earning.amount, earningGroup.memberCount) : null;

  return <section aria-label="Legacy weekly Mud financial accounting" className="mt-8 border-t-2 border-slate-300 pt-6">
    <h3 className="text-lg font-bold">Legacy Weekly Financial Accounting</h3>
    <p className="mt-1 text-sm text-slate-600">This remains the only financial authority. New live group figures above do not affect it.</p>
    <LegacyMudRateControl factoryId={factoryId} wageRates={wageRates} loading={ratesLoading} failed={ratesError} />
    <h4 className="mt-6 font-semibold">Calculate Mud-Supply Wage</h4>
    {groupsLoading && <p className="mt-2 text-sm text-slate-500">Loading legacy weekly group...</p>}
    {groupsError && <p className="mt-2 text-sm text-red-700">Legacy weekly group could not be loaded.</p>}
    {!groupsLoading && !groupsError && !activeGroup && <p className="mt-2 text-sm text-slate-500">No legacy weekly group is active.</p>}
    {activeGroup && <p className="mt-2 text-sm text-slate-600">Legacy weekly group: <span className="font-semibold text-slate-900">{activeGroup.name}</span></p>}
    <form className="mt-4 flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end" onSubmit={(event) => void submit(event)}>
      <Field label="Week start"><input type="date" value={weekStart} onChange={(event) => { setWeekStart(event.target.value); setFeedback(""); setEarning(null); }} required disabled={submitting} className={inputClass} /></Field>
      <button type="submit" disabled={submitting || groupsLoading || groupsError || !activeGroup} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:opacity-60">{submitting ? "Calculating..." : "Calculate Mud Wage"}</button>
    </form>
    {feedback && <p role="status" className="mt-3 text-sm font-medium text-slate-700">{feedback}</p>}
    {earning && <dl className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-3">
      <div><dt className="text-slate-500">Locked quantity</dt><dd className="font-semibold">{formatNumber(earning.quantityUsed)}</dd></div>
      <div><dt className="text-slate-500">Locked earning</dt><dd className="font-semibold">{formatCurrency(earning.amount)}</dd></div>
      <div><dt className="text-slate-500">Legacy per-member share</dt><dd className="font-semibold">{perMember === null ? "Unavailable" : formatCurrency(perMember)}</dd></div>
    </dl>}
    {activeGroup && <LegacyGroupWithdrawalPanel factoryId={factoryId} labourGroup={activeGroup} />}
  </section>;
}

function LegacyMudRateControl({ factoryId, wageRates, loading, failed }: Readonly<{ factoryId: string; wageRates: readonly WageRateHistory[]; loading: boolean; failed: boolean }>) {
  const queryClient = useQueryClient();
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(getLocalDate());
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mudRates = wageRates.filter((item) => item.applies_to === "mud_supply");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback("");
    try { await setMudSupplyRate({ factoryId, ratePer1000Bricks: Number(rate), effectiveFrom }); setRate(""); setFeedback("Legacy financial Mud rate saved."); await queryClient.invalidateQueries({ queryKey: ["office-wage-rates", factoryId] }); }
    catch (error) { setFeedback(errorMessage(error, "Could not set the legacy Mud rate.")); }
    finally { setSubmitting(false); }
  }
  return <details className="mt-4 rounded-lg border border-slate-200 p-4">
    <summary className="cursor-pointer font-semibold">Legacy Financial Rate</summary>
    <form className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end" onSubmit={(event) => void submit(event)}>
      <Field label="Rate / 1,000"><input type="number" min="0" step="any" value={rate} onChange={(event) => setRate(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <Field label="Effective from"><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <button disabled={submitting} className="h-11 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-60">Save Legacy Rate</button>
    </form>
    {feedback && <p className="mt-3 text-sm font-medium text-slate-700">{feedback}</p>}
    {loading && <p className="mt-3 text-sm text-slate-500">Loading legacy rates...</p>}
    {failed && <p className="mt-3 text-sm text-red-700">Legacy rates unavailable.</p>}
    {!loading && !failed && <p className="mt-3 text-sm text-slate-600">{mudRates.length} legacy rate period{mudRates.length === 1 ? "" : "s"} recorded.</p>}
  </details>;
}

function LegacyGroupWithdrawalPanel({ factoryId, labourGroup }: Readonly<{ factoryId: string; labourGroup: LabourGroup }>) {
  const queryClient = useQueryClient();
  const asOfDate = getLocalDate();
  const balanceQuery = useQuery({ queryKey: ["labour-group-available-balance", factoryId, labourGroup.groupId, asOfDate], queryFn: () => getLabourGroupAvailableBalance({ factoryId, labourGroupId: labourGroup.groupId, asOfDate }) });
  const historyQuery = useQuery({ queryKey: ["labour-group-withdrawal-history", factoryId, labourGroup.groupId], queryFn: () => getLabourGroupWithdrawalHistory(factoryId, labourGroup.groupId) });
  const [date, setDate] = useState(asOfDate);
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback("");
    try {
      await createLabourGroupWithdrawal({ factoryId, labourGroupId: labourGroup.groupId, withdrawalDate: date, amount: Number(amount) });
      setAmount(""); setFeedback("Legacy group withdrawal recorded.");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["labour-group-available-balance", factoryId, labourGroup.groupId] }), queryClient.invalidateQueries({ queryKey: ["labour-group-withdrawal-history", factoryId, labourGroup.groupId] })]);
    } catch (error) { setFeedback(errorMessage(error, "Could not record legacy group withdrawal.")); }
    finally { setSubmitting(false); }
  }
  return <section className="mt-6 border-t border-slate-200 pt-5">
    <h4 className="font-semibold">Legacy Group Balance &amp; Withdrawals</h4>
    {balanceQuery.data && <div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="Available Balance" value={formatCurrency(balanceQuery.data.availableBalance)} /><Metric label="Total Earned" value={formatCurrency(balanceQuery.data.totalEarned)} /><Metric label="Total Withdrawn" value={formatCurrency(balanceQuery.data.totalWithdrawn)} /></div>}
    {balanceQuery.error && <p className="mt-3 text-sm text-red-700">{errorMessage(balanceQuery.error, "Could not load legacy balance.")}</p>}
    <form className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end" onSubmit={(event) => void submit(event)}>
      <Field label="Withdrawal date"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <Field label="Amount"><input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={submitting} className={inputClass} /></Field>
      <button disabled={submitting} className="h-11 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:opacity-60">Record Group Withdrawal</button>
    </form>
    {feedback && <p className="mt-3 text-sm font-medium text-slate-700">{feedback}</p>}
    <h5 className="mt-5 font-semibold">Withdrawal History</h5>
    {historyQuery.isLoading && <p className="mt-2 text-sm text-slate-500">Loading withdrawals...</p>}
    {historyQuery.error && <p className="mt-2 text-sm text-red-700">{errorMessage(historyQuery.error, "Could not load withdrawal history.")}</p>}
    {historyQuery.data?.length === 0 && <p className="mt-2 text-sm text-slate-500">No withdrawals recorded.</p>}
    {historyQuery.data && historyQuery.data.length > 0 && <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">{historyQuery.data.map((withdrawal) => <li key={withdrawal.withdrawalId} className="flex justify-between px-4 py-3 text-sm"><span>{formatDate(withdrawal.withdrawalDate)}</span><span className="font-semibold">{formatCurrency(withdrawal.amount)}</span></li>)}</ul>}
  </section>;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) { return <label className="block flex-1 text-sm font-medium text-slate-700">{label}{children}</label>; }
function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold tabular-nums">{value}</p></div>; }
function errorMessage(error: unknown, fallback: string) { return error instanceof MudGroupConfigurationError || error instanceof MudSettlementAccountError || error instanceof CalculateMudSupplyWagesError || error instanceof SetMudSupplyRateError || error instanceof CreateLabourGroupWithdrawalError || error instanceof Error ? error.message : fallback; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`)); }
function formatNumber(value: number) { return value.toLocaleString("en-IN", { maximumFractionDigits: 20 }); }
function formatCurrency(value: number) { return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
const inputClass = "mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:bg-slate-100";
const smallButton = "h-10 w-full rounded-lg border border-slate-300 px-3 font-semibold disabled:opacity-60";
