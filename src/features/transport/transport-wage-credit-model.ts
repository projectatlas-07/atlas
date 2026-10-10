import { isLocalDate } from "../../lib/local-date.ts";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";

const S = ATLAS_UI_STRINGS.transportCredit;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CreditScope = Readonly<{ actorId: string; factoryId: string; workerId: string }>;
export type CreditIntent = CreditScope & Readonly<{
  id: string; originalWorkDate: string; amount: string; reason: string;
}>;
export type WageCredit = CreditIntent & Readonly<{
  postingDate: string; createdAt: string; wasReplayed: boolean;
}>;
export type CreditStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CreditLockManager = {
  request<T>(name: string, options: { mode: "exclusive"; signal?: AbortSignal }, action: () => T | Promise<T>): Promise<T>;
};
export const creditLockKey = (scope: CreditScope) => `${creditStorageKey(scope)}:exclusive`;
// Web Locks are origin-scoped and released on document termination. AbortSignal
// cancels a queued request, not an acquired lock. No steal/lease/storage fallback.
export function createCreditCoordinator(manager: CreditLockManager | null, secure: boolean) {
  return secure && manager ? {
    exclusive<T>(scope: CreditScope, action: () => T | Promise<T>, signal?: AbortSignal) {
      return manager.request(creditLockKey(scope), { mode: "exclusive", signal }, () => {
        signal?.throwIfAborted();
        return action();
      });
    },
  } : null;
}
export function browserCreditCoordinator() {
  return createCreditCoordinator(typeof navigator === "undefined" ? null : navigator.locks ?? null,
    typeof window !== "undefined" && window.isSecureContext);
}
export const CREDIT_STORAGE_EVENT = "atlas-transport-credit-storage";
function notifyStorage(scope: CreditScope) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CREDIT_STORAGE_EVENT, { detail: creditStorageKey(scope) }));
}

// V1 maximum INR 9,999,999,999.99 (999,999,999,999 paise). This is below 2^34
// rupees: binary64 conversion error is <= 2^-20 rupees (< 0.0001 paise).
// Multiplication by 100 adds < 0.0001 paise at this bound, so integer-paise
// recovery cannot cross a half-paise boundary. Decimal JSON -> binary64 ->
// shortest decimal retains the unique original two-decimal value in this range.
// Validate decimal digits with BigInt first; never round an input into acceptance.
export const MAX_TRANSPORT_CREDIT_PAISE = 999_999_999_999n;
export function normalizeCreditAmount(raw: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (paise <= 0n || paise > MAX_TRANSPORT_CREDIT_PAISE) return null;
  return `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;
}

export class CreditFailure extends Error {
  readonly kind: "rejected" | "conflict" | "unknown" | "storage";
  constructor(kind: CreditFailure["kind"], message: string) {
    super(message); this.name = "CreditFailure"; this.kind = kind;
  }
}

export function creditError(error: unknown): CreditFailure {
  if (error instanceof CreditFailure) return error;
  const failure = error as { code?: string; message?: string } | null;
  if (failure?.code === "P2631" && failure.message === "ATLAS_TRANSPORT_CREDIT_WEEK_NOT_FINALIZED") {
    return new CreditFailure("rejected", S.finalized);
  }
  if (failure?.code === "P2632" && failure.message === "ATLAS_TRANSPORT_CREDIT_REPLAY_CONFLICT") {
    return new CreditFailure("conflict", S.conflict);
  }
  if (failure?.code === "42501") return new CreditFailure("rejected", S.unauthorized);
  if (failure?.code === "22023") return new CreditFailure("rejected", S.invalid);
  // Network/serialization/unrecognized errors are not proof of rollback.
  return new CreditFailure("unknown", S.unknown);
}

export function browserCreditStorage(): CreditStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}
export function creditStorageKey(scope: CreditScope): string {
  return `atlas.transport.credit.v1:${scope.actorId}:${scope.factoryId}:${scope.workerId}`;
}
function validIntent(value: CreditIntent, scope: CreditScope): boolean {
  return value !== null && typeof value === "object" && uuid.test(value.id)
    && uuid.test(scope.actorId) && uuid.test(scope.factoryId) && uuid.test(scope.workerId)
    && value.actorId === scope.actorId && value.factoryId === scope.factoryId && value.workerId === scope.workerId
    && typeof value.amount === "string" && normalizeCreditAmount(value.amount) === value.amount
    && typeof value.reason === "string" && !!value.reason.trim() && value.reason === value.reason.trim()
    && typeof value.originalWorkDate === "string" && isLocalDate(value.originalWorkDate);
}
export function readCreditRecord(scope: CreditScope, storage: CreditStorage | null): { intent: CreditIntent; state: "unresolved" | "rejected" | "saved" | "cleared" } | null {
  if (!storage) throw new CreditFailure("storage", S.storage);
  try {
    const raw = storage.getItem(creditStorageKey(scope));
    if (raw === null) return null;
    const value = JSON.parse(raw) as CreditIntent & { recoveryState?: string };
    if (!validIntent(value, scope)) throw new Error("Invalid intent");
    if (value.recoveryState !== undefined && !["unresolved", "rejected", "saved", "cleared"].includes(value.recoveryState)) throw new Error("Invalid recovery state");
    const intent = Object.freeze({ actorId: value.actorId, factoryId: value.factoryId, workerId: value.workerId,
      id: value.id, originalWorkDate: value.originalWorkDate, amount: value.amount, reason: value.reason });
    return { intent, state: (value.recoveryState ?? "unresolved") as "unresolved" | "rejected" | "saved" | "cleared" };
  } catch { throw new CreditFailure("storage", S.storage); }
}
export function readCreditIntent(scope: CreditScope, storage: CreditStorage | null): CreditIntent | null {
  const record = readCreditRecord(scope, storage);
  return record?.state === "cleared" ? null : record?.intent ?? null;
}
export function assertMatchingCredit(credit: WageCredit, intent: CreditIntent): void {
  if (!validIntent(credit, intent) || credit.id !== intent.id
    || credit.originalWorkDate !== intent.originalWorkDate || credit.amount !== intent.amount
    || credit.reason !== intent.reason || !isLocalDate(credit.postingDate)
    || credit.postingDate < credit.originalWorkDate || !Number.isFinite(Date.parse(credit.createdAt))) {
    throw new CreditFailure("conflict", S.conflict);
  }
}

export type CreditOutcome =
  | { status: "saved"; credit: WageCredit; refresh: "refreshing" | "current" | "outdated"; recovery: "available" | "unavailable" }
  | { status: "unknown" | "rejected" | "conflict" | "storage"; message: string };
// Production confirmation fields: saved evidence is shown only for the active
// actor/factory/worker and original intent UUID, independently of read health.
export function creditSavedConfirmation(outcome: CreditOutcome | null, scope: CreditScope, intentId: string | null) {
  if (outcome?.status !== "saved" || !validIntent(outcome.credit, scope) || outcome.credit.id !== intentId) return null;
  const credit = outcome.credit;
  return Object.freeze({ creditId: credit.id, amount: credit.amount, originalWorkDate: credit.originalWorkDate,
    postingDate: credit.postingDate, reason: credit.reason, actorId: credit.actorId, createdAt: credit.createdAt,
    wasReplayed: credit.wasReplayed, refresh: outcome.refresh, recovery: outcome.recovery });
}
export type CreditDependencies = {
  create: (intent: CreditIntent) => Promise<WageCredit>;
  lookup: (intent: CreditIntent) => Promise<WageCredit | null>;
  refresh: (credit: WageCredit) => Promise<void>;
  recoveryChanged?: (available: boolean, id: string) => void;
  assertActive?: () => void;
};

/** One immutable, durable intent. Reads/callback failures never undo saved status. */
export function createCreditWorkflow(scope: CreditScope, storage: CreditStorage | null, deps: CreditDependencies,
  coordinator = browserCreditCoordinator()) {
  let intent = readCreditIntent(scope, storage);
  let uncertain = intent !== null; // Reloaded intent may already be committed.
  let busy = false;
  let saved: WageCredit | null = null;
  let correctable = false;
  let outcome: CreditOutcome | null = null;
  let running: Promise<CreditOutcome> | null = null;
  let refreshGeneration = 0;
  let recoveryAvailable = true;
  const listeners = new Set<(value: CreditOutcome | null) => void>();
  function publish(value: CreditOutcome | null) {
    outcome = value;
    listeners.forEach((listener) => { try { listener(value); } catch { /* A UI callback cannot undo a commit. */ } });
    return value;
  }
  const same = (left: CreditIntent | null, right: CreditIntent | null) => JSON.stringify(left) === JSON.stringify(right);
  function persisted() {
    const existing = readCreditRecord(scope, storage);
    if (!intent || existing?.state === "cleared" || !same(existing?.intent ?? null, intent)) throw new CreditFailure("storage", S.storage);
    return existing!;
  }
  function recovery(available: boolean) {
    if (available === recoveryAvailable) return;
    recoveryAvailable = available;
    if (intent) deps.recoveryChanged?.(available, intent.id);
  }
  function checkSavedRecovery() {
    try {
      // Refresh runs outside the cross-tab lock: inspect only, never resurrect
      // a cleared record or overwrite a newer intent with a delayed write.
      if (persisted().state !== "saved") throw new CreditFailure("storage", S.storage);
      recovery(true);
    } catch { recovery(false); }
  }
  function savedOutcome(refresh: "refreshing" | "current" | "outdated"): CreditOutcome {
    return { status: "saved", credit: saved!, refresh, recovery: recoveryAvailable ? "available" : "unavailable" };
  }
  function persist(state: "unresolved" | "rejected" | "saved") {
    deps.assertActive?.();
    const serialized = JSON.stringify({ ...intent, recoveryState: state });
    const changed = storage!.getItem(creditStorageKey(scope)) !== serialized;
    if (changed) storage!.setItem(creditStorageKey(scope), serialized);
    if (persisted().state !== state) throw new CreditFailure("storage", S.storage);
    if (changed) notifyStorage(scope);
  }
  async function exclusive<T>(action: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!coordinator) throw new CreditFailure("storage", S.coordination);
    let entered = false;
    try { return await coordinator.exclusive(scope, () => { entered = true; deps.assertActive?.(); return action(); }, signal); }
    catch (error) { if (entered || error instanceof CreditFailure) throw error; throw new CreditFailure("storage", S.storage); }
  }
  async function refreshSaved(): Promise<CreditOutcome> {
    if (!saved) return run(true);
    const credit = saved;
    const generation = ++refreshGeneration;
    checkSavedRecovery();
    publish(savedOutcome("refreshing"));
    let refresh: "current" | "outdated" = "current";
    try { await deps.refresh(credit); } catch { refresh = "outdated"; }
    // Storage may fail while the financial reads are pending. Keep both states
    // independent and close the withdrawal gate even when those reads succeed.
    if (generation === refreshGeneration && saved === credit) checkSavedRecovery();
    const result: CreditOutcome = { status: "saved", credit, refresh, recovery: recoveryAvailable ? "available" : "unavailable" };
    if (generation === refreshGeneration && saved === credit) publish(result);
    return result;
  }
  function confirmed(credit: WageCredit): CreditOutcome {
    assertMatchingCredit(credit, intent!);
    saved = Object.freeze(credit);
    // The validated RPC/ledger record is the success boundary, not storage or UI reads.
    try { persisted(); persist("saved"); recovery(true); }
    catch { recovery(false); }
    const result = savedOutcome("refreshing");
    publish(result);
    void refreshSaved();
    return result;
  }
  function run(readOnly: boolean): Promise<CreditOutcome> {
    if (running) return running;
    if (busy) return Promise.resolve({ status: "storage", message: S.storage });
    busy = true;
    running = (async () => {
    try {
      return await exclusive(async () => {
      if (readOnly) {
        const latestRecord = readCreditRecord(scope, storage);
        const latest = latestRecord?.state === "cleared" ? null : latestRecord?.intent ?? null;
        if (!same(latest, intent)) {
          // Cross-tab reset/replacement is adopted only after the old ambiguous
          // intent is proven saved. An absent lookup never permits its disposal.
          if (intent && !saved && !correctable) {
            const old = await deps.lookup(intent);
            if (!old) throw new CreditFailure("storage", S.storage);
            assertMatchingCredit(old, intent);
            saved = Object.freeze(old);
          }
          // A coordinated terminal marker must belong to this exact intent.
          // Absence or another UUID's marker is not evidence of safe cleanup.
          if (intent && !latest && (latestRecord?.state !== "cleared" || !same(latestRecord.intent, intent))) {
            throw new CreditFailure("storage", S.storage);
          }
          const completed = saved;
          recovery(true);
          intent = latest; saved = null; uncertain = latest !== null; correctable = false;
          refreshGeneration++; publish(null);
          // Accepted completion cleanup still needs fresh financial reads.
          if (!latest && completed) void deps.refresh(completed).catch(() => {});
        }
        if (!intent) return { status: "unknown", message: S.absent };
      }
      persisted();
      if (saved) {
        // Recovery metadata can be repaired only under the same exclusive lock
        // and only after the exact original intent passed persisted().
        persist("saved"); recovery(true);
        void refreshSaved(); return outcome!;
      }
      if (readOnly) {
        const credit = await deps.lookup(intent!);
        if (credit) return confirmed(credit);
        uncertain = true;
        return publish({ status: "unknown", message: S.absent })!;
      }
      persist("unresolved");
      try { return confirmed(await deps.create(intent!)); }
      catch (error) {
        if (creditError(error).kind === "rejected") persist("rejected");
        throw error;
      }
      });
    } catch (error) {
      const failure = creditError(error);
      if (failure.kind === "storage") recovery(false);
      if (saved) {
        // Recovery failure cannot erase a validated commit in this context.
        recovery(false);
        return publish(savedOutcome(outcome?.status === "saved" ? outcome.refresh : "outdated"))!;
      }
      correctable = failure.kind === "rejected" && !uncertain;
      if (failure.kind === "unknown") uncertain = true;
      return publish({ status: failure.kind, message: failure.message })!;
    } finally { busy = false; running = null; }
    })();
    return running;
  }
  return {
    get intent() { return intent; },
    get busy() { return busy; },
    get preparing() { return busy && !running; },
    get canCorrect() { return correctable && !busy; },
    get coordinated() { return coordinator !== null; },
    get outcome() { return outcome; },
    subscribe(listener: (value: CreditOutcome | null) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async prepare(draft: { originalWorkDate: string; amount: string; reason: string }, id: () => string, signal?: AbortSignal): Promise<CreditIntent> {
      if (busy) throw new CreditFailure("storage", S.storage);
      busy = true;
      try { return await exclusive(() => {
      const existing = readCreditIntent(scope, storage);
      if (intent && !same(existing, intent)) throw new CreditFailure("storage", S.storage);
      if (existing) { intent = existing; uncertain = true; return existing; }
      if (intent) throw new CreditFailure("storage", S.storage);
      const amount = normalizeCreditAmount(draft.amount);
      const next = Object.freeze({ ...scope, id: id(), originalWorkDate: draft.originalWorkDate, amount: amount ?? "", reason: draft.reason.trim() });
      if (!validIntent(next, scope)) throw new CreditFailure("rejected", S.invalid);
      try {
        intent = next;
        persist("unresolved"); // Read-back is required BEFORE a network request.
      } catch { throw new CreditFailure("storage", S.storage); }
      return next;
      }, signal); } finally { busy = false; }
    },
    submit: () => run(false),
    reconcile: () => run(true),
    refresh: refreshSaved,
    async reset() {
      if (busy || (!saved && !correctable)) throw new CreditFailure("storage", S.storage);
      busy = true;
      try { await exclusive(() => {
      const record = persisted();
      // Another tab's ambiguous retry must prevent clearing a prior rejection.
      if (!saved && record.state !== "rejected") throw new CreditFailure("storage", S.storage);
      try {
        // Terminal tombstone distinguishes a coordinated reset from external deletion.
        storage!.setItem(creditStorageKey(scope), JSON.stringify({ ...intent, recoveryState: "cleared" }));
        if (readCreditRecord(scope, storage)?.state !== "cleared") throw new Error("Not cleared");
      } catch { throw new CreditFailure("storage", S.storage); }
      recovery(true);
      intent = null; saved = null; correctable = false; uncertain = false;
      refreshGeneration++; publish(null);
      notifyStorage(scope);
      }); } catch (error) {
        if (saved) { recovery(false); publish(savedOutcome(outcome?.status === "saved" ? outcome.refresh : "outdated")); }
        throw error;
      } finally { busy = false; }
    },
  };
}
