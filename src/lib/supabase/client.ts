import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createAuthStorageBoundary } from "./auth-storage.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

// Preserve the SDK's established project-specific key and browser persistence.
export const authStorageBoundary = createAuthStorageBoundary(`sb-${new URL(url).hostname.split(".")[0]}-auth-token`);
export const supabase = createClient<Database>(url, anonKey, {
  auth: { storageKey: authStorageBoundary.key, storage: authStorageBoundary.storage },
});
