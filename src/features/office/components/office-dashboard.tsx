"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { DashboardFeature } from "@/features/dashboard/components/dashboard-feature";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { OfficeShell } from "@/features/office/components/office-shell";
import { ProductionOfficeWorkspace } from "@/features/office/components/production-office-workspace";
import {
  WorkforceOfficeWorkspace,
  type WorkforceWorkspaceArea,
} from "@/features/office/components/workforce-office-workspace";
import { ProductionWorkerAccountDrawer } from "@/features/office/components/production-worker-account-drawer";
import { ProductionWorkerManagementDrawer } from "@/features/office/components/production-worker-management-drawer";
import {
  AddProductionLabourerDrawer,
  type AddProductionLabourerInput,
} from "@/features/office/components/add-production-labourer-drawer";
import { ProductionBulkRateSetting } from "@/features/office/components/production-bulk-rate-setting";
import { formatProductionWorkerLastPaid } from "@/features/office/production-worker-account-model";
import { getTodaysProduction } from "@/features/office/services/todays-production-service";
import {
  resolveOfficeAreaFromHash,
  type OfficeAreaId,
} from "@/features/office/office-navigation";
import { TransportOfficeSection } from "@/features/office/components/transport-office-section";
import { StaffOfficeSection } from "@/features/office/components/staff-office-section";
import { SoilOfficeSection } from "@/features/office/components/soil-office-section";
import { SalesOfficeSection } from "@/features/office/components/sales-office-section";
import { CoalPurchaseOfficeSection } from "@/features/office/components/coal-purchase-office-section";
import { VehicleMaintenanceOfficeSection } from "@/features/office/components/vehicle-maintenance-office-section";
import { VehicleFuelOfficeSection } from "@/features/office/components/vehicle-fuel-office-section";
import { ExpensesOfficeSection } from "@/features/office/components/expenses-office-section";
import { CashBookOfficeSection } from "@/features/office/components/cash-book-office-section";
import { MudGroupManagement } from "@/features/office/components/mud-group-management";
import { getLatestLabourerWithdrawalsForFactory } from "@/features/wages/services/labourer-withdrawal-history-service";
import { assignLabourerToProductionCrew, endLabourerProductionCrewAssignment, ProductionCrewAssignmentMutationError, type ProductionCrewAssignment } from "@/features/wages/services/production-crew-assignment-service";
import { createProductionCrew, getCurrentProductionCrewAssignment, getProductionCrewAssignments, getProductionCrews, ProductionCrewMutationError, setProductionCrewActive, type ProductionCrew } from "@/features/wages/services/production-crew-service";
import { CreateProductionWageRateError, createLabourerProductionWageRateOverride, createProductionCrewWageRate } from "@/features/wages/services/production-wage-rate-create-service";
import { getCurrentCrewProductionWageRate, getCurrentLabourerProductionWageRate, getCurrentLabourerProductionWageRateOverride, getProductionWageRatesForFactory, type ProductionWageRate } from "@/features/wages/services/production-wage-rate-read-service";
import { calculateProductionWage } from "@/features/wages/services/production-wage-calculation";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "@/lib/formatting";
import { getLocalDate } from "@/lib/local-date";
import {
  PRODUCTION_LABOURER_LIFECYCLE_STATUS,
  resolveBooleanStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";
import { supabase } from "@/lib/supabase/client";

type BrickType = { id: string; name: string; isActive: boolean };

const brickTypeFormSchema = z.object({ name: z.string().trim().min(1, "Brick type name is required.") });

type BrickTypeFormValues = z.infer<typeof brickTypeFormSchema>;

type ManagedLabourer = {
  id: string;
  name: string;
  originLabel: string | null;
  isActive: boolean;
};

export function OfficeDashboard() {
  const router = useRouter();
  const [activeArea, setActiveArea] = useState<OfficeAreaId>("dashboard");
  const [workforceArea, setWorkforceArea] = useState<WorkforceWorkspaceArea>("production-workers");
  const [salesNavigationTarget, setSalesNavigationTarget] = useState<"new-challan" | null>(null);
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [factoryAccessStatus, setFactoryAccessStatus] = useState<"loading" | "ready" | "denied" | "failed">("loading");
  const [factoryAccessMessage, setFactoryAccessMessage] = useState("");
  const [factoryResolutionAttempt, setFactoryResolutionAttempt] = useState(0);
  const [brickTypes, setBrickTypes] = useState<readonly BrickType[]>([]);
  const [labourers, setLabourers] = useState<readonly ManagedLabourer[]>([]);
  const [isLoadingLabourers, setIsLoadingLabourers] = useState(true);
  const [labourersError, setLabourersError] = useState("");
  const [brickTypesError, setBrickTypesError] = useState("");
  const [updatingLabourerId, setUpdatingLabourerId] = useState("");
  const [updatingBrickTypeId, setUpdatingBrickTypeId] = useState("");

  useEffect(() => {
    let isCancelled = false;

    async function resolveFactoryAccess() {
      setFactoryAccessStatus("loading");
      setFactoryAccessMessage("");
      setFactoryId(null);
      const result = await resolveAuthenticatedFactoryId();
      if (isCancelled) return;
      if (result.ok) {
        setFactoryId(result.factoryId);
        setFactoryAccessStatus("ready");
        return;
      }
      if (result.error.code === "unauthenticated") {
        router.replace("/login");
        return;
      }
      setFactoryAccessMessage(result.error.message);
      setFactoryAccessStatus(result.error.code === "request_failed" ? "failed" : "denied");
    }

    void resolveFactoryAccess();
    return () => { isCancelled = true; };
  }, [factoryResolutionAttempt, router]);

  useEffect(() => {
    function syncAreaFromHash() {
      const hash = window.location.hash;
      setActiveArea(resolveOfficeAreaFromHash(hash));
      setSalesNavigationTarget(hash === "#new-challan" ? "new-challan" : null);
    }

    syncAreaFromHash();
    window.addEventListener("hashchange", syncAreaFromHash);
    return () => window.removeEventListener("hashchange", syncAreaFromHash);
  }, []);

  const loadLabourers = useCallback(async () => {
    if (!factoryId) return;

    setIsLoadingLabourers(true);
    setLabourersError("");
    setBrickTypesError("");
    const [{ data: labourerRows, error: labourerError }, { data: brickTypeRows, error: brickTypeError }] = await Promise.all([
      supabase.from("labourers").select("id, name, production_origin_label, is_active").eq("factory_id", factoryId).order("name"),
      supabase.from("brick_types").select("id, name, is_active").eq("factory_id", factoryId).order("name"),
    ]);
    if (labourerError) {
      console.error({ context: "Failed to load Production workers", message: labourerError.message, code: labourerError.code, details: labourerError.details, hint: labourerError.hint });
      setLabourersError(labourerError.message);
    } else {
      setLabourers((labourerRows ?? []).map((labourer) => ({
        id: labourer.id,
        name: labourer.name,
        originLabel: labourer.production_origin_label,
        isActive: labourer.is_active,
      })));
    }
    if (brickTypeError) {
      console.error({ context: "Failed to load Sales Brick Types", message: brickTypeError.message, code: brickTypeError.code, details: brickTypeError.details, hint: brickTypeError.hint });
      setBrickTypesError(brickTypeError.message);
    } else {
      setBrickTypes((brickTypeRows ?? []).map((brickType) => ({
        id: brickType.id,
        name: brickType.name,
        isActive: brickType.is_active,
      })));
    }
    setIsLoadingLabourers(false);
  }, [factoryId]);

  useEffect(() => { if (factoryId) void loadLabourers(); }, [factoryId, loadLabourers]);

  async function toggleLabourer(labourer: ManagedLabourer): Promise<string | null> {
    if (!factoryId) return "Factory is unavailable.";

    setUpdatingLabourerId(labourer.id);
    setLabourersError("");
    const { error } = await supabase
      .from("labourers")
      .update({ is_active: !labourer.isActive })
      .eq("id", labourer.id)
      .eq("factory_id", factoryId);
    if (error) {
      console.error({ context: "Failed to update labourer", message: error.message, code: error.code, details: error.details, hint: error.hint });
      setLabourersError(error.message);
      setUpdatingLabourerId("");
      return error.message;
    }

    setLabourers((current) => current.map((item) => item.id === labourer.id ? { ...item, isActive: !item.isActive } : item));
    setUpdatingLabourerId("");
    return null;
  }

  async function toggleBrickType(brickType: BrickType) {
    if (!factoryId) return;

    setBrickTypesError("");
    setUpdatingBrickTypeId(brickType.id);
    const { error } = await supabase
      .from("brick_types")
      .update({ is_active: !brickType.isActive })
      .eq("id", brickType.id)
      .eq("factory_id", factoryId);
    if (error) {
      console.error({ context: "Failed to update brick type", message: error.message, code: error.code, details: error.details, hint: error.hint });
      setBrickTypesError(error.message);
      setUpdatingBrickTypeId("");
      return;
    }

    setBrickTypes((current) => current.map((item) => item.id === brickType.id ? { ...item, isActive: !item.isActive } : item));
    setUpdatingBrickTypeId("");
  }

  async function saveLabourerName(labourer: ManagedLabourer, name: string): Promise<string | null> {
    if (!factoryId) return "Factory is unavailable.";

    setUpdatingLabourerId(labourer.id);
    setLabourersError("");
    const { error } = await supabase
      .from("labourers")
      .update({ name })
      .eq("id", labourer.id)
      .eq("factory_id", factoryId);
    if (error) {
      console.error({ context: "Failed to update labourer name", message: error.message, code: error.code, details: error.details, hint: error.hint });
      setLabourersError(error.message);
      setUpdatingLabourerId("");
      return error.message;
    }

    setLabourers((current) => current.map((item) => item.id === labourer.id ? { ...item, name } : item));
    setUpdatingLabourerId("");
    return null;
  }

  async function createProductionLabourer({
    name,
    originLabel,
  }: AddProductionLabourerInput): Promise<string | null> {
    if (!factoryId) return "Factory is unavailable.";

    const { error } = await supabase.from("labourers").insert({
      factory_id: factoryId,
      name,
      production_origin_label: originLabel,
      is_active: true,
    });
    if (error) {
      console.error({
        context: "Failed to add Production labourer",
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return error.message;
    }

    await loadLabourers();
    return null;
  }

  if (factoryAccessStatus === "loading") {
    return <main className="min-h-screen bg-atlas-background px-atlas-4 py-atlas-8 font-atlas text-atlas-text"><div className="mx-auto max-w-6xl"><Feedback role="status" tone="neutral">Loading factory access...</Feedback></div></main>;
  }
  if (factoryAccessStatus === "denied") {
    return <main className="min-h-screen bg-atlas-background px-atlas-4 py-atlas-8 font-atlas text-atlas-text"><div className="mx-auto max-w-6xl"><Feedback role="alert" tone="danger">Access denied: {factoryAccessMessage}</Feedback></div></main>;
  }
  if (factoryAccessStatus === "failed") {
    return <main className="min-h-screen bg-atlas-background px-atlas-4 py-atlas-8 font-atlas text-atlas-text"><div className="mx-auto max-w-6xl"><Feedback role="alert" tone="danger">{factoryAccessMessage}</Feedback><div className="mt-atlas-4"><Button type="button" variant="secondary" onClick={() => setFactoryResolutionAttempt((attempt) => attempt + 1)}>Try again</Button></div></div></main>;
  }

  return (
    <OfficeShell activeArea={activeArea} onAreaChange={setActiveArea}>
      <section id="dashboard" aria-label="Dashboard" hidden={activeArea !== "dashboard"}>
        <div id="office-dashboard-feature" className="scroll-mt-atlas-16">
          <DashboardFeature factoryId={factoryId!} />
        </div>
      </section>

      <section id="production" aria-label="Production" hidden={activeArea !== "production"}>
        <ProductionOfficeWorkspace factoryId={factoryId!} />
      </section>

      <section id="workforce" aria-label="Workforce" hidden={activeArea !== "workforce"}>
        <WorkforceOfficeWorkspace activeArea={workforceArea} onAreaChange={setWorkforceArea}>
          <div hidden={workforceArea !== "production-workers"}>
            <LabourerManagement
              factoryId={factoryId!}
              labourers={labourers}
              isLoading={isLoadingLabourers}
              error={labourersError}
              updatingLabourerId={updatingLabourerId}
              onToggle={toggleLabourer}
              onSaveName={saveLabourerName}
              onOriginChanged={loadLabourers}
              onCreateLabourer={createProductionLabourer}
            />
          </div>
          <div hidden={workforceArea !== "mud-supply"}><MudGroupManagement factoryId={factoryId!} /></div>
          <div hidden={workforceArea !== "chamber-transport"}><TransportOfficeSection factoryId={factoryId!} /></div>
          <div hidden={workforceArea !== "soil-workers"}><SoilOfficeSection factoryId={factoryId!} /></div>
          <div hidden={workforceArea !== "staff"}><StaffOfficeSection factoryId={factoryId!} /></div>
        </WorkforceOfficeWorkspace>
      </section>

      <SalesOfficeSection
        activeArea={activeArea}
        navigationTarget={salesNavigationTarget}
        factoryId={factoryId!}
        brickTypes={brickTypes}
        isLoadingBrickTypes={isLoadingLabourers}
        brickTypesError={brickTypesError}
        showVehicleWages={activeArea === "workforce" && workforceArea === "vehicle-delivery-wages"}
      />

      <section id="purchases-expenses" aria-label="Purchases and Expenses" hidden={activeArea !== "purchases-expenses"}>
        <CoalPurchaseOfficeSection factoryId={factoryId!} />
        <VehicleMaintenanceOfficeSection factoryId={factoryId!} />
        <VehicleFuelOfficeSection factoryId={factoryId!} />
      </section>

      <ExpensesOfficeSection activeArea={activeArea} factoryId={factoryId!} />

      <section id="cash-book" aria-label="Cash Book" hidden={activeArea !== "cash-book"}>
        <CashBookOfficeSection factoryId={factoryId!} />
      </section>

      <section id="reports" aria-label="Reports" hidden={activeArea !== "reports"}>
        <div className="max-w-3xl border-y border-atlas-border py-atlas-6">
          <h2 className="text-atlas-xl font-atlas-semibold text-atlas-text">Reports stay with their source records</h2>
          <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">Open the relevant area for its existing authoritative register or history. This shell does not copy financial data into a second reporting source.</p>
          <nav aria-label="Available reporting areas" className="mt-atlas-4 flex flex-wrap gap-atlas-2">
            {(["sales", "purchases-expenses", "cash-book"] as const).map((area) => (
              <a key={area} href={`#${area}`} onClick={() => setActiveArea(area)} className="inline-flex min-h-atlas-12 items-center rounded-atlas-button border border-atlas-border-strong bg-atlas-surface px-atlas-4 text-atlas-sm font-atlas-semibold text-atlas-text hover:bg-atlas-surface-hover focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
                {area === "sales" ? "Sales records" : area === "purchases-expenses" ? "Purchase and expense records" : "Cash Book records"}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section aria-label="Brick type settings" hidden={activeArea !== "settings"}>
        <AddBrickTypeForm factoryId={factoryId!} onAdded={loadLabourers} />
        <BrickTypeManagement
          brickTypes={brickTypes}
          error={brickTypesError}
          updatingBrickTypeId={updatingBrickTypeId}
          onToggle={toggleBrickType}
        />
      </section>
    </OfficeShell>
  );
}

function formatWageRate(rate: number) {
  return `₹${rate.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / 1,000 bricks`;
}

function ProductionCrewManagement({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const { data: crews = [], error, isLoading } = useQuery({
    queryKey: ["office-production-crews", factoryId],
    queryFn: () => getProductionCrews(factoryId),
  });
  const { data: productionRates = [], error: productionRatesError, isLoading: isLoadingProductionRates } = useQuery({
    queryKey: ["office-production-wage-rates", factoryId],
    queryFn: () => getProductionWageRatesForFactory(factoryId),
  });
  const [name, setName] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingCrewId, setUpdatingCrewId] = useState("");
  const [historyCrewId, setHistoryCrewId] = useState("");

  function clearFeedback() {
    setMutationError("");
    setSuccessMessage("");
  }

  function mutationErrorMessage(caught: unknown, fallback: string) {
    if (caught instanceof ProductionCrewMutationError) return caught.message;
    return caught instanceof Error ? caught.message : fallback;
  }

  async function addCrew(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setMutationError("Crew name is required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createProductionCrew({ factoryId, name: trimmedName });
      setName("");
      setSuccessMessage("Production crew added.");
      await queryClient.invalidateQueries({ queryKey: ["office-production-crews", factoryId] });
    } catch (caught) {
      setMutationError(mutationErrorMessage(caught, "Could not add production crew."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleCrew(crew: ProductionCrew) {
    if (updatingCrewId) return;

    setUpdatingCrewId(crew.id);
    clearFeedback();
    try {
      await setProductionCrewActive({ factoryId, crewId: crew.id, isActive: !crew.isActive });
      setSuccessMessage(crew.isActive ? "Production crew deactivated." : "Production crew reactivated.");
      await queryClient.invalidateQueries({ queryKey: ["office-production-crews", factoryId] });
    } catch (caught) {
      setMutationError(mutationErrorMessage(caught, "Could not update production crew."));
    } finally {
      setUpdatingCrewId("");
    }
  }

  const loadErrorMessage = error instanceof Error ? error.message : "Could not load production crews.";
  const productionRatesErrorMessage = productionRatesError instanceof Error ? productionRatesError.message : "Could not load production wage rates.";
  const activeCrews = crews.filter((crew) => crew.isActive);
  const historyCrew = crews.find((crew) => crew.id === historyCrewId) ?? null;
  const historyRates = productionRates.filter((rate) => rate.productionCrewId === historyCrewId && rate.labourerId === null);
  const today = getLocalDate();

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Production Crews</h2>
      <form className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={(event) => void addCrew(event)}>
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Crew name
          <input value={name} onChange={(event) => { setName(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Adding..." : "Add Production Crew"}</button>
      </form>
      {mutationError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{mutationError}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p>}

      {!isLoading && !error && !isLoadingProductionRates && !productionRatesError && crews.length > 0 && <ProductionCrewRateForm factoryId={factoryId} activeCrews={activeCrews} />}
      {isLoadingProductionRates && <p className="mt-5 text-sm text-slate-500">Loading production crew rates...</p>}
      {productionRatesError && <p role="alert" className="mt-5 text-sm font-medium text-red-700">Could not load production wage rates: {productionRatesErrorMessage}</p>}

      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading production crews...</p>}
      {error && <p role="alert" className="mt-5 text-sm font-medium text-red-700">Could not load production crews: {loadErrorMessage}</p>}
      {!isLoading && !error && crews.length === 0 && <p className="mt-5 text-sm text-slate-500">No production crews configured.</p>}
      {!isLoading && !error && crews.length > 0 && <div className="mt-5 space-y-3">
        {crews.map((crew) => {
          const isUpdating = updatingCrewId === crew.id;
          const currentRate = getCurrentCrewProductionWageRate(productionRates, crew.id, today);
          return <article key={crew.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold">{crew.name}</h3>
              <p className="mt-1 text-sm text-slate-600">{isLoadingProductionRates ? "Rate: Loading..." : productionRatesError ? "Rate unavailable" : currentRate ? formatWageRate(currentRate.ratePer1000Bricks) : "Rate not set"}</p>
              <p className={`mt-1 text-sm font-medium ${crew.isActive ? "text-emerald-700" : "text-slate-500"}`}>{crew.isActive ? "Active" : "Inactive"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={isLoadingProductionRates || Boolean(productionRatesError)} onClick={() => setHistoryCrewId((current) => current === crew.id ? "" : crew.id)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{historyCrewId === crew.id ? "Hide Rate History" : "View Rate History"}</button>
              <button type="button" disabled={Boolean(updatingCrewId)} onClick={() => void toggleCrew(crew)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                {isUpdating ? "Updating..." : crew.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </article>;
        })}
      </div>}
      {historyCrew && <div className="mt-5 border-t border-slate-200 pt-5">
        <ProductionRateHistory title={`${historyCrew.name} rate history`} rates={historyRates} asOfDate={today} />
      </div>}
    </section>
  );
}

function ProductionCrewRateForm({ factoryId, activeCrews }: Readonly<{ factoryId: string; activeCrews: readonly ProductionCrew[] }>) {
  const queryClient = useQueryClient();
  const [crewId, setCrewId] = useState("");
  const [ratePer1000Bricks, setRatePer1000Bricks] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => getLocalDate());
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function clearFeedback() {
    setSubmitError("");
    setIsSaved(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const rate = Number(ratePer1000Bricks);
    if (!activeCrews.some((crew) => crew.id === crewId)) {
      setSubmitError("Choose an active production crew.");
      return;
    }
    if (!ratePer1000Bricks || !Number.isFinite(rate) || rate <= 0) {
      setSubmitError("Rate per 1,000 bricks must be greater than zero.");
      return;
    }
    if (!effectiveFrom) {
      setSubmitError("Effective-from date is required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createProductionCrewWageRate({ factoryId, productionCrewId: crewId, ratePer1000Bricks: rate, effectiveFrom });
      setRatePer1000Bricks("");
      setIsSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["office-production-wage-rates", factoryId] });
    } catch (caught) {
      setSubmitError(caught instanceof CreateProductionWageRateError ? caught.message : caught instanceof Error ? caught.message : "Could not save production crew rate.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4 rounded-lg border border-slate-200 p-4 md:grid-cols-4 md:items-end" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium text-slate-700">
        Active production crew
        <select value={crewId} onChange={(event) => { setCrewId(event.target.value); clearFeedback(); }} required disabled={isSubmitting || activeCrews.length === 0} className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100">
          <option value="" disabled>Select a crew</option>
          {activeCrews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Rate per 1,000 bricks
        <input type="number" min="0" step="any" value={ratePer1000Bricks} onChange={(event) => { setRatePer1000Bricks(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Effective from
        <input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <button type="submit" disabled={isSubmitting || activeCrews.length === 0} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Set Crew Rate"}</button>
      {activeCrews.length === 0 && <p className="text-sm text-slate-500 md:col-span-4">No active production crew is available.</p>}
      {submitError && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-4">{submitError}</p>}
      {isSaved && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-4">Production crew rate saved.</p>}
    </form>
  );
}

function ProductionRateHistory({ title, rates, asOfDate }: Readonly<{ title: string; rates: readonly ProductionWageRate[]; asOfDate: string }>) {
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      {rates.length === 0 ? <p className="mt-2 text-sm text-slate-500">No production rates recorded.</p> : <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rates.map((rate) => {
          const isCurrent = rate.effectiveFrom <= asOfDate && (rate.effectiveTo === null || rate.effectiveTo >= asOfDate);
          const period = isCurrent
            ? `Current · from ${formatDate(rate.effectiveFrom)}`
            : rate.effectiveFrom > asOfDate
              ? `Future · from ${formatDate(rate.effectiveFrom)}`
              : `${formatDate(rate.effectiveFrom)} — ${formatDate(rate.effectiveTo!)}`;
          return <li key={rate.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="font-semibold tabular-nums">{formatWageRate(rate.ratePer1000Bricks)}</span>
            <span className="text-right text-slate-600">{period}</span>
          </li>;
        })}
      </ul>}
    </div>
  );
}


function AddBrickTypeForm({ factoryId, onAdded }: Readonly<{ factoryId: string; onAdded: () => Promise<void> }>) {
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<BrickTypeFormValues>({ defaultValues: { name: "" } });

  async function addBrickType(values: BrickTypeFormValues) {
    const parsed = brickTypeFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("name", { message: parsed.error.issues[0]?.message });
      return;
    }

    setSubmitError("");
    const { error } = await supabase.from("brick_types").insert({
      factory_id: factoryId,
      name: parsed.data.name,
      is_active: true,
    });
    if (error) {
      console.error({ context: "Failed to add brick type", message: error.message, code: error.code, details: error.details, hint: error.hint });
      setSubmitError(error.message);
      return;
    }

    reset();
    setIsSaved(true);
    await onAdded();
  }

  return (
    <section className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Add Brick Type</h2>
      <form className="mt-5 space-y-4" onSubmit={handleSubmit(addBrickType)}>
        <label className="block text-sm font-medium text-slate-700">
          Brick-type name
          <input {...register("name", { onChange: () => setIsSaved(false) })} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950" />
        </label>
        {errors.name && <p role="alert" className="text-sm font-medium text-red-700">{errors.name.message}</p>}
        {submitError && <p role="alert" className="text-sm font-medium text-red-700">{submitError}</p>}
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Adding..." : "Add Brick Type"}</button>
        {isSaved && <p role="status" className="text-sm font-medium text-emerald-700">Brick type added.</p>}
      </form>
    </section>
  );
}

function BrickTypeManagement({ brickTypes, error, updatingBrickTypeId, onToggle }: Readonly<{
  brickTypes: readonly BrickType[];
  error: string;
  updatingBrickTypeId: string;
  onToggle: (brickType: BrickType) => Promise<void>;
}>) {
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Brick Types</h2>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}
      <div className="mt-4 space-y-3">
        {brickTypes.map((brickType) => {
          const isUpdating = updatingBrickTypeId === brickType.id;
          return (
            <article key={brickType.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold">{brickType.name}</h3>
                <p className={`mt-1 text-sm font-medium ${brickType.isActive ? "text-emerald-700" : "text-slate-500"}`}>{brickType.isActive ? "Active" : "Inactive"}</p>
              </div>
              <button type="button" disabled={isUpdating} onClick={() => void onToggle(brickType)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                {isUpdating ? "Updating..." : brickType.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LabourerManagement({ factoryId, labourers, isLoading, error, updatingLabourerId, onToggle, onSaveName, onOriginChanged, onCreateLabourer }: Readonly<{
  factoryId: string;
  labourers: readonly ManagedLabourer[];
  isLoading: boolean;
  error: string;
  updatingLabourerId: string;
  onToggle: (labourer: ManagedLabourer) => Promise<string | null>;
  onSaveName: (labourer: ManagedLabourer, name: string) => Promise<string | null>;
  onOriginChanged: () => Promise<void>;
  onCreateLabourer: (input: AddProductionLabourerInput) => Promise<string | null>;
}>) {
  const asOfDate = getLocalDate();
  const { data: productionWageRates = [], error: productionWageRatesError, isLoading: isLoadingProductionWageRates } = useQuery({
    queryKey: ["office-production-wage-rates", factoryId],
    queryFn: () => getProductionWageRatesForFactory(factoryId),
  });
  const productionTodayQuery = useQuery({
    queryKey: ["office-production-workers-overview", factoryId, asOfDate],
    queryFn: () => getTodaysProduction(factoryId, asOfDate),
    refetchInterval: 30_000,
  });
  const latestWithdrawalsQuery = useQuery({
    queryKey: ["labourer-latest-withdrawals", factoryId],
    queryFn: () => getLatestLabourerWithdrawalsForFactory(factoryId),
    refetchInterval: 30_000,
  });
  const [accountLabourerId, setAccountLabourerId] = useState("");
  const [managementLabourerId, setManagementLabourerId] = useState("");
  const [isAddLabourerOpen, setIsAddLabourerOpen] = useState(false);
  const [isBulkRateOpen, setIsBulkRateOpen] = useState(false);
  const [workerSearch, setWorkerSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | "active" | "archived">("all");
  const productionWageRatesErrorMessage = productionWageRatesError instanceof Error ? productionWageRatesError.message : "Could not load production wage rates.";
  const productionTodayErrorMessage = productionTodayQuery.error instanceof Error
    ? productionTodayQuery.error.message
    : "Could not load today's Production work.";
  const productionByLabourerId = new Map<string, number>();
  for (const entry of productionTodayQuery.data ?? []) {
    productionByLabourerId.set(
      entry.labourerId,
      (productionByLabourerId.get(entry.labourerId) ?? 0) + entry.quantity,
    );
  }
  const activeCount = labourers.filter((labourer) => labourer.isActive).length;
  const archivedCount = labourers.length - activeCount;
  const normalizedSearch = workerSearch.trim().toLocaleLowerCase("en-IN");
  const visibleLabourers = labourers.filter((labourer) => {
    if (lifecycleFilter === "active" && !labourer.isActive) return false;
    if (lifecycleFilter === "archived" && labourer.isActive) return false;
    if (!normalizedSearch) return true;
    return [labourer.name, labourer.originLabel ?? ""]
      .some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedSearch));
  });
  const latestWithdrawalByLabourerId = new Map(
    (latestWithdrawalsQuery.data ?? []).map((withdrawal) => [withdrawal.labourerId, withdrawal]),
  );
  const selectedAccountLabourer = labourers.find((labourer) => labourer.id === accountLabourerId) ?? null;
  const selectedManagedLabourer = labourers.find((labourer) => labourer.id === managementLabourerId) ?? null;

  function getWorkerOverview(labourer: ManagedLabourer) {
    const quantity = productionByLabourerId.get(labourer.id) ?? 0;
    const currentRate = getCurrentLabourerProductionWageRate(
      productionWageRates,
      labourer.id,
      asOfDate,
    );
    const amount = quantity === 0
      ? 0
      : currentRate
        ? calculateProductionWage(quantity, currentRate.ratePer1000Bricks)
        : null;
    const status = resolveBooleanStatusPresentation(
      PRODUCTION_LABOURER_LIFECYCLE_STATUS,
      labourer.isActive,
    );
    const latestWithdrawal = latestWithdrawalByLabourerId.get(labourer.id) ?? null;
    return {
      amount,
      currentRate,
      quantity,
      status,
      lastPaid: formatProductionWorkerLastPaid(latestWithdrawal?.withdrawalDate ?? null, asOfDate),
    };
  }

  return (
    <section aria-labelledby="production-workers-heading">
      <header className="flex flex-col gap-atlas-3 border-b border-atlas-border pb-atlas-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
            Today · {formatDateOnly(asOfDate)}
          </p>
          <h3 id="production-workers-heading" className="mt-atlas-1 text-atlas-2xl font-atlas-semibold text-atlas-text">
            Production workers
          </h3>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
            {formatIndianNumber(activeCount)} active · {formatIndianNumber(archivedCount)} archived
          </p>
        </div>
        <div className="flex max-w-xl flex-col items-start gap-atlas-3 sm:items-end">
          <p className="text-atlas-sm text-atlas-text-muted sm:text-right">
            Work and earnings shown here use today&apos;s saved Production entries and each worker&apos;s direct effective-dated rate.
          </p>
          <div className="flex flex-wrap gap-atlas-2">
            <Button
              variant="secondary"
              aria-expanded={isBulkRateOpen}
              disabled={isLoading || activeCount === 0}
              onClick={() => { setAccountLabourerId(""); setManagementLabourerId(""); setIsAddLabourerOpen(false); setIsBulkRateOpen(true); }}
            >
              Set rates
            </Button>
            <Button
              aria-expanded={isAddLabourerOpen}
              onClick={() => { setAccountLabourerId(""); setManagementLabourerId(""); setIsBulkRateOpen(false); setIsAddLabourerOpen(true); }}
            >
              + Add labourer
            </Button>
          </div>
        </div>
      </header>

      {!isBulkRateOpen && <div className="mt-atlas-4 flex flex-col gap-atlas-3 lg:flex-row lg:items-end lg:justify-between">
        <div aria-label="Filter Production workers by lifecycle" className="flex gap-atlas-2 overflow-x-auto pb-atlas-1">
          {([
            ["all", `All ${formatIndianNumber(labourers.length)}`],
            ["active", `Active ${formatIndianNumber(activeCount)}`],
            ["archived", `Archived ${formatIndianNumber(archivedCount)}`],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              variant={lifecycleFilter === value ? "primary" : "ghost"}
              aria-pressed={lifecycleFilter === value}
              onClick={() => setLifecycleFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="w-full lg:max-w-sm">
          <FormField label="Search Production workers">
            <Input
              type="search"
              value={workerSearch}
              onChange={(event) => setWorkerSearch(event.target.value)}
              placeholder="Search worker or origin"
              autoComplete="off"
            />
          </FormField>
        </div>
      </div>}

      <div className="mt-atlas-4 space-y-atlas-3">
        {error && <Feedback role="alert" tone="danger">Could not load Production workers: {error}</Feedback>}
        {productionWageRatesError && <Feedback role="alert" tone="danger">Could not load Production wage rates: {productionWageRatesErrorMessage}</Feedback>}
        {productionTodayQuery.error && <Feedback role="alert" tone="danger">Could not load today&apos;s Production work: {productionTodayErrorMessage}</Feedback>}
        {latestWithdrawalsQuery.error && <Feedback role="alert" tone="danger">Could not load latest Production worker payments.</Feedback>}
      </div>

      {isBulkRateOpen ? (
        <ProductionBulkRateSetting
          factoryId={factoryId}
          labourers={labourers}
          onClose={() => setIsBulkRateOpen(false)}
        />
      ) : isLoading ? (
        <div className="mt-atlas-4"><Feedback role="status" tone="neutral">Loading Production workers...</Feedback></div>
      ) : visibleLabourers.length === 0 ? (
        <EmptyState
          title={labourers.length === 0 ? "No Production workers yet" : "No workers match these filters"}
          description={labourers.length === 0 ? "Use Add labourer to create the first Production worker." : "Clear the search or choose another lifecycle filter."}
        />
      ) : (
        <>
          <div className="mt-atlas-4 hidden md:block">
            <TableContainer>
              <Table wide>
                <TableCaption visuallyHidden>Production worker overview for {formatDateOnly(asOfDate)}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Worker</TableHeaderCell>
                    <TableHeaderCell numeric>Work done</TableHeaderCell>
                    <TableHeaderCell numeric>Rate</TableHeaderCell>
                    <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
                    <TableHeaderCell>Last paid</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLabourers.map((labourer) => {
                    const overview = getWorkerOverview(labourer);
                    return (
                      <TableRow key={labourer.id} hoverable>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-atlas-2">
                            <p className="font-atlas-semibold text-atlas-text">{labourer.name}</p>
                            <StatusPill label={overview.status.label} tone={overview.status.tone} />
                          </div>
                          {labourer.originLabel && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{labourer.originLabel}</p>}
                        </TableCell>
                        <TableCell numeric>
                          <p className="font-atlas-medium text-atlas-text">
                            {productionTodayQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : `${formatIndianNumber(overview.quantity)} bricks`}
                          </p>
                          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">Today</p>
                        </TableCell>
                        <TableCell numeric>
                          <p className="text-atlas-text-muted">
                            {isLoadingProductionWageRates
                              ? ATLAS_UI_STRINGS.feedback.loading
                              : productionWageRatesError
                                ? ATLAS_UI_STRINGS.feedback.unavailable
                                : overview.currentRate
                                  ? `${formatIndianCurrency(overview.currentRate.ratePer1000Bricks)} / 1,000`
                                  : "Rate not set"}
                          </p>
                        </TableCell>
                        <TableCell numeric>
                          <p className="text-atlas-lg font-atlas-semibold text-atlas-text">
                            {productionTodayQuery.isLoading
                              ? ATLAS_UI_STRINGS.feedback.loading
                              : productionTodayQuery.error
                                ? ATLAS_UI_STRINGS.feedback.unavailable
                                : overview.amount === null
                                  ? ATLAS_UI_STRINGS.feedback.unavailable
                                  : formatIndianCurrency(overview.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-atlas-sm font-atlas-medium text-atlas-text-muted">
                            {latestWithdrawalsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : overview.lastPaid}
                          </p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-atlas-2">
                            <Button
                              aria-expanded={accountLabourerId === labourer.id}
                              onClick={() => { setManagementLabourerId(""); setAccountLabourerId(labourer.id); }}
                            >
                              Account &amp; payment
                            </Button>
                            <Button
                              variant="ghost"
                              aria-expanded={managementLabourerId === labourer.id}
                              onClick={() => { setAccountLabourerId(""); setManagementLabourerId((current) => current === labourer.id ? "" : labourer.id); }}
                            >
                              Manage
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </div>

          <div className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
            {visibleLabourers.map((labourer) => {
              const overview = getWorkerOverview(labourer);
              return (
                <article key={labourer.id} className="py-atlas-4">
                  <div className="flex items-start justify-between gap-atlas-3">
                    <div className="min-w-0">
                      <h4 className="truncate text-atlas-base font-atlas-semibold text-atlas-text">{labourer.name}</h4>
                      {labourer.originLabel && <p className="mt-atlas-1 text-atlas-xs text-atlas-text-subtle">{labourer.originLabel}</p>}
                    </div>
                    <StatusPill label={overview.status.label} tone={overview.status.tone} />
                  </div>
                  <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3 text-atlas-sm">
                    <div><dt className="text-atlas-xs text-atlas-text-subtle">Work done today</dt><dd className="mt-atlas-1 font-atlas-medium tabular-nums text-atlas-text">{productionTodayQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : productionTodayQuery.error ? ATLAS_UI_STRINGS.feedback.unavailable : `${formatIndianNumber(overview.quantity)} bricks`}</dd></div>
                    <div><dt className="text-atlas-xs text-atlas-text-subtle">Rate</dt><dd className="mt-atlas-1 text-right tabular-nums text-atlas-text-muted">{isLoadingProductionWageRates ? ATLAS_UI_STRINGS.feedback.loading : productionWageRatesError ? ATLAS_UI_STRINGS.feedback.unavailable : overview.currentRate ? `${formatIndianCurrency(overview.currentRate.ratePer1000Bricks)} / 1,000` : "Rate not set"}</dd></div>
                    <div><dt className="text-atlas-xs text-atlas-text-subtle">Today&apos;s earnings</dt><dd className="mt-atlas-1 font-atlas-semibold tabular-nums text-atlas-text">{productionTodayQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : productionTodayQuery.error || overview.amount === null ? ATLAS_UI_STRINGS.feedback.unavailable : formatIndianCurrency(overview.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
                  </dl>
                  <p className="mt-atlas-3 text-atlas-xs font-atlas-medium text-atlas-text-muted">
                    {latestWithdrawalsQuery.isLoading ? ATLAS_UI_STRINGS.feedback.loading : overview.lastPaid}
                  </p>
                  <div className="mt-atlas-3 flex flex-wrap gap-atlas-2">
                    <Button
                      aria-expanded={accountLabourerId === labourer.id}
                      onClick={() => { setManagementLabourerId(""); setAccountLabourerId(labourer.id); }}
                    >
                      Account &amp; payment
                    </Button>
                    <Button
                      variant="ghost"
                      aria-expanded={managementLabourerId === labourer.id}
                      onClick={() => { setAccountLabourerId(""); setManagementLabourerId((current) => current === labourer.id ? "" : labourer.id); }}
                    >
                      Manage
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {selectedManagedLabourer && (
        <ProductionWorkerManagementDrawer
          key={selectedManagedLabourer.id}
          factoryId={factoryId}
          worker={selectedManagedLabourer}
          directRates={productionWageRates.filter(
            (rate) => rate.labourerId === selectedManagedLabourer.id && rate.productionCrewId === null,
          )}
          wageRatesLoading={isLoadingProductionWageRates}
          wageRatesError={Boolean(productionWageRatesError)}
          workerUpdating={updatingLabourerId === selectedManagedLabourer.id}
          onSaveName={onSaveName}
          onToggleLifecycle={onToggle}
          onWorkerChanged={onOriginChanged}
          onClose={() => setManagementLabourerId("")}
        />
      )}

      {selectedAccountLabourer && (
        <ProductionWorkerAccountDrawer
          key={selectedAccountLabourer.id}
          factoryId={factoryId}
          worker={selectedAccountLabourer}
          wageRates={productionWageRates}
          wageRatesLoading={isLoadingProductionWageRates}
          wageRatesError={Boolean(productionWageRatesError)}
          onClose={() => setAccountLabourerId("")}
        />
      )}

      {isAddLabourerOpen && (
        <AddProductionLabourerDrawer
          onCreate={onCreateLabourer}
          onClose={() => setIsAddLabourerOpen(false)}
        />
      )}
    </section>
  );
}

function LabourerProductionRateOverrideControls({ factoryId, labourer, history, asOfDate }: Readonly<{
  factoryId: string;
  labourer: ManagedLabourer;
  history: readonly ProductionWageRate[];
  asOfDate: string;
}>) {
  const queryClient = useQueryClient();
  const [ratePer1000Bricks, setRatePer1000Bricks] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => getLocalDate());
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function clearFeedback() {
    setSubmitError("");
    setIsSaved(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const rate = Number(ratePer1000Bricks);
    if (!ratePer1000Bricks || !Number.isFinite(rate) || rate <= 0) {
      setSubmitError("Override rate per 1,000 bricks must be greater than zero.");
      return;
    }
    if (!effectiveFrom) {
      setSubmitError("Effective-from date is required.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createLabourerProductionWageRateOverride({ factoryId, labourerId: labourer.id, ratePer1000Bricks: rate, effectiveFrom });
      setRatePer1000Bricks("");
      setIsSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["office-production-wage-rates", factoryId] });
    } catch (caught) {
      setSubmitError(caught instanceof CreateProductionWageRateError ? caught.message : caught instanceof Error ? caught.message : "Could not save individual override.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full border-t border-slate-200 pt-4">
      <h4 className="font-semibold">Individual Production-Rate Override</h4>
      <p className="mt-1 text-sm text-slate-600">Leave this unset to use the production crew rate.</p>
      <form className="mt-3 grid gap-3 md:grid-cols-3 md:items-end" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Override per 1,000 bricks
          <input type="number" min="0" step="any" value={ratePer1000Bricks} onChange={(event) => { setRatePer1000Bricks(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Effective from
          <input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={isSubmitting} className="h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Set Override"}</button>
        {submitError && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-3">{submitError}</p>}
        {isSaved && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-3">Individual override saved.</p>}
      </form>
      <div className="mt-4">
        <ProductionRateHistory title={`${labourer.name} override history`} rates={history} asOfDate={asOfDate} />
      </div>
    </div>
  );
}

function LabourerCrewAssignmentControls({ factoryId, labourer, currentAssignment, openAssignment, openCrewName, activeCrews, onChanged }: Readonly<{
  factoryId: string;
  labourer: ManagedLabourer;
  currentAssignment: ProductionCrewAssignment | null;
  openAssignment: ProductionCrewAssignment | null;
  openCrewName: string;
  activeCrews: readonly ProductionCrew[];
  onChanged: () => Promise<void>;
}>) {
  const today = getLocalDate();
  const [selectedCrewId, setSelectedCrewId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveTo, setEffectiveTo] = useState(() => openAssignment && openAssignment.effectiveFrom > today ? openAssignment.effectiveFrom : today);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [activeMutation, setActiveMutation] = useState<"assign" | "end" | null>(null);
  const unavailableCrewId = openAssignment?.productionCrewId ?? currentAssignment?.productionCrewId;
  const availableCrews = activeCrews.filter((crew) => crew.id !== unavailableCrewId);
  const isMove = currentAssignment !== null || openAssignment !== null;

  function clearFeedback() {
    setSubmitError("");
    setSuccessMessage("");
  }

  function assignmentErrorMessage(caught: unknown, fallback: string) {
    if (caught instanceof ProductionCrewAssignmentMutationError) return caught.message;
    return caught instanceof Error ? caught.message : fallback;
  }

  async function assignCrew(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeMutation) return;
    if (!selectedCrewId) {
      setSubmitError("Choose an active production crew.");
      return;
    }
    if (!effectiveFrom) {
      setSubmitError("Effective-from date is required.");
      return;
    }

    setActiveMutation("assign");
    clearFeedback();
    try {
      await assignLabourerToProductionCrew({ factoryId, labourerId: labourer.id, productionCrewId: selectedCrewId, effectiveFrom });
      setSelectedCrewId("");
      setEffectiveTo(effectiveFrom > today ? effectiveFrom : today);
      setSuccessMessage(isMove ? "Production crew move saved." : "Production crew assignment saved.");
      await onChanged();
    } catch (caught) {
      setSubmitError(assignmentErrorMessage(caught, "Could not save production crew assignment."));
    } finally {
      setActiveMutation(null);
    }
  }

  async function endAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeMutation) return;
    if (!effectiveTo) {
      setSubmitError("Final assigned date is required.");
      return;
    }

    setActiveMutation("end");
    clearFeedback();
    try {
      await endLabourerProductionCrewAssignment({ factoryId, labourerId: labourer.id, effectiveTo });
      setSuccessMessage("Production crew assignment ended.");
      await onChanged();
    } catch (caught) {
      setSubmitError(assignmentErrorMessage(caught, "Could not end production crew assignment."));
    } finally {
      setActiveMutation(null);
    }
  }

  return (
    <div className="w-full border-t border-slate-200 pt-4">
      <h4 className="font-semibold">{isMove ? "Move Production Crew" : "Assign Production Crew"}</h4>
      <form className="mt-3 grid gap-3 md:grid-cols-3 md:items-end" onSubmit={(event) => void assignCrew(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Active production crew
          <select value={selectedCrewId} onChange={(event) => { setSelectedCrewId(event.target.value); clearFeedback(); }} required disabled={Boolean(activeMutation) || availableCrews.length === 0} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100">
            <option value="" disabled>Select a crew</option>
            {availableCrews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {isMove ? "Move effective date" : "Effective from"}
          <input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); clearFeedback(); }} required disabled={Boolean(activeMutation)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={Boolean(activeMutation) || !selectedCrewId || availableCrews.length === 0} className="h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{activeMutation === "assign" ? "Saving..." : isMove ? "Move Crew" : "Assign Crew"}</button>
      </form>
      {availableCrews.length === 0 && <p className="mt-2 text-sm text-slate-500">{isMove ? "No other active production crew is available." : "No active production crew is available."}</p>}

      {openAssignment && <form className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[1fr_auto] md:items-end" onSubmit={(event) => void endAssignment(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Final assigned date for {openCrewName}
          <input type="date" value={effectiveTo} onChange={(event) => { setEffectiveTo(event.target.value); clearFeedback(); }} required disabled={Boolean(activeMutation)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={Boolean(activeMutation)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{activeMutation === "end" ? "Ending..." : "Leave Crew"}</button>
      </form>}

      {submitError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{submitError}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p>}
    </div>
  );
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}
