import type { SupabaseClient } from "@supabase/supabase-js";
import { authStorageBoundary } from "../../../lib/supabase/client.ts";
import { accountCoordinator } from "../../auth/services/shared-account-context.ts";
import { capturedAccountClient, createAccountCoordinator, transportAccountAdapter, verifyCapturedAccount,
  type AccountCapture } from "../../auth/services/account-activation.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";
import {
  assertMatchingCredit, creditError, CreditFailure, normalizeCreditAmount,
  type CreditIntent, type WageCredit,
} from "../transport-wage-credit-model.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

type CreditRow = {
  id: string; factory_id: string; transport_worker_id: string;
  original_work_date: string; posting_date: string; amount: number | string;
  reason: string; actor_id: string; created_at: string;
};
function mapCredit(row: CreditRow, wasReplayed = false): WageCredit {
  const amount = normalizeCreditAmount(String(row.amount));
  if (!amount || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) {
    throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unknown);
  }
  return { id: row.id, factoryId: row.factory_id, workerId: row.transport_worker_id,
    originalWorkDate: row.original_work_date, postingDate: row.posting_date, amount,
    reason: row.reason, actorId: row.actor_id, createdAt: row.created_at, wasReplayed };
}
export function createTransportAuthContext(auth: Pick<SupabaseClient["auth"], "onAuthStateChange">,
  boundary: Parameters<typeof createAccountCoordinator>[1] = authStorageBoundary) {
  return transportAccountAdapter(createAccountCoordinator(auth, boundary));
}
const transportAuth = transportAccountAdapter(accountCoordinator);
export const subscribeTransportCreditAuth = transportAuth.subscribe;
function connection() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unknown);
  return { url, key };
}
async function verifyCapturedActor(captured: AccountCapture | null, coordinator = accountCoordinator) {
  if (!captured) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized);
  try { await verifyCapturedAccount(coordinator, captured, connection()); }
  catch {
    // Failed authentication never proves that an earlier financial write rolled back.
    throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized);
  }
}
export async function verifyTransportCreditActor(context = transportAuth): Promise<string | null> {
  // One inspection may explicitly retry recoverable uncertainty. No write is
  // retried, and the adapter never auto-reinspects on a network failure.
  const captured = context.capture() ?? context.coordinator.retryVerification();
  try {
    await verifyCapturedActor(captured, context.coordinator);
    return context.isCurrent(captured) ? captured!.activation.actorId : null;
  } catch { return null; }
}
async function actorBoundClient(actorId: string, beforeDispatch?: () => void) {
  const captured = transportAuth.capture();
  if (!captured || captured.activation.actorId !== actorId) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized);
  await verifyCapturedActor(captured);
  const assertCurrent = () => {
    try { accountCoordinator.assertCredentialCurrent(captured); }
    catch { throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized); }
  };
  return { client: capturedAccountClient(accountCoordinator, captured, connection(), beforeDispatch), assertCurrent };
}
// A timeout means UNKNOWN; the original server request may still commit.
export async function withCreditTimeout<T>(request: PromiseLike<T>, milliseconds = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unknown)), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export async function createTransportWageCredit(intent: CreditIntent, assertActive: () => void = () => {}): Promise<WageCredit> {
  return withCreditTimeout((async () => {
    const { client: requestClient, assertCurrent } = await actorBoundClient(intent.actorId);
    assertActive(); // An unmounted producer cannot dispatch after delayed verification.
    const { data, error } = await requestClient.rpc("create_transport_wage_credit", {
      p_factory_id: intent.factoryId, p_credit_id: intent.id,
      p_transport_worker_id: intent.workerId, p_original_work_date: intent.originalWorkDate,
      p_amount: intent.amount, p_reason: intent.reason,
    });
    assertCurrent();
    if (error) throw creditError(error);
    const row = data?.[0];
    if (!row || data?.length !== 1 || typeof row.was_replayed !== "boolean") {
      throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unknown);
    }
    const credit = mapCredit({ ...row, id: row.credit_id }, row.was_replayed);
    assertMatchingCredit(credit, intent);
    return credit;
  })());
}
export async function findTransportWageCredit(intent: CreditIntent, assertActive: () => void = () => {}): Promise<WageCredit | null> {
  return withCreditTimeout((async () => {
    assertActive();
    // One captured-owner assertion covers verification completion and every SDK HTTP retry.
    const assertLookupDispatch = () => { assertActive(); };
    const { client: requestClient, assertCurrent } = await actorBoundClient(intent.actorId, assertLookupDispatch);
    assertLookupDispatch();
    const { data, error } = await requestClient.from("transport_wage_credits")
      .select("id, factory_id, transport_worker_id, original_work_date, posting_date, amount, reason, actor_id, created_at")
      .eq("factory_id", intent.factoryId).eq("transport_worker_id", intent.workerId).eq("id", intent.id).maybeSingle();
    assertCurrent();
    if (error) throw creditError(error);
    if (!data) return null;
    const credit = mapCredit(data, true);
    assertMatchingCredit(credit, intent);
    return credit;
  })());
}
export type TransportCreditHistoryRequest = {
  actorId: string; factoryId: string; workerId?: string; signal: AbortSignal; assertActive: () => void;
};
export async function listTransportWageCredits({ actorId, factoryId, workerId, signal, assertActive }: TransportCreditHistoryRequest): Promise<WageCredit[]> {
  const assertHistoryDispatch = () => {
    assertActive();
    if (signal.aborted) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.outdated);
  };
  assertHistoryDispatch();
  const { client: requestClient, assertCurrent } = await actorBoundClient(actorId, assertHistoryDispatch);
  assertHistoryDispatch();
  const rows = await readAllKeysetPages(async (after, size) => {
    assertHistoryDispatch();
    let query = requestClient.from("transport_wage_credits")
      .select("id, factory_id, transport_worker_id, original_work_date, posting_date, amount, reason, actor_id, created_at")
      .eq("factory_id", factoryId).order("id", { ascending: true }).limit(size).abortSignal(signal);
    if (workerId) query = query.eq("transport_worker_id", workerId);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    assertCurrent();
    assertHistoryDispatch();
    if (error) throw creditError(error);
    return data ?? [];
  });
  return rows.map((row) => mapCredit(row)).sort((a, b) =>
    b.postingDate.localeCompare(a.postingDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
