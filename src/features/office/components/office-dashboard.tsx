"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { resolveAuthenticatedFactoryId } from "@/features/auth/services/factory-access-service";
import { getTodaysProduction, type TodayProductionRow } from "@/features/office/services/todays-production-service";
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

        <AddBrickTypeForm factoryId={factoryId!} onAdded={loadLabourers} />
        <BrickTypeManagement
          brickTypes={brickTypes}
          error={brickTypesError}
          updatingBrickTypeId={updatingBrickTypeId}
          onToggle={toggleBrickType}
        />
        <AddLabourerForm factoryId={factoryId!} brickTypes={activeBrickTypes} onAdded={loadLabourers} />
        <LabourerManagement
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
      </div>
    </main>
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

function LabourerManagement({ labourers, isLoading, error, updatingLabourerId, onToggle, activeBrickTypes, editingLabourerId, selectedBrickTypeId, onOpenBrickTypeChange, onSelectedBrickTypeChange, onSaveBrickTypeChange, onCancelBrickTypeChange, editingLabourerNameId, onOpenNameEdit, onSaveName, onCancelNameEdit }: Readonly<{
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
                </div>
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
