import { AccountSupersededError, AccountVerificationError, capturedAccountClient, verifyCapturedAccount,
  type AccountActivation, type AccountCapture, type AccountConnection, type AccountCoordinator } from "./account-activation.ts";

export type CapturedFactoryResult =
  | { kind: "authorized"; actorId: string; activation: AccountActivation; factoryId: string }
  | { kind: "no_factory" | "inactive"; actorId: string; activation: AccountActivation }
  | { kind: "authentication_failed" | "superseded" | "request_error" | "configuration_error" };

// Opt-in: the caller supplies the original capture, never implicitly selects
// whichever shared account happens to be current after an asynchronous wait.
export async function resolveCapturedFactoryAccess(
  coordinator: AccountCoordinator, capture: AccountCapture, connection: AccountConnection,
): Promise<CapturedFactoryResult> {
  try {
    await verifyCapturedAccount(coordinator, capture, connection);
    const client = capturedAccountClient(coordinator, capture, connection);
    const { data, error, status } = await client.rpc("resolve_factory_access");
    coordinator.assertCredentialCurrent(capture);
    if (error) {
      if (status === 401 || (error.code === "P0001" && error.message === "ATLAS_UNAUTHENTICATED")) {
        coordinator.verificationFailed(capture, "authentication");
        return { kind: "authentication_failed" };
      }
      return { kind: "request_error" };
    }
    if (!Array.isArray(data) || data.length !== 1) return { kind: "configuration_error" };
    const row = data[0];
    if (!row || typeof row !== "object") return { kind: "configuration_error" };
    const identity = { actorId: capture.activation.actorId, activation: capture.activation };
    if (row.status === "active" && typeof row.factory_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.factory_id)) {
      return { kind: "authorized", ...identity, factoryId: row.factory_id };
    }
    if ((row.status === "none" || row.status === "inactive") && row.factory_id === null) {
      return { kind: row.status === "none" ? "no_factory" : "inactive", ...identity };
    }
    return { kind: "configuration_error" };
  } catch (error) {
    if (error instanceof AccountSupersededError) return { kind: "superseded" };
    if (error instanceof AccountVerificationError) {
      if (!coordinator.ownsCredential(capture)) return { kind: "superseded" };
      return { kind: error.kind };
    }
    try { coordinator.assertCredentialCurrent(capture); } catch { return { kind: "superseded" }; }
    return { kind: "request_error" };
  }
}
export function assertFactoryResultCurrent(coordinator: AccountCoordinator, result: CapturedFactoryResult): asserts result is Extract<CapturedFactoryResult, { activation: AccountActivation }> {
  if (!("activation" in result) || result.actorId !== result.activation.actorId ||
    !coordinator.isActivationCurrent(result.activation) || coordinator.getSnapshot().status !== "verified") throw new AccountSupersededError();
}
