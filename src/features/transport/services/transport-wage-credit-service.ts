import { supabase } from "../../../lib/supabase/client.ts";
import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../types/supabase.ts";
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
let verificationSequence = 0;
// Capture only SDK-delivered session events in memory. getSession() is not a
// passive capture: it can refresh tokens or remove shared session storage.
export function createTransportAuthContext(auth: Pick<SupabaseClient["auth"], "onAuthStateChange">) {
  let current: Readonly<{ actorId: string; token: string }> | null = null;
  let receivedEvent = false;
  const listeners = new Set<(event: AuthChangeEvent, actorId: string | null) => void>();
  const { data } = auth.onAuthStateChange((event, session: Session | null) => {
    // A delayed INITIAL_SESSION must not overwrite a newer sign-in/out event.
    if (event === "INITIAL_SESSION" && receivedEvent) return;
    receivedEvent = true;
    const actorId = session?.user.id ?? null;
    const token = session?.access_token ?? null;
    if (!actorId || !token) current = null;
    else if (current?.actorId !== actorId || current.token !== token) current = Object.freeze({ actorId, token });
    listeners.forEach((listener) => listener(event, current?.actorId ?? null));
  });
  return {
    capture: () => current,
    isCurrent: (captured: typeof current) => captured !== null && captured === current,
    subscribe(listener: (event: AuthChangeEvent, actorId: string | null) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { current = null; data.subscription.unsubscribe(); listeners.clear(); },
  };
}
const transportAuth = createTransportAuthContext(supabase.auth);
export const subscribeTransportCreditAuth = transportAuth.subscribe;
async function verifyCapturedActor(captured: ReturnType<typeof transportAuth.capture>) {
  if (!captured) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unknown);
  // SDK getUser(jwt) removes its own session on session_not_found. Keep that
  // side effect away from the shared Auth client (which may now belong to B).
  // persistSession:false uses SDK memory storage and disables BroadcastChannel.
  const verifier = createClient<Database>(url, key, { auth: {
    storageKey: `atlas-transport-credit-verification-${++verificationSequence}`,
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  } });
  const { data, error } = await verifier.auth.getUser(captured.token);
  if (error || data.user?.id !== captured.actorId) {
    // Identity verification is not evidence that an earlier write rolled back.
    throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized);
  }
  return { url, key };
}
export async function verifyTransportCreditActor(context = transportAuth): Promise<string | null> {
  const captured = context.capture();
  try {
    await verifyCapturedActor(captured);
    return context.isCurrent(captured) ? captured!.actorId : null;
  } catch { return null; }
}
async function actorBoundClient(actorId: string, beforeDispatch?: () => void) {
  const captured = transportAuth.capture();
  if (!captured || captured.actorId !== actorId) throw new CreditFailure("unknown", ATLAS_UI_STRINGS.transportCredit.unauthorized);
  const { url, key } = await verifyCapturedActor(captured);
  // Installed SDK 2.111.0 skips its Auth client entirely with accessToken set.
  // Every fetch receives this captured token. No session/token persistence or substitution.
  return createClient<Database>(url, key, {
    accessToken: async () => captured.token,
    ...(beforeDispatch ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      beforeDispatch();
      return fetch(input, init);
    } } } : {}),
  });
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
    const requestClient = await actorBoundClient(intent.actorId);
    assertActive(); // An unmounted producer cannot dispatch after delayed verification.
    const { data, error } = await requestClient.rpc("create_transport_wage_credit", {
      p_factory_id: intent.factoryId, p_credit_id: intent.id,
      p_transport_worker_id: intent.workerId, p_original_work_date: intent.originalWorkDate,
      p_amount: intent.amount, p_reason: intent.reason,
    });
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
    const requestClient = await actorBoundClient(intent.actorId, assertLookupDispatch);
    assertLookupDispatch();
    const { data, error } = await requestClient.from("transport_wage_credits")
      .select("id, factory_id, transport_worker_id, original_work_date, posting_date, amount, reason, actor_id, created_at")
      .eq("factory_id", intent.factoryId).eq("transport_worker_id", intent.workerId).eq("id", intent.id).maybeSingle();
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
  const requestClient = await actorBoundClient(actorId, assertHistoryDispatch);
  assertHistoryDispatch();
  const rows = await readAllKeysetPages(async (after, size) => {
    assertHistoryDispatch();
    let query = requestClient.from("transport_wage_credits")
      .select("id, factory_id, transport_worker_id, original_work_date, posting_date, amount, reason, actor_id, created_at")
      .eq("factory_id", factoryId).order("id", { ascending: true }).limit(size).abortSignal(signal);
    if (workerId) query = query.eq("transport_worker_id", workerId);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    assertHistoryDispatch();
    if (error) throw creditError(error);
    return data ?? [];
  });
  return rows.map((row) => mapCredit(row)).sort((a, b) =>
    b.postingDate.localeCompare(a.postingDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
