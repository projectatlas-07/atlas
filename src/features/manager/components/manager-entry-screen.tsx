"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveLegacyProductionRedirect } from "@/features/manager/manager-workflow-navigation";

export function ManagerEntryScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace(resolveLegacyProductionRedirect(window.location.hash));
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-atlas-background px-atlas-4 font-atlas text-atlas-text">
      <p role="status" className="text-atlas-sm font-atlas-medium text-atlas-text-muted">Opening Production...</p>
    </main>
  );
}
