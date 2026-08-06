import { supabase } from "@/lib/supabase/client";

export type FactoryResolutionResult =
  | { ok: true; factoryId: string }
  | {
    ok: false;
    error: {
      code: "unauthenticated" | "access_denied" | "invalid_configuration" | "request_failed";
      message: string;
      details?: unknown;
    };
  };

export async function resolveAuthenticatedFactoryId(): Promise<FactoryResolutionResult> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: {
        code: "unauthenticated",
        message: "You must be signed in to access a factory.",
        details: userError ?? undefined,
      },
    };
  }
  if (userError) {
    return {
      ok: false,
      error: {
        code: "request_failed",
        message: "Unable to verify factory access.",
        details: userError,
      },
    };
  }

  const { data: mappings, error: mappingError } = await supabase
    .from("factory_users")
    .select("factory_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(2);
  if (mappingError) {
    return {
      ok: false,
      error: {
        code: "request_failed",
        message: "Unable to verify factory access.",
        details: mappingError,
      },
    };
  }
  if (!mappings || mappings.length === 0) {
    return {
      ok: false,
      error: {
        code: "access_denied",
        message: "No active factory access is assigned to this account.",
      },
    };
  }
  if (mappings.length > 1) {
    return {
      ok: false,
      error: {
        code: "invalid_configuration",
        message: "This account has an invalid factory configuration.",
        details: { activeMappingCount: mappings.length },
      },
    };
  }

  return { ok: true, factoryId: mappings[0].factory_id };
}
