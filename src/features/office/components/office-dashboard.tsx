"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { getTodaysProduction, type TodayProductionRow } from "@/features/office/services/todays-production-service";
import { CreateWageRateError, createWageRate } from "@/features/wages/services/wage-rate-create-service";
import { getWageRatesForFactory } from "@/features/wages/services/wage-rate-read-service";
import { assertMondayWeekStart, getActiveRate, getWageRateHistoryStatus, WageRateResolutionError, type WageRate, type WageRateAppliesTo, type WageRateHistory } from "@/features/wages/services/wage-rate-service";
import { assertCompletedWageWeek } from "@/features/wages/services/completed-wage-week-validation";
import { CalculateProductionWagesError, calculateProductionWages, type ProductionWageCalculationSummary } from "@/features/wages/services/production-wage-calculation-service";
import { getLabourerEarningsHistory } from "@/features/wages/services/labourer-earnings-history-service";
import { getLabourerAvailableBalance } from "@/features/wages/services/labourer-available-balance-service";
import { CreateLabourerWithdrawalError, createLabourerWithdrawal } from "@/features/wages/services/labourer-withdrawal-create-service";
import { getLabourerWithdrawalHistory } from "@/features/wages/services/labourer-withdrawal-history-service";
import { getLabourGroups, type LabourGroup } from "@/features/wages/services/labour-group-read-service";
import { LabourGroupMutationError, createLabourGroup, setLabourGroupActive } from "@/features/wages/services/labour-group-mutation-service";
import { CalculateMudSupplyWagesError, calculateMudSupplyWages } from "@/features/wages/services/mud-supply-wage-calculation-service";
import { calculateInformationalPerMemberShare } from "@/features/wages/services/mud-supply-wage-calculation";
import { getMudSupplyWeeklyEarning, type MudSupplyWeeklyEarning } from "@/features/wages/services/mud-supply-weekly-earning-read-service";
import { getLabourGroupAvailableBalance } from "@/features/wages/services/labour-group-available-balance-service";
import { CreateLabourGroupWithdrawalError, createLabourGroupWithdrawal } from "@/features/wages/services/labour-group-withdrawal-create-service";
import { getLabourGroupWithdrawalHistory } from "@/features/wages/services/labour-group-withdrawal-history-service";
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
  isActive: boolean;
};

type BrickTypeTotal = { id: string; name: string; quantity: number };

export function OfficeDashboard() {
  const router = useRouter();
  const [factoryId, setFactoryId] = useState<string | null>(null);
  const [factoryAccessStatus, setFactoryAccessStatus] = useState<"loading" | "ready" | "denied" | "failed">("loading");
  const [factoryAccessMessage, setFactoryAccessMessage] = useState("");
  const [factoryResolutionAttempt, setFactoryResolutionAttempt] = useState(0);
  const [selectedProductionDate, setSelectedProductionDate] = useState(() => getLocalDate());
  const { data = [], error: productionError, isLoading: isLoadingProduction } = useQuery({
    queryKey: ["office-production", factoryId, selectedProductionDate],
    queryFn: () => getTodaysProduction(factoryId!, selectedProductionDate),
    enabled: factoryId !== null,
    refetchInterval: 30_000,
  });
  const { data: wageRates = [], error: wageRatesError, isLoading: isLoadingWageRates } = useQuery({
    queryKey: ["office-wage-rates", factoryId],
    queryFn: () => getWageRatesForFactory(factoryId!),
    enabled: factoryId !== null,
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
      supabase.from("labourers").select("id, name, assigned_brick_type_id, is_active").eq("factory_id", factoryId).order("name"),
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
  const wageRatesErrorMessage = wageRatesError instanceof Error ? wageRatesError.message : "Could not load wage rates.";
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

        <WageRatesSection
          factoryId={factoryId!}
          rates={wageRates}
          isLoading={isLoadingWageRates}
          errorMessage={wageRatesError ? wageRatesErrorMessage : ""}
          currentDate={getMondayWeekStart(getLocalDate())}
        />

        <CalculateWagesSection factoryId={factoryId!} />

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
        />
        <LabourGroupManagement factoryId={factoryId!} />
      </div>
    </main>
  );
}

function CalculateWagesSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const [weekStart, setWeekStart] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<ProductionWageCalculationSummary | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!weekStart) {
      setSubmitError("Week-start date is required.");
      return;
    }

    try {
      assertCompletedWageWeek(weekStart, getLocalDate());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Choose a completed Monday–Sunday week.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setResult(null);
    try {
      setResult(await calculateProductionWages({ factoryId, weekStart }));
    } catch (error) {
      if (error instanceof CalculateProductionWagesError) {
        setSubmitError(error.message);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Could not calculate production wages.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="calculate-wages-heading" className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="calculate-wages-heading" className="text-xl font-bold">Calculate Wages</h2>
      <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Week start
          <input type="date" value={weekStart} onChange={(event) => { setWeekStart(event.target.value); setSubmitError(""); setResult(null); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        {submitError && <p role="alert" className="text-sm font-medium text-red-700">{submitError}</p>}
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Calculating..." : "Calculate Wages"}</button>
        {result && <p role="status" className="text-sm font-medium text-emerald-700">Calculation complete: {result.labourersCalculated} labourers calculated; {result.rowsSkipped} rows skipped.</p>}
      </form>
    </section>
  );
}

function WageRatesSection({ factoryId, rates, isLoading, errorMessage, currentDate }: Readonly<{
  factoryId: string;
  rates: readonly WageRateHistory[];
  isLoading: boolean;
  errorMessage: string;
  currentDate: string;
}>) {
  const productionHistory = rates.filter((rate) => rate.applies_to === "production");
  const mudSupplyHistory = rates.filter((rate) => rate.applies_to === "mud_supply");
  const productionCurrentRate = resolveCurrentRate(productionHistory, "production", currentDate);
  const mudSupplyCurrentRate = resolveCurrentRate(mudSupplyHistory, "mud_supply", currentDate);

  return (
    <section aria-labelledby="wage-rates-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="wage-rates-heading" className="text-xl font-bold">Wage Rates</h2>
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading wage rates...</p>}
      {errorMessage && <p role="alert" className="mt-4 text-sm font-medium text-red-700">Could not load wage rates: {errorMessage}</p>}
      {!isLoading && !errorMessage && <>
        <AddWageRateForm factoryId={factoryId} />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <CurrentWageRateCard title="Production wage rate" missingMessage="No production wage rate configured for this week" currentRate={productionCurrentRate} />
          <CurrentWageRateCard title="Mud-supply wage rate" missingMessage="No mud-supply wage rate configured for this week" currentRate={mudSupplyCurrentRate} />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <WageRateHistory title="Production rate history" rates={productionHistory} currentDate={currentDate} />
          <WageRateHistory title="Mud-supply rate history" rates={mudSupplyHistory} currentDate={currentDate} />
        </div>
      </>}
    </section>
  );
}

function AddWageRateForm({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [appliesTo, setAppliesTo] = useState<WageRateAppliesTo>("production");
  const [ratePer1000Bricks, setRatePer1000Bricks] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const rate = Number(ratePer1000Bricks);
    if (!ratePer1000Bricks || !Number.isFinite(rate) || rate <= 0) {
      setSubmitError("Rate per 1,000 bricks must be greater than zero.");
      return;
    }
    if (!effectiveFrom) {
      setSubmitError("Effective-from date is required.");
      return;
    }
    try {
      assertMondayWeekStart(effectiveFrom);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Effective-from date must be a Monday.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setIsSaved(false);
    try {
      await createWageRate({ factoryId, appliesTo, ratePer1000Bricks: rate, effectiveFrom });
      await queryClient.invalidateQueries({ queryKey: ["office-wage-rates", factoryId] });
      setRatePer1000Bricks("");
      setEffectiveFrom("");
      setIsSaved(true);
    } catch (error) {
      if (error instanceof CreateWageRateError) {
        setSubmitError(error.message);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Could not create wage rate.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-5 grid gap-4 rounded-lg border border-slate-200 p-4 md:grid-cols-4 md:items-end" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium text-slate-700">
        Rate type
        <select value={appliesTo} onChange={(event) => { setAppliesTo(event.target.value as WageRateAppliesTo); setIsSaved(false); setSubmitError(""); }} className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950">
          <option value="production">Production</option>
          <option value="mud_supply">Mud supply</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Rate per 1,000 bricks
        <input type="number" min="0" step="any" value={ratePer1000Bricks} onChange={(event) => { setRatePer1000Bricks(event.target.value); setIsSaved(false); setSubmitError(""); }} required className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Effective from
        <input type="date" value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setIsSaved(false); setSubmitError(""); }} required className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950" />
      </label>
      <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Adding..." : "Add Wage Rate"}</button>
      {submitError && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-4">{submitError}</p>}
      {isSaved && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-4">Wage rate added.</p>}
    </form>
  );
}

function CurrentWageRateCard({ title, missingMessage, currentRate }: Readonly<{
  title: string;
  missingMessage: string;
  currentRate: CurrentRateResolution;
}>) {
  return (
    <article className="rounded-lg border border-slate-200 p-5">
      <h3 className="font-semibold">{title}</h3>
      {currentRate.status === "missing" && <p className="mt-3 text-sm text-slate-500">{missingMessage}</p>}
      {currentRate.status === "error" && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Wage-rate configuration error: {currentRate.error}</p>}
      {currentRate.status === "resolved" && <>
        <p className="mt-3 text-2xl font-bold tabular-nums">{formatWageRate(currentRate.rate.rate_per_1000_bricks)}</p>
        <p className="mt-2 text-sm text-slate-600">Effective from {formatDate(currentRate.rate.effective_from)}</p>
      </>}
    </article>
  );
}

function WageRateHistory({ title, rates, currentDate }: Readonly<{ title: string; rates: readonly WageRateHistory[]; currentDate: string }>) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      {rates.length === 0 ? <p className="mt-3 text-sm text-slate-500">No rates configured.</p> : <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rates.map((rate) => {
          const status = getWageRateHistoryStatus(rate, currentDate);
          const period = status === "current"
            ? "Current"
            : status === "future"
              ? `Future · Effective from ${formatDate(rate.effective_from)}`
              : `${formatDate(rate.effective_from)} — ${formatDate(rate.effective_to!)}`;

          return <li key={rate.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <span className="font-semibold tabular-nums">{formatWageRate(rate.rate_per_1000_bricks)}</span>
          <span className="text-right text-slate-600">{period}</span>
        </li>;
        })}
      </ul>}
    </div>
  );
}

type CurrentRateResolution =
  | { status: "resolved"; rate: WageRate }
  | { status: "missing" }
  | { status: "error"; error: string };

function resolveCurrentRate(rates: readonly WageRateHistory[], appliesTo: WageRateAppliesTo, currentDate: string): CurrentRateResolution {
  try {
    return { status: "resolved", rate: getActiveRate([...rates], appliesTo, currentDate) };
  } catch (error) {
    if (error instanceof WageRateResolutionError && error.failure === "missing") {
      return { status: "missing" };
    }
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Could not determine the current wage rate.",
    };
  }
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

function getMondayWeekStart(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(day - ((date.getDay() + 6) % 7));

  const mondayYear = date.getFullYear();
  const mondayMonth = String(date.getMonth() + 1).padStart(2, "0");
  const mondayDay = String(date.getDate()).padStart(2, "0");
  return `${mondayYear}-${mondayMonth}-${mondayDay}`;
}

function LabourGroupManagement({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const { data: groups = [], error, isLoading } = useQuery({
    queryKey: ["office-labour-groups", factoryId],
    queryFn: () => getLabourGroups(factoryId),
  });
  const [name, setName] = useState("");
  const [memberNames, setMemberNames] = useState("");
  const [memberCount, setMemberCount] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingGroupId, setUpdatingGroupId] = useState("");

  function clearFeedback() {
    setMutationError("");
    setIsSaved(false);
  }

  function getMutationErrorMessage(caught: unknown, fallback: string) {
    if (caught instanceof LabourGroupMutationError) return caught.message;
    return caught instanceof Error ? caught.message : fallback;
  }

  async function addGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setMutationError("Group name is required.");
      return;
    }
    const numericMemberCount = Number(memberCount);
    if (!memberCount || !Number.isInteger(numericMemberCount) || numericMemberCount <= 0) {
      setMutationError("Number of members must be a positive integer.");
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      await createLabourGroup({
        factoryId,
        name: trimmedName,
        memberNames: memberNames.trim() || null,
        memberCount: numericMemberCount,
      });
      setName("");
      setMemberNames("");
      setMemberCount("");
      setIsSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["office-labour-groups", factoryId] });
    } catch (caught) {
      setMutationError(getMutationErrorMessage(caught, "Could not add labour group."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleGroup(group: LabourGroup) {
    if (updatingGroupId) return;

    setUpdatingGroupId(group.groupId);
    clearFeedback();
    try {
      await setLabourGroupActive({
        factoryId,
        groupId: group.groupId,
        isActive: !group.isActive,
      });
      await queryClient.invalidateQueries({ queryKey: ["office-labour-groups", factoryId] });
    } catch (caught) {
      setMutationError(getMutationErrorMessage(caught, "Could not update labour group."));
    } finally {
      setUpdatingGroupId("");
    }
  }

  const loadErrorMessage = error instanceof Error ? error.message : "Could not load labour groups.";

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Labour Groups</h2>
      <form className="mt-5 grid gap-4 md:grid-cols-4 md:items-end" onSubmit={(event) => void addGroup(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Group name
          <input value={name} onChange={(event) => { setName(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Member names (optional)
          <input value={memberNames} onChange={(event) => { setMemberNames(event.target.value); clearFeedback(); }} disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Number of members
          <input type="number" min="1" step="1" value={memberCount} onChange={(event) => { setMemberCount(event.target.value); clearFeedback(); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Adding..." : "Add Labour Group"}</button>
        {mutationError && <p role="alert" className="text-sm font-medium text-red-700 md:col-span-4">{mutationError}</p>}
        {isSaved && <p role="status" className="text-sm font-medium text-emerald-700 md:col-span-4">Labour group added.</p>}
      </form>

      {isLoading && <p className="mt-5 text-sm text-slate-500">Loading labour groups...</p>}
      {error && <p role="alert" className="mt-5 text-sm font-medium text-red-700">Could not load labour groups: {loadErrorMessage}</p>}
      {!isLoading && !error && groups.length === 0 && <p className="mt-5 text-sm text-slate-500">No labour groups configured.</p>}
      {!isLoading && !error && groups.length > 0 && <div className="mt-5 space-y-3">
        {groups.map((group) => {
          const isUpdating = updatingGroupId === group.groupId;
          return <article key={group.groupId} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold">{group.name}</h3>
              <p className="mt-1 text-sm text-slate-600">{group.memberNames || "No member names recorded."}</p>
              <p className="mt-1 text-sm text-slate-600">Members: {group.memberCount ?? "Not set"}</p>
              <p className={`mt-1 text-sm font-medium ${group.isActive ? "text-emerald-700" : "text-slate-500"}`}>{group.isActive ? "Active" : "Inactive"}</p>
            </div>
            <button type="button" disabled={Boolean(updatingGroupId)} onClick={() => void toggleGroup(group)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">
              {isUpdating ? "Updating..." : group.isActive ? "Deactivate" : "Reactivate"}
            </button>
          </article>;
        })}
      </div>}
      <MudSupplyWageCalculation
        factoryId={factoryId}
        groups={groups}
        isLoadingGroups={isLoading}
        groupsLoadFailed={Boolean(error)}
      />
    </section>
  );
}

function MudSupplyWageCalculation({ factoryId, groups, isLoadingGroups, groupsLoadFailed }: Readonly<{
  factoryId: string;
  groups: readonly LabourGroup[];
  isLoadingGroups: boolean;
  groupsLoadFailed: boolean;
}>) {
  const activeGroup = groups.find((group) => group.isActive) ?? null;
  const [weekStart, setWeekStart] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [readError, setReadError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [earning, setEarning] = useState<MudSupplyWeeklyEarning | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !activeGroup) return;

    if (!weekStart) {
      setSubmitError("Week-start date is required.");
      return;
    }

    try {
      assertCompletedWageWeek(weekStart, getLocalDate());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Choose a completed Monday–Sunday week.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setReadError("");
    setSuccessMessage("");
    setEarning(null);
    try {
      const summary = await calculateMudSupplyWages({
        factoryId,
        labourGroupId: activeGroup.groupId,
        weekStart,
      });

      setSuccessMessage(summary.groupsCalculated === 1
        ? "Mud wage calculated and locked."
        : summary.rowsSkipped === 1
          ? "This week’s mud earning was already calculated and remains locked."
          : "Mud wage calculation completed.");

      try {
        setEarning(await getMudSupplyWeeklyEarning({
          factoryId,
          weeklyEarningId: summary.weeklyEarningId,
          weekStart,
        }));
      } catch (error) {
        setReadError(error instanceof Error ? error.message : "Could not load the stored mud earning.");
      }
    } catch (error) {
      if (error instanceof CalculateMudSupplyWagesError) {
        setSubmitError(error.message);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Could not calculate the mud wage.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const earningGroup = earning
    ? groups.find((group) => group.groupId === earning.labourGroupId)
    : undefined;
  const perMemberShare = earning && earningGroup?.memberCount
    ? calculateInformationalPerMemberShare(earning.amount, earningGroup.memberCount)
    : null;
  const calculationDisabled = isSubmitting || isLoadingGroups || groupsLoadFailed || !activeGroup;

  return (
    <div className="mt-6 border-t border-slate-200 pt-6">
      <h3 className="text-lg font-bold">Calculate Mud-Supply Wage</h3>
      {isLoadingGroups && <p className="mt-3 text-sm text-slate-500">Loading the active labour group...</p>}
      {!isLoadingGroups && groupsLoadFailed && <p className="mt-3 text-sm text-slate-500">Labour groups could not be loaded, so mud wages cannot be calculated.</p>}
      {!isLoadingGroups && !groupsLoadFailed && !activeGroup && <p className="mt-3 text-sm text-slate-500">No active labour group. Activate or add one before calculating mud wages or recording group withdrawals.</p>}
      {activeGroup && <p className="mt-3 text-sm text-slate-600">Active group: <span className="font-semibold text-slate-900">{activeGroup.name}</span></p>}

      <form className="mt-4 flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end" onSubmit={(event) => void submit(event)}>
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Week start
          <input type="date" value={weekStart} onChange={(event) => { setWeekStart(event.target.value); setSubmitError(""); setReadError(""); setSuccessMessage(""); setEarning(null); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={calculationDisabled} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Calculating..." : "Calculate Mud Wage"}</button>
      </form>

      {submitError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{submitError}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p>}
      {readError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Mud wage was locked, but the stored earning could not be loaded: {readError}</p>}

      {earning && <div className="mt-5 rounded-lg border border-slate-200 p-4">
        <h4 className="font-semibold">Locked Mud Earning</h4>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Week</dt><dd className="mt-1 font-semibold">{formatDate(earning.weekStart)}</dd></div>
          <div><dt className="text-slate-500">Group name</dt><dd className="mt-1 font-semibold">{earningGroup?.name ?? "Unknown labour group"}</dd></div>
          <div><dt className="text-slate-500">Eligible quantity used</dt><dd className="mt-1 font-semibold tabular-nums">{formatStoredNumber(earning.quantityUsed)}</dd></div>
          <div><dt className="text-slate-500">Mud rate per 1,000</dt><dd className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(earning.rateUsed)}</dd></div>
          <div><dt className="text-slate-500">Group earning</dt><dd className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(earning.amount)}</dd></div>
          <div><dt className="text-slate-500">Member count</dt><dd className="mt-1 font-semibold tabular-nums">{earningGroup?.memberCount ?? "Unavailable"}</dd></div>
          <div><dt className="text-slate-500">Per member (informational)</dt><dd className="mt-1 font-semibold tabular-nums">{perMemberShare === null ? "Unavailable" : formatStoredCurrency(perMemberShare)}</dd></div>
        </dl>
      </div>}

      {activeGroup && <LabourGroupWithdrawalPanel key={activeGroup.groupId} factoryId={factoryId} labourGroup={activeGroup} />}
    </div>
  );
}

function LabourGroupWithdrawalPanel({ factoryId, labourGroup }: Readonly<{
  factoryId: string;
  labourGroup: LabourGroup;
}>) {
  const queryClient = useQueryClient();
  const asOfDate = getLocalDate();
  const { data: balance, error: balanceError, isLoading: isLoadingBalance } = useQuery({
    queryKey: ["labour-group-available-balance", factoryId, labourGroup.groupId, asOfDate],
    queryFn: () => getLabourGroupAvailableBalance({ factoryId, labourGroupId: labourGroup.groupId, asOfDate }),
  });
  const { data: withdrawals = [], error: withdrawalsError, isLoading: isLoadingWithdrawals } = useQuery({
    queryKey: ["labour-group-withdrawal-history", factoryId, labourGroup.groupId],
    queryFn: () => getLabourGroupWithdrawalHistory(factoryId, labourGroup.groupId),
  });
  const [withdrawalDate, setWithdrawalDate] = useState(() => getLocalDate());
  const [amount, setAmount] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!withdrawalDate) {
      setSubmitError("Withdrawal date is required.");
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
      await createLabourGroupWithdrawal({
        factoryId,
        labourGroupId: labourGroup.groupId,
        withdrawalDate,
        amount: numericAmount,
      });
      setAmount("");
      setIsSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["labour-group-available-balance", factoryId, labourGroup.groupId, asOfDate] }),
        queryClient.invalidateQueries({ queryKey: ["labour-group-withdrawal-history", factoryId, labourGroup.groupId] }),
      ]);
    } catch (error) {
      if (error instanceof CreateLabourGroupWithdrawalError) {
        setSubmitError(error.message);
      } else {
        setSubmitError(error instanceof Error ? error.message : "Could not record group withdrawal.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const balanceErrorMessage = balanceError instanceof Error ? balanceError.message : "Could not load group balance.";
  const withdrawalsErrorMessage = withdrawalsError instanceof Error ? withdrawalsError.message : "Could not load group withdrawal history.";

  return (
    <section aria-label="Labour group balance and withdrawals" className="mt-6 border-t border-slate-200 pt-6">
      <h3 className="text-lg font-bold">Group Balance &amp; Withdrawals</h3>
      <p className="mt-2 text-sm text-slate-600">Active group: <span className="font-semibold text-slate-900">{labourGroup.name}</span></p>

      {isLoadingBalance && <p className="mt-3 text-sm text-slate-500">Loading group balance...</p>}
      {balanceError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load group balance: {balanceErrorMessage}</p>}
      {!isLoadingBalance && !balanceError && balance && <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Available Balance</p><p className="mt-1 text-xl font-bold tabular-nums">{formatStoredCurrency(balance.availableBalance)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Total Earned</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.totalEarned)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Total Withdrawn</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.totalWithdrawn)}</p></div>
      </div>}

      <form className="mt-5 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-3 sm:items-end" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-slate-700">
          Withdrawal date
          <input type="date" value={withdrawalDate} onChange={(event) => { setWithdrawalDate(event.target.value); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Amount
          <input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Record Group Withdrawal"}</button>
        {submitError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-3">{submitError}</p>}
        {isSaved && <p role="status" className="text-sm font-medium text-emerald-700 sm:col-span-3">Group withdrawal recorded.</p>}
      </form>

      <h4 className="mt-6 font-semibold">Withdrawal History</h4>
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
    </section>
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

function LabourerManagement({ factoryId, labourers, isLoading, error, updatingLabourerId, onToggle, activeBrickTypes, editingLabourerId, selectedBrickTypeId, onOpenBrickTypeChange, onSelectedBrickTypeChange, onSaveBrickTypeChange, onCancelBrickTypeChange, editingLabourerNameId, onOpenNameEdit, onSaveName, onCancelNameEdit }: Readonly<{
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
}>) {
  const [earningsLabourerId, setEarningsLabourerId] = useState("");

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">Labourers</h2>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}
      {activeBrickTypes.length === 0 && <p className="mt-3 text-sm text-slate-500">No active brick types available — activate one first.</p>}
      {isLoading ? <p className="mt-4 text-sm text-slate-500">Loading labourers...</p> : (
        <div className="mt-4 space-y-3">
          {labourers.map((labourer) => {
            const isUpdating = updatingLabourerId === labourer.id;
            const isEditingBrickType = editingLabourerId === labourer.id;
            const isEditingName = editingLabourerNameId === labourer.id;
            const isCurrentBrickTypeActive = activeBrickTypes.some((brickType) => brickType.id === labourer.brickTypeId);
            return (
              <article key={labourer.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold">{labourer.name}</h3>
                  <p className="text-sm text-slate-600">{labourer.brickTypeName}</p>
                  <p className={`mt-1 text-sm font-medium ${labourer.isActive ? "text-emerald-700" : "text-slate-500"}`}>{labourer.isActive ? "Active" : "Inactive"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={isUpdating} onClick={() => void onToggle(labourer)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                    {isUpdating ? "Updating..." : labourer.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating} onClick={() => onOpenNameEdit(labourer)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">Edit Name</button>}
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating || activeBrickTypes.length === 0} onClick={() => onOpenBrickTypeChange(labourer)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">Change Brick Type</button>}
                  {!isEditingBrickType && !isEditingName && <button type="button" disabled={isUpdating} onClick={() => setEarningsLabourerId((current) => current === labourer.id ? "" : labourer.id)} className="h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60">{earningsLabourerId === labourer.id ? "Hide Earnings" : "View Earnings"}</button>}
                </div>
                {earningsLabourerId === labourer.id && <LabourerEarningsHistory factoryId={factoryId} labourerId={labourer.id} />}
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

function LabourerEarningsHistory({ factoryId, labourerId }: Readonly<{ factoryId: string; labourerId: string }>) {
  const asOfDate = getLocalDate();
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
    <section aria-label="Locked earnings history" className="w-full border-t border-slate-200 pt-4">
      <h3 className="font-semibold">Available Balance</h3>
      {isLoadingBalance && <p className="mt-3 text-sm text-slate-500">Loading available balance...</p>}
      {balanceError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load available balance: {balanceErrorMessage}</p>}
      {!isLoadingBalance && !balanceError && balance && <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Available balance</p><p className="mt-1 text-xl font-bold tabular-nums">{formatStoredCurrency(balance.availableBalance)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Total earned</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.totalEarned)}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-sm text-slate-500">Total withdrawn</p><p className="mt-1 font-semibold tabular-nums">{formatStoredCurrency(balance.totalWithdrawn)}</p></div>
      </div>}

      <LabourerWithdrawalForm factoryId={factoryId} labourerId={labourerId} asOfDate={asOfDate} />

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
              <td className="px-4 py-3 text-right tabular-nums">₹{formatStoredNumber(earning.rate_used)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">₹{formatStoredNumber(earning.amount)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function LabourerWithdrawalForm({ factoryId, labourerId, asOfDate }: Readonly<{
  factoryId: string;
  labourerId: string;
  asOfDate: string;
}>) {
  const queryClient = useQueryClient();
  const [withdrawalDate, setWithdrawalDate] = useState(() => getLocalDate());
  const [amount, setAmount] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (!withdrawalDate) {
      setSubmitError("Withdrawal date is required.");
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
      await createLabourerWithdrawal({
        factoryId,
        labourerId,
        withdrawalDate,
        amount: numericAmount,
      });
      setAmount("");
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
        <input type="date" value={withdrawalDate} onChange={(event) => { setWithdrawalDate(event.target.value); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Amount
        <input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setSubmitError(""); setIsSaved(false); }} required disabled={isSubmitting} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100" />
      </label>
      <button type="submit" disabled={isSubmitting} className="h-11 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Saving..." : "Record Withdrawal"}</button>
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

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}
