"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type SessionState = "loading" | "authenticated" | "unauthenticated";

export function AuthGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("loading");

  useEffect(() => {
    let isMounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) setSessionState(session ? "authenticated" : "unauthenticated");
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        console.error({ context: "Failed to check Supabase session", message: error.message });
        setSessionState("unauthenticated");
        return;
      }
      setSessionState(data.session ? "authenticated" : "unauthenticated");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (sessionState === "unauthenticated") router.replace("/login");
  }, [router, sessionState]);

  if (sessionState === "loading") return <AuthStatus message="Checking session..." />;
  if (sessionState === "unauthenticated") return <AuthStatus message="Redirecting to sign in..." />;
  return children;
}

function AuthStatus({ message }: Readonly<{ message: string }>) {
  return <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-sm font-medium text-slate-600">{message}</main>;
}
