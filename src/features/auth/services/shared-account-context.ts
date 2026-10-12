import { supabase, authStorageBoundary } from "../../../lib/supabase/client.ts";
import { createAccountCoordinator } from "./account-activation.ts";

// One event subscription supplies both the opt-in factory API and Transport.
export const accountCoordinator = createAccountCoordinator(supabase.auth, authStorageBoundary);
