import { z } from "zod";
import { supabase } from "../../../lib/supabase/client.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";

export const FACTORY_NAME_MAX_LENGTH = 200;

export const factoryNameSchema = z.string().trim()
  .min(1, ATLAS_UI_STRINGS.auth.factoryNameRequired)
  .max(FACTORY_NAME_MAX_LENGTH, ATLAS_UI_STRINGS.auth.factoryNameTooLong);

type RpcErrorLike = Readonly<{ message?: string }>;
type ProvisioningRow = Readonly<{ factory_id: string; created: boolean }>;
type FactoryAccessRow = Readonly<{
  status: "active" | "inactive" | "none";
  factory_id: string | null;
}>;

export type ProvisionFirstFactoryResult =
  | { ok: true; factoryId: string; created: boolean }
  | {
    ok: false;
    reason: "unauthenticated" | "email_unconfirmed" | "membership_inactive" | "invalid_name" | "unexpected";
    message: string;
  };

export type OnboardingAccessResult =
  | { state: "login" }
  | { state: "verification"; email: string | null }
  | { state: "office"; factoryId: string }
  | { state: "eligible"; email: string | null }
  | { state: "disabled" }
  | { state: "error"; message: string };

export type FactoryAccessStatusResult =
  | { ok: true; status: "active"; factoryId: string }
  | { ok: true; status: "inactive" | "none"; factoryId: null }
  | { ok: false; reason: "unauthenticated" | "unexpected" };

type ProvisionDependencies = Readonly<{
  rpc: (args: Readonly<{ p_factory_name: string }>) => PromiseLike<{
    data: ProvisioningRow[] | null;
    error: RpcErrorLike | null;
  }>;
}>;

type FactoryAccessDependencies = Readonly<{
  rpc: () => PromiseLike<{
    data: FactoryAccessRow[] | null;
    error: RpcErrorLike | null;
  }>;
}>;

type OnboardingAccessDependencies = Readonly<{
  getUser: () => PromiseLike<{
    data: {
      user: null | Readonly<{
        email?: string | null;
        email_confirmed_at?: string | null;
      }>;
    };
    error: unknown | null;
  }>;
  resolveFactoryAccess: () => Promise<FactoryAccessStatusResult>;
}>;

const productionProvisionDependencies: ProvisionDependencies = {
  async rpc(args) {
    const { data, error } = await supabase.rpc("provision_first_factory", args);
    return { data, error };
  },
};

const productionFactoryAccessDependencies: FactoryAccessDependencies = {
  async rpc() {
    const { data, error } = await supabase.rpc("resolve_factory_access");
    return { data, error };
  },
};

const productionOnboardingAccessDependencies: OnboardingAccessDependencies = {
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    return { data, error };
  },
  resolveFactoryAccess: () => resolveFactoryAccessStatus(productionFactoryAccessDependencies),
};

const RPC_ERROR_REASONS = {
  ATLAS_UNAUTHENTICATED: "unauthenticated",
  ATLAS_EMAIL_NOT_CONFIRMED: "email_unconfirmed",
  ATLAS_MEMBERSHIP_INACTIVE: "membership_inactive",
  ATLAS_INVALID_FACTORY_NAME: "invalid_name",
} as const;

function mapRpcError(error: RpcErrorLike): ProvisionFirstFactoryResult {
  const reason = error.message
    ? RPC_ERROR_REASONS[error.message as keyof typeof RPC_ERROR_REASONS]
    : undefined;

  if (reason === "unauthenticated") {
    return { ok: false, reason, message: ATLAS_UI_STRINGS.auth.factoryCreateError };
  }
  if (reason === "email_unconfirmed") {
    return { ok: false, reason, message: ATLAS_UI_STRINGS.auth.verificationError };
  }
  if (reason === "membership_inactive") {
    return { ok: false, reason, message: ATLAS_UI_STRINGS.auth.accessDisabledDescription };
  }
  if (reason === "invalid_name") {
    return { ok: false, reason, message: ATLAS_UI_STRINGS.auth.factoryNameInvalid };
  }
  return { ok: false, reason: "unexpected", message: ATLAS_UI_STRINGS.auth.factoryCreateError };
}

export async function provisionFirstFactory(
  factoryName: string,
  dependencies: ProvisionDependencies = productionProvisionDependencies,
): Promise<ProvisionFirstFactoryResult> {
  try {
    const { data, error } = await dependencies.rpc({ p_factory_name: factoryName.trim() });
    if (error) return mapRpcError(error);

    const result = data?.[0];
    if (!result || data?.length !== 1) {
      return { ok: false, reason: "unexpected", message: ATLAS_UI_STRINGS.auth.factoryCreateError };
    }

    return {
      ok: true,
      factoryId: result.factory_id,
      created: result.created,
    };
  } catch {
    return { ok: false, reason: "unexpected", message: ATLAS_UI_STRINGS.auth.factoryCreateError };
  }
}

export async function resolveFactoryAccessStatus(
  dependencies: FactoryAccessDependencies = productionFactoryAccessDependencies,
): Promise<FactoryAccessStatusResult> {
  try {
    const { data, error } = await dependencies.rpc();
    if (error) {
      if (error.message === "ATLAS_UNAUTHENTICATED") {
        return { ok: false, reason: "unauthenticated" };
      }
      return { ok: false, reason: "unexpected" };
    }

    const result = data?.[0];
    if (!result || data?.length !== 1) return { ok: false, reason: "unexpected" };
    if (result.status === "active" && result.factory_id) {
      return { ok: true, status: "active", factoryId: result.factory_id };
    }
    if ((result.status === "inactive" || result.status === "none") && result.factory_id === null) {
      return { ok: true, status: result.status, factoryId: null };
    }
    return { ok: false, reason: "unexpected" };
  } catch {
    return { ok: false, reason: "unexpected" };
  }
}

export async function resolveOnboardingAccess(
  dependencies: OnboardingAccessDependencies = productionOnboardingAccessDependencies,
): Promise<OnboardingAccessResult> {
  try {
    const { data, error } = await dependencies.getUser();
    if (error || !data.user) return { state: "login" };

    const email = data.user.email ?? null;
    if (!data.user.email_confirmed_at) return { state: "verification", email };

    const factoryAccess = await dependencies.resolveFactoryAccess();
    if (!factoryAccess.ok) {
      if (factoryAccess.reason === "unauthenticated") return { state: "login" };
      return { state: "error", message: ATLAS_UI_STRINGS.auth.workspaceError };
    }
    if (factoryAccess.status === "active") {
      return { state: "office", factoryId: factoryAccess.factoryId };
    }
    if (factoryAccess.status === "inactive") return { state: "disabled" };
    return { state: "eligible", email };
  } catch {
    return { state: "error", message: ATLAS_UI_STRINGS.auth.workspaceError };
  }
}
