"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browserCreditStorage, CREDIT_STORAGE_EVENT } from "@/features/transport/transport-wage-credit-model";
import { createTransportCreditRecovery } from "../transport-wage-credit-office-model";
import { ChamberTransportAccountDrawer } from "@/features/office/components/chamber-transport-account-drawer";
import { ChamberTransportManagementDrawer } from "@/features/office/components/chamber-transport-management-drawer";
import { ChamberTransportWorkforceOverview } from "@/features/office/components/chamber-transport-workforce-overview";
import { listTransportGroups } from "@/features/transport/services/transport-crew-service";
import { listTransportWorkers } from "@/features/transport/services/transport-worker-service";
import { subscribeTransportCreditAuth, verifyTransportCreditActor } from "@/features/transport/services/transport-wage-credit-service";

const workerQueryKey = (factoryId: string) => ["office-transport-workers", factoryId] as const;
const groupQueryKey = (factoryId: string) => ["office-transport-groups", factoryId] as const;

export function TransportOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const client = useQueryClient();
  const recoveryController = useMemo(() => createTransportCreditRecovery(client, factoryId, verifyTransportCreditActor, browserCreditStorage), [client, factoryId]);
  const recovery = useSyncExternalStore(recoveryController.subscribe, recoveryController.getSnapshot, recoveryController.getSnapshot);
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
  useEffect(() => {
    if (!workersQuery.data) return;
    const workers = workersQuery.data.map((worker) => worker.id);
    void recoveryController.inspect(workers);
    const unsubscribeAuth = subscribeTransportCreditAuth((_event, actorId) => {
      // Invalidate readiness synchronously; isolated verification runs outside the callback.
      void recoveryController.inspect(workers, actorId, true);
    });
    const changed = () => { void recoveryController.inspect(workers); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("atlas.transport.credit.v1:")) changed();
    };
    const visible = () => { if (document.visibilityState === "visible") changed(); };
    window.addEventListener("storage", storageChanged);
    window.addEventListener(CREDIT_STORAGE_EVENT, changed);
    document.addEventListener("visibilitychange", visible);
    return () => {
      recoveryController.stop(); unsubscribeAuth();
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(CREDIT_STORAGE_EVENT, changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [recoveryController, workersQuery.data]);

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
        recovery={recovery}
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
          key={`${recovery.actorId}:${factoryId}:${accountWorker.id}`}
          factoryId={factoryId}
          worker={accountWorker}
          recovery={recovery}
          onClose={() => setActiveView("overview")}
        />
      )}
    </section>
  );
}
