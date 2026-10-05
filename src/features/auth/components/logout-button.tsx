"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { ATLAS_UI_STRINGS } from "@/lib/strings";
import { supabase } from "@/lib/supabase/client";

export function LogoutButton({
  v2 = false,
  fullWidth = false,
}: Readonly<{ v2?: boolean; fullWidth?: boolean }>) {
  const router = useRouter();
  const isLoggingOutRef = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function logout() {
    if (isLoggingOutRef.current) return;

    isLoggingOutRef.current = true;
    setIsLoggingOut(true);
    setLogoutError("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setLogoutError(ATLAS_UI_STRINGS.auth.logoutError);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError(ATLAS_UI_STRINGS.auth.logoutError);
    } finally {
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
    }
  }

  return (
    <div className={`flex shrink-0 flex-col gap-2 ${fullWidth ? "w-full items-stretch" : "items-end"}`}>
      {v2 ? (
        <Button
          type="button"
          variant="secondary"
          fullWidth={fullWidth}
          disabled={isLoggingOut}
          loading={isLoggingOut}
          loadingLabel={ATLAS_UI_STRINGS.auth.loggingOut}
          onClick={() => void logout()}
        >
          {ATLAS_UI_STRINGS.auth.logout}
        </Button>
      ) : (
        <button
          type="button"
          disabled={isLoggingOut}
          onClick={() => void logout()}
          className="h-10 rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoggingOut ? ATLAS_UI_STRINGS.auth.loggingOut : ATLAS_UI_STRINGS.auth.logout}
        </button>
      )}
      {logoutError && (v2
        ? <Feedback role="alert" tone="danger">{logoutError}</Feedback>
        : <p role="alert" className="max-w-52 text-right text-sm font-medium text-red-700">{logoutError}</p>)}
    </div>
  );
}
