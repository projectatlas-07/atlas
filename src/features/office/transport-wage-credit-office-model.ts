import type { QueryClient } from "@tanstack/react-query";
import { refreshFinancialQueryGroups } from "./customer-payment-office-model.ts";
import type { WageCredit, CreditDependencies } from "../transport/transport-wage-credit-model.ts";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";
import { readCreditRecord, type CreditStorage } from "../transport/transport-wage-credit-model.ts";
import type { TransportCreditHistoryRequest } from "../transport/services/transport-wage-credit-service.ts";

export type TransportCreditGateContext = { readonly client: QueryClient; readonly factoryId: string; readonly actorId: string | null; readonly generation: string; active: boolean };
export type TransportCreditGateOwner = { readonly context: TransportCreditGateContext; readonly actorId: string | null; readonly workerId: string; readonly generation: symbol; active: boolean };
const contexts = new WeakMap<QueryClient, Map<string, TransportCreditGateContext>>();
let activationSequence = 0;
export function activateTransportCreditContext(client: QueryClient, factoryId: string, actorId: string | null) {
  let map = contexts.get(client);
  if (!map) { map = new Map(); contexts.set(client, map); }
  const previous = map.get(factoryId);
  if (previous) previous.active = false;
  // The existing activation generation is serializable for QueryClient keys.
  // A1 and A2 remain distinct even when they use the same actor/token.
  const context: TransportCreditGateContext = { client, factoryId, actorId, generation: String(++activationSequence), active: true };
  map.set(factoryId, context);
  return context;
}
export function createTransportCreditGateOwner(context: TransportCreditGateContext, workerId: string): TransportCreditGateOwner {
  return { context, actorId: context.actorId, workerId, generation: Symbol(), active: true };
}
// The single authority for every producer/controller mutation. Object identity
// distinguishes A1 -> B1 -> A2 even when account IDs (or tokens) match again.
export function ownsTransportCreditGate(owner: TransportCreditGateOwner) {
  const context = owner.context;
  return owner.active && context.active && owner.actorId === context.actorId
    && contexts.get(context.client)?.get(context.factoryId) === context;
}
export function deactivateTransportCreditGateOwner(owner: TransportCreditGateOwner) { owner.active = false; }
export function bindTransportCreditGate(owner: TransportCreditGateOwner, operations: Pick<CreditDependencies, "create" | "lookup">): CreditDependencies {
  const assertActive = () => { if (!ownsTransportCreditGate(owner)) throw new Error(ATLAS_UI_STRINGS.transportCredit.outdated); };
  return {
    assertActive,
    create: (intent) => { assertActive(); return operations.create(intent); },
    lookup: (intent) => { assertActive(); return operations.lookup(intent); },
    refresh: (credit) => refreshTransportCreditQueries(owner, credit.id),
    recoveryChanged: (available, id) => { markTransportCreditPending(owner, id, available); },
  };
}
export function publishTransportCreditRecovery(owner: TransportCreditGateOwner, publish: () => void) {
  if (!ownsTransportCreditGate(owner)) return false;
  publish(); return true;
}
export function resetTransportCreditGate(owner: TransportCreditGateOwner) {
  if (!ownsTransportCreditGate(owner)) return false;
  const { client, factoryId } = owner.context;
  intentMap(client).delete(JSON.stringify(creditFreshnessKey(factoryId, owner.workerId)));
  client.setQueryData(creditFreshnessKey(factoryId, owner.workerId), "outdated");
  void client.invalidateQueries({ queryKey: ["office-transport-worker-balance", factoryId, owner.workerId], refetchType: "none" });
  return true;
}
export type TransportCreditRecovery = Readonly<{ factoryId: string; actorId: string | null; ready: boolean; revision: number; intentIds: Readonly<Record<string, string>>; context: TransportCreditGateContext }>;
export function createTransportCreditRecovery(client: QueryClient, factoryId: string,
  verifyActor: () => Promise<string | null>, storage: () => CreditStorage | null) {
  let context = activateTransportCreditContext(client, factoryId, null);
  let publisher = createTransportCreditGateOwner(context, "");
  let state: TransportCreditRecovery = { factoryId, actorId: null, ready: false, revision: 0, intentIds: {}, context };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: TransportCreditRecovery) => publishTransportCreditRecovery(publisher, () => { state = next; listeners.forEach((listener) => listener()); });
  function activate(actorId: string | null) {
    context = activateTransportCreditContext(client, factoryId, actorId);
    publisher = createTransportCreditGateOwner(context, "");
  }
  function invalidateIdentity(workers: readonly string[]) {
    for (const workerId of workers) {
      resetTransportCreditGate(createTransportCreditGateOwner(context, workerId));
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async inspect(workers: readonly string[], actorHint?: string | null, routine = false) {
      if (routine && state.ready && state.actorId === actorHint) return;
      const current = ++generation;
      const changed = actorHint !== undefined && actorHint !== state.actorId;
      if (changed || !context.active) activate(null);
      // Called synchronously by auth/storage listeners: no old ready state survives a switch.
      publish({ ...state, context, actorId: changed ? null : state.actorId, ready: false });
      if (changed) invalidateIdentity(workers);
      try {
        await Promise.resolve(); // Never request the Auth lock within an Auth listener callback.
        const actorId = await verifyActor();
        if (current !== generation || !ownsTransportCreditGate(publisher) || !actorId || (actorHint !== undefined && actorId !== actorHint)) return;
        const newIdentity = context.actorId !== actorId;
        if (newIdentity) { activate(actorId); invalidateIdentity(workers); }
        const intentIds: Record<string, string> = {};
        for (const workerId of workers) {
          try {
            const record = readCreditRecord({ actorId, factoryId, workerId }, storage());
            const intent = record?.state === "cleared" ? null : record?.intent;
            const key = JSON.stringify(creditFreshnessKey(factoryId, workerId));
            if (!record && !changed && !newIdentity && state.intentIds[workerId]) throw new Error("Externally removed intent");
            if (intent) intentIds[workerId] = intent.id;
            // Routine reinspection must not rearm a confirmed/refreshed identical intent.
            if (intent && !(intentMap(client).get(key)?.id === intent.id
              && intentMap(client).get(key)?.recoveryAvailable !== false
              && client.getQueryData(creditFreshnessKey(factoryId, workerId)) === "current")) {
              markTransportCreditPending(createTransportCreditGateOwner(context, workerId), intent.id);
            }
          } catch { intentIds[workerId] = "invalid"; markTransportCreditPending(createTransportCreditGateOwner(context, workerId), undefined, false); }
        }
        publish({ factoryId, actorId, ready: true, revision: state.revision + 1, intentIds, context });
        // After an identity change, old cache data cannot reopen payment gates.
        // Inactive balances remain invalidated; their own successful read is still required.
        if (newIdentity) for (const workerId of workers) {
          if (!intentIds[workerId]) void refreshTransportCreditQueries(createTransportCreditGateOwner(context, workerId)).catch(() => {});
        }
      } catch { /* Identity not established: keep all financial actions gated. */ }
    },
    stop() { generation++; publish({ ...state, ready: false }); context.active = false; deactivateTransportCreditGateOwner(publisher); },
  };
}

// A completion for an older intent must not clear a newer UNKNOWN intent's gate.
const intents = new WeakMap<QueryClient, Map<string, { id?: string; recoveryAvailable?: boolean }>>();
function intentMap(client: QueryClient) {
  let map = intents.get(client);
  if (!map) { map = new Map(); intents.set(client, map); }
  return map;
}

export const creditHistoryKey = (context: TransportCreditGateContext, workerId?: string) =>
  workerId ? ["office-transport-wage-credits", context.factoryId, context.actorId ?? "", context.generation, workerId] as const
    : ["office-transport-overview-wage-credits", context.factoryId, context.actorId ?? "", context.generation] as const;

export function isTransportCreditHistoryReady(recovery: TransportCreditRecovery, factoryId: string) {
  return recovery.ready && recovery.factoryId === factoryId && recovery.context.factoryId === factoryId
    && !!recovery.actorId && recovery.actorId === recovery.context.actorId
    && ownsTransportCreditGate(createTransportCreditGateOwner(recovery.context, ""));
}
export function transportCreditHistoryOptions(recovery: TransportCreditRecovery, factoryId: string,
  read: (request: TransportCreditHistoryRequest) => Promise<WageCredit[]>, workerId?: string) {
  const owner = createTransportCreditGateOwner(recovery.context, workerId ?? "");
  const ready = () => isTransportCreditHistoryReady(recovery, factoryId) && ownsTransportCreditGate(owner);
  return {
    queryKey: creditHistoryKey(recovery.context, workerId),
    enabled: ready(),
    retry: (failures: number) => ready() && failures < 2,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const assertActive = () => { if (!ready() || signal.aborted) throw new Error(ATLAS_UI_STRINGS.transportCredit.outdated); };
      assertActive();
      const result = await read({ actorId: recovery.actorId!, factoryId, workerId, signal, assertActive });
      assertActive(); // An already-sent response cannot publish after activation loss.
      return result;
    },
  };
}
export function isTransportCreditHistoryCurrent(recovery: TransportCreditRecovery, factoryId: string,
  state: Parameters<typeof isTransportCreditReadCurrent>[0]) {
  return isTransportCreditHistoryReady(recovery, factoryId) && isTransportCreditReadCurrent(state);
}
export const creditFreshnessKey = (factoryId: string, workerId: string) =>
  ["office-transport-credit-freshness", factoryId, workerId] as const;

export function markTransportCreditPending(owner: TransportCreditGateOwner, id?: string, recoveryAvailable?: boolean) {
  if (!ownsTransportCreditGate(owner)) return false;
  const { client, factoryId } = owner.context;
  const workerId = owner.workerId;
  const key = JSON.stringify(creditFreshnessKey(factoryId, workerId));
  const map = intentMap(client);
  const previous = map.get(key);
  if (!id || previous?.id !== id || (recoveryAvailable !== undefined && previous?.recoveryAvailable !== recoveryAvailable)) {
    map.set(key, { id, recoveryAvailable: recoveryAvailable ?? previous?.recoveryAvailable });
  }
  client.setQueryData(creditFreshnessKey(factoryId, workerId), "pending");
  return true;
}

export async function refreshTransportCreditQueries(owner: TransportCreditGateOwner, id?: string) {
  if (!ownsTransportCreditGate(owner)) throw new Error(ATLAS_UI_STRINGS.transportCredit.outdated);
  const { client, factoryId } = owner.context;
  const workerId = owner.workerId;
  const key = JSON.stringify(creditFreshnessKey(factoryId, workerId));
  const map = intentMap(client);
  const intent = map.get(key);
  if ((id && intent?.id !== id) || (!id && client.getQueryData(creditFreshnessKey(factoryId, workerId)) === "pending")) {
    throw new Error(ATLAS_UI_STRINGS.transportCredit.outdated);
  }
  client.setQueryData(creditFreshnessKey(factoryId, workerId), "outdated");
  await refreshFinancialQueryGroups(client, [
    ["office-transport-worker-balance", factoryId, workerId],
    creditHistoryKey(owner.context, workerId), creditHistoryKey(owner.context),
  ], [], (query) => query.isActive() && !query.isDisabled(), () => true, () => {
    if (!ownsTransportCreditGate(owner)) throw new Error(ATLAS_UI_STRINGS.transportCredit.outdated);
  });
  if (!ownsTransportCreditGate(owner) || map.get(key) !== intent) throw new Error(ATLAS_UI_STRINGS.transportCredit.outdated);
  // Successful reads do not repair unavailable recovery storage. The saved
  // confirmation can report fresh reads while withdrawal readiness stays closed.
  markTransportCreditCurrent(owner, intent);
}
export function markTransportCreditCurrent(owner: TransportCreditGateOwner, expected: { id?: string; recoveryAvailable?: boolean } | undefined) {
  if (!ownsTransportCreditGate(owner)) return false;
  const { client, factoryId } = owner.context;
  const key = creditFreshnessKey(factoryId, owner.workerId);
  if (intentMap(client).get(JSON.stringify(key)) !== expected) return false;
  client.setQueryData(key, expected?.recoveryAvailable === false ? "pending" : "current");
  return true;
}
export function isTransportCreditReadCurrent(state: {
  status: string; fetchStatus: string; isInvalidated?: boolean; error: unknown; dataUpdatedAt: number;
}) {
  return state.status === "success" && state.fetchStatus === "idle"
    && !state.isInvalidated && !state.error && state.dataUpdatedAt > 0;
}
// Presentation only, never used to authorize a withdrawal. Credits use posting date.
export function sumPostedTransportCredits(credits: readonly WageCredit[], from: string, to: string, workerId?: string): number {
  return credits.filter((c) => c.postingDate >= from && c.postingDate <= to && (!workerId || c.workerId === workerId))
    .reduce((total, c) => total + Number(c.amount), 0);
}
