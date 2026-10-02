"use client";

import { useEffect } from "react";
import { resolveLegacyProductionRedirect } from "@/features/office/office-navigation";

/** Redirects the retired root entry point without mounting legacy workflow UI. */
export function OfficeStartupRedirect() {
  useEffect(() => {
    window.location.replace(resolveLegacyProductionRedirect(window.location.hash));
  }, []);

  return null;
}
