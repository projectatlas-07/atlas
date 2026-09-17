"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { DashboardFeature } from "@/features/dashboard/components/dashboard-feature";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { getTodaysProduction, type TodayProductionRow } from "@/features/office/services/todays-production-service";
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
import { listTransportDailyOperations } from "@/features/transport/services/transport-daily-operations-service";
import type { TransportDailyOperationsEntry } from "@/features/transport/types";
import { getLabourerEarningsHistory } from "@/features/wages/services/labourer-earnings-history-service";
import { getLabourerAvailableBalance } from "@/features/wages/services/labourer-available-balance-service";
import { CreateLabourerWithdrawalError, createLabourerWithdrawal, getDefaultSettlementCutoff } from "@/features/wages/services/labourer-withdrawal-create-service";
import { getLabourerWithdrawalHistory } from "@/features/wages/services/labourer-withdrawal-history-service";
import { assignLabourerToProductionCrew, endLabourerProductionCrewAssignment, ProductionCrewAssignmentMutationError, type ProductionCrewAssignment } from "@/features/wages/services/production-crew-assignment-service";
import { createProductionCrew, getCurrentProductionCrewAssignment, getProductionCrewAssignments, getProductionCrews, ProductionCrewMutationError, setProductionCrewActive, type ProductionCrew } from "@/features/wages/services/production-crew-service";
import { CreateProductionWageRateError, createLabourerProductionWageRateOverride, createProductionCrewWageRate } from "@/features/wages/services/production-wage-rate-create-service";
import { getCurrentCrewProductionWageRate, getCurrentLabourerProductionWageRate, getCurrentLabourerProductionWageRateOverride, getProductionWageRatesForFactory, type ProductionWageRate } from "@/features/wages/services/production-wage-rate-read-service";
import { ProductionRateConfigurationError, setProductionLabourerOrigin, setProductionLabourerRates } from "@/features/wages/services/production-rate-configuration-service";
import { calculateProductionRangeSummary, listLabourerProductionEntriesForRange, type ProductionRangeSummary } from "@/features/wages/services/production-range-summary-service";
import { DEFAULT_WAGE_EARNINGS_DATE_PRESET, resolveWageEarningsDateRange, type WageEarningsDatePreset } from "@/features/wages/wage-earnings-date-range";
import { getLocalDate } from "@/lib/local-date";
import { supabase } from "@/lib/supabase/client";

type BrickType = { id: string; name: string; isActive: boolean };

const brickTypeFormSchema = z.object({ name: z.string().trim().min(1, "Brick type name is required.") });
const labourerNameFormSchema = z.object({ name: z.string().trim().min(1, "Labourer name is required.") });

type BrickTypeFormValues = z.infer<typeof brickTypeFormSchema>;
type LabourerNameFormValues = z.infer<typeof labourerNameFormSchema>;

type ManagedLabourer = {
  id: string;
  name: string;
  brickTypeId: string;
  brickTypeName: string;
  originLabel: string | null;
  isActive: boolean;
};

type BrickTypeTotal = { id: string; name: string; quantity: number };

const productionRangePresets: Array<{ value: WageEarningsDatePreset; label: string }> = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

export function OfficeDashboard() {
  const router = useRouter();
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [factoryAccessStatus, setFactoryAccessStatus] = useState<"loading" | "ready" | "denied" | "failed">("loading");
  const [factoryAccessMessage, setFactoryAccessMessage] = useState("");
  const [factoryResolutionAttempt, setFactoryResolutionAttempt] = useState(0);
  const [selectedProductionDate, setSelectedProductionDate] = useState(() => getLocalDate());
  const [selectedTransportDate, setSelectedTransportDate] = useState(() => getLocalDate());
  const { data = [], error: productionError, isLoading: isLoadingProduction } = useQuery({
    queryKey: ["office-production", factoryId, selectedProductionDate],
    queryFn: () => getTodaysProduction(factoryId!, selectedProductionDate),
    enabled: factoryId !== null,
    refetchInterval: 30_000,
  });
  const {
    data: transportDailyOperations = [],
    error: transportDailyOperationsError,
    isLoading: isLoadingTransportDailyOperations,
  } = useQuery({
    queryKey: ["office-transport-daily-operations", factoryId, selectedTransportDate],
    queryFn: () => listTransportDailyOperations({
      factoryId: factoryId!,
      workDate: selectedTransportDate,
    }),
    enabled: factoryId !== null,
    refetchInterval: 30_000,
  });
  const [brickTypes, setBrickTypes] = useState<readonly BrickType[]>([]);
  const [labourers, setLabourers] = useState<readonly ManagedLabourer[]>([]);
  const [isLoadingLabourers, setIsLoadingLabourers] = useState(true);
  const [labourersError, setLabourersError] = useState("");
  const [brickTypesError, setBrickTypesError] = useState("");
  const [updatingLabourerId, setUpdatingLabourerId] = useState("");
  const [editingLabourerId, setEditingLabourerId] = useState("");
  const [editingLabourerNameId, setEditingLabourerNameId] = useState("");
  const [selectedBrickTypeId, setSelectedBrickTypeId] = useState("");
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

  const loadLabourers = useCallback(async () => {
    if (!factoryId) return;

    setIsLoadingLabourers(true);
    setLabourersError("");
    setBrickTypesError("");
    const [{ data: labourerRows, error: labourerError }, { data: brickTypeRows, error: brickTypeError }] = await Promise.all([
      supabase.from("labourers").select("id, name, assigned_brick_type_id, production_origin_label, is_active").eq("factory_id", factoryId).order("name"),
      supabase.from("brick_types").select("id, name, is_active").eq("factory_id", factoryId).order("name"),
    ]);
    if (labourerError || brickTypeError) {
      const error = labourerError || brickTypeError;
      if (!error) return;
      console.error({ context: "Failed to load office master data", message: error.message, code: error.code, details: error.details, hint: error.hint });
      if (labourerError) setLabourersError(labourerError.message);
      if (brickTypeError) setBrickTypesError(brickTypeError.message);
      setIsLoadingLabourers(false);
      return;
    }

    const loadedBrickTypes = (brickTypeRows ?? []).map((brickType) => ({
      id: brickType.id,
      name: brickType.name,
      isActive: brickType.is_active,
    }));
    const brickTypeNames = new Map(loadedBrickTypes.map((brickType) => [brickType.id, brickType.name]));
    setBrickTypes(loadedBrickTypes);
    setLabourers((labourerRows ?? []).map((labourer) => ({
      id: labourer.id,
      name: labourer.name,
      brickTypeId: labourer.assigned_brick_type_id,
      brickTypeName: brickTypeNames.get(labourer.assigned_brick_type_id) ?? "Unknown brick type",
      originLabel: labourer.production_origin_label,
      isActive: labourer.is_active,
    })));
    setIsLoadingLabourers(false);
  }, [factoryId]);

  useEffect(() => { if (factoryId) void loadLabourers(); }, [factoryId, loadLabourers]);

  async function toggleLabourer(labourer: ManagedLabourer) {
    if (!factoryId) return;

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
      return;
    }

    setLabourers((current) => current.map((item) => item.id === labourer.id ? { ...item, isActive: !item.isActive } : item));
    setUpdatingLabourerId("");
  }

  async function toggleBrickType(brickType: BrickType) {
    if (!factoryId) return;

    setBrickTypesError("");
    if (brickType.isActive) {
      const { data: activeLabourers, error: activeLabourersError } = await supabase
        .from("labourers")
        .select("id")
        .eq("factory_id", factoryId)
        .eq("assigned_brick_type_id", brickType.id)
        .eq("is_active", true)
        .limit(1);
      if (activeLabourersError) {
        console.error({ context: "Failed to check brick type assignments", message: activeLabourersError.message, code: activeLabourersError.code, details: activeLabourersError.details, hint: activeLabourersError.hint });
        setBrickTypesError(activeLabourersError.message);
        return;
      }
      if (activeLabourers.length > 0) {
        setBrickTypesError("Cannot deactivate this brick type while active labourers are assigned to it.");
        return;
      }
    }

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

  function openBrickTypeChange(labourer: ManagedLabourer) {
    setEditingLabourerId(labourer.id);
    setEditingLabourerNameId("");
    setSelectedBrickTypeId(activeBrickTypes.some((brickType) => brickType.id === labourer.brickTypeId) ? labourer.brickTypeId : "");
    setLabourersError("");
  }

  async function saveBrickTypeChange(labourer: ManagedLabourer) {
    if (!factoryId) return;
    const selectedBrickType = activeBrickTypes.find((brickType) => brickType.id === selectedBrickTypeId);
    if (!selectedBrickType) {
      setLabourersError("No active brick types available — activate one first.");
      return;
    }

    setUpdatingLabourerId(labourer.id);
    setLabourersError("");
    const { error } = await supabase
      .from("labourers")
      .update({ assigned_brick_type_id: selectedBrickType.id })
      .eq("id", labourer.id)
      .eq("factory_id", factoryId);
    if (error) {
      console.error({ context: "Failed to change labourer brick type", message: error.message, code: error.code, details: error.details, hint: error.hint });
      setLabourersError(error.message);
      setUpdatingLabourerId("");
      return;
    }

    setLabourers((current) => current.map((item) => item.id === labourer.id ? {
      ...item,
      brickTypeId: selectedBrickType.id,
      brickTypeName: selectedBrickType.name,
    } : item));
    setEditingLabourerId("");
    setSelectedBrickTypeId("");
    setUpdatingLabourerId("");
  }

  async function saveLabourerName(labourer: ManagedLabourer, name: string) {
    if (!factoryId) return;

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
      return;
    }

    setLabourers((current) => current.map((item) => item.id === labourer.id ? { ...item, name } : item));
    setEditingLabourerNameId("");
    setUpdatingLabourerId("");
  }

  const totalProduction = data.reduce((sum, row) => sum + row.quantity, 0);
  const brickTypeTotalsById = new Map<string, BrickTypeTotal>();
  for (const row of data) {
    const total = brickTypeTotalsById.get(row.brickTypeId);
    brickTypeTotalsById.set(row.brickTypeId, {
      id: row.brickTypeId,
      name: row.brickTypeName,
      quantity: (total?.quantity ?? 0) + row.quantity,
    });
  }
  const brickTypeTotals = [...brickTypeTotalsById.values()]
    .sort((left, right) => left.name.localeCompare(right.name, "en-IN"));
  const productionErrorMessage = productionError instanceof Error ? productionError.message : "Could not load today’s production.";
  const activeBrickTypes = brickTypes.filter((brickType) => brickType.isActive);

  if (factoryAccessStatus === "loading") {
    return <main className="min-h-screen bg-slate-100 px-8 py-10 text-slate-950"><p className="mx-auto max-w-6xl text-slate-600">Loading factory access...</p></main>;
  }
  if (factoryAccessStatus === "denied") {
    return <main className="min-h-screen bg-slate-100 px-8 py-10 text-slate-950"><p role="alert" className="mx-auto max-w-6xl font-medium text-red-700">Access denied: {factoryAccessMessage}</p></main>;
  }
  if (factoryAccessStatus === "failed") {
    return <main className="min-h-screen bg-slate-100 px-8 py-10 text-slate-950"><div className="mx-auto max-w-6xl"><p role="alert" className="font-medium text-red-700">{factoryAccessMessage}</p><button type="button" onClick={() => setFactoryResolutionAttempt((attempt) => attempt + 1)} className="mt-4 h-10 rounded-lg border border-slate-300 bg-white px-4 font-semibold">Try again</button></div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-8 py-10 text-slate-950 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Office</p>
            <h1 className="mt-1 text-3xl font-bold">Production</h1>
            <p className="mt-2 text-slate-600">{formatDate(selectedProductionDate)}</p>
            <a href="#office-dashboard-feature" className="mt-3 inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">Dashboard</a>
          </div>
          <LogoutButton />
        </header>

        <section className="mb-8 max-w-sm">
          <SummaryCard label="Total Production" value={isLoadingProduction ? "Loading..." : totalProduction.toLocaleString("en-IN")} />
        </section>

        <section aria-labelledby="todays-production-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="todays-production-heading" className="text-lg font-bold">Production for {formatDate(selectedProductionDate)}</h2>
            <label className="text-sm font-medium text-slate-700">
              <span className="sr-only">Production date</span>
              <input type="date" value={selectedProductionDate} onChange={(event) => setSelectedProductionDate(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-slate-950" />
            </label>
          </div>
          {isLoadingProduction && <p className="px-6 py-10 text-center text-slate-500">Loading production...</p>}
          {productionError && <p role="alert" className="px-6 py-10 text-center font-medium text-red-700">Could not load production: {productionErrorMessage}</p>}
          {!isLoadingProduction && !productionError && data.length === 0 && <p className="px-6 py-10 text-center text-slate-500">No production recorded for this date.</p>}
          {!isLoadingProduction && !productionError && data.length > 0 && <table className="w-full border-collapse text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
              <tr><th className="px-6 py-4">Labour Name</th><th className="px-6 py-4 text-right">Quantity</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((row) => <ProductionRow key={row.labourerId} row={row} />)}
            </tbody>
          </table>}
          {!isLoadingProduction && !productionError && data.length > 0 && <div className="border-t border-slate-200 px-6 py-5">
            <h3 className="text-base font-bold">Brick Type Totals</h3>
            <ul className="mt-3 divide-y divide-slate-100">
              {brickTypeTotals.map((brickType) => <li key={brickType.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="font-medium">{brickType.name}</span>
                <span className="font-semibold tabular-nums">{brickType.quantity.toLocaleString("en-IN")}</span>
              </li>)}
            </ul>
          </div>}
        </section>

        <TransportDailyOperationsSection
          selectedDate={selectedTransportDate}
          onSelectedDateChange={setSelectedTransportDate}
          entries={transportDailyOperations}
          isLoading={isLoadingTransportDailyOperations}
          error={transportDailyOperationsError}
        />

        <SalesOfficeSection
          factoryId={factoryId!}
          brickTypes={brickTypes}
          isLoadingBrickTypes={isLoadingLabourers}
          brickTypesError={brickTypesError}
        />

        <CoalPurchaseOfficeSection factoryId={factoryId!} />

        <VehicleMaintenanceOfficeSection factoryId={factoryId!} />

        <VehicleFuelOfficeSection factoryId={factoryId!} />

        <ExpensesOfficeSection factoryId={factoryId!} />

        <CashBookOfficeSection factoryId={factoryId!} />

        <AddBrickTypeForm factoryId={factoryId!} onAdded={loadLabourers} />
        <BrickTypeManagement
          brickTypes={brickTypes}
          error={brickTypesError}
          updatingBrickTypeId={updatingBrickTypeId}
          onToggle={toggleBrickType}
        />
        <AddLabourerForm factoryId={factoryId!} brickTypes={activeBrickTypes} onAdded={loadLabourers} />
        <LabourerManagement
          factoryId={factoryId!}
          labourers={labourers}
          isLoading={isLoadingLabourers}
          error={labourersError}
          updatingLabourerId={updatingLabourerId}
          onToggle={toggleLabourer}
          activeBrickTypes={activeBrickTypes}
          editingLabourerId={editingLabourerId}
          selectedBrickTypeId={selectedBrickTypeId}
          onOpenBrickTypeChange={openBrickTypeChange}
          onSelectedBrickTypeChange={setSelectedBrickTypeId}
          onSaveBrickTypeChange={saveBrickTypeChange}
          onCancelBrickTypeChange={() => { setEditingLabourerId(""); setSelectedBrickTypeId(""); setLabourersError(""); }}
          editingLabourerNameId={editingLabourerNameId}
          onOpenNameEdit={(labourer) => { setEditingLabourerId(""); setSelectedBrickTypeId(""); setEditingLabourerNameId(labourer.id); setLabourersError(""); }}
          onSaveName={saveLabourerName}
          onCancelNameEdit={() => { setEditingLabourerNameId(""); setLabourersError(""); }}
          onOriginChanged={loadLabourers}
        />
        <MudGroupManagement factoryId={factoryId!} />
        <SoilOfficeSection factoryId={factoryId!} />
        <StaffOfficeSection factoryId={factoryId!} />
        <TransportOfficeSection factoryId={factoryId!} />
        <section id="office-dashboard-feature" aria-label="Dashboard" className="mt-8 scroll-mt-6">
          <DashboardFeature factoryId={factoryId!} />
        </section>
      </div>
    </main>
  );
}

function formatWageRate(rate: number) {
  return `₹${rate.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / 1,000 bricks`;
}

function formatStoredNumber(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 20 });
}

function formatStoredCurrency(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 20 })}`;
}

function formatCurrencyWithTwoDecimals(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function AddLabourerForm({ factoryId, brickTypes, onAdded }: Readonly<{ factoryId: string; brickTypes: readonly BrickType[]; onAdded: () => Promise<void> }>) {
  const [name, setName] = useState("");
  const [brickTypeId, setBrickTypeId] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function addLabourer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brickTypes.some((brickType) => brickType.id === brickTypeId)) {
      setSubmitError("No active brick types available — activate one first.");
      return;
    }

    setSubmitError("");
    const { error } = await supabase.from("labourers").insert({
      factory_id: factoryId,
      name: name.trim(),
      assigned_brick_type_id: brickTypeId,
      is_active: true,
    });
    if (error) {
      console.error({
        context: "Failed to add labourer",
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      setSubmitError(error.message);
      return;
    }

    setName("");
    setBrickTypeId("");
    setIsSaved(true);
    await onAdded();
  }

  return (
    <section className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Add Labourer</h2>
      <form className="mt-5 space-y-4" onSubmit={(event) => void addLabourer(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Labourer name
          <input value={name} onChange={(event) => { setName(event.target.value); setIsSaved(false); }} required className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Assigned brick type
          {brickTypes.length === 0 ? <p className="mt-1 text-sm text-slate-500">No active brick types available — activate one first.</p> : <select value={brickTypeId} onChange={(event) => { setBrickTypeId(event.target.value); setIsSaved(false); setSubmitError(""); }} required className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950">
            <option value="" disabled>Select brick type</option>
            {brickTypes.map((brickType) => <option key={brickType.id} value={brickType.id}>{brickType.name}</option>)}
          </select>}
        </label>
        {submitError && <p role="alert" className="text-sm font-medium text-red-700">{submitError}</p>}
        <button type="submit" disabled={brickTypes.length === 0} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">Add Labourer</button>
        {isSaved && <p role="status" className="text-sm font-medium text-emerald-700">Labourer added.</p>}
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

function LabourerManagement({ factoryId, labourers, isLoading, error, updatingLabourerId, onToggle, activeBrickTypes, editingLabourerId, selectedBrickTypeId, onOpenBrickTypeChange, onSelectedBrickTypeChange, onSaveBrickTypeChange, onCancelBrickTypeChange, editingLabourerNameId, onOpenNameEdit, onSaveName, onCancelNameEdit, onOriginChanged }: Readonly<{
  factoryId: string;
  labourers: readonly ManagedLabourer[];
  isLoading: boolean;
  error: string;
  updatingLabourerId: string;
  onToggle: (labourer: ManagedLabourer) => Promise<void>;
  activeBrickTypes: readonly BrickType[];
  editingLabourerId: string;
  selectedBrickTypeId: string;
  onOpenBrickTypeChange: (labourer: ManagedLabourer) => void;
  onSelectedBrickTypeChange: (brickTypeId: string) => void;
  onSaveBrickTypeChange: (labourer: ManagedLabourer) => Promise<void>;
  onCancelBrickTypeChange: () => void;
  editingLabourerNameId: string;
  onOpenNameEdit: (labourer: ManagedLabourer) => void;
  onSaveName: (labourer: ManagedLabourer, name: string) => Promise<void>;
  onCancelNameEdit: () => void;
  onOriginChanged: () => Promise<void>;
}>) {
  const asOfDate = getLocalDate();
  const { data: productionWageRates = [], error: productionWageRatesError, isLoading: isLoadingProductionWageRates } = useQuery({
    queryKey: ["office-production-wage-rates", factoryId],
    queryFn: () => getProductionWageRatesForFactory(factoryId),
  });
  const [earningsLabourerId, setEarningsLabourerId] = useState("");
  const [rateLabourerId, setRateLabourerId] = useState("");
  const [originLabourerId, setOriginLabourerId] = useState("");
  const [originValue, setOriginValue] = useState("");
  const [originError, setOriginError] = useState("");
  const [isSavingOrigin, setIsSavingOrigin] = useState(false);
  const productionWageRatesErrorMessage = productionWageRatesError instanceof Error ? productionWageRatesError.message : "Could not load production wage rates.";

  async function saveOrigin(labourer: ManagedLabourer) {
    if (isSavingOrigin) return;
    setIsSavingOrigin(true);
    setOriginError("");
    try {
      await setProductionLabourerOrigin({
        factoryId,
        labourerId: labourer.id,
        originLabel: originValue.trim() || null,
      });
      await onOriginChanged();
      setOriginLabourerId("");
      setOriginValue("");
    } catch (caught) {
      setOriginError(caught instanceof Error ? caught.message : "Could not save Production origin.");
    } finally {
      setIsSavingOrigin(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Labourers</h2>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}
      {productionWageRatesError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load production wage rates: {productionWageRatesErrorMessage}</p>}
      <p className="mt-3 text-sm text-slate-600">Production earnings use each labourer&apos;s direct effective-dated rate.</p>
      {activeBrickTypes.length === 0 && <p className="mt-3 text-sm text-slate-500">No active brick types available — activate one first.</p>}
      {!isLoading && <ProductionLabourerRateControls
        factoryId={factoryId}
        labourers={labourers}
      />}
      {isLoading ? <p className="mt-4 text-sm text-slate-500">Loading labourers...</p> : (
        <div className="mt-4 space-y-3">
          {labourers.map((labourer) => {
            const isUpdating = updatingLabourerId === labourer.id;
            const isEditingBrickType = editingLabourerId === labourer.id;
            const isEditingName = editingLabourerNameId === labourer.id;
            const isCurrentBrickTypeActive = activeBrickTypes.some((brickType) => brickType.id === labourer.brickTypeId);
            const currentRate = getCurrentLabourerProductionWageRate(productionWageRates, labourer.id, asOfDate);
            const labourerRateHistory = productionWageRates.filter((rate) => rate.labourerId === labourer.id && rate.productionCrewId === null);
            return (
              <article key={labourer.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold">{labourer.name}</h3>
                  <p className="text-sm text-slate-600">{labourer.brickTypeName}</p>
                  {labourer.originLabel && <p className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{labourer.originLabel}</p>}
                  <p className="mt-1 text-sm text-slate-600">Production Rate: {isLoadingProductionWageRates ? "Loading..." : productionWageRatesError ? "Unavailable" : currentRate ? formatWageRate(currentRate.ratePer1000Bricks) : "Rate not set"}</p>
                  <p className={`mt-1 text-sm font-medium ${labourer.isActive ? "text-emerald-700" : "text-slate-500"}`}>{labourer.isActive ? "Active" : "Inactive"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={isUpdating} onClick={() => void onToggle(labourer)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                    {isUpdating ? "Updating..." : labourer.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating} onClick={() => onOpenNameEdit(labourer)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">Edit Name</button>}
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating || activeBrickTypes.length === 0} onClick={() => onOpenBrickTypeChange(labourer)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">Change Brick Type</button>}
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating || !labourer.isActive || isLoadingProductionWageRates || Boolean(productionWageRatesError)} onClick={() => setRateLabourerId((current) => current === labourer.id ? "" : labourer.id)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{rateLabourerId === labourer.id ? "Hide Rate" : "Set Rate"}</button>}
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating} onClick={() => { setOriginLabourerId((current) => current === labourer.id ? "" : labourer.id); setOriginValue(labourer.originLabel ?? ""); setOriginError(""); }} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{originLabourerId === labourer.id ? "Hide Origin" : "Edit Origin"}</button>}
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating} onClick={() => setEarningsLabourerId((current) => current === labourer.id ? "" : labourer.id)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{earningsLabourerId === labourer.id ? "Hide Earnings" : "View Earnings"}</button>}
                </div>
                {rateLabourerId === labourer.id && <ProductionLabourerRateControls
                  factoryId={factoryId}
                  labourers={labourers}
                  fixedLabourer={labourer}
                  rateHistory={labourerRateHistory}
                />}
                {originLabourerId === labourer.id && <div className="w-full border-t border-slate-200 pt-4">
                  <label className="block text-sm font-medium text-slate-700">Origin / group (optional)<input value={originValue} maxLength={100} onChange={(event) => { setOriginValue(event.target.value); setOriginError(""); }} placeholder="Jharkhand, Bengal, or blank" disabled={isSavingOrigin} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:bg-slate-100" /></label>
                  <div className="mt-3 flex gap-2"><button type="button" disabled={isSavingOrigin} onClick={() => void saveOrigin(labourer)} className="h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:opacity-60">{isSavingOrigin ? "Saving..." : "Save Origin"}</button><button type="button" disabled={isSavingOrigin} onClick={() => { setOriginLabourerId(""); setOriginError(""); }} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold">Cancel</button></div>
                  {originError && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{originError}</p>}
                  <p className="mt-2 text-xs text-slate-500">For identification and rate selection only. It never changes wage calculations.</p>
                </div>}
                {earningsLabourerId === labourer.id && <LabourerEarningsHistory
                  factoryId={factoryId}
                  labourerId={labourer.id}
                  wageRates={productionWageRates}
                  historicalDataLoading={isLoadingProductionWageRates}
                  historicalDataError={Boolean(productionWageRatesError)}
                />}
                {isEditingName && <EditLabourerNameForm labourer={labourer} isUpdating={isUpdating} onSave={onSaveName} onCancel={onCancelNameEdit} />}
                {isEditingBrickType && (
                  <div className="w-full border-t border-slate-200 pt-3">
                    {!isCurrentBrickTypeActive && <p className="mb-2 text-sm text-slate-500">Current assignment is inactive. Select an active brick type.</p>}
                    <label className="block text-sm font-medium text-slate-700">
                      Assigned brick type
                      <select value={selectedBrickTypeId} onChange={(event) => onSelectedBrickTypeChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950">
                        {!isCurrentBrickTypeActive && <option value="" disabled>Select an active brick type</option>}
                        {activeBrickTypes.map((brickType) => <option key={brickType.id} value={brickType.id}>{brickType.name}</option>)}
                      </select>
                    </label>
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={isUpdating || !selectedBrickTypeId} onClick={() => void onSaveBrickTypeChange(labourer)} className="h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isUpdating ? "Saving..." : "Save"}</button>
                      <button type="button" disabled={isUpdating} onClick={onCancelBrickTypeChange} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProductionLabourerRateControls({ factoryId, labourers, fixedLabourer, rateHistory = [] }: Readonly<{
  factoryId: string;
  labourers: readonly ManagedLabourer[];
  fixedLabourer?: ManagedLabourer;
  rateHistory?: readonly ProductionWageRate[];
}>) {
  const queryClient = useQueryClient();
  const today = getLocalDate();
  const [selectionMode, setSelectionMode] = useState<"all" | "manual">("all");
  const [selectedLabourerIds, setSelectedLabourerIds] = useState<ReadonlySet<string>>(() => new Set());
  const [originFilter, setOriginFilter] = useState("all");
  const [ratePer1000Bricks, setRatePer1000Bricks] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeLabourers = labourers.filter((labourer) => labourer.isActive);
  const originOptions = [...new Set(activeLabourers.map((labourer) => labourer.originLabel).filter((origin): origin is string => Boolean(origin)))].sort((left, right) => left.localeCompare(right));
  const visibleLabourers = activeLabourers.filter((labourer) => {
    if (originFilter === "all") return true;
    if (originFilter === "none") return labourer.originLabel === null;
    return labourer.originLabel === originFilter;
  });
  const labourerIds = fixedLabourer
    ? [fixedLabourer.id]
    : selectionMode === "all"
      ? visibleLabourers.map((labourer) => labourer.id)
      : visibleLabourers.filter((labourer) => selectedLabourerIds.has(labourer.id)).map((labourer) => labourer.id);
  const numericRate = Number(ratePer1000Bricks);

  function clearFeedback() {
    setSubmitError("");
    setSuccessMessage("");
  }

  function toggleLabourer(labourerId: string) {
    setSelectedLabourerIds((current) => {
      const next = new Set(current);
      if (next.has(labourerId)) next.delete(labourerId);
      else next.add(labourerId);
      return next;
    });
    clearFeedback();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (labourerIds.length === 0) {
      setSubmitError("Choose at least one active labourer.");
      return;
    }
    if (!ratePer1000Bricks || !Number.isFinite(numericRate) || numericRate <= 0) {
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
      await setProductionLabourerRates({ factoryId, labourerIds, ratePer1000Bricks: numericRate, effectiveFrom });
      setRatePer1000Bricks("");
      setSelectedLabourerIds(new Set());
      setSuccessMessage(`Rate saved for ${labourerIds.length.toLocaleString("en-IN")} ${labourerIds.length === 1 ? "labourer" : "labourers"}.`);
      await queryClient.invalidateQueries({ queryKey: ["office-production-wage-rates", factoryId] });
    } catch (caught) {
      setSubmitError(caught instanceof ProductionRateConfigurationError ? caught.message : caught instanceof Error ? caught.message : "Could not save Production rate.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={fixedLabourer ? "w-full border-t border-slate-200 pt-4" : "mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"}>
      <h3 className="font-semibold">Set Rate{fixedLabourer ? ` · ${fixedLabourer.name}` : ""}</h3>
      {!fixedLabourer && <>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="production-rate-selection" checked={selectionMode === "all"} onChange={() => { setSelectionMode("all"); clearFeedback(); }} />Select All</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="production-rate-selection" checked={selectionMode === "manual"} onChange={() => { setSelectionMode("manual"); clearFeedback(); }} />Select Manually</label>
        </div>
        <label className="mt-3 block max-w-sm text-sm font-medium text-slate-700">Filter by origin
          <select value={originFilter} onChange={(event) => { setOriginFilter(event.target.value); clearFeedback(); }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950">
            <option value="all">All origins</option>
            <option value="none">No origin</option>
            {originOptions.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
          </select>
        </label>
        {selectionMode === "manual" && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleLabourers.map((labourer) => <label key={labourer.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><input type="checkbox" checked={selectedLabourerIds.has(labourer.id)} onChange={() => toggleLabourer(labourer.id)} />{labourer.name}{labourer.originLabel ? ` · ${labourer.originLabel}` : ""}</label>)}
          {visibleLabourers.length === 0 && <p className="text-sm text-slate-500">No active labourers match this origin.</p>}
        </div>}
      </>}
      <form className="mt-3 grid gap-3 md:grid-cols-3 md:items-end" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-slate-700">Rate per 1,000 bricks<input type="number" min="0" step="any" value={ratePer1000Bricks} onChange={(event) => { setRatePer1000Bricks(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:bg-slate-100" /></label>
        <label className="block text-sm font-medium text-slate-700">Effective From<input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 disabled:bg-slate-100" /></label>
        <button type="submit" disabled={isSubmitting || labourerIds.length === 0 || Boolean(fixedLabourer && !fixedLabourer.isActive)} className="h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Save Rate"}</button>
        {labourerIds.length > 0 && ratePer1000Bricks && Number.isFinite(numericRate) && numericRate > 0 && effectiveFrom && <p className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 md:col-span-3">{labourerIds.length.toLocaleString("en-IN")} {labourerIds.length === 1 ? "labourer" : "labourers"} · {formatWageRate(numericRate)} · effective from {formatDate(effectiveFrom)}</p>}
        {effectiveFrom && effectiveFrom < today && <p className="text-sm font-semibold text-amber-800 md:col-span-3">Backdated change: live historical range earnings from this date may change.</p>}
        {submitError && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-3">{submitError}</p>}
        {successMessage && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-3">{successMessage}</p>}
      </form>
      {fixedLabourer && <div className="mt-4"><ProductionRateHistory title="Direct Production rate history" rates={rateHistory} asOfDate={today} /></div>}
    </div>
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

function LabourerEarningsHistory({
  factoryId,
  labourerId,
  wageRates,
  historicalDataLoading,
  historicalDataError,
}: Readonly<{
  factoryId: string;
  labourerId: string;
  wageRates: readonly ProductionWageRate[];
  historicalDataLoading: boolean;
  historicalDataError: boolean;
}>) {
  const asOfDate = getLocalDate();
  const [rangeToday] = useState(() => getLocalDate());
  const [rangePreset, setRangePreset] = useState<WageEarningsDatePreset>(
    DEFAULT_WAGE_EARNINGS_DATE_PRESET,
  );
  const [customFrom, setCustomFrom] = useState(rangeToday);
  const [customTo, setCustomTo] = useState(rangeToday);
  const productionRange = resolveWageEarningsDateRange(
    rangePreset,
    rangeToday,
    customFrom,
    customTo,
  );
  const historicalDataReady = !historicalDataLoading && !historicalDataError;
  const productionRangeEntriesQuery = useQuery({
    queryKey: [
      "labourer-production-range-summary",
      factoryId,
      labourerId,
      productionRange?.fromDate,
      productionRange?.toDate,
    ],
    queryFn: () => listLabourerProductionEntriesForRange({
      factoryId,
      labourerId,
      range: productionRange!,
    }),
    enabled: productionRange !== null && historicalDataReady,
    refetchInterval: 30_000,
  });
  let productionRangeSummary: ProductionRangeSummary | null = null;
  let productionRangeCalculationError = "";
  if (productionRangeEntriesQuery.data && historicalDataReady) {
    try {
      productionRangeSummary = calculateProductionRangeSummary({
        labourerId,
        entries: productionRangeEntriesQuery.data,
        wageRates,
        range: productionRange!,
      });
    } catch (calculationError) {
      productionRangeCalculationError = calculationError instanceof Error
        ? calculationError.message
        : "Could not calculate Production range earnings.";
    }
  }
  const { data: earnings = [], error, isLoading } = useQuery({
    queryKey: ["labourer-earnings-history", factoryId, labourerId],
    queryFn: () => getLabourerEarningsHistory({ factoryId, labourerId }),
  });
  const { data: balance, error: balanceError, isLoading: isLoadingBalance } = useQuery({
    queryKey: ["labourer-available-balance", factoryId, labourerId, asOfDate],
    queryFn: () => getLabourerAvailableBalance({ factoryId, labourerId, asOfDate }),
  });
  const { data: withdrawals = [], error: withdrawalsError, isLoading: isLoadingWithdrawals } = useQuery({
    queryKey: ["labourer-withdrawal-history", factoryId, labourerId],
    queryFn: () => getLabourerWithdrawalHistory(factoryId, labourerId),
  });
  const errorMessage = error instanceof Error ? error.message : "Could not load earnings history.";
  const balanceErrorMessage = balanceError instanceof Error ? balanceError.message : "Could not load available balance.";
  const withdrawalsErrorMessage = withdrawalsError instanceof Error ? withdrawalsError.message : "Could not load withdrawal history.";

  return (
    <section aria-label="Production wage details" className="w-full border-t border-slate-200 pt-4">
      <section aria-label="Production range summary" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium text-amber-900">Earnings period</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {productionRangePresets.map((option) => <button
                key={option.value}
                type="button"
                aria-pressed={rangePreset === option.value}
                onClick={() => setRangePreset(option.value)}
                className={`h-9 rounded-lg border px-3 text-sm font-semibold ${rangePreset === option.value ? "border-amber-700 bg-amber-700 text-white" : "border-amber-300 bg-white text-slate-700"}`}
              >{option.label}</button>)}
            </div>
          </div>
          {productionRange && <p className="text-xs text-amber-900">{formatDate(productionRange.fromDate)} → {formatDate(productionRange.toDate)}, inclusive</p>}
        </div>

        {rangePreset === "custom" && <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-amber-900">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-950" /></label>
          <label className="text-xs font-medium text-amber-900">To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-950" /></label>
        </div>}
        {rangePreset === "custom" && !productionRange && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Choose a valid inclusive date range. From date cannot be after To date.</p>}
        {historicalDataLoading && <p className="mt-3 text-sm text-slate-600">Loading historical Production rates...</p>}
        {historicalDataError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">Production rate data is unavailable.</p>}
        {productionRangeEntriesQuery.isLoading && <p className="mt-3 text-sm text-slate-600">Loading Production range...</p>}
        {productionRangeEntriesQuery.error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{productionRangeEntriesQuery.error instanceof Error ? productionRangeEntriesQuery.error.message : "Could not load Production range."}</p>}
        {productionRangeCalculationError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{productionRangeCalculationError}</p>}
        {productionRange && productionRangeSummary && !productionRangeEntriesQuery.error && !productionRangeCalculationError && <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-white p-4"><p className="text-sm text-slate-600">Range Production</p><p className="mt-1 text-xl font-bold tabular-nums">{formatStoredNumber(productionRangeSummary.rangeProduction)}</p></div>
          <div className="rounded-lg bg-white p-4"><p className="text-sm text-slate-600">Range Earned</p><p className="mt-1 text-xl font-bold tabular-nums">{formatStoredCurrency(productionRangeSummary.rangeEarned)}</p></div>
          <div className="rounded-lg bg-white p-4"><p className="text-sm text-slate-600">Rate(s) Used</p>{productionRangeSummary.ratePeriods.length === 0 ? <p className="mt-1 text-sm font-semibold text-slate-500">No production in this period</p> : <ul className="mt-1 space-y-1">{productionRangeSummary.ratePeriods.map((period) => <li key={period.productionWageRateId} className="text-sm font-semibold tabular-nums">{formatWageRate(period.ratePer1000Bricks)}{productionRangeSummary.ratePeriods.length > 1 ? ` · ${formatDate(period.fromDate)} — ${formatDate(period.toDate)}` : ""}</li>)}</ul>}</div>
        </div>}
        <p className="mt-3 text-xs text-amber-900">Informational only. Available Balance uses all settled and live Production through today, independent of this range.</p>
      </section>

      <h3 className="mt-6 font-semibold">Available Balance</h3>
      {isLoadingBalance && <p className="mt-3 text-sm text-slate-500">Loading available balance...</p>}
      {balanceError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load available balance: {balanceErrorMessage}</p>}
      {!isLoadingBalance && !balanceError && balance && <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Available balance</p><p className="mt-1 text-xl font-bold tabular-nums">{formatStoredCurrency(balance.availableBalance)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Settled earned</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.settledEarned)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Live earned</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.liveEarned)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Total withdrawn</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.totalWithdrawn)}</p></div>
      </div>}

      <LabourerWithdrawalForm
        factoryId={factoryId}
        labourerId={labourerId}
        asOfDate={asOfDate}
        latestSettlementCutoff={balance?.latestSettlementCutoff ?? null}
      />

      <h3 className="mt-6 font-semibold">Withdrawal History</h3>
      {isLoadingWithdrawals && <p className="mt-3 text-sm text-slate-500">Loading withdrawal history...</p>}
      {withdrawalsError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load withdrawal history: {withdrawalsErrorMessage}</p>}
      {!isLoadingWithdrawals && !withdrawalsError && withdrawals.length === 0 && <p className="mt-3 text-sm text-slate-500">No withdrawals recorded.</p>}
      {!isLoadingWithdrawals && !withdrawalsError && withdrawals.length > 0 && <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
            <tr><th className="px-4 py-3">Withdrawal date</th><th className="px-4 py-3 text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {withdrawals.map((withdrawal) => <tr key={withdrawal.withdrawalId}>
              <td className="px-4 py-3 font-medium">{formatDate(withdrawal.withdrawalDate)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCurrencyWithTwoDecimals(withdrawal.amount)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}

      <h3 className="mt-6 font-semibold">Locked Earnings History</h3>
      {isLoading && <p className="mt-3 text-sm text-slate-500">Loading earnings history...</p>}
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load earnings history: {errorMessage}</p>}
      {!isLoading && !error && earnings.length === 0 && <p className="mt-3 text-sm text-slate-500">No locked earnings for this labourer.</p>}
      {!isLoading && !error && earnings.length > 0 && <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
            <tr><th className="px-4 py-3">Week starting</th><th className="px-4 py-3 text-right">Quantity used</th><th className="px-4 py-3 text-right">Rate per 1,000</th><th className="px-4 py-3 text-right">Amount earned</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {earnings.map((earning) => <tr key={earning.id}>
              <td className="px-4 py-3 font-medium">{formatDate(earning.week_start)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatStoredNumber(earning.quantity_used)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{earning.rate_used === null ? "Multiple rates" : `₹${formatStoredNumber(earning.rate_used)}`}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">₹{formatStoredNumber(earning.amount)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function LabourerWithdrawalForm({ factoryId, labourerId, asOfDate, latestSettlementCutoff }: Readonly<{
  factoryId: string;
  labourerId: string;
  asOfDate: string;
  latestSettlementCutoff: string | null;
}>) {
  const queryClient = useQueryClient();
  const [withdrawalDate, setWithdrawalDate] = useState(() => getLocalDate());
  const [settlementCutoff, setSettlementCutoff] = useState(() => getDefaultSettlementCutoff(getLocalDate(), null));
  const [amount, setAmount] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!latestSettlementCutoff) return;
    setSettlementCutoff((current) => current >= latestSettlementCutoff
      ? current
      : getDefaultSettlementCutoff(withdrawalDate, latestSettlementCutoff));
  }, [latestSettlementCutoff, withdrawalDate]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!withdrawalDate) {
      setSubmitError("Withdrawal date is required.");
      return;
    }
    if (!settlementCutoff) {
      setSubmitError("Settlement cutoff is required.");
      return;
    }
    if (settlementCutoff > withdrawalDate) {
      setSubmitError("Settlement cutoff cannot be after the withdrawal date.");
      return;
    }
    if (latestSettlementCutoff && settlementCutoff < latestSettlementCutoff) {
      setSubmitError(`Settlement cutoff cannot be before ${formatDate(latestSettlementCutoff)}.`);
      return;
    }

    const numericAmount = Number(amount);
    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setSubmitError("Amount must be greater than zero.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setIsSaved(false);
    try {
      const saved = await createLabourerWithdrawal({
        factoryId,
        labourerId,
        withdrawalDate,
        settlementCutoff,
        amount: numericAmount,
      });
      setAmount("");
      setSettlementCutoff(saved.settledThrough);
      setIsSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["labourer-available-balance", factoryId, labourerId, asOfDate] }),
        queryClient.invalidateQueries({ queryKey: ["labourer-earnings-history", factoryId, labourerId] }),
        queryClient.invalidateQueries({ queryKey: ["labourer-withdrawal-history", factoryId, labourerId] }),
      ]);
    } catch (error) {
      if (error instanceof CreateLabourerWithdrawalError) {
        setSubmitError(error.message);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Could not record withdrawal.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-5 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-3 sm:items-end" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium text-slate-700">
        Withdrawal date
        <input type="date" max={getLocalDate()} value={withdrawalDate} onChange={(event) => { const nextDate = event.target.value; setWithdrawalDate(nextDate); setSettlementCutoff(getDefaultSettlementCutoff(nextDate, latestSettlementCutoff)); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Settlement cutoff
        <input type="date" min={latestSettlementCutoff ?? undefined} max={withdrawalDate || undefined} value={settlementCutoff} onChange={(event) => { setSettlementCutoff(event.target.value); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Amount
        <input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <p className="text-sm text-slate-600 sm:col-span-3">This withdrawal will settle Production through <span className="font-semibold text-slate-900">{settlementCutoff ? formatDate(settlementCutoff) : "the chosen cutoff"}</span>.</p>
      <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-3">{isSubmitting ? "Saving..." : "Record Withdrawal"}</button>
      {submitError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-3">{submitError}</p>}
      {isSaved && <p role="status" className="text-sm font-medium text-emerald-700 sm:col-span-3">Withdrawal recorded.</p>}
    </form>
  );
}

function EditLabourerNameForm({ labourer, isUpdating, onSave, onCancel }: Readonly<{
  labourer: ManagedLabourer;
  isUpdating: boolean;
  onSave: (labourer: ManagedLabourer, name: string) => Promise<void>;
  onCancel: () => void;
}>) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm<LabourerNameFormValues>({ defaultValues: { name: labourer.name } });

  async function save(values: LabourerNameFormValues) {
    const parsed = labourerNameFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("name", { message: parsed.error.issues[0]?.message });
      return;
    }
    await onSave(labourer, parsed.data.name);
  }

  return (
    <form className="w-full border-t border-slate-200 pt-3" onSubmit={handleSubmit(save)}>
      <label className="block text-sm font-medium text-slate-700">
        Labourer name
        <input {...register("name")} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-slate-950" />
      </label>
      {errors.name && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{errors.name.message}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={isUpdating} className="h-10 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isUpdating ? "Saving..." : "Save"}</button>
        <button type="button" disabled={isUpdating} onClick={onCancel} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
      </div>
    </form>
  );
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return <section className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight">{value}</p></section>;
}

function ProductionRow({ row }: Readonly<{ row: TodayProductionRow }>) {
  return <tr className="text-base"><td className="px-6 py-5 font-medium">{row.labourerName}</td><td className="px-6 py-5 text-right font-semibold tabular-nums">{row.quantity.toLocaleString("en-IN")}</td></tr>;
}

function TransportDailyOperationsSection({
  selectedDate,
  onSelectedDateChange,
  entries,
  isLoading,
  error,
}: Readonly<{
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  entries: readonly TransportDailyOperationsEntry[];
  isLoading: boolean;
  error: Error | null;
}>) {
  const totalPaya = entries.reduce((total, entry) => total + entry.payaQuantity, 0);

  return (
    <section aria-labelledby="daily-chamber-transport-heading" className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="daily-chamber-transport-heading" className="text-lg font-bold">
          Chamber Transport for {formatDate(selectedDate)}
        </h2>
        <label className="text-sm font-medium text-slate-700">
          <span className="sr-only">Chamber Transport date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => onSelectedDateChange(event.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-slate-950"
          />
        </label>
      </div>

      {isLoading && <p className="px-6 py-10 text-center text-slate-500">Loading chamber transport...</p>}
      {error && (
        <p role="alert" className="px-6 py-10 text-center font-medium text-red-700">
          Could not load chamber transport: {error.message}
        </p>
      )}
      {!isLoading && !error && entries.length === 0 && (
        <p className="px-6 py-10 text-center text-slate-500">No chamber transport recorded for this date.</p>
      )}
      {!isLoading && !error && entries.length > 0 && (
        <>
          <div className="grid gap-3 border-b border-slate-200 px-6 py-5 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Total crews recorded</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{entries.length.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Total paya</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{formatTransportPaya(totalPaya)}</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <article key={entry.dailyEntryId} className="px-6 py-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold">{entry.transportCrewName}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {entry.transportCrewWorkDirection === "FIELD_TO_KILN" ? "Field → Kiln" : "Kiln → Field"}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <p className="font-semibold tabular-nums">{formatTransportPaya(entry.payaQuantity)} paya</p>
                    <p className="mt-1 text-slate-600">
                      {entry.attendanceCount.toLocaleString("en-IN")} {entry.attendanceCount === 1 ? "worker" : "workers"} present
                    </p>
                  </div>
                </div>
                <details className="mt-4 rounded-lg border border-slate-200 px-4 py-3">
                  <summary className="cursor-pointer font-medium">Saved attendance</summary>
                  <ul className="mt-3 space-y-2 text-sm">
                    {entry.attendanceWorkers.map((worker) => (
                      <li key={worker.transportWorkerId} className="flex items-center justify-between gap-4">
                        <span>{worker.transportWorkerName}</span>
                        {!worker.transportWorkerIsActive && <span className="text-slate-500">Inactive</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function formatTransportPaya(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 20 });
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}
