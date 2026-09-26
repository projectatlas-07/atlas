"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChamberTransportAccountDrawer } from "@/features/office/components/chamber-transport-account-drawer";
import { ChamberTransportManagementDrawer } from "@/features/office/components/chamber-transport-management-drawer";
import { ChamberTransportWorkforceOverview } from "@/features/office/components/chamber-transport-workforce-overview";
import { listTransportGroups } from "@/features/transport/services/transport-crew-service";
import { listTransportWorkers } from "@/features/transport/services/transport-worker-service";

const workerQueryKey = (factoryId: string) => ["office-transport-workers", factoryId] as const;
const groupQueryKey = (factoryId: string) => ["office-transport-groups", factoryId] as const;

export function TransportOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const [activeView, setActiveView] = useState<"overview" | "setup" | "account">("overview");
  const [accountWorkerId, setAccountWorkerId] = useState("");
  const workersQuery = useQuery({
    queryKey: workerQueryKey(factoryId),
    queryFn: () => listTransportWorkers(factoryId),
  });
  const groupsQuery = useQuery({
    queryKey: groupQueryKey(factoryId),
    queryFn: () => listTransportGroups(factoryId),
    enabled: activeView === "setup",
  });

  function openAccount(transportWorkerId: string) {
    setAccountWorkerId(transportWorkerId);
    setActiveView("account");
  }
  const accountWorker = workersQuery.data?.find((worker) => worker.id === accountWorkerId) ?? null;

  return (
    <section aria-label="Chamber Transport Workforce">
      <ChamberTransportWorkforceOverview
        factoryId={factoryId}
        workers={workersQuery.data ?? []}
        workersLoading={workersQuery.isLoading}
        workersError={workersQuery.error}
        onManageSetup={() => setActiveView("setup")}
        onOpenAccount={openAccount}
      />

      {activeView === "setup" && (
        <ChamberTransportManagementDrawer
          factoryId={factoryId}
          workers={workersQuery.data ?? []}
          workersLoading={workersQuery.isLoading}
          workersError={workersQuery.error}
          groups={groupsQuery.data ?? []}
          groupsLoading={groupsQuery.isLoading}
          groupsError={groupsQuery.error}
          onClose={() => setActiveView("overview")}
        />
      )}

      {activeView === "account" && accountWorker && (
        <ChamberTransportAccountDrawer
          key={accountWorker.id}
          factoryId={factoryId}
          worker={accountWorker}
          onClose={() => setActiveView("overview")}
        />
      )}
    </section>
  );
}
