import { supabase } from "../../../lib/supabase/client.ts";
import { ATLAS_UI_STRINGS } from "../../../lib/strings.ts";
import {
  resolveAuthenticatedFactoryId,
  type FactoryResolutionResult,
} from "./factory-access-service.ts";

export type LoginCredentials = Readonly<{
  email: string;
  password: string;
}>;

export type LoginDestinationResult =
  | { ok: true; destination: "/office" | "/onboarding"; needsOnboarding: boolean }
  | { ok: false; message: string };

type LoginDependencies = Readonly<{
  signInWithPassword: (
    credentials: LoginCredentials,
  ) => PromiseLike<{ error: unknown | null }>;
  resolveFactoryAccess: () => Promise<FactoryResolutionResult>;
}>;

const productionDependencies: LoginDependencies = {
  async signInWithPassword(credentials) {
    const { error } = await supabase.auth.signInWithPassword(credentials);
    return { error };
  },
  resolveFactoryAccess: resolveAuthenticatedFactoryId,
};

function mapFactoryAccessToDestination(
  factoryAccess: FactoryResolutionResult,
): LoginDestinationResult {
  if (factoryAccess.ok) {
    return { ok: true, destination: "/office", needsOnboarding: false };
  }

  if (factoryAccess.error.code === "access_denied") {
    return { ok: true, destination: "/onboarding", needsOnboarding: true };
  }

  return { ok: false, message: ATLAS_UI_STRINGS.auth.workspaceError };
}

export async function resolvePostLoginDestination(
  resolveFactoryAccess: LoginDependencies["resolveFactoryAccess"] =
    productionDependencies.resolveFactoryAccess,
): Promise<LoginDestinationResult> {
  try {
    return mapFactoryAccessToDestination(await resolveFactoryAccess());
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.workspaceError };
  }
}

export async function loginWithPassword(
  credentials: LoginCredentials,
  dependencies: LoginDependencies = productionDependencies,
): Promise<LoginDestinationResult> {
  try {
    const { error } = await dependencies.signInWithPassword(credentials);
    if (error) {
      return { ok: false, message: ATLAS_UI_STRINGS.auth.invalidCredentials };
    }
  } catch {
    return { ok: false, message: ATLAS_UI_STRINGS.auth.workspaceError };
  }

  return resolvePostLoginDestination(dependencies.resolveFactoryAccess);
}
