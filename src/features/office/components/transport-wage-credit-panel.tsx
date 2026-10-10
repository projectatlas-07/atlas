"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Checkbox, Input, Textarea } from "@/components/ui/form-controls";
import { getFactoryPrintableProfile } from "@/features/sales/services/challan-service";
import { createTransportWageCredit, findTransportWageCredit, listTransportWageCredits } from "@/features/transport/services/transport-wage-credit-service";
import { browserCreditStorage, createCreditWorkflow, creditSavedConfirmation, normalizeCreditAmount, type CreditOutcome } from "@/features/transport/transport-wage-credit-model";
import type { TransportWorker } from "@/features/transport/types";
import { bindTransportCreditGate, createTransportCreditGateOwner, deactivateTransportCreditGateOwner, ownsTransportCreditGate, creditHistoryKey, transportCreditHistoryOptions, isTransportCreditHistoryCurrent, markTransportCreditPending, refreshTransportCreditQueries, type TransportCreditGateOwner, type TransportCreditRecovery } from "@/features/office/transport-wage-credit-office-model";
import { formatDateOnly, formatIndianCurrency } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

const S = ATLAS_UI_STRINGS.transportCredit;

export function TransportWageCreditPanel({ factoryId, worker, recovery }: Readonly<{ factoryId: string; worker: TransportWorker; recovery: TransportCreditRecovery }>) {
  const actorId = recovery.factoryId === factoryId ? recovery.actorId : null;
  return actorId ? <CreditAccount key={`${actorId}:${factoryId}:${worker.id}`} actorId={actorId} factoryId={factoryId} worker={worker} recovery={recovery} />
    : <Feedback role="status" tone="neutral">{S.unauthorized}</Feedback>;
}

function CreditAccount({ actorId, factoryId, worker, recovery }: Readonly<{ actorId: string; factoryId: string; worker: TransportWorker; recovery: TransportCreditRecovery }>) {
  const client = useQueryClient();
  const [setup, setSetup] = useState<{ workflow: ReturnType<typeof createCreditWorkflow> | null; owner: TransportCreditGateOwner | null }>({ workflow: null, owner: null });
  const workflow = setup.workflow;
  const owner = setup.owner;
  const [form, setForm] = useState({ originalWorkDate: getLocalDate(), amount: "", reason: "" });
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CreditOutcome | null>(null);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState(workflow?.intent ?? null);
  const mounted = useRef(false);
  const preparation = useRef<AbortController | null>(null);
  const completedId = useRef<string | null>(null);
  const factory = useQuery({ queryKey: ["office-factory-profile", factoryId], queryFn: () => getFactoryPrintableProfile(factoryId) });
  const history = useQuery(transportCreditHistoryOptions(recovery, factoryId, listTransportWageCredits, worker.id));

  useEffect(() => {
    // An effect activation owns a distinct lease. StrictMode cleanup cannot
    // revive generation 1's callbacks when generation 2 mounts.
    const activeOwner = createTransportCreditGateOwner(recovery.context, worker.id);
    mounted.current = true;
    preparation.current = new AbortController();
    const abort = preparation.current;
    let unsubscribe = () => {};
    try {
      if (!ownsTransportCreditGate(activeOwner) || recovery.context.actorId !== actorId) throw new Error("Obsolete account");
      const assertActive = () => { if (!ownsTransportCreditGate(activeOwner)) throw new Error(S.outdated); };
      const activeWorkflow = createCreditWorkflow({ actorId, factoryId, workerId: worker.id }, browserCreditStorage(), bindTransportCreditGate(activeOwner, {
        create: (value) => createTransportWageCredit(value, assertActive),
        lookup: (value) => findTransportWageCredit(value, assertActive),
      }));
      setSetup({ workflow: activeWorkflow, owner: activeOwner });
      setIntent(activeWorkflow.intent); setOutcome(null); setError("");
      unsubscribe = activeWorkflow.subscribe((result) => {
      if (!ownsTransportCreditGate(activeOwner)) return;
      setOutcome(result); setIntent(activeWorkflow.intent);
      if (result?.status === "saved" && completedId.current !== result.credit.id) {
        completedId.current = result.credit.id;
        setForm({ originalWorkDate: getLocalDate(), amount: "", reason: "" }); setReview(false); setConfirmed(false);
      }
      });
    } catch { setSetup({ workflow: null, owner: activeOwner }); setError(S.storage); }
    return () => { deactivateTransportCreditGateOwner(activeOwner); mounted.current = false; abort.abort(); unsubscribe(); };
  }, [client, actorId, factoryId, worker.id, recovery.context]);

  useEffect(() => {
    if (!recovery.ready || !workflow || !owner || !ownsTransportCreditGate(owner)) return;
    if (workflow.preparing || (!workflow.intent && !recovery.intentIds[worker.id])) return;
    const id = recovery.intentIds[worker.id] ?? workflow.intent?.id;
    if (id) markTransportCreditPending(owner, id);
    let alive = true;
    setBusy(true);
    void workflow.reconcile().then(() => {
      if (alive && ownsTransportCreditGate(owner)) { setIntent(workflow.intent); setBusy(false); }
    });
    return () => { alive = false; };
  }, [workflow, owner, actorId, factoryId, worker.id, recovery.ready, recovery.revision, recovery.intentIds]);

  async function run(readOnly: boolean) {
    if (!recovery.ready || !workflow || !owner || !ownsTransportCreditGate(owner) || workflow.busy) return;
    if (readOnly && workflow.outcome?.status === "saved" && workflow.outcome.recovery === "available") {
      setError("");
      void workflow.refresh(); // Read-only retry remains available even if an older read hangs.
      return;
    }
    setBusy(true); setError("");
    await (readOnly ? workflow.reconcile() : workflow.submit());
    if (ownsTransportCreditGate(owner)) { setIntent(workflow.intent); setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recovery.ready || !workflow || !owner || !ownsTransportCreditGate(owner) || workflow.busy || workflow.intent || !review || !confirmed) return;
    try {
      const prepared = await workflow.prepare(form, () => crypto.randomUUID(), preparation.current?.signal);
      if (!mounted.current || !ownsTransportCreditGate(owner)) return;
      markTransportCreditPending(owner, prepared.id);
      setIntent(prepared);
      await run(false);
    } catch (failure) { if (ownsTransportCreditGate(owner)) { setIntent(workflow.intent); setError(failure instanceof Error ? failure.message : S.storage); } }
  }
  async function reset() {
    if (!owner || !ownsTransportCreditGate(owner)) return;
    try {
      await workflow!.reset();
      if (!ownsTransportCreditGate(owner)) return;
      setIntent(null); setOutcome(null); setReview(false); setConfirmed(false); setError("");
      void refreshTransportCreditQueries(owner, intent?.id).catch(() => { if (ownsTransportCreditGate(owner)) setError(S.outdated); });
    } catch { if (ownsTransportCreditGate(owner)) setError(S.storage); }
  }
  const data = intent ?? form;
  const current = isTransportCreditHistoryCurrent(recovery, factoryId, { ...history, isInvalidated: client.getQueryState(creditHistoryKey(recovery.context, worker.id))?.isInvalidated });
  const saved = creditSavedConfirmation(outcome, { actorId, factoryId, workerId: worker.id }, intent?.id ?? null);
  return <section aria-labelledby="transport-credit-heading" className="space-y-atlas-3">
    <h3 id="transport-credit-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">{S.add}</h3>
    <p className="text-atlas-sm text-atlas-text-muted">{worker.name} · {S.factory}: {factory.data?.name ?? factoryId}</p>
    <p className="text-atlas-xs text-atlas-text-subtle">{S.eligibility}</p>
    {workflow && !workflow.coordinated && <Feedback role="alert" tone="danger">{S.coordination}</Feedback>}
    <Card>
      <form className="space-y-atlas-3" onSubmit={(event) => void submit(event)}>
        <FormField label={S.originalDate}><Input type="date" required value={data.originalWorkDate} disabled={!!intent || busy || !workflow || !workflow.coordinated || !recovery.ready} onChange={(e) => { setForm({ ...form, originalWorkDate: e.target.value }); setReview(false); setConfirmed(false); }} /></FormField>
        <FormField label={ATLAS_UI_STRINGS.fields.amount}><Input inputMode="decimal" autoComplete="off" required value={data.amount} disabled={!!intent || busy || !workflow || !workflow.coordinated || !recovery.ready} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setReview(false); setConfirmed(false); }} /></FormField>
        <FormField label={S.reason}><Textarea required value={data.reason} disabled={!!intent || busy || !workflow || !workflow.coordinated || !recovery.ready} onChange={(e) => { setForm({ ...form, reason: e.target.value }); setReview(false); setConfirmed(false); }} /></FormField>
        {!intent && !review && <Button type="button" variant="secondary" disabled={!workflow || !workflow.coordinated || !recovery.ready || busy} onClick={() => {
          if (!recovery.ready || !workflow?.coordinated) { setError(S.coordination); return; }
          if (!normalizeCreditAmount(form.amount) || !form.reason.trim() || !form.originalWorkDate) { setError(S.invalid); return; }
          setError(""); setReview(true);
        }}>{S.review}</Button>}
        {review && !intent && <>
          <p className="text-atlas-sm text-atlas-text-muted">{formatIndianCurrency(Number(normalizeCreditAmount(form.amount)))} · {formatDateOnly(form.originalWorkDate)}</p>
          <label className="flex min-h-atlas-12 items-start gap-atlas-3 text-atlas-sm text-atlas-text"><Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>{S.policy}</span></label>
          <Button type="submit" loading={busy} loadingLabel={ATLAS_UI_STRINGS.feedback.saving} disabled={!confirmed || busy || !recovery.ready || !workflow?.coordinated}>{S.confirm}</Button>
        </>}
      </form>
      {error && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{error}</Feedback></div>}
      {(saved || (outcome && outcome.status !== "saved")) && <div className="mt-atlas-3"><Feedback role={saved ? "status" : "alert"} tone={saved ? "success" : "danger"}>{saved ? saved.wasReplayed ? S.replayed : S.saved : outcome && "message" in outcome ? outcome.message : ""}</Feedback></div>}
      {saved && <dl className="mt-atlas-3 space-y-atlas-2 text-atlas-sm">
        <div><dt>{S.creditId}</dt><dd className="select-text break-all">{saved.creditId}</dd></div>
        <div><dt>{ATLAS_UI_STRINGS.fields.amount}</dt><dd>{formatIndianCurrency(Number(saved.amount))}</dd></div>
        <div><dt>{S.postingDate}</dt><dd>{formatDateOnly(saved.postingDate)}</dd></div>
        <div><dt>{S.originalDate}</dt><dd>{formatDateOnly(saved.originalWorkDate)}</dd></div>
        <div><dt>{S.reason}</dt><dd>{saved.reason}</dd></div>
      </dl>}
      {saved && saved.refresh !== "current" && <div className="mt-atlas-3"><Feedback role="status" tone="neutral">{S.outdated}</Feedback></div>}
      {saved && saved.recovery === "unavailable" && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{S.storage}</Feedback></div>}
      {intent && <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
        <Button variant="secondary" disabled={busy || !recovery.ready} onClick={() => void run(true)}>{saved ? S.refresh : S.reconcile}</Button>
        {!saved && outcome?.status !== "conflict" && <Button disabled={busy || !recovery.ready} onClick={() => void run(false)}>{S.retrySame}</Button>}
        {saved && <Button variant="ghost" disabled={busy || !recovery.ready || outcome?.status !== "saved" || outcome.recovery !== "available"} onClick={reset}>{S.another}</Button>}
        {workflow?.canCorrect && <Button variant="ghost" disabled={busy || !recovery.ready} onClick={reset}>{S.correct}</Button>}
      </div>}
    </Card>
    <h4 className="text-atlas-base font-atlas-semibold text-atlas-text">{S.history}</h4>
    <p className="text-atlas-xs text-atlas-text-subtle">{S.historyHelp}</p>
    {!current ? <><Feedback role="status" tone="neutral">{history.isLoading ? ATLAS_UI_STRINGS.feedback.loading : S.unavailable}</Feedback><Button variant="ghost" disabled={busy || !recovery.ready || !owner} onClick={() => { if (intent) void run(true); else if (owner) void refreshTransportCreditQueries(owner).catch(() => { if (ownsTransportCreditGate(owner)) setError(S.outdated); }); }}>{ATLAS_UI_STRINGS.actions.retry}</Button></>
      : !history.data?.length ? <EmptyState title={S.empty} /> : history.data.map((credit) => <Card key={credit.id} surface="muted">
        <p className="text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(Number(credit.amount))}</p>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{S.originalDate}: {formatDateOnly(credit.originalWorkDate)} · {S.postingDate}: {formatDateOnly(credit.postingDate)}</p>
        <p className="mt-atlas-2 text-atlas-sm text-atlas-text">{credit.reason}</p>
        <p className="mt-atlas-1 break-all text-atlas-xs text-atlas-text-subtle">{S.actor}: {credit.actorId}</p>
      </Card>)}
  </section>;
}
