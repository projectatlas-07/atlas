"use client";

import { useState } from "react";
import { ProductionEntryScreen } from "@/features/production/components/production-entry-screen";
import { TransportDailyEntryScreen } from "@/features/transport/components/transport-daily-entry-screen";

type ManagerWorkflow = "production" | "transport";

export function ManagerEntryScreen() {
  const [workflow, setWorkflow] = useState<ManagerWorkflow>("production");

  return (
    <div className="min-h-screen bg-stone-50">
      <nav aria-label="Manager entry workflow" className="mx-auto max-w-xl px-4 pt-4 sm:px-6">
        <div className="grid grid-cols-2 rounded-xl bg-stone-200 p-1">
          <WorkflowButton
            isSelected={workflow === "production"}
            onClick={() => setWorkflow("production")}
          >
            Production
          </WorkflowButton>
          <WorkflowButton
            isSelected={workflow === "transport"}
            onClick={() => setWorkflow("transport")}
          >
            Chamber transport
          </WorkflowButton>
        </div>
      </nav>

      {workflow === "production"
        ? <ProductionEntryScreen />
        : <TransportDailyEntryScreen />}
    </div>
  );
}

function WorkflowButton({
  children,
  isSelected,
  onClick,
}: Readonly<{
  children: React.ReactNode;
  isSelected: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${isSelected ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 active:bg-stone-100"}`}
    >
      {children}
    </button>
  );
}
