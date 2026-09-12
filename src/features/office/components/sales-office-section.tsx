"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SalesRegisterSection } from "@/features/office/components/sales-register-section";
import { CustomerPaymentsSection } from "@/features/office/components/customer-payments-section";
import { VehicleWageAccountsSection } from "@/features/office/components/vehicle-wage-accounts-section";
import { applyPaymentLocks } from "@/features/office/customer-payment-office-model";
import {
  addChallanFlexibleLine,
  addChallanLine,
  buildFactoryProfileInput,
  buildCustomerUpdateInput,
  buildCreateChallanInput,
  buildQuickCustomerInput,
  buildUpdateChallanInput,
  calculateChallanBrickLineAmountPreview,
  calculateChallanTotalPreview,
  calculateFlexibleLineAmountPreview,
  challanFormFromSaved,
  customerFormFromSaved,
  emptyChallanLine,
  factoryProfileErrorMessage,
  factoryProfileFormFromSaved,
  filterActiveVehiclesForChallan,
  formatChallanDate,
  formatSalesMoney,
  getChallanEligibility,
  getChallanFormError,
  getSavedChallanFlexibleLineViews,
  getSavedChallanVehicleDetails,
  isFactoryPrintableProfileComplete,
  moveChallanFlexibleLine,
  removeChallanFlexibleLine,
  removeChallanLine,
  SALES_SECTION_HEADING,
  salesOfficeErrorMessage,
  selectCustomer,
  selectVehicleForChallan,
  updateChallanLineField,
  upsertChallanNewestFirst,
  type ChallanExtraChargeMode,
  type ChallanFormState,
  type FactoryProfileForm,
  type QuickCustomerForm,
} from "@/features/office/sales-office-model";
import {
  createChallan,
  getFactoryPrintableProfile,
  getChallan,
  listChallans,
  updateChallan,
  updateFactoryPrintableProfile,
  voidChallan,
} from "@/features/sales/services/challan-service";
import {
  createCustomer,
  listCustomers,
  updateCustomer,
} from "@/features/sales/services/customer-service";
import {
  archiveVehicle,
  findOrCreateVehicle,
  listVehicles,
  restoreVehicle,
  setVehicleDeliveryWageTracking,
} from "@/features/sales/services/vehicle-service";
import type {
  Challan,
  ChallanHeader,
  Customer,
  CustomerPayment,
  FactoryPrintableProfile,
  Vehicle,
} from "@/features/sales/types";
import { formatChallanLabel } from "@/features/sales/types";
import { getLocalDate } from "@/lib/local-date";

type SalesBrickType = { id: string; name: string; isActive: boolean };
type WorkspaceMode = "create" | "detail" | "edit";

const customersKey = (factoryId: string) => ["office-sales-customers", factoryId] as const;
const factoryProfileKey = (factoryId: string) => ["office-sales-factory-profile", factoryId] as const;
const challansKey = (factoryId: string) => ["office-sales-challans", factoryId] as const;
const challanKey = (factoryId: string, challanId: string) =>
  ["office-sales-challan", factoryId, challanId] as const;
const vehiclesKey = (factoryId: string) => ["office-sales-vehicles", factoryId] as const;
const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100";
const primaryButton = "h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

export function SalesOfficeSection({
  factoryId,
  brickTypes,
  isLoadingBrickTypes,
  brickTypesError,
}: Readonly<{
  factoryId: string;
  brickTypes: readonly SalesBrickType[];
  isLoadingBrickTypes: boolean;
  brickTypesError: string;
}>) {
  const queryClient = useQueryClient();
  const factoryProfileQuery = useQuery({
    queryKey: factoryProfileKey(factoryId),
    queryFn: () => getFactoryPrintableProfile(factoryId),
  });
  const customersQuery = useQuery({
    queryKey: customersKey(factoryId),
    queryFn: () => listCustomers(factoryId),
  });
  const challansQuery = useQuery({
    queryKey: challansKey(factoryId),
    queryFn: () => listChallans(factoryId),
  });
  const vehiclesQuery = useQuery({
    queryKey: vehiclesKey(factoryId),
    queryFn: () => listVehicles(factoryId, true),
  });
  const [mode, setMode] = useState<WorkspaceMode>("create");
  const [selectedChallanId, setSelectedChallanId] = useState("");
  const [success, setSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [isConfirmingVoid, setIsConfirmingVoid] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);

  const selectedChallanQuery = useQuery({
    queryKey: challanKey(factoryId, selectedChallanId),
    queryFn: () => getChallan(factoryId, selectedChallanId),
    enabled: Boolean(selectedChallanId),
  });

  function openCreate() {
    setMode("create");
    setSelectedChallanId("");
    setIsConfirmingVoid(false);
    setActionError("");
    setSuccess("");
  }

  function openChallan(challanId: string) {
    setSelectedChallanId(challanId);
    setMode("detail");
    setIsConfirmingVoid(false);
    setActionError("");
    setSuccess("");
  }

  function cacheSavedChallan(saved: Challan) {
    queryClient.setQueryData<ChallanHeader[]>(
      challansKey(factoryId),
      (current = []) => upsertChallanNewestFirst(current, saved),
    );
    queryClient.setQueryData<Challan>(challanKey(factoryId, saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: challansKey(factoryId) });
    void queryClient.invalidateQueries({ queryKey: ["office-sales-register", factoryId] });
    void queryClient.invalidateQueries({ queryKey: ["office-vehicle-wages", factoryId] });
    void queryClient.invalidateQueries({ queryKey: ["office-vehicle-trips", factoryId] });
  }

  function cacheSavedCustomer(customer: Customer) {
    queryClient.setQueryData<Customer[]>(customersKey(factoryId), (current = []) =>
      [...current.filter((item) => item.id !== customer.id), customer].sort(
        (left, right) => left.name.localeCompare(right.name, "en-IN")
          || left.id.localeCompare(right.id),
      ));
    void queryClient.invalidateQueries({ queryKey: customersKey(factoryId) });
  }

  function cacheSavedVehicle(vehicle: Vehicle) {
    queryClient.setQueryData<Vehicle[]>(vehiclesKey(factoryId), (current = []) =>
      [...current.filter((item) => item.id !== vehicle.id), vehicle].sort(
        (left, right) => left.normalizedVehicleNumber.localeCompare(
          right.normalizedVehicleNumber,
          "en-IN",
        ) || left.id.localeCompare(right.id),
      ));
    void queryClient.invalidateQueries({ queryKey: vehiclesKey(factoryId) });
  }

  function cacheSavedPayment(payment: CustomerPayment) {
    queryClient.setQueryData<ChallanHeader[]>(
      challansKey(factoryId),
      (current = []) => applyPaymentLocks(current, payment),
    );
    for (const allocation of payment.allocations) {
      queryClient.setQueryData<Challan>(
        challanKey(factoryId, allocation.challanId),
        (current) => current ? { ...current, isLocked: true } : current,
      );
      void queryClient.invalidateQueries({
        queryKey: challanKey(factoryId, allocation.challanId),
      });
    }
    void queryClient.invalidateQueries({ queryKey: challansKey(factoryId) });
    void queryClient.invalidateQueries({ queryKey: ["office-sales-register", factoryId] });
    void queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] });
  }

  function cacheSavedFactoryProfile(profile: FactoryPrintableProfile) {
    queryClient.setQueryData<FactoryPrintableProfile>(factoryProfileKey(factoryId), profile);
    void queryClient.invalidateQueries({ queryKey: factoryProfileKey(factoryId) });
    setActionError("");
    setSuccess("Factory / Challan Profile saved. Challan creation is now available.");
  }

  function handleSaved(saved: Challan, action: "created" | "updated") {
    cacheSavedChallan(saved);
    setSelectedChallanId(saved.id);
    setMode("detail");
    setActionError("");
    setSuccess(
      action === "created"
        ? `${formatChallanLabel(saved.challanNumber)} created. Authoritative total: ${formatSalesMoney(saved.challanTotal)}.`
        : `${formatChallanLabel(saved.challanNumber)} updated. Authoritative total: ${formatSalesMoney(saved.challanTotal)}.`,
    );
  }

  async function confirmVoid(challan: Challan) {
    if (isVoiding) return;
    setIsVoiding(true);
    setActionError("");
    setSuccess("");
    try {
      const saved = await voidChallan(factoryId, challan.id);
      cacheSavedChallan(saved);
      setIsConfirmingVoid(false);
      setSuccess(`${formatChallanLabel(saved.challanNumber)} is now Void.`);
    } catch (error) {
      setActionError(salesOfficeErrorMessage(error, "Could not void this Challan."));
    } finally {
      setIsVoiding(false);
    }
  }

  const customers = customersQuery.data ?? [];
  const challans = challansQuery.data ?? [];
  const selectedChallan = selectedChallanQuery.data;
  const factoryProfile = factoryProfileQuery.data;
  const vehicles = vehiclesQuery.data ?? [];
  const profileComplete = isFactoryPrintableProfileComplete(factoryProfile);

  return (
    <section aria-labelledby="sales-office-heading" className="mt-10 border-t-4 border-cyan-300 pt-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-cyan-800">{SALES_SECTION_HEADING}</p>
          <h2 id="sales-office-heading" className="mt-1 text-2xl font-bold">Create and manage Challans</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Add the paper Challan number when available, or leave it blank. The database calculates the total.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={primaryButton}>New Challan</button>
      </div>

      {success && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</p>}
      {actionError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{actionError}</p>}

      {factoryProfileQuery.isLoading && <LoadingCard label="Loading Factory / Challan Profile..." />}
      {factoryProfileQuery.error && <ErrorCard message={salesOfficeErrorMessage(factoryProfileQuery.error, "Could not load the Factory / Challan Profile.")} />}
      {factoryProfile && <FactoryProfileEditor
        key={factoryProfile.updatedAt}
        factoryId={factoryId}
        profile={factoryProfile}
        onSaved={cacheSavedFactoryProfile}
      />}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.8fr)] xl:items-start">
        <div>
          {mode === "create" && <ChallanEditor
            key="create-challan"
            factoryId={factoryId}
            customers={customers}
            customersUnavailable={customersQuery.isLoading || Boolean(customersQuery.error)}
            customersError={customersQuery.error}
            vehicles={vehicles}
            vehiclesUnavailable={vehiclesQuery.isLoading || Boolean(vehiclesQuery.error)}
            vehiclesError={vehiclesQuery.error}
            brickTypes={brickTypes}
            isLoadingBrickTypes={isLoadingBrickTypes}
            brickTypesError={brickTypesError}
            profileComplete={profileComplete}
            isLoadingFactoryProfile={factoryProfileQuery.isLoading}
            onCustomerSaved={cacheSavedCustomer}
            onVehicleSaved={cacheSavedVehicle}
            onSaved={(saved) => handleSaved(saved, "created")}
          />}

          {mode === "edit" && selectedChallan && <ChallanEditor
            key={`edit-${selectedChallan.id}-${selectedChallan.updatedAt}`}
            factoryId={factoryId}
            customers={customers}
            customersUnavailable={customersQuery.isLoading || Boolean(customersQuery.error)}
            customersError={customersQuery.error}
            vehicles={vehicles}
            vehiclesUnavailable={vehiclesQuery.isLoading || Boolean(vehiclesQuery.error)}
            vehiclesError={vehiclesQuery.error}
            brickTypes={brickTypes}
            isLoadingBrickTypes={isLoadingBrickTypes}
            brickTypesError={brickTypesError}
            profileComplete={profileComplete}
            isLoadingFactoryProfile={factoryProfileQuery.isLoading}
            challan={selectedChallan}
            onCustomerSaved={cacheSavedCustomer}
            onVehicleSaved={cacheSavedVehicle}
            onCancel={() => setMode("detail")}
            onSaved={(saved) => handleSaved(saved, "updated")}
          />}

          {mode === "detail" && !selectedChallanId && <EmptyWorkspace onCreate={openCreate} />}
          {mode === "detail" && selectedChallanId && selectedChallanQuery.isLoading && <LoadingCard label="Loading Challan details..." />}
          {mode === "detail" && selectedChallanId && selectedChallanQuery.error && <ErrorCard message={salesOfficeErrorMessage(selectedChallanQuery.error, "Could not load Challan details.")} />}
          {mode === "detail" && selectedChallan && <ChallanDetail
            challan={selectedChallan}
            isConfirmingVoid={isConfirmingVoid}
            isVoiding={isVoiding}
            onEdit={() => { setMode("edit"); setSuccess(""); setActionError(""); }}
            onStartVoid={() => { setIsConfirmingVoid(true); setSuccess(""); setActionError(""); }}
            onCancelVoid={() => setIsConfirmingVoid(false)}
            onConfirmVoid={() => void confirmVoid(selectedChallan)}
          />}
        </div>

        <section aria-labelledby="challan-history-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 id="challan-history-heading" className="text-lg font-bold">Challan history</h3>
            <p className="mt-1 text-sm text-slate-500">Operational history, newest first.</p>
          </div>
          {challansQuery.isLoading && <p className="px-5 py-8 text-sm text-slate-500">Loading Challans...</p>}
          {challansQuery.error && <p role="alert" className="px-5 py-8 text-sm font-medium text-red-700">{salesOfficeErrorMessage(challansQuery.error, "Could not load Challans.")}</p>}
          {!challansQuery.isLoading && !challansQuery.error && challans.length === 0 && <p className="px-5 py-8 text-sm text-slate-500">No Challans yet. Create the first one.</p>}
          {!challansQuery.isLoading && !challansQuery.error && challans.length > 0 && <ul className="max-h-[46rem] divide-y divide-slate-100 overflow-y-auto">
            {challans.map((challan) => <li key={challan.id} className={selectedChallanId === challan.id ? "bg-cyan-50" : "bg-white"}>
              <button type="button" onClick={() => openChallan(challan.id)} className="w-full px-5 py-4 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-600">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{formatChallanLabel(challan.challanNumber)}</p>
                    <p className="mt-1 text-sm text-slate-700">{challan.customerNameSnapshot}</p>
                  </div>
                  <StatusBadge status={challan.status} isLocked={challan.isLocked} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span>{formatChallanDate(challan.challanDate)}</span>
                  <span className="text-right font-semibold tabular-nums text-slate-900">{formatSalesMoney(challan.challanTotal)}</span>
                  <span className="truncate">{challan.vehicleNumberSnapshot || challan.vehicleNumber
                    ? `Vehicle ${challan.vehicleNumberSnapshot || challan.vehicleNumber}`
                    : "No vehicle"}</span>
                  <span className="text-right font-semibold text-cyan-800">Open</span>
                </div>
              </button>
            </li>)}
          </ul>}
        </section>
      </div>

      <VehicleManagementSection
        factoryId={factoryId}
        vehicles={vehicles}
        isLoading={vehiclesQuery.isLoading}
        error={vehiclesQuery.error}
        onSaved={cacheSavedVehicle}
      />

      <VehicleWageAccountsSection factoryId={factoryId} vehicles={vehicles} />

      <CustomerPaymentsSection
        factoryId={factoryId}
        customers={customers}
        onPaymentSaved={cacheSavedPayment}
      />
      <SalesRegisterSection factoryId={factoryId} />
    </section>
  );
}

function FactoryProfileEditor({
  factoryId,
  profile,
  onSaved,
}: Readonly<{
  factoryId: string;
  profile: FactoryPrintableProfile;
  onSaved: (profile: FactoryPrintableProfile) => void;
}>) {
  const complete = isFactoryPrintableProfileComplete(profile);
  const [isEditing, setIsEditing] = useState(!complete);
  const [form, setForm] = useState<FactoryProfileForm>(() => factoryProfileFormFromSaved(profile));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const input = buildFactoryProfileInput(factoryId, form);
    if (!input) {
      setError("Complete all eight Factory / Challan Profile fields.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await updateFactoryPrintableProfile(input);
      setForm(factoryProfileFormFromSaved(saved));
      setIsEditing(false);
      onSaved(saved);
    } catch (caught) {
      setError(factoryProfileErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="factory-challan-profile-heading" className={`rounded-xl border p-4 shadow-sm ${complete ? "border-slate-200 bg-white" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="factory-challan-profile-heading" className="font-bold">Factory / Challan Profile</h3>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-200 text-amber-900"}`}>{complete ? "Complete" : "Required"}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">Saved on every new Challan as the historical company snapshot.</p>
        </div>
        {!isEditing && <button type="button" onClick={() => setIsEditing(true)} className={secondaryButton}>Edit profile</button>}
      </div>

      {!isEditing && <div className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Company / factory" value={profile.name} />
        <Detail label="Business description" value={profile.businessDescription} />
        <Detail label="Village" value={profile.village} />
        <Detail label="Post Office" value={profile.postOffice} />
        <Detail label="Police Station" value={profile.policeStation} />
        <Detail label="District" value={profile.district} />
        <Detail label="State" value={profile.state} />
        <Detail label="Mobile" value={profile.mobile} />
      </div>}

      {isEditing && <form className="mt-4" onSubmit={(event) => void saveProfile(event)}>
        {!complete && <p role="alert" className="mb-3 text-sm font-semibold text-amber-900">Complete this profile to enable Challan creation.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Company / factory name"><input autoFocus value={form.name} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="Business description"><input value={form.businessDescription} onChange={(event) => { setForm((current) => ({ ...current, businessDescription: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="Village"><input value={form.village} onChange={(event) => { setForm((current) => ({ ...current, village: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="Post Office"><input value={form.postOffice} onChange={(event) => { setForm((current) => ({ ...current, postOffice: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="Police Station"><input value={form.policeStation} onChange={(event) => { setForm((current) => ({ ...current, policeStation: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="District"><input value={form.district} onChange={(event) => { setForm((current) => ({ ...current, district: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="State"><input value={form.state} onChange={(event) => { setForm((current) => ({ ...current, state: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <Field label="Mobile"><input inputMode="tel" value={form.mobile} onChange={(event) => { setForm((current) => ({ ...current, mobile: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button disabled={isSaving} className={primaryButton}>{isSaving ? "Saving..." : "Save profile"}</button>
          {complete && <button type="button" onClick={() => { setForm(factoryProfileFormFromSaved(profile)); setIsEditing(false); setError(""); }} disabled={isSaving} className={secondaryButton}>Cancel</button>}
          {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        </div>
      </form>}
    </section>
  );
}

function VehicleManagementSection({
  factoryId,
  vehicles,
  isLoading,
  error,
  onSaved,
}: Readonly<{
  factoryId: string;
  vehicles: readonly Vehicle[];
  isLoading: boolean;
  error: Error | null;
  onSaved: (vehicle: Vehicle) => void;
}>) {
  const [showArchived, setShowArchived] = useState(false);
  const [busyVehicleId, setBusyVehicleId] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const activeVehicles = vehicles.filter((vehicle) => vehicle.isActive);
  const archivedVehicles = vehicles.filter((vehicle) => !vehicle.isActive);

  async function runAction(
    vehicle: Vehicle,
    action: "toggle" | "archive" | "restore",
  ) {
    if (busyVehicleId) return;
    setBusyVehicleId(vehicle.id);
    setActionError("");
    setSuccess("");
    try {
      const saved = action === "toggle"
        ? await setVehicleDeliveryWageTracking({
          factoryId,
          vehicleId: vehicle.id,
          enabled: !vehicle.deliveryWageTrackingEnabled,
        })
        : action === "archive"
          ? await archiveVehicle(factoryId, vehicle.id)
          : await restoreVehicle(factoryId, vehicle.id);
      onSaved(saved);
      setSuccess(action === "toggle"
        ? `${saved.vehicleNumber}: Delivery Wage Tracking ${saved.deliveryWageTrackingEnabled ? "ON" : "OFF"}.`
        : `${saved.vehicleNumber} ${action === "archive" ? "archived" : "restored"}.`);
    } catch (caught) {
      setActionError(salesOfficeErrorMessage(caught, `Could not ${action} this Vehicle.`));
    } finally {
      setBusyVehicleId("");
    }
  }

  function vehicleRow(vehicle: Vehicle) {
    return <li key={vehicle.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-bold text-slate-950">{vehicle.vehicleNumber}</p>
        <p className="mt-1 text-xs text-slate-500">Delivery Wage Tracking: <span className={vehicle.deliveryWageTrackingEnabled ? "font-bold text-emerald-700" : "font-bold text-slate-700"}>{vehicle.deliveryWageTrackingEnabled ? "ON" : "OFF"}</span></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void runAction(vehicle, "toggle")} disabled={Boolean(busyVehicleId)} className={secondaryButton}>Turn tracking {vehicle.deliveryWageTrackingEnabled ? "OFF" : "ON"}</button>
        <button type="button" onClick={() => void runAction(vehicle, vehicle.isActive ? "archive" : "restore")} disabled={Boolean(busyVehicleId)} className={vehicle.isActive ? "h-10 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-40" : primaryButton}>{vehicle.isActive ? "Archive" : "Restore"}</button>
      </div>
    </li>;
  }

  return <section aria-labelledby="vehicle-management-heading" className="mt-10 rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 id="vehicle-management-heading" className="text-lg font-bold">Vehicles</h3>
        <p className="mt-1 text-sm text-slate-500">Manage selection availability and future-trip Delivery Wage Tracking.</p>
      </div>
      <button type="button" onClick={() => setShowArchived((current) => !current)} className={secondaryButton}>{showArchived ? "Hide archived" : `Archived (${archivedVehicles.length})`}</button>
    </div>
    {success && <p role="status" className="mx-4 mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</p>}
    {actionError && <p role="alert" className="mx-4 mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{actionError}</p>}
    {isLoading && <p className="px-5 py-8 text-sm text-slate-500">Loading Vehicles...</p>}
    {error && <p role="alert" className="px-5 py-8 text-sm font-medium text-red-700">{salesOfficeErrorMessage(error, "Could not load Vehicles.")}</p>}
    {!isLoading && !error && activeVehicles.length === 0 && <p className="px-5 py-6 text-sm text-slate-500">No active Vehicles. Add one inside the Challan form when needed.</p>}
    {!isLoading && !error && activeVehicles.length > 0 && <ul className="divide-y divide-slate-100">{activeVehicles.map(vehicleRow)}</ul>}
    {showArchived && <div className="border-t border-slate-200">
      <h4 className="bg-slate-50 px-5 py-3 text-sm font-bold text-slate-700">Archived Vehicles</h4>
      {archivedVehicles.length === 0
        ? <p className="px-5 py-6 text-sm text-slate-500">No archived Vehicles.</p>
        : <ul className="divide-y divide-slate-100">{archivedVehicles.map(vehicleRow)}</ul>}
    </div>}
  </section>;
}

function ChallanEditor({
  factoryId,
  customers,
  customersUnavailable,
  customersError,
  vehicles,
  vehiclesUnavailable,
  vehiclesError,
  brickTypes,
  isLoadingBrickTypes,
  brickTypesError,
  profileComplete,
  isLoadingFactoryProfile,
  challan,
  onCustomerSaved,
  onVehicleSaved,
  onSaved,
  onCancel,
}: Readonly<{
  factoryId: string;
  customers: readonly Customer[];
  customersUnavailable: boolean;
  customersError: Error | null;
  vehicles: readonly Vehicle[];
  vehiclesUnavailable: boolean;
  vehiclesError: Error | null;
  brickTypes: readonly SalesBrickType[];
  isLoadingBrickTypes: boolean;
  brickTypesError: string;
  profileComplete: boolean;
  isLoadingFactoryProfile: boolean;
  challan?: Challan;
  onCustomerSaved: (customer: Customer) => void;
  onVehicleSaved: (vehicle: Vehicle) => void;
  onSaved: (challan: Challan) => void;
  onCancel?: () => void;
}>) {
  const nextLineNumber = useRef((challan?.items.length ?? 1) + 1);
  const nextFlexibleLineNumber = useRef((challan?.flexibleLines.length ?? 0) + 1);
  const [form, setForm] = useState<ChallanFormState>(() => challan
    ? challanFormFromSaved(challan, vehicles)
    : {
      challanNumber: "",
      challanDate: getLocalDate(),
      customerId: "",
      vehicleId: "",
      selectedVehicleIsActive: true,
      vehicleDeliveryWageTrackingEnabled: false,
      tripLabourWage: "",
      lines: [emptyChallanLine("new-line-1")],
      flexibleLines: [],
    });
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState<QuickCustomerForm>({ name: "", address: "", mobile: "" });
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState("");
  const [customerEdit, setCustomerEdit] = useState<QuickCustomerForm>({ name: "", address: "", mobile: "" });
  const [isUpdatingCustomer, setIsUpdatingCustomer] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [showQuickVehicle, setShowQuickVehicle] = useState(false);
  const [quickVehicleNumber, setQuickVehicleNumber] = useState("");
  const [quickVehicleTracksWage, setQuickVehicleTracksWage] = useState(false);
  const [isCreatingVehicle, setIsCreatingVehicle] = useState(false);
  const [vehicleError, setVehicleError] = useState("");

  useEffect(() => {
    if (!form.customerId && customers.length > 0) {
      setForm((current) => ({ ...current, customerId: customers[0].id }));
    }
  }, [customers, form.customerId]);

  useEffect(() => {
    if (vehicles.length === 0) return;
    setForm((current) => current.vehicleId
      ? selectVehicleForChallan(current, vehicles, current.vehicleId)
      : current);
  }, [vehicles]);

  const selectedCustomer = selectCustomer(customers, form.customerId);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === form.vehicleId);
  const totalPreview = calculateChallanTotalPreview(form.lines, form.flexibleLines);

  function updateLine(
    key: string,
    field: "brickTypeId" | "quantity" | "ratePer1000Bricks" | "lineAmount",
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      lines: updateChallanLineField(current.lines, key, field, value),
    }));
    setError("");
  }

  function addFlexibleLine(lineType: "NOTE" | "EXTRA_CHARGE") {
    const key = `new-flexible-line-${nextFlexibleLineNumber.current}`;
    nextFlexibleLineNumber.current += 1;
    setForm((current) => ({
      ...current,
      flexibleLines: addChallanFlexibleLine(current.flexibleLines, key, lineType),
    }));
    setError("");
  }

  function updateFlexibleParticulars(key: string, particulars: string) {
    setForm((current) => ({
      ...current,
      flexibleLines: current.flexibleLines.map((line) =>
        line.key === key ? { ...line, particulars } : line),
    }));
    setError("");
  }

  function updateExtraChargeField(
    key: string,
    field: "amount" | "quantity" | "rate",
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      flexibleLines: current.flexibleLines.map((line) =>
        line.key === key && line.lineType === "EXTRA_CHARGE"
          ? { ...line, [field]: value }
          : line),
    }));
    setError("");
  }

  function updateExtraChargeMode(key: string, chargeMode: ChallanExtraChargeMode) {
    setForm((current) => ({
      ...current,
      flexibleLines: current.flexibleLines.map((line) =>
        line.key === key && line.lineType === "EXTRA_CHARGE"
          ? { ...line, chargeMode, amount: "", quantity: "", rate: "" }
          : line),
    }));
    setError("");
  }

  async function submitQuickCustomer() {
    if (isCreatingCustomer) return;
    const input = buildQuickCustomerInput(factoryId, quickCustomer);
    if (!input) {
      setCustomerError("Customer name is required.");
      return;
    }
    setIsCreatingCustomer(true);
    setCustomerError("");
    try {
      const customer = await createCustomer(input);
      onCustomerSaved(customer);
      setForm((current) => ({ ...current, customerId: customer.id }));
      setQuickCustomer({ name: "", address: "", mobile: "" });
      setShowQuickCustomer(false);
    } catch (caught) {
      setCustomerError(salesOfficeErrorMessage(caught, "Could not create the customer."));
    } finally {
      setIsCreatingCustomer(false);
    }
  }

  function startCustomerEdit() {
    if (!selectedCustomer || challan) return;
    setCustomerEdit(customerFormFromSaved(selectedCustomer));
    setEditingCustomerId(selectedCustomer.id);
    setShowQuickCustomer(false);
    setCustomerError("");
  }

  function cancelCustomerEdit() {
    setEditingCustomerId("");
    setCustomerError("");
  }

  async function submitCustomerEdit() {
    if (isUpdatingCustomer) return;
    const input = buildCustomerUpdateInput(factoryId, editingCustomerId, customerEdit);
    if (!input) {
      setCustomerError("Customer name is required.");
      return;
    }
    setIsUpdatingCustomer(true);
    setCustomerError("");
    try {
      const customer = await updateCustomer(input);
      onCustomerSaved(customer);
      setForm((current) => ({ ...current, customerId: customer.id }));
      setEditingCustomerId("");
    } catch (caught) {
      setCustomerError(salesOfficeErrorMessage(caught, "Could not update the customer."));
    } finally {
      setIsUpdatingCustomer(false);
    }
  }

  async function submitQuickVehicle() {
    if (isCreatingVehicle) return;
    setIsCreatingVehicle(true);
    setVehicleError("");
    try {
      const vehicle = await findOrCreateVehicle({
        factoryId,
        vehicleNumber: quickVehicleNumber,
        deliveryWageTrackingEnabled: quickVehicleTracksWage,
      });
      onVehicleSaved(vehicle);
      if (!vehicle.isActive) {
        setVehicleError("This Vehicle is archived. Restore it in Vehicle management before use.");
        return;
      }
      setForm((current) => selectVehicleForChallan(current, [vehicle], vehicle.id));
      setQuickVehicleNumber("");
      setQuickVehicleTracksWage(false);
      setShowQuickVehicle(false);
    } catch (caught) {
      setVehicleError(salesOfficeErrorMessage(caught, "Could not add the Vehicle."));
    } finally {
      setIsCreatingVehicle(false);
    }
  }

  async function submitChallan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    if (!challan && !profileComplete) {
      setError("Complete the Factory / Challan Profile before creating a Challan.");
      return;
    }
    const formError = getChallanFormError(form);
    if (formError) {
      setError(formError);
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      let saved: Challan;
      if (challan) {
        const input = buildUpdateChallanInput(factoryId, challan.id, form);
        if (!input) throw new Error("Could not prepare this Challan update.");
        saved = await updateChallan(input);
      } else {
        const input = buildCreateChallanInput(factoryId, form);
        if (!input) throw new Error("Could not prepare this Challan.");
        saved = await createChallan(input);
      }
      onSaved(saved);
    } catch (caught) {
      setError(salesOfficeErrorMessage(caught, `Could not ${challan ? "update" : "create"} the Challan.`));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="challan-editor-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="challan-editor-heading" className="text-xl font-bold">{challan ? `Edit ${formatChallanLabel(challan.challanNumber)}` : "Create Challan"}</h3>
          {!challan && <p className="mt-1 text-sm text-slate-500">Challan No. is optional and can match the paper reference.</p>}
        </div>
      </div>

      <form className="mt-6" onSubmit={(event) => void submitChallan(event)}>
        {!challan && !isLoadingFactoryProfile && !profileComplete && <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Complete the Factory / Challan Profile before creating a Challan.</p>}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Customer">
            <select
              value={form.customerId}
              onChange={(event) => { setForm((current) => ({ ...current, customerId: event.target.value })); setEditingCustomerId(""); setCustomerError(""); setError(""); }}
              disabled={customersUnavailable || isSaving || isUpdatingCustomer || customers.length === 0}
              className={inputClass}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </Field>
          <button type="button" onClick={() => { setShowQuickCustomer((current) => !current); setEditingCustomerId(""); setCustomerError(""); }} disabled={isSaving || isUpdatingCustomer} className={secondaryButton}>
            {showQuickCustomer ? "Close customer form" : "Quick add customer"}
          </button>
        </div>

        {selectedCustomer && <div className="mt-3 grid gap-1 rounded-lg border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <p className="font-semibold text-slate-900">{selectedCustomer.name}</p>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <p className="text-slate-700">{selectedCustomer.mobile || "No mobile"}</p>
            {!challan && <button type="button" onClick={startCustomerEdit} disabled={isSaving || isUpdatingCustomer} className="font-semibold text-cyan-800 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50">Edit</button>}
          </div>
          <p className="text-slate-700 sm:col-span-2">Delivery destination: {selectedCustomer.address || "No address recorded"}</p>
        </div>}
        {customersUnavailable && !customersError && <p className="mt-2 text-sm text-slate-500">Loading customers...</p>}
        {customersError && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{salesOfficeErrorMessage(customersError, "Could not load customers.")}</p>}
        {!customersUnavailable && customers.length === 0 && !showQuickCustomer && <p className="mt-2 text-sm text-slate-500">No customers yet. Quick add the first customer.</p>}

        {showQuickCustomer && <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-4" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitQuickCustomer(); } }}>
          <p className="text-sm font-bold text-cyan-950">New customer</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Customer name"><input autoFocus value={quickCustomer.name} onChange={(event) => { setQuickCustomer((current) => ({ ...current, name: event.target.value })); setCustomerError(""); }} disabled={isCreatingCustomer} className={inputClass} /></Field>
            <Field label="Address / delivery destination"><input value={quickCustomer.address} onChange={(event) => { setQuickCustomer((current) => ({ ...current, address: event.target.value })); setCustomerError(""); }} disabled={isCreatingCustomer} className={inputClass} /></Field>
            <Field label="Mobile"><input inputMode="tel" value={quickCustomer.mobile} onChange={(event) => { setQuickCustomer((current) => ({ ...current, mobile: event.target.value })); setCustomerError(""); }} disabled={isCreatingCustomer} className={inputClass} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void submitQuickCustomer()} disabled={isCreatingCustomer} className={primaryButton}>{isCreatingCustomer ? "Adding..." : "Add and select customer"}</button>
            {customerError && <p role="alert" className="text-sm font-medium text-red-700">{customerError}</p>}
          </div>
        </div>}

        {editingCustomerId && selectedCustomer && !challan && <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-4" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitCustomerEdit(); } }}>
          <p className="text-sm font-bold text-cyan-950">Edit selected customer</p>
          <p className="mt-1 text-xs text-cyan-900">Updates Customer Master for this and future Challans. Saved Challans stay unchanged.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Customer name"><input autoFocus value={customerEdit.name} onChange={(event) => { setCustomerEdit((current) => ({ ...current, name: event.target.value })); setCustomerError(""); }} disabled={isUpdatingCustomer} className={inputClass} /></Field>
            <Field label="Address / delivery destination"><input value={customerEdit.address} onChange={(event) => { setCustomerEdit((current) => ({ ...current, address: event.target.value })); setCustomerError(""); }} disabled={isUpdatingCustomer} className={inputClass} /></Field>
            <Field label="Mobile"><input inputMode="tel" value={customerEdit.mobile} onChange={(event) => { setCustomerEdit((current) => ({ ...current, mobile: event.target.value })); setCustomerError(""); }} disabled={isUpdatingCustomer} className={inputClass} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void submitCustomerEdit()} disabled={isUpdatingCustomer} className={primaryButton}>{isUpdatingCustomer ? "Saving..." : "Save customer"}</button>
            <button type="button" onClick={cancelCustomerEdit} disabled={isUpdatingCustomer} className={secondaryButton}>Cancel</button>
            {customerError && <p role="alert" className="text-sm font-medium text-red-700">{customerError}</p>}
          </div>
        </div>}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Field label="Challan No. (optional)"><input value={form.challanNumber} onChange={(event) => { setForm((current) => ({ ...current, challanNumber: event.target.value })); setError(""); }} maxLength={100} placeholder="145 or A-39" disabled={isSaving} className={inputClass} /></Field>
          <Field label="Challan date"><input type="date" value={form.challanDate} onChange={(event) => { setForm((current) => ({ ...current, challanDate: event.target.value })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
          <VehicleCombobox
            vehicles={vehicles}
            selectedVehicleId={form.vehicleId}
            onSelect={(vehicleId) => { setForm((current) => selectVehicleForChallan(current, vehicles, vehicleId)); setError(""); }}
            disabled={isSaving || vehiclesUnavailable}
          />
        </div>
        {vehiclesUnavailable && !vehiclesError && <p className="mt-2 text-sm text-slate-500">Loading Vehicles...</p>}
        {vehiclesError && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{salesOfficeErrorMessage(vehiclesError, "Could not load Vehicles.")}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => { setShowQuickVehicle((current) => !current); setVehicleError(""); }} disabled={isSaving} className={secondaryButton}>{showQuickVehicle ? "Close Vehicle form" : "Add Vehicle"}</button>
          {selectedVehicle && <p className="text-sm text-slate-600">Delivery Wage Tracking <span className="font-semibold text-slate-900">{selectedVehicle.deliveryWageTrackingEnabled ? "ON" : "OFF"}</span>{selectedVehicle.isActive ? "" : " · Vehicle archived"}</p>}
        </div>

        {showQuickVehicle && <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-4">
          <p className="text-sm font-bold text-cyan-950">Add Vehicle without leaving this Challan</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-end">
            <Field label="Vehicle number"><input autoFocus value={quickVehicleNumber} onChange={(event) => { setQuickVehicleNumber(event.target.value); setVehicleError(""); }} placeholder="WB 12 AB 1234" autoCapitalize="characters" disabled={isCreatingVehicle} className={inputClass} /></Field>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={quickVehicleTracksWage} onChange={(event) => setQuickVehicleTracksWage(event.target.checked)} disabled={isCreatingVehicle} />Delivery Wage Tracking ON</label>
            <button type="button" onClick={() => void submitQuickVehicle()} disabled={isCreatingVehicle} className={primaryButton}>{isCreatingVehicle ? "Adding..." : "Add and select"}</button>
          </div>
          {vehicleError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{vehicleError}</p>}
        </div>}

        {form.vehicleDeliveryWageTrackingEnabled && <div className="mt-4 max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Field label="Trip Labour Wage"><input type="text" inputMode="decimal" value={form.tripLabourWage} onChange={(event) => { setForm((current) => ({ ...current, tripLabourWage: event.target.value })); setError(""); }} placeholder="750" disabled={isSaving} className={inputClass} /></Field>
          <p className="mt-2 text-xs text-amber-900">Internal only — does not affect the customer Challan total.</p>
        </div>}

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-bold">Brick lines</h4>
              <p className="mt-1 text-xs text-slate-500">Edit Rate or Amount. The last one you edit controls the row.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const key = `new-line-${nextLineNumber.current}`;
                nextLineNumber.current += 1;
                setForm((current) => ({ ...current, lines: addChallanLine(current.lines, key) }));
                setError("");
              }}
              disabled={isSaving || form.lines.length >= 100 || !brickTypes.some((brickType) => brickType.isActive)}
              className={secondaryButton}
            >
              Add brick row
            </button>
          </div>

          {isLoadingBrickTypes && <p className="mt-3 text-sm text-slate-500">Loading brick types...</p>}
          {brickTypesError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">Could not load brick types: {brickTypesError}</p>}
          {!isLoadingBrickTypes && !brickTypesError && !brickTypes.some((brickType) => brickType.isActive) && <p className="mt-3 text-sm font-medium text-amber-700">No active brick type is available. Activate one in Brick Types first.</p>}
          {form.lines.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">No brick rows. Add a note or extra charge below to save a manual Challan.</p>}

          <div className="mt-4 space-y-3">
            {form.lines.map((line, index) => {
              const amount = calculateChallanBrickLineAmountPreview(line);
              const availableBrickTypes = brickTypes.filter((brickType) =>
                brickType.isActive || brickType.id === line.brickTypeId,
              );
              return <div key={line.key} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[minmax(10rem,1.5fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(8rem,0.7fr)_auto] md:items-end">
                <Field label={`Brick type ${index + 1}`}><select value={line.brickTypeId} onChange={(event) => updateLine(line.key, "brickTypeId", event.target.value)} disabled={isSaving || availableBrickTypes.length === 0} className={inputClass}><option value="">Select brick type</option>{availableBrickTypes.map((brickType) => <option key={brickType.id} value={brickType.id}>{brickType.name}{brickType.isActive ? "" : " · inactive"}</option>)}</select></Field>
                <Field label="Quantity"><input type="number" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(line.key, "quantity", event.target.value)} disabled={isSaving} className={inputClass} /></Field>
                <Field label={`Rate / 1,000${line.pricingMode !== "AMOUNT" ? " · controls row" : ""}`}><input type="text" inputMode="decimal" value={line.ratePer1000Bricks} onChange={(event) => updateLine(line.key, "ratePer1000Bricks", event.target.value)} disabled={isSaving} className={inputClass} /></Field>
                <Field label={`Amount${line.pricingMode === "AMOUNT" ? " · controls row" : ""}`}><input type="text" inputMode="decimal" value={line.pricingMode === "AMOUNT" ? line.lineAmount ?? "" : amount === null ? "" : String(amount)} onChange={(event) => updateLine(line.key, "lineAmount", event.target.value)} disabled={isSaving} className={inputClass} /></Field>
                <button type="button" onClick={() => { setForm((current) => ({ ...current, lines: removeChallanLine(current.lines, line.key) })); setError(""); }} disabled={isSaving} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Remove</button>
              </div>;
            })}
          </div>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="font-bold">Additional lines / notes</h4>
              <p className="mt-1 text-xs text-slate-500">Notes are non-financial. Extra charges are included in the Challan total.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => addFlexibleLine("NOTE")} disabled={isSaving || form.flexibleLines.length >= 100} className={secondaryButton}>Add note</button>
              <button type="button" onClick={() => addFlexibleLine("EXTRA_CHARGE")} disabled={isSaving || form.flexibleLines.length >= 100} className={secondaryButton}>Add extra charge</button>
            </div>
          </div>

          {form.flexibleLines.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">No additional lines. Add a note or customer-facing charge only when needed.</p>}

          <div className="mt-4 space-y-3">
            {form.flexibleLines.map((line, index) => {
              const label = line.lineType === "NOTE" ? "Note" : "Extra charge";
              const amountPreview = calculateFlexibleLineAmountPreview(line);
              return <div key={line.key} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{label} {index + 1}</p>
                    <p className="text-xs text-slate-500">Position {index + 1}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" aria-label={`Move ${label.toLowerCase()} up`} onClick={() => { setForm((current) => ({ ...current, flexibleLines: moveChallanFlexibleLine(current.flexibleLines, line.key, "up") })); setError(""); }} disabled={isSaving || index === 0} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Move up</button>
                    <button type="button" aria-label={`Move ${label.toLowerCase()} down`} onClick={() => { setForm((current) => ({ ...current, flexibleLines: moveChallanFlexibleLine(current.flexibleLines, line.key, "down") })); setError(""); }} disabled={isSaving || index === form.flexibleLines.length - 1} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Move down</button>
                    <button type="button" onClick={() => { setForm((current) => ({ ...current, flexibleLines: removeChallanFlexibleLine(current.flexibleLines, line.key) })); setError(""); }} disabled={isSaving} className="h-9 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Remove</button>
                  </div>
                </div>

                {line.lineType === "NOTE" && <div className="mt-3">
                  <Field label="Particulars / note text"><input value={line.particulars} maxLength={500} onChange={(event) => updateFlexibleParticulars(line.key, event.target.value)} placeholder="Delivery made at customer's site." disabled={isSaving} className={inputClass} /></Field>
                </div>}

                {line.lineType === "EXTRA_CHARGE" && <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field label="Particulars"><input value={line.particulars} maxLength={500} onChange={(event) => updateFlexibleParticulars(line.key, event.target.value)} placeholder="Loading / unloading" disabled={isSaving} className={inputClass} /></Field>
                  <Field label="Charge method"><select value={line.chargeMode} onChange={(event) => updateExtraChargeMode(line.key, event.target.value as ChallanExtraChargeMode)} disabled={isSaving} className={inputClass}><option value="DIRECT_AMOUNT">Direct amount</option><option value="QUANTITY_RATE">Quantity × rate</option></select></Field>
                  {line.chargeMode === "DIRECT_AMOUNT" && <Field label="Amount"><input type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => updateExtraChargeField(line.key, "amount", event.target.value)} placeholder="2000" disabled={isSaving} className={inputClass} /></Field>}
                  {line.chargeMode === "QUANTITY_RATE" && <>
                    <Field label="Quantity"><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateExtraChargeField(line.key, "quantity", event.target.value)} disabled={isSaving} className={inputClass} /></Field>
                    <Field label="Rate"><input type="number" min="0.01" step="0.01" value={line.rate} onChange={(event) => updateExtraChargeField(line.key, "rate", event.target.value)} disabled={isSaving} className={inputClass} /></Field>
                  </>}
                  <div><p className="text-xs font-medium text-slate-600">Charge preview</p><p className="mt-1 flex h-10 items-center font-bold tabular-nums">{amountPreview === null ? "—" : formatSalesMoney(amountPreview)}</p></div>
                </div>}
              </div>;
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 border-t border-slate-200 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Total preview</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatSalesMoney(totalPreview)}</p>
            <p className="mt-1 text-xs text-slate-500">Brick rows plus extra charges. Notes add ₹0. The database returns the authoritative saved total.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onCancel && <button type="button" onClick={onCancel} disabled={isSaving} className={secondaryButton}>Cancel</button>}
            <button disabled={isSaving || (form.lines.length > 0 && (isLoadingBrickTypes || Boolean(brickTypesError))) || (!challan && (!profileComplete || isLoadingFactoryProfile))} className={primaryButton}>{isSaving ? "Saving..." : challan ? "Save corrections" : "Create Challan"}</button>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
      </form>
    </section>
  );
}

function VehicleCombobox({
  vehicles,
  selectedVehicleId,
  disabled,
  onSelect,
}: Readonly<{
  vehicles: readonly Vehicle[];
  selectedVehicleId: string;
  disabled: boolean;
  onSelect: (vehicleId: string) => void;
}>) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const options = filterActiveVehiclesForChallan(vehicles, searchText);
  const highlightedVehicle = options[highlightedIndex];

  useEffect(() => {
    setSearchText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, [selectedVehicleId]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSearchText("");
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  function openList() {
    if (disabled) return;
    const activeVehicles = filterActiveVehiclesForChallan(vehicles, "");
    const selectedIndex = activeVehicles.findIndex((vehicle) => vehicle.id === selectedVehicleId);
    setSearchText("");
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : activeVehicles.length > 0 ? 0 : -1);
    setIsOpen(true);
  }

  function selectVehicle(vehicleId: string) {
    onSelect(vehicleId);
    setSearchText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
      setSearchText("");
      setIsOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setHighlightedIndex((current) => options.length === 0
        ? -1
        : Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setHighlightedIndex((current) => options.length === 0
        ? -1
        : current <= 0 ? options.length - 1 : current - 1);
      return;
    }
    if (event.key === "Enter" && isOpen && highlightedVehicle) {
      event.preventDefault();
      selectVehicle(highlightedVehicle.id);
    }
  }

  return <div ref={rootRef} className="relative" data-vehicle-combobox>
    <label htmlFor={inputId} className="block text-xs font-medium text-slate-600">Vehicle (optional)</label>
    <div className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={highlightedVehicle ? `${listboxId}-${highlightedVehicle.id}` : undefined}
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="Search or select vehicle..."
        value={isOpen ? searchText : selectedVehicle?.vehicleNumber ?? ""}
        onFocus={openList}
        onClick={() => {
          if (!isOpen) openList();
        }}
        onChange={(event) => {
          setSearchText(event.target.value);
          setHighlightedIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`${inputClass} pr-16`}
      />
      {selectedVehicleId && !disabled && <button
        type="button"
        aria-label="Clear Vehicle selection"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectVehicle("")}
        className="absolute right-8 top-1/2 mt-0.5 -translate-y-1/2 px-2 text-lg text-slate-500 hover:text-slate-950"
      >×</button>}
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500">▾</span>
    </div>

    {isOpen && <div
      id={listboxId}
      role="listbox"
      aria-label="Available Vehicles"
      className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-xl"
    >
      {options.length === 0
        ? <p className="px-3 py-3 text-slate-500">No active Vehicle matches.</p>
        : options.map((vehicle, index) => <button
            key={vehicle.id}
            id={`${listboxId}-${vehicle.id}`}
            type="button"
            role="option"
            aria-selected={vehicle.id === selectedVehicleId}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => selectVehicle(vehicle.id)}
            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${index === highlightedIndex ? "bg-cyan-50 text-cyan-950" : "text-slate-900 hover:bg-slate-50"}`}
          >
            <span className="font-semibold">{vehicle.vehicleNumber}</span>
            <span className="text-xs text-slate-500">Wage {vehicle.deliveryWageTrackingEnabled ? "ON" : "OFF"}</span>
          </button>)}
    </div>}
  </div>;
}

function ChallanDetail({
  challan,
  isConfirmingVoid,
  isVoiding,
  onEdit,
  onStartVoid,
  onCancelVoid,
  onConfirmVoid,
}: Readonly<{
  challan: Challan;
  isConfirmingVoid: boolean;
  isVoiding: boolean;
  onEdit: () => void;
  onStartVoid: () => void;
  onCancelVoid: () => void;
  onConfirmVoid: () => void;
}>) {
  const eligibility = getChallanEligibility(challan);
  const flexibleLines = getSavedChallanFlexibleLineViews(challan.flexibleLines);
  const vehicleDetails = getSavedChallanVehicleDetails(challan);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-2xl font-bold">{formatChallanLabel(challan.challanNumber)}</h3>
            <StatusBadge status={challan.status} isLocked={challan.isLocked} />
          </div>
          <p className="mt-2 text-sm text-slate-600">{formatChallanDate(challan.challanDate)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/office/challans/${challan.id}`} target="_blank" rel="noreferrer" className={`${primaryButton} inline-flex items-center`}>View Challan</Link>
          <button type="button" onClick={onEdit} disabled={!eligibility.canEdit} className={secondaryButton}>Edit Challan</button>
          <button type="button" onClick={onStartVoid} disabled={!eligibility.canVoid} className="h-10 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Void Challan</button>
        </div>
      </div>

      {challan.isLocked && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Locked: editing and voiding are unavailable.</p>}
      {challan.status === "void" && <p className="mt-4 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">This Challan is Void. Its historical data remains permanent.</p>}

      {isConfirmingVoid && eligibility.canVoid && <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-900">Void {formatChallanLabel(challan.challanNumber)}?</p>
        <p className="mt-1 text-sm text-red-800">The Challan stays in history.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onConfirmVoid} disabled={isVoiding} className="h-10 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{isVoiding ? "Voiding..." : "Confirm void"}</button>
          <button type="button" onClick={onCancelVoid} disabled={isVoiding} className={secondaryButton}>Cancel</button>
        </div>
      </div>}

      <section aria-label="Saved customer snapshot" className="mt-6 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
        <Detail label="Customer snapshot" value={challan.customerNameSnapshot} />
        <Detail label="Mobile snapshot" value={challan.customerMobileSnapshot || "Not recorded"} />
        <div className="sm:col-span-2"><Detail label="Delivery address snapshot" value={challan.customerAddressSnapshot || "Not recorded"} /></div>
      </section>

      <section aria-label="Saved company snapshot" className="mt-4 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
        <Detail label="Company snapshot" value={challan.companyNameSnapshot} />
        <Detail label="Company mobile snapshot" value={challan.companyMobileSnapshot} />
        <Detail label="Business description snapshot" value={challan.companyBusinessDescriptionSnapshot} />
        <Detail label="Company address snapshot" value={challan.companyAddressSnapshot} />
      </section>

      <section aria-label="Saved Vehicle information" className="mt-4 grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
        <Detail label="Vehicle Number" value={vehicleDetails.vehicleNumber ?? "No vehicle"} />
        {vehicleDetails.tripLabourWage !== null && <div>
          <Detail label="Trip Labour Wage" value={formatSalesMoney(vehicleDetails.tripLabourWage)} />
          <p className="mt-1 text-xs text-slate-500">Internal only · not customer-facing</p>
        </div>}
      </section>

      <section aria-labelledby="saved-challan-items-heading" className="mt-6 overflow-hidden rounded-lg border border-slate-200">
        <h4 id="saved-challan-items-heading" className="border-b border-slate-200 bg-slate-50 px-4 py-3 font-bold">Saved brick lines</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Particulars snapshot</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3 text-right">Rate / 1,000</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {challan.items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.brickParticularsSnapshot}</td><td className="px-4 py-3 text-right tabular-nums">{item.quantity.toLocaleString("en-IN")}</td><td className="px-4 py-3 text-right tabular-nums">{formatSalesMoney(item.ratePer1000Bricks)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatSalesMoney(item.lineAmount)}</td></tr>)}
              {challan.items.length === 0 && <tr><td colSpan={4} className="px-4 py-5 text-center text-slate-500">No brick lines</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="saved-challan-flexible-lines-heading" className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <h4 id="saved-challan-flexible-lines-heading" className="border-b border-slate-200 bg-slate-50 px-4 py-3 font-bold">Additional lines / notes</h4>
        {flexibleLines.length === 0 && <p className="px-4 py-5 text-center text-sm text-slate-500">No additional lines or notes</p>}
        {flexibleLines.length > 0 && <ul className="divide-y divide-slate-100">
          {flexibleLines.map((line) => <li key={line.key} className="px-4 py-4">
            {line.kind === "note" && <div>
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">{line.typeLabel}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{line.particulars}</p>
            </div>}
            {line.kind === "extra_charge" && <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">{line.typeLabel}</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{line.particulars}</p>
                {line.quantity !== null && line.rate !== null && <p className="mt-1 text-xs text-slate-500">{line.quantity.toLocaleString("en-IN")} × {formatSalesMoney(line.rate)}</p>}
              </div>
              <p className="text-right text-base font-bold tabular-nums text-slate-950">{formatSalesMoney(line.amount)}</p>
            </div>}
          </li>)}
        </ul>}
      </section>

      <div className="mt-5 rounded-lg bg-slate-950 p-4 text-white">
        <div className="sm:text-right"><p className="text-xs uppercase tracking-wide text-slate-300">Authoritative Challan total</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatSalesMoney(challan.challanTotal)}</p></div>
      </div>
    </article>
  );
}

function StatusBadge({ status, isLocked }: Readonly<{ status: ChallanHeader["status"]; isLocked: boolean }>) {
  return <span className="flex flex-wrap justify-end gap-1">
    {status === "void"
      ? <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700">Void</span>
      : <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">Active</span>}
    {isLocked && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Locked</span>}
  </span>;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return <label className="block text-xs font-medium text-slate-600">{label}{children}</label>;
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>;
}

function LoadingCard({ label }: Readonly<{ label: string }>) {
  return <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">{label}</div>;
}

function ErrorCard({ message }: Readonly<{ message: string }>) {
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center text-sm font-semibold text-red-700">{message}</div>;
}

function EmptyWorkspace({ onCreate }: Readonly<{ onCreate: () => void }>) {
  return <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm"><p className="text-sm text-slate-500">Select a Challan from history or create a new one.</p><button type="button" onClick={onCreate} className={`${primaryButton} mt-4`}>Create Challan</button></div>;
}
