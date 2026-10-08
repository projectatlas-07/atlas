"use client";

import Link from "next/link";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCustomerPaymentReadCurrent } from "@/features/office/customer-payment-office-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Feedback } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form-controls";
import { FormField } from "@/components/ui/form-field";
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
import { SalesRegisterSection } from "@/features/office/components/sales-register-section";
import { CustomerPaymentsSection } from "@/features/office/components/customer-payments-section";
import { BrickTypeManagementDrawer } from "@/features/office/components/brick-type-management-drawer";
import {
  SalesOfficeWorkspace,
  type SalesWorkspaceArea,
} from "@/features/office/components/sales-office-workspace";
import { useOfficePageScrollReset } from "@/features/office/components/office-shell";
import { AllChallansExpandedView } from "@/features/office/components/all-challans-expanded-view";
import { AllCustomerPaymentsExpandedView } from "@/features/office/components/all-customer-payments-expanded-view";
import { VehicleDeliveryWageOverview } from "@/features/office/components/vehicle-delivery-wage-overview";
import type { OfficeAreaId } from "@/features/office/office-navigation";
import { applyPaymentLocks } from "@/features/office/customer-payment-office-model";
import {
  addChallanFlexibleLine,
  addChallanLine,
  buildFactoryProfileInput,
  buildChallanReceivedPayment,
  buildCustomerUpdateInput,
  buildCreateChallanInput,
  buildQuickCustomerInput,
  buildUpdateChallanInput,
  calculateChallanBrickLineAmountPreview,
  calculateChallanTotalPreview,
  calculateFlexibleLineAmountPreview,
  challanFormFromSaved,
  clearBrickTypeFromUnsavedChallanDraft,
  customerFormFromSaved,
  emptyChallanLine,
  emptyChallanReceivedPaymentForm,
  factoryProfileErrorMessage,
  factoryProfileFormFromSaved,
  filterActiveVehiclesForChallan,
  filterChallansByNumber,
  formatSalesMoney,
  getChallanEligibility,
  getChallanFormError,
  getChallanReceivedPaymentError,
  getCompactChallanHistory,
  getSavedChallanFlexibleLineViews,
  getSavedChallanPaymentHistoryEntries,
  getSavedChallanVehicleDetails,
  isChallanHistoryRowSelected,
  isFactoryPrintableProfileComplete,
  moveChallanFlexibleLine,
  removeChallanFlexibleLine,
  removeChallanLine,
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
  createChallanWithReceivedPayment,
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
  getChallanPaymentState,
  listCustomerPayments,
} from "@/features/sales/services/customer-payment-service";
import type { BrickType } from "@/features/sales/services/brick-type-service";
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
  CustomerPaymentResult,
  FactoryPrintableProfile,
  Vehicle,
} from "@/features/sales/types";
import {
  formatChallanLabel,
  formatCustomerPaymentMethods,
  formatCustomerPaymentMode,
  NEW_CUSTOMER_PAYMENT_MODES,
} from "@/features/sales/types";
import { getLocalDate } from "@/lib/local-date";
import {
  formatDateOnly,
  formatIndianCurrency,
  formatIndianNumber,
} from "@/lib/formatting";
import {
  CHALLAN_FINANCIAL_LOCK_STATUS,
  CHALLAN_PAYMENT_STATUS,
  CHALLAN_STATUS,
  resolveBooleanStatusPresentation,
  resolveStatusPresentation,
} from "@/lib/statuses";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type WorkspaceMode = "create" | "detail" | "edit";
type ChallansWorkspaceView = "main" | "all";
type CustomerPaymentsWorkspaceView = "main" | "all";

const customersKey = (factoryId: string) => ["office-sales-customers", factoryId] as const;
const factoryProfileKey = (factoryId: string) => ["office-sales-factory-profile", factoryId] as const;
const challansKey = (factoryId: string) => ["office-sales-challans", factoryId] as const;
const challanKey = (factoryId: string, challanId: string) =>
  ["office-sales-challan", factoryId, challanId] as const;
const challanPaymentStateKey = (factoryId: string, challanId: string) =>
  ["office-challan-payment-state", factoryId, challanId] as const;
const customerPaymentHistoryKey = (factoryId: string, customerId: string) =>
  ["office-customer-payment-history", factoryId, customerId] as const;
const vehiclesKey = (factoryId: string) => ["office-sales-vehicles", factoryId] as const;
const MONEY_WITH_PAISE = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;
const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100";
const primaryButton = "h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function ChallanField({
  label,
  children,
  v2,
}: Readonly<{ label: string; children: React.ReactNode; v2: boolean }>) {
  if (!v2) return <Field label={label}>{children}</Field>;
  return <FormField label={label}>{children}</FormField>;
}

type ChallanInputProps = React.ComponentPropsWithoutRef<typeof Input> & { v2: boolean };

const ChallanInput = forwardRef<HTMLInputElement, ChallanInputProps>(function ChallanInput(
  { v2, ...props },
  ref,
) {
  return v2 ? <Input ref={ref} {...props} /> : <input ref={ref} {...props} className={inputClass} />;
});

type ChallanSelectProps = React.ComponentPropsWithoutRef<typeof Select> & { v2: boolean };

const ChallanSelect = forwardRef<HTMLSelectElement, ChallanSelectProps>(function ChallanSelect(
  { v2, children, ...props },
  ref,
) {
  return v2
    ? <Select ref={ref} {...props}>{children}</Select>
    : <select ref={ref} {...props} className={inputClass}>{children}</select>;
});

type ChallanButtonProps = React.ComponentPropsWithoutRef<typeof Button> & {
  legacyClassName: string;
  v2: boolean;
};

const ChallanButton = forwardRef<HTMLButtonElement, ChallanButtonProps>(function ChallanButton(
  { legacyClassName, v2, variant = "secondary", children, disabled, loading = false, loadingLabel, ...props },
  ref,
) {
  return v2
    ? <Button ref={ref} variant={variant} disabled={disabled} loading={loading} loadingLabel={loadingLabel} {...props}>{children}</Button>
    // ui-exception: adapter preserves the unchanged legacy edit-Challan button markup
    : <button ref={ref} {...props} disabled={disabled || loading} className={legacyClassName}>{loading && loadingLabel ? loadingLabel : children}</button>;
});

function ChallanCard({
  children,
  legacyClassName,
  surface = "default",
  v2,
  ...props
}: Readonly<React.HTMLAttributes<HTMLDivElement> & {
  legacyClassName: string;
  surface?: "default" | "muted";
  v2: boolean;
}>) {
  return v2
    ? <Card surface={surface} {...props}>{children}</Card>
    : <div className={legacyClassName} {...props}>{children}</div>;
}

export function SalesOfficeSection({
  activeArea,
  navigationTarget,
  factoryId,
  brickTypes,
  isLoadingBrickTypes,
  brickTypesError,
  onBrickTypesChanged,
  showVehicleWages,
}: Readonly<{
  activeArea: OfficeAreaId;
  navigationTarget: "new-challan" | null;
  factoryId: string;
  brickTypes: readonly BrickType[];
  isLoadingBrickTypes: boolean;
  brickTypesError: string;
  onBrickTypesChanged: () => Promise<void>;
  showVehicleWages: boolean;
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
  const [challanNumberSearch, setChallanNumberSearch] = useState("");
  const [salesArea, setSalesArea] = useState<SalesWorkspaceArea>("challans");
  const [challansView, setChallansView] = useState<ChallansWorkspaceView>("main");
  const [customerPaymentsView, setCustomerPaymentsView] =
    useState<CustomerPaymentsWorkspaceView>("main");
  const resetOfficePageScroll = useOfficePageScrollReset();

  function showChallansView(view: ChallansWorkspaceView) {
    if (view === challansView) return;
    setChallansView(view);
    resetOfficePageScroll();
  }

  function showCustomerPaymentsView(view: CustomerPaymentsWorkspaceView) {
    if (view === customerPaymentsView) return;
    setCustomerPaymentsView(view);
    resetOfficePageScroll();
  }

  useEffect(() => {
    if (activeArea !== "sales" || navigationTarget !== "new-challan") return;
    setSalesArea("challans");
    setChallansView("main");
    setMode("create");
    setSelectedChallanId("");
    setIsConfirmingVoid(false);
    setActionError("");
    setSuccess("");
  }, [activeArea, navigationTarget]);

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
    void queryClient.invalidateQueries({
      queryKey: challanPaymentStateKey(factoryId, saved.id),
    });
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

  function cacheSavedPayment(payment: CustomerPaymentResult) {
    // Unavailable children must never be treated as empty saved allocations.
    // The payment handler invalidates all submitted targets independently.
    if (payment.detailsStatus !== "ready") return;
    queryClient.setQueryData<ChallanHeader[]>(
      challansKey(factoryId),
      (current = []) => applyPaymentLocks(current, payment),
    );
    for (const allocation of payment.allocations) {
      queryClient.setQueryData<Challan>(
        challanKey(factoryId, allocation.challanId),
        (current) => current ? { ...current, isLocked: true } : current,
      );
    }
  }

  function cacheSavedFactoryProfile(profile: FactoryPrintableProfile) {
    queryClient.setQueryData<FactoryPrintableProfile>(factoryProfileKey(factoryId), profile);
    void queryClient.invalidateQueries({ queryKey: factoryProfileKey(factoryId) });
    setActionError("");
    setSuccess("Factory / Challan Profile saved. Challan creation is now available.");
  }

  function handleSaved(
    saved: Challan,
    action: "created" | "updated",
    receivedNowAmount = 0,
  ) {
    cacheSavedChallan(saved);
    if (receivedNowAmount > 0) {
      void queryClient.invalidateQueries({
        queryKey: ["office-customer-payment-summary", factoryId, saved.customerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["office-customer-payment-candidates", factoryId, saved.customerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["office-customer-payment-history", factoryId, saved.customerId],
      });
      void queryClient.invalidateQueries({ queryKey: ["office-factory-customer-payments", factoryId] });
      void queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] });
    }
    setSelectedChallanId(saved.id);
    setMode("detail");
    setActionError("");
    setSuccess(
      action === "created"
        ? `${formatChallanLabel(saved.challanNumber)} created. Authoritative total: ${formatSalesMoney(saved.challanTotal)}.${receivedNowAmount > 0 ? ` Received now: ${formatSalesMoney(receivedNowAmount)}.` : ""}`
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
  const visibleChallans = filterChallansByNumber(challans, challanNumberSearch);
  const compactChallans = getCompactChallanHistory(visibleChallans);
  const selectedChallan = selectedChallanQuery.data;
  const selectedChallanEligibility = selectedChallan
    ? getChallanEligibility(selectedChallan)
    : null;
  const factoryProfile = factoryProfileQuery.data;
  const vehicles = vehiclesQuery.data ?? [];
  const profileComplete = isFactoryPrintableProfileComplete(factoryProfile);

  return (
    <>
      {(activeArea === "sales" || activeArea === "settings") && <>
        {success && <div className="mb-atlas-4"><Feedback tone="success" role="status">{success}</Feedback></div>}
        {actionError && <div className="mb-atlas-4"><Feedback tone="danger" role="alert">{actionError}</Feedback></div>}
      </>}
      <section id="sales" aria-label="Sales workspace" hidden={activeArea !== "sales"}>
      <SalesOfficeWorkspace activeArea={salesArea} onAreaChange={setSalesArea}>
      <div hidden={salesArea !== "challans"}>
      <div hidden={challansView !== "main"}>
      {factoryProfileQuery.isLoading && (
        <div className="mb-atlas-4">
          <Feedback tone="neutral" role="status">Loading Factory / Challan Profile...</Feedback>
        </div>
      )}
      {factoryProfileQuery.error && (
        <div className="mb-atlas-4">
          <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{salesOfficeErrorMessage(factoryProfileQuery.error, "Could not load the Factory / Challan Profile.")}</span>
              <Button variant="secondary" onClick={() => { void factoryProfileQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
            </div>
          </Feedback>
        </div>
      )}

      <div className="grid gap-atlas-6 xl:grid-cols-3 xl:items-start">
        <div className="xl:col-span-2">
          <div className="mb-atlas-3 flex flex-wrap items-center justify-end gap-atlas-2" aria-label="Challan actions">
            {mode === "detail" && selectedChallan && selectedChallanEligibility && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => { setMode("edit"); setSuccess(""); setActionError(""); }}
                  disabled={!selectedChallanEligibility.canEdit}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  onClick={() => { setIsConfirmingVoid(true); setSuccess(""); setActionError(""); }}
                  disabled={!selectedChallanEligibility.canVoid}
                >
                  Void
                </Button>
              </>
            )}
            <Button variant="primary" onClick={openCreate} aria-label="Create Challan" title="Create Challan">
              <span aria-hidden="true" className="text-atlas-xl leading-none">+</span>
            </Button>
          </div>
          <Card as="section" aria-label="Challan work area">
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
            onBrickTypesChanged={onBrickTypesChanged}
            profileComplete={profileComplete}
            isLoadingFactoryProfile={factoryProfileQuery.isLoading}
            onCustomerSaved={cacheSavedCustomer}
            onVehicleSaved={cacheSavedVehicle}
            onSaved={(saved, receivedNowAmount) => handleSaved(saved, "created", receivedNowAmount)}
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
            onBrickTypesChanged={onBrickTypesChanged}
            profileComplete={profileComplete}
            isLoadingFactoryProfile={factoryProfileQuery.isLoading}
            challan={selectedChallan}
            onCustomerSaved={cacheSavedCustomer}
            onVehicleSaved={cacheSavedVehicle}
            onCancel={() => setMode("detail")}
            onSaved={(saved) => handleSaved(saved, "updated")}
          />}

          {mode === "detail" && !selectedChallanId && <EmptyWorkspace onCreate={openCreate} />}
          {mode === "detail" && selectedChallanId && selectedChallanQuery.isLoading && <Feedback tone="neutral" role="status">Loading Challan details...</Feedback>}
          {mode === "detail" && selectedChallanId && selectedChallanQuery.error && <Feedback tone="danger" role="alert">
            <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{salesOfficeErrorMessage(selectedChallanQuery.error, "Could not load Challan details.")}</span>
              <Button variant="secondary" onClick={() => { void selectedChallanQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
            </div>
          </Feedback>}
          {mode === "detail" && selectedChallan && <ChallanDetail
            challan={selectedChallan}
            isConfirmingVoid={isConfirmingVoid}
            isVoiding={isVoiding}
            onCancelVoid={() => setIsConfirmingVoid(false)}
            onConfirmVoid={() => void confirmVoid(selectedChallan)}
          />}
          </Card>
        </div>

        <div className="xl:sticky xl:top-atlas-8">
          <Card as="section" aria-labelledby="challan-history-heading">
            <div className="flex items-start justify-between gap-atlas-3">
              <div>
                <h3 id="challan-history-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Challan history</h3>
                <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Operational history, newest first.</p>
              </div>
              <Button variant="ghost" onClick={() => showChallansView("all")}>View all Challans</Button>
            </div>
            <div className="mt-atlas-4">
              <FormField label="Search Challan No.">
                <Input
                  type="search"
                  value={challanNumberSearch}
                  onChange={(event) => setChallanNumberSearch(event.target.value)}
                  placeholder="Search Challan No."
                />
              </FormField>
            </div>

            <div className="mt-atlas-4 border-t border-atlas-border pt-atlas-2">
              {challansQuery.isLoading && <Feedback tone="neutral" role="status">Loading Challans...</Feedback>}
              {challansQuery.error && (
                <Feedback tone="danger" role="alert">
                  <div className="flex flex-col gap-atlas-3">
                    <span>{salesOfficeErrorMessage(challansQuery.error, "Could not load Challans.")}</span>
                    <div><Button variant="secondary" onClick={() => { void challansQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button></div>
                  </div>
                </Feedback>
              )}
              {!challansQuery.isLoading && !challansQuery.error && challans.length === 0 && (
                <EmptyState title="No Challans yet" description="Create the first Challan to start the operational history." />
              )}
              {!challansQuery.isLoading && !challansQuery.error && challans.length > 0 && visibleChallans.length === 0 && (
                <EmptyState title="No matching Challans" description="Try another Challan number." />
              )}
              {!challansQuery.isLoading && !challansQuery.error && visibleChallans.length > 0 && (
                <ul className="max-h-screen divide-y divide-atlas-border overflow-y-auto">
                  {compactChallans.map((challan) => {
                    const isSelected = isChallanHistoryRowSelected(
                      selectedChallanId,
                      challan.id,
                    );

                    return (
                      <li
                        key={challan.id}
                        className={isSelected
                          ? "bg-atlas-primary-surface"
                          : "bg-atlas-surface hover:bg-atlas-surface-hover"}
                      >
                        {/* ui-exception: This composite history row needs a full-width multi-line button layout that the shared Button does not support. */}
                        <button className={`block min-h-atlas-12 w-full border-l-4 p-atlas-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-inset ${isSelected ? "border-l-atlas-primary" : "border-l-transparent"}`}
                          type="button"
                          onClick={() => openChallan(challan.id)}
                          aria-pressed={isSelected}
                        >
                          <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-atlas-semibold text-atlas-text">{formatChallanLabel(challan.challanNumber)}</p>
                              <p className="mt-atlas-1 truncate text-atlas-sm text-atlas-text-muted">{challan.customerNameSnapshot}</p>
                              {challan.customerAddressSnapshot && (
                                <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-subtle">{challan.customerAddressSnapshot}</p>
                              )}
                            </div>
                            <StatusBadge status={challan.status} isLocked={challan.isLocked} />
                          </div>
                          <div className="mt-atlas-3 grid grid-cols-2 gap-x-atlas-3 gap-y-atlas-1 text-atlas-xs text-atlas-text-muted">
                            <span>{formatDateOnly(challan.challanDate)}</span>
                            <span className="text-right font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(challan.challanTotal)}</span>
                            <span className="truncate">{challan.vehicleNumberSnapshot || challan.vehicleNumber
                              ? `Vehicle ${challan.vehicleNumberSnapshot || challan.vehicleNumber}`
                              : "No vehicle"}</span>
                            <span className="text-right font-atlas-semibold text-atlas-primary">Open</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      </div>
      <div hidden={challansView !== "all"}>
        <AllChallansExpandedView
          challans={challans}
          isLoading={challansQuery.isLoading}
          errorMessage={challansQuery.error
            ? salesOfficeErrorMessage(challansQuery.error, "Could not load Challans.")
            : ""}
          selectedChallanId={selectedChallanId}
          onBack={() => showChallansView("main")}
          onOpen={(challanId) => {
            openChallan(challanId);
            setChallansView("main");
            resetOfficePageScroll();
          }}
          onRetry={() => { void challansQuery.refetch(); }}
        />
      </div>
      </div>
      <div hidden={salesArea !== "customer-payments"}>
      <div hidden={customerPaymentsView !== "main"}>
      <CustomerPaymentsSection
        factoryId={factoryId}
        customers={customers}
        onPaymentSaved={cacheSavedPayment}
        onViewAll={() => showCustomerPaymentsView("all")}
      />
      </div>
      <div hidden={customerPaymentsView !== "all"}>
        <AllCustomerPaymentsExpandedView
          factoryId={factoryId}
          isActive={salesArea === "customer-payments" && customerPaymentsView === "all"}
          onBack={() => showCustomerPaymentsView("main")}
        />
      </div>
      </div>
      <div hidden={salesArea !== "sales-register"}>
      <SalesRegisterSection factoryId={factoryId} />
      </div>
      </SalesOfficeWorkspace>
      </section>

      <section aria-label="Vehicle Delivery Wages" hidden={!showVehicleWages}>
        <VehicleDeliveryWageOverview
          factoryId={factoryId}
          vehicles={vehicles}
          onVehicleSaved={cacheSavedVehicle}
        />
      </section>

      <section id="settings" aria-label="Sales configuration" hidden={activeArea !== "settings"}>
        {factoryProfileQuery.isLoading && <LoadingCard label="Loading Factory / Challan Profile..." />}
        {factoryProfileQuery.error && <ErrorCard message={salesOfficeErrorMessage(factoryProfileQuery.error, "Could not load the Factory / Challan Profile.")} />}
        {factoryProfile && <FactoryProfileEditor
          key={factoryProfile.updatedAt}
          factoryId={factoryId}
          profile={factoryProfile}
          onSaved={cacheSavedFactoryProfile}
        />}
        <VehicleManagementSection
          factoryId={factoryId}
          vehicles={vehicles}
          isLoading={vehiclesQuery.isLoading}
          error={vehiclesQuery.error}
          onSaved={cacheSavedVehicle}
        />
      </section>
    </>
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
      setError("Complete all required Factory / Challan Profile fields.");
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
      <div className="flex flex-wrap items-start justify-between gap-atlas-3">
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
        {profile.gstin && <Detail label="GSTIN" value={profile.gstin} />}
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
          <Field label="GSTIN (optional)"><input autoCapitalize="characters" value={form.gstin} onChange={(event) => { setForm((current) => ({ ...current, gstin: event.target.value.toUpperCase() })); setError(""); }} disabled={isSaving} className={inputClass} /></Field>
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
  onBrickTypesChanged,
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
  brickTypes: readonly BrickType[];
  isLoadingBrickTypes: boolean;
  brickTypesError: string;
  onBrickTypesChanged: () => Promise<void>;
  profileComplete: boolean;
  isLoadingFactoryProfile: boolean;
  challan?: Challan;
  onCustomerSaved: (customer: Customer) => void;
  onVehicleSaved: (vehicle: Vehicle) => void;
  onSaved: (challan: Challan, receivedNowAmount?: number) => void;
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
  const [receivedPaymentForm, setReceivedPaymentForm] = useState(() =>
    emptyChallanReceivedPaymentForm(form.challanDate));
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
  const [isManagingBrickTypes, setIsManagingBrickTypes] = useState(false);
  const challanNumberInputRef = useRef<HTMLInputElement>(null);
  const challanDateInputRef = useRef<HTMLInputElement>(null);
  const vehicleInputRef = useRef<HTMLInputElement>(null);
  const tripLabourWageInputRef = useRef<HTMLInputElement>(null);
  const brickTypeInputRefs = useRef(new Map<string, HTMLInputElement>());
  const quantityInputRefs = useRef(new Map<string, HTMLInputElement>());
  const rateInputRefs = useRef(new Map<string, HTMLInputElement>());
  const amountInputRefs = useRef(new Map<string, HTMLInputElement>());
  const payLaterInputRef = useRef<HTMLInputElement>(null);
  const receivedNowInputRef = useRef<HTMLInputElement>(null);
  const receivedAmountInputRef = useRef<HTMLInputElement>(null);
  const paymentDateInputRef = useRef<HTMLInputElement>(null);
  const paymentModeInputRef = useRef<HTMLSelectElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

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
  const correctionEligibility = challan ? getChallanEligibility(challan) : null;
  const challanStatus = challan
    ? resolveStatusPresentation(CHALLAN_STATUS, challan.status)
    : null;

  function focusSoon(element: HTMLElement | null | (() => HTMLElement | null)) {
    requestAnimationFrame(() => {
      const target = typeof element === "function" ? element() : element;
      target?.focus();
    });
  }

  function advanceNewChallanOnEnter(
    event: React.KeyboardEvent<HTMLInputElement>,
    nextElement: () => HTMLElement | null,
  ) {
    if (challan || event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    focusSoon(nextElement);
  }

  function focusFirstBrickLine() {
    const firstLine = form.lines[0];
    focusSoon(() => firstLine
      ? brickTypeInputRefs.current.get(firstLine.key) ?? null
      : receivedPaymentForm.choice === "received_now"
        ? receivedNowInputRef.current
        : payLaterInputRef.current);
  }

  function focusAfterVehicle(vehicleId: string, tracksDeliveryWage?: boolean) {
    if (challan) return;
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    if (tracksDeliveryWage ?? vehicle?.deliveryWageTrackingEnabled) {
      focusSoon(() => tripLabourWageInputRef.current);
      return;
    }
    focusFirstBrickLine();
  }

  function focusAfterBrickLine(index: number) {
    const nextLine = form.lines[index + 1];
    focusSoon(nextLine
      ? brickTypeInputRefs.current.get(nextLine.key) ?? null
      : receivedPaymentForm.choice === "received_now"
        ? receivedNowInputRef.current
        : payLaterInputRef.current);
  }

  function preventImplicitCreateSubmit(event: React.KeyboardEvent<HTMLFormElement>) {
    if (challan || event.key !== "Enter" || event.defaultPrevented
      || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (["BUTTON", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    event.preventDefault();
  }

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

  function handleBrickTypeUnavailable(brickTypeId: string) {
    if (challan) return;
    setForm((current) => clearBrickTypeFromUnsavedChallanDraft(current, brickTypeId));
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
      focusSoon(challanNumberInputRef.current);
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
      focusAfterVehicle(vehicle.id, vehicle.deliveryWageTrackingEnabled);
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
    const receivedPaymentError = challan
      ? null
      : getChallanReceivedPaymentError(receivedPaymentForm, totalPreview);
    if (receivedPaymentError) {
      setError(receivedPaymentError);
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
        const receivedPayment = buildChallanReceivedPayment(
          receivedPaymentForm,
          totalPreview,
        );
        saved = receivedPayment
          ? await createChallanWithReceivedPayment({ ...input, receivedPayment })
          : await createChallan(input);
      }
      onSaved(
        saved,
        challan ? undefined : buildChallanReceivedPayment(
          receivedPaymentForm,
          totalPreview,
        )?.amount,
      );
    } catch (caught) {
      setError(salesOfficeErrorMessage(caught, `Could not ${challan ? "update" : "create"} the Challan.`));
    } finally {
      setIsSaving(false);
    }
  }

  if (challan && correctionEligibility && !correctionEligibility.canEdit) {
    const unavailableMessage = correctionEligibility.reason === "locked"
      ? "This Challan is financially locked because a payment has been allocated. Corrections are unavailable."
      : "This Challan is Void. Void Challans are retained as immutable history and cannot be corrected.";

    return (
      <section aria-labelledby="challan-editor-heading" className="mx-auto max-w-6xl text-atlas-text">
        <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
          Challan correction
        </p>
        <div className="mt-atlas-1 flex flex-wrap items-center gap-atlas-2">
          <h3 id="challan-editor-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">
            {formatChallanLabel(challan.challanNumber)}
          </h3>
          {challanStatus && <StatusPill label={challanStatus.label} tone={challanStatus.tone} />}
        </div>
        <div className="mt-atlas-4">
          <Feedback role="alert" tone={correctionEligibility.reason === "void" ? "danger" : "warning"}>
            {unavailableMessage}
          </Feedback>
        </div>
        {onCancel && <div className="mt-atlas-4"><Button variant="secondary" type="button" onClick={onCancel}>{ATLAS_UI_STRINGS.actions.close}</Button></div>}
      </section>
    );
  }

  return (
    <section aria-labelledby="challan-editor-heading" className="mx-auto max-w-6xl text-atlas-text">
      <div className="flex flex-wrap items-start justify-between gap-atlas-3">
        <div>
          {challan && <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Challan correction</p>}
          <div className={challan ? "mt-atlas-1 flex flex-wrap items-center gap-atlas-2" : undefined}>
            <h3 id="challan-editor-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">{challan ? formatChallanLabel(challan.challanNumber) : "Create Challan"}</h3>
            {challanStatus && <StatusPill label={challanStatus.label} tone={challanStatus.tone} />}
          </div>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
            {challan ? "Correct editable fields, verify the authoritative total, then save." : "Enter the sale in order, verify the total, then save."}
          </p>
        </div>
      </div>

      {challan && <div className="mt-atlas-4"><Card surface="muted" as="section" aria-labelledby="challan-correction-snapshots-heading">
        <h4 id="challan-correction-snapshots-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Saved snapshot context</h4>
        <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
          Reference values from the saved Challan. Saving a correction refreshes the customer and Vehicle snapshots through the existing correction flow; the company snapshot remains unchanged.
        </p>
        <dl className="mt-atlas-4 grid gap-atlas-4 sm:grid-cols-2 lg:grid-cols-4">
          <SnapshotValue label="Saved customer" value={challan.customerNameSnapshot} />
          <SnapshotValue label="Saved Vehicle" value={challan.vehicleNumberSnapshot ?? "No Vehicle recorded"} />
          <SnapshotValue label="Saved company" value={challan.companyNameSnapshot} />
          {challan.companyGstinSnapshot && <SnapshotValue label="Saved GSTIN" value={challan.companyGstinSnapshot} />}
        </dl>
      </Card></div>}

      <form
        className="mt-atlas-6 space-y-atlas-6"
        onKeyDown={preventImplicitCreateSubmit}
        onSubmit={(event) => void submitChallan(event)}
      >
        {!challan && !isLoadingFactoryProfile && !profileComplete && <Feedback role="alert" tone="warning">Complete the Factory / Challan Profile before creating a Challan.</Feedback>}
        <div className="grid gap-atlas-3 sm:grid-cols-3 sm:items-end">
          <div className="sm:col-span-2">
          <ChallanField label="Customer" v2>
            <ChallanSelect
              v2
              autoFocus={!challan}
              data-challan-focus="customer"
              value={form.customerId}
              onChange={(event) => {
                const customerId = event.target.value;
                setForm((current) => ({ ...current, customerId }));
                setEditingCustomerId("");
                setCustomerError("");
                setError("");
                if (!challan && customerId) focusSoon(challanNumberInputRef.current);
              }}
              onKeyUp={(event) => {
                if (!challan && event.key === "Enter" && form.customerId) {
                  focusSoon(challanNumberInputRef.current);
                }
              }}
              disabled={customersUnavailable || isSaving || isUpdatingCustomer || customers.length === 0}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </ChallanSelect>
          </ChallanField>
          </div>
          <ChallanButton v2 variant="secondary" legacyClassName={secondaryButton} type="button" onClick={() => { setShowQuickCustomer((current) => !current); setEditingCustomerId(""); setCustomerError(""); }} disabled={isSaving || isUpdatingCustomer}>
            {showQuickCustomer ? "Close customer form" : "Quick add customer"}
          </ChallanButton>
        </div>

        {selectedCustomer && <ChallanCard v2 surface="muted" legacyClassName="mt-3 grid gap-1 rounded-lg border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-atlas-1 text-atlas-sm sm:grid-cols-2">
          <p className="font-atlas-semibold text-atlas-text">{selectedCustomer.name}</p>
          <div className="flex flex-wrap items-center gap-atlas-3 sm:justify-end">
            <p className="text-atlas-text-muted">{selectedCustomer.mobile || "No mobile"}</p>
            {!challan && <Button type="button" variant="ghost" onClick={startCustomerEdit} disabled={isSaving || isUpdatingCustomer}>{ATLAS_UI_STRINGS.actions.edit}</Button>}
          </div>
          <p className="text-atlas-text-muted sm:col-span-2">Delivery destination: {selectedCustomer.address || "No address recorded"}</p>
          </div>
        </ChallanCard>}
        {customersUnavailable && !customersError && <Feedback tone="neutral">Loading customers...</Feedback>}
        {customersError && <Feedback role="alert" tone="danger">{salesOfficeErrorMessage(customersError, "Could not load customers.")}</Feedback>}
        {!customersUnavailable && customers.length === 0 && !showQuickCustomer && <Feedback tone="neutral">No customers yet. Quick add the first customer.</Feedback>}

        {showQuickCustomer && <ChallanCard v2 surface="muted" legacyClassName="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-4" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitQuickCustomer(); } }}>
          <p className="text-atlas-base font-atlas-semibold text-atlas-text">New customer</p>
          <div className="mt-atlas-3 grid gap-atlas-3 md:grid-cols-3">
            <ChallanField v2 label="Customer name"><ChallanInput v2 autoFocus value={quickCustomer.name} onChange={(event) => { setQuickCustomer((current) => ({ ...current, name: event.target.value })); setCustomerError(""); }} disabled={isCreatingCustomer} /></ChallanField>
            <ChallanField v2 label="Address / delivery destination"><ChallanInput v2 value={quickCustomer.address} onChange={(event) => { setQuickCustomer((current) => ({ ...current, address: event.target.value })); setCustomerError(""); }} disabled={isCreatingCustomer} /></ChallanField>
            <ChallanField v2 label="Mobile"><ChallanInput v2 inputMode="tel" value={quickCustomer.mobile} onChange={(event) => { setQuickCustomer((current) => ({ ...current, mobile: event.target.value })); setCustomerError(""); }} disabled={isCreatingCustomer} /></ChallanField>
          </div>
          <div className="mt-atlas-3 flex flex-wrap items-center gap-atlas-3">
            <ChallanButton v2 legacyClassName={primaryButton} type="button" onClick={() => void submitQuickCustomer()} disabled={isCreatingCustomer} loading={isCreatingCustomer} loadingLabel="Adding...">Add and select customer</ChallanButton>
            {customerError && <Feedback role="alert" tone="danger">{customerError}</Feedback>}
          </div>
        </ChallanCard>}

        {editingCustomerId && selectedCustomer && !challan && <Card surface="muted" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitCustomerEdit(); } }}>
          <p className="text-atlas-base font-atlas-semibold text-atlas-text">Edit selected customer</p>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Updates Customer Master for this and future Challans. Saved Challans stay unchanged.</p>
          <div className="mt-atlas-3 grid gap-atlas-3 md:grid-cols-3">
            <ChallanField v2 label="Customer name"><ChallanInput v2 autoFocus value={customerEdit.name} onChange={(event) => { setCustomerEdit((current) => ({ ...current, name: event.target.value })); setCustomerError(""); }} disabled={isUpdatingCustomer} /></ChallanField>
            <ChallanField v2 label="Address / delivery destination"><ChallanInput v2 value={customerEdit.address} onChange={(event) => { setCustomerEdit((current) => ({ ...current, address: event.target.value })); setCustomerError(""); }} disabled={isUpdatingCustomer} /></ChallanField>
            <ChallanField v2 label="Mobile"><ChallanInput v2 inputMode="tel" value={customerEdit.mobile} onChange={(event) => { setCustomerEdit((current) => ({ ...current, mobile: event.target.value })); setCustomerError(""); }} disabled={isUpdatingCustomer} /></ChallanField>
          </div>
          <div className="mt-atlas-3 flex flex-wrap items-center gap-atlas-3">
            <Button type="button" onClick={() => void submitCustomerEdit()} disabled={isUpdatingCustomer} loading={isUpdatingCustomer} loadingLabel="Saving...">Save customer</Button>
            <Button type="button" variant="secondary" onClick={cancelCustomerEdit} disabled={isUpdatingCustomer}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
            {customerError && <Feedback role="alert" tone="danger">{customerError}</Feedback>}
          </div>
        </Card>}

        <div className="grid gap-atlas-4 border-t border-atlas-border pt-atlas-5 md:grid-cols-3">
          <h4 className="text-atlas-lg font-atlas-semibold text-atlas-text md:col-span-3">Challan details</h4>
          <ChallanField v2 label="Challan No. (optional)"><ChallanInput v2 ref={challanNumberInputRef} data-challan-focus="number" value={form.challanNumber} onChange={(event) => { setForm((current) => ({ ...current, challanNumber: event.target.value })); setError(""); }} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => challanDateInputRef.current)} maxLength={100} placeholder="145 or A-39" disabled={isSaving} /></ChallanField>
          <ChallanField v2 label="Challan date"><ChallanInput v2 ref={challanDateInputRef} data-challan-focus="date" type="date" value={form.challanDate} onChange={(event) => { setForm((current) => ({ ...current, challanDate: event.target.value })); setError(""); }} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => vehicleInputRef.current)} disabled={isSaving} /></ChallanField>
          <VehicleCombobox
            v2
            vehicles={vehicles}
            selectedVehicleId={form.vehicleId}
            onSelect={(vehicleId) => { setForm((current) => selectVehicleForChallan(current, vehicles, vehicleId)); setError(""); }}
            onSelectionComplete={focusAfterVehicle}
            onAdvance={() => focusAfterVehicle(form.vehicleId)}
            inputRef={vehicleInputRef}
            disabled={isSaving || vehiclesUnavailable}
          />
        </div>
        {vehiclesUnavailable && !vehiclesError && <Feedback tone="neutral">Loading Vehicles...</Feedback>}
        {vehiclesError && <Feedback role="alert" tone="danger">{salesOfficeErrorMessage(vehiclesError, "Could not load Vehicles.")}</Feedback>}
        <div className="flex flex-wrap items-center gap-atlas-3">
          <ChallanButton v2 variant="secondary" legacyClassName={secondaryButton} type="button" onClick={() => { setShowQuickVehicle((current) => !current); setVehicleError(""); }} disabled={isSaving}>{showQuickVehicle ? "Close Vehicle form" : "Add Vehicle"}</ChallanButton>
          {selectedVehicle && <p className="text-atlas-sm text-atlas-text-muted">Delivery Wage Tracking <span className="font-atlas-semibold text-atlas-text">{selectedVehicle.deliveryWageTrackingEnabled ? "ON" : "OFF"}</span>{selectedVehicle.isActive ? "" : " · Vehicle archived"}</p>}
        </div>

        {showQuickVehicle && <ChallanCard v2 surface="muted" legacyClassName="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-4">
          <p className="text-atlas-base font-atlas-semibold text-atlas-text">Add Vehicle without leaving this Challan</p>
          <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-3 sm:items-end">
            <ChallanField v2 label="Vehicle number"><ChallanInput v2 autoFocus value={quickVehicleNumber} onChange={(event) => { setQuickVehicleNumber(event.target.value); setVehicleError(""); }} placeholder="WB 12 AB 1234" autoCapitalize="characters" disabled={isCreatingVehicle} /></ChallanField>
            <label className="flex min-h-atlas-12 items-center gap-atlas-2 rounded-atlas-control border border-atlas-border-strong bg-atlas-surface px-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text"><input type="checkbox" checked={quickVehicleTracksWage} onChange={(event) => setQuickVehicleTracksWage(event.target.checked)} disabled={isCreatingVehicle} />Delivery Wage Tracking ON</label>
            <ChallanButton v2 legacyClassName={primaryButton} type="button" onClick={() => void submitQuickVehicle()} disabled={isCreatingVehicle} loading={isCreatingVehicle} loadingLabel="Adding...">Add and select</ChallanButton>
          </div>
          {vehicleError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">{vehicleError}</Feedback></div>}
        </ChallanCard>}

        {form.vehicleDeliveryWageTrackingEnabled && <div className="max-w-sm">
          <ChallanField v2 label="Trip Labour Wage"><ChallanInput v2 ref={tripLabourWageInputRef} data-challan-focus="trip-labour-wage" type="text" inputMode="decimal" value={form.tripLabourWage} onChange={(event) => { setForm((current) => ({ ...current, tripLabourWage: event.target.value })); setError(""); }} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => {
            const firstLine = form.lines[0];
            return firstLine
              ? brickTypeInputRefs.current.get(firstLine.key) ?? null
              : receivedPaymentForm.choice === "received_now"
                ? receivedNowInputRef.current
                : payLaterInputRef.current;
          })} placeholder="750" disabled={isSaving} /></ChallanField>
          <p className="mt-atlas-2 text-atlas-xs text-atlas-warning-text">Internal only — does not affect the customer Challan total.</p>
        </div>}

        <div className="border-t border-atlas-border pt-atlas-5">
          <div className="flex items-center justify-between gap-atlas-3">
            <div>
              <h4 className="text-atlas-lg font-atlas-semibold text-atlas-text">Brick items</h4>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{challan ? "Edit Rate or Amount. The last one you edit controls the row." : "Enter Rate to derive Amount, or edit Amount to make it authoritative."}</p>
            </div>
            <div className="flex flex-wrap items-center gap-atlas-2">
              {!challan && <ChallanButton
                v2
                variant="secondary"
                legacyClassName={secondaryButton}
                type="button"
                onClick={() => setIsManagingBrickTypes(true)}
                disabled={isSaving}
              >
                Manage brick types
              </ChallanButton>}
              <ChallanButton
                v2
                variant="secondary"
                legacyClassName={secondaryButton}
                type="button"
                onClick={() => {
                  const key = `new-line-${nextLineNumber.current}`;
                  nextLineNumber.current += 1;
                  setForm((current) => ({ ...current, lines: addChallanLine(current.lines, key) }));
                  setError("");
                  if (!challan) {
                    focusSoon(() => brickTypeInputRefs.current.get(key) ?? null);
                  }
                }}
                disabled={isSaving || form.lines.length >= 100 || !brickTypes.some((brickType) => brickType.isActive)}
              >
                Add brick row
              </ChallanButton>
            </div>
          </div>

          {isLoadingBrickTypes && <div className="mt-atlas-3"><Feedback tone="neutral">Loading brick types...</Feedback></div>}
          {brickTypesError && <div className="mt-atlas-3"><Feedback role="alert" tone="danger">Could not load brick types: {brickTypesError}</Feedback></div>}
          {!isLoadingBrickTypes && !brickTypesError && !brickTypes.some((brickType) => brickType.isActive) && <div className="mt-atlas-3"><Feedback tone="warning">No active brick type is available. Use Manage brick types to add or reactivate one.</Feedback></div>}
          {form.lines.length === 0 && <EmptyState title="No brick items" description="Add a brick row, or use a note or extra charge for a manual Challan." />}

          <div className="mt-atlas-4 space-y-atlas-3">
            {form.lines.map((line, index) => {
              const amount = calculateChallanBrickLineAmountPreview(line);
              const availableBrickTypes = brickTypes.filter((brickType) =>
                brickType.isActive || brickType.id === line.brickTypeId,
              );
              return <Card key={line.key}>
                <div className="grid gap-atlas-3 md:grid-cols-5 md:items-end">
                <BrickTypeCombobox
                  v2
                  brickTypes={availableBrickTypes}
                  selectedBrickTypeId={line.brickTypeId}
                  label={`Brick type ${index + 1}`}
                  focusName={`brick-type-${index + 1}`}
                  inputRef={(element) => { if (element) brickTypeInputRefs.current.set(line.key, element); }}
                  onSelect={(brickTypeId) => updateLine(line.key, "brickTypeId", brickTypeId)}
                  onSelectionComplete={() => { if (!challan) focusSoon(quantityInputRefs.current.get(line.key) ?? null); }}
                  disabled={isSaving || availableBrickTypes.length === 0}
                />
                <ChallanField v2 label="Quantity"><ChallanInput v2 ref={(element) => { if (element) quantityInputRefs.current.set(line.key, element); }} data-challan-focus={`quantity-${index + 1}`} type="text" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(line.key, "quantity", event.target.value)} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => rateInputRefs.current.get(line.key) ?? null)} disabled={isSaving} /></ChallanField>
                <ChallanField v2 label={challan ? `Rate / 1,000${line.pricingMode !== "AMOUNT" ? " · controls row" : " · derived"}` : `Rate / 1,000${line.pricingMode !== "AMOUNT" ? " · entered" : " · derived"}`}><ChallanInput v2 ref={(element) => { if (element) rateInputRefs.current.set(line.key, element); }} data-challan-focus={`rate-${index + 1}`} type="text" inputMode="decimal" value={line.ratePer1000Bricks} onChange={(event) => updateLine(line.key, "ratePer1000Bricks", event.target.value)} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => amountInputRefs.current.get(line.key) ?? null)} disabled={isSaving} /></ChallanField>
                <ChallanField v2 label={challan ? `Amount${line.pricingMode === "AMOUNT" ? " · controls row" : " · derived"}` : `Amount${line.pricingMode === "AMOUNT" ? " · entered" : " · derived"}`}><ChallanInput v2 ref={(element) => { if (element) amountInputRefs.current.set(line.key, element); }} data-challan-focus={`amount-${index + 1}`} type="text" inputMode="decimal" value={line.pricingMode === "AMOUNT" ? line.lineAmount ?? "" : amount === null ? "" : String(amount)} onChange={(event) => updateLine(line.key, "lineAmount", event.target.value)} onKeyDown={(event) => { if (!challan && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); focusAfterBrickLine(index); } }} disabled={isSaving} /></ChallanField>
                <ChallanButton v2 variant="ghost" legacyClassName="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => { setForm((current) => ({ ...current, lines: removeChallanLine(current.lines, line.key) })); setError(""); }} disabled={isSaving}>Remove</ChallanButton>
                </div>
              </Card>;
            })}
          </div>
        </div>

        <div className="border-t border-atlas-border pt-atlas-5">
          <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-atlas-lg font-atlas-semibold text-atlas-text">{challan ? "Additional lines / notes" : "Optional notes and charges"}</h4>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{challan ? "Notes are non-financial. Extra charges are included in the Challan total." : "Add only when this Challan needs customer-facing notes or extra charges."}</p>
            </div>
            <div className="flex flex-wrap gap-atlas-2">
              <ChallanButton v2 variant="secondary" legacyClassName={secondaryButton} type="button" onClick={() => addFlexibleLine("NOTE")} disabled={isSaving || form.flexibleLines.length >= 100}>Add note</ChallanButton>
              <ChallanButton v2 variant="secondary" legacyClassName={secondaryButton} type="button" onClick={() => addFlexibleLine("EXTRA_CHARGE")} disabled={isSaving || form.flexibleLines.length >= 100}>Add extra charge</ChallanButton>
            </div>
          </div>

          {form.flexibleLines.length === 0 && <div className="mt-atlas-4"><Feedback tone="neutral">No additional lines. Continue unless this Challan needs a note or extra charge.</Feedback></div>}

          <div className="mt-atlas-4 space-y-atlas-3">
            {form.flexibleLines.map((line, index) => {
              const label = line.lineType === "NOTE" ? "Note" : "Extra charge";
              const amountPreview = calculateFlexibleLineAmountPreview(line);
              return <Card key={line.key} surface="muted">
                <div className="flex flex-wrap items-center justify-between gap-atlas-3">
                  <div>
                    <p className="font-atlas-semibold text-atlas-text">{label} {index + 1}</p>
                    <p className="text-atlas-xs text-atlas-text-muted">Position {index + 1}</p>
                  </div>
                  <div className="flex flex-wrap gap-atlas-2">
                    <ChallanButton v2 variant="ghost" legacyClassName="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40" type="button" aria-label={`Move ${label.toLowerCase()} up`} onClick={() => { setForm((current) => ({ ...current, flexibleLines: moveChallanFlexibleLine(current.flexibleLines, line.key, "up") })); setError(""); }} disabled={isSaving || index === 0}>Move up</ChallanButton>
                    <ChallanButton v2 variant="ghost" legacyClassName="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40" type="button" aria-label={`Move ${label.toLowerCase()} down`} onClick={() => { setForm((current) => ({ ...current, flexibleLines: moveChallanFlexibleLine(current.flexibleLines, line.key, "down") })); setError(""); }} disabled={isSaving || index === form.flexibleLines.length - 1}>Move down</ChallanButton>
                    <ChallanButton v2 variant="danger" legacyClassName="h-9 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => { setForm((current) => ({ ...current, flexibleLines: removeChallanFlexibleLine(current.flexibleLines, line.key) })); setError(""); }} disabled={isSaving}>Remove</ChallanButton>
                  </div>
                </div>

                {line.lineType === "NOTE" && <div className="mt-atlas-3">
                  <ChallanField v2 label="Particulars / note text"><ChallanInput v2 value={line.particulars} maxLength={500} onChange={(event) => updateFlexibleParticulars(line.key, event.target.value)} placeholder="Delivery made at customer's site." disabled={isSaving} /></ChallanField>
                </div>}

                {line.lineType === "EXTRA_CHARGE" && <div className="mt-atlas-3 grid gap-atlas-3 md:grid-cols-2">
                  <ChallanField v2 label="Particulars"><ChallanInput v2 value={line.particulars} maxLength={500} onChange={(event) => updateFlexibleParticulars(line.key, event.target.value)} placeholder="Loading / unloading" disabled={isSaving} /></ChallanField>
                  <ChallanField v2 label="Charge method"><ChallanSelect v2 value={line.chargeMode} onChange={(event) => updateExtraChargeMode(line.key, event.target.value as ChallanExtraChargeMode)} disabled={isSaving}><option value="DIRECT_AMOUNT">Direct amount</option><option value="QUANTITY_RATE">Quantity × rate</option></ChallanSelect></ChallanField>
                  {line.chargeMode === "DIRECT_AMOUNT" && <ChallanField v2 label={challan ? "Amount · entered" : "Amount"}><ChallanInput v2 type="text" inputMode="decimal" value={line.amount} onChange={(event) => updateExtraChargeField(line.key, "amount", event.target.value)} placeholder="2000" disabled={isSaving} /></ChallanField>}
                  {line.chargeMode === "QUANTITY_RATE" && <>
                    <ChallanField v2 label="Quantity"><ChallanInput v2 type="text" inputMode="decimal" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateExtraChargeField(line.key, "quantity", event.target.value)} disabled={isSaving} /></ChallanField>
                    <ChallanField v2 label="Rate"><ChallanInput v2 type="text" inputMode="decimal" min="0.01" step="0.01" value={line.rate} onChange={(event) => updateExtraChargeField(line.key, "rate", event.target.value)} disabled={isSaving} /></ChallanField>
                  </>}
                  <div><p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">{challan ? "Charge preview · derived" : "Charge preview"}</p><p className="mt-atlas-1 flex min-h-atlas-12 items-center font-atlas-semibold tabular-nums text-atlas-text">{amountPreview === null ? "—" : formatIndianCurrency(amountPreview, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
                </div>}
              </Card>;
            })}
          </div>
        </div>

        {!challan && <fieldset className="rounded-atlas-card border border-atlas-border bg-atlas-surface-muted p-atlas-4">
          <legend className="px-atlas-1 text-atlas-lg font-atlas-semibold text-atlas-text">Payment</legend>
          <p className="mb-atlas-3 text-atlas-sm text-atlas-text-muted">Record money received now, or leave the full balance due.</p>
          <div className="grid gap-atlas-3 sm:grid-cols-2">
            <label className="flex min-h-atlas-12 items-center gap-atlas-2 rounded-atlas-control border border-atlas-border-strong bg-atlas-surface px-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">
              <input
                ref={payLaterInputRef}
                data-challan-focus="pay-later"
                type="radio"
                name="challan-payment-choice"
                value="pay_later"
                checked={receivedPaymentForm.choice === "pay_later"}
                onChange={() => {
                  setReceivedPaymentForm((current) => ({
                    ...current,
                    choice: "pay_later",
                    amount: "",
                    paymentMode: "",
                  }));
                  setError("");
                  focusSoon(saveButtonRef.current);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  setReceivedPaymentForm((current) => ({
                    ...current,
                    choice: "pay_later",
                    amount: "",
                    paymentMode: "",
                  }));
                  setError("");
                  focusSoon(saveButtonRef.current);
                }}
                disabled={isSaving}
              />
              Pay later
            </label>
            <label className="flex min-h-atlas-12 items-center gap-atlas-2 rounded-atlas-control border border-atlas-border-strong bg-atlas-surface px-atlas-3 text-atlas-sm font-atlas-semibold text-atlas-text">
              <input
                ref={receivedNowInputRef}
                data-challan-focus="received-now"
                type="radio"
                name="challan-payment-choice"
                value="received_now"
                checked={receivedPaymentForm.choice === "received_now"}
                onChange={() => {
                  setReceivedPaymentForm((current) => ({ ...current, choice: "received_now" }));
                  setError("");
                  focusSoon(() => receivedAmountInputRef.current);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  setReceivedPaymentForm((current) => ({ ...current, choice: "received_now" }));
                  setError("");
                  focusSoon(() => receivedAmountInputRef.current);
                }}
                disabled={isSaving}
              />
              Received now
            </label>
          </div>
          {receivedPaymentForm.choice === "received_now" && <div className="mt-atlas-4 grid gap-atlas-3 md:grid-cols-3">
            <ChallanField v2 label="Amount received"><ChallanInput v2 ref={receivedAmountInputRef} data-challan-focus="received-amount" type="text" inputMode="decimal" value={receivedPaymentForm.amount} onChange={(event) => { setReceivedPaymentForm((current) => ({ ...current, amount: event.target.value })); setError(""); }} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => paymentDateInputRef.current)} placeholder="50000" disabled={isSaving} /></ChallanField>
            <ChallanField v2 label="Payment date"><ChallanInput v2 ref={paymentDateInputRef} data-challan-focus="payment-date" type="date" value={receivedPaymentForm.paymentDate} onChange={(event) => { setReceivedPaymentForm((current) => ({ ...current, paymentDate: event.target.value })); setError(""); }} onKeyDown={(event) => advanceNewChallanOnEnter(event, () => paymentModeInputRef.current)} disabled={isSaving} /></ChallanField>
            <ChallanField v2 label={ATLAS_UI_STRINGS.payment.mode}><ChallanSelect v2 ref={paymentModeInputRef} data-challan-focus="payment-mode" value={receivedPaymentForm.paymentMode} onChange={(event) => { setReceivedPaymentForm((current) => ({ ...current, paymentMode: event.target.value })); setError(""); if (event.target.value) focusSoon(saveButtonRef.current); }} disabled={isSaving}><option value="">{ATLAS_UI_STRINGS.payment.selectMode}</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</ChallanSelect></ChallanField>
          </div>}
        </fieldset>}

        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        <div className="sticky bottom-atlas-0 z-20 flex flex-col gap-atlas-4 border-t border-atlas-border-strong bg-atlas-background py-atlas-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-atlas-sm text-atlas-text-muted">{challan ? "Corrected total preview · derived" : "Final Challan total"}</p>
            <p className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(totalPreview)}</p>
            <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{challan ? "Brick rows plus extra charges. Notes add ₹0. The database returns the authoritative saved total." : "Brick items plus extra charges. Notes add ₹0. The saved total remains authoritative."}</p>
          </div>
          <div className="flex flex-wrap gap-atlas-2">
            {onCancel && <ChallanButton v2 variant="secondary" legacyClassName={secondaryButton} type="button" onClick={onCancel} disabled={isSaving}>{ATLAS_UI_STRINGS.actions.cancel}</ChallanButton>}
            <ChallanButton ref={saveButtonRef} v2 variant="primary" legacyClassName={primaryButton} data-challan-focus="save" type="submit" loading={isSaving} loadingLabel="Saving Challan..." disabled={isSaving || (form.lines.length > 0 && (isLoadingBrickTypes || Boolean(brickTypesError))) || (!challan && (!profileComplete || isLoadingFactoryProfile))}>{challan ? "Save corrections" : "Save Challan"}</ChallanButton>
          </div>
        </div>
      </form>
      {isManagingBrickTypes && !challan && (
        <BrickTypeManagementDrawer
          factoryId={factoryId}
          brickTypes={brickTypes}
          isLoading={isLoadingBrickTypes}
          loadError={brickTypesError}
          onBrickTypesChanged={onBrickTypesChanged}
          onBrickTypeUnavailable={handleBrickTypeUnavailable}
          onClose={() => setIsManagingBrickTypes(false)}
        />
      )}
    </section>
  );
}

function VehicleCombobox({
  v2,
  vehicles,
  selectedVehicleId,
  disabled,
  onSelect,
  onSelectionComplete,
  onAdvance,
  inputRef,
}: Readonly<{
  v2: boolean;
  vehicles: readonly Vehicle[];
  selectedVehicleId: string;
  disabled: boolean;
  onSelect: (vehicleId: string) => void;
  onSelectionComplete: (vehicleId: string) => void;
  onAdvance: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
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
    if (vehicleId) onSelectionComplete(vehicleId);
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
    if (event.key === "Enter") {
      event.preventDefault();
      if (isOpen && highlightedVehicle) {
        selectVehicle(highlightedVehicle.id);
      } else if (!isOpen || !searchText.trim()) {
        setSearchText("");
        setIsOpen(false);
        setHighlightedIndex(-1);
        onAdvance();
      }
    }
  }

  return <div
    ref={rootRef}
    className="relative"
    data-vehicle-combobox
    onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setSearchText("");
      setIsOpen(false);
      setHighlightedIndex(-1);
    }}
  >
    <label htmlFor={inputId} className={v2 ? "mb-atlas-1 block text-atlas-sm font-atlas-medium text-atlas-text-muted" : "block text-xs font-medium text-slate-600"}>Vehicle (optional)</label>
    <div className="relative">
      {/* ui-exception: specialized accessible searchable vehicle combobox */}
      <input className={v2
          ? "min-h-atlas-12 w-full rounded-atlas-control border border-atlas-border-strong bg-atlas-surface px-atlas-3 py-atlas-2 pr-atlas-16 text-atlas-base text-atlas-text placeholder:text-atlas-text-subtle hover:border-atlas-primary-border focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus disabled:cursor-not-allowed disabled:border-atlas-border disabled:bg-atlas-surface-disabled disabled:text-atlas-text-disabled"
          : `${inputClass} pr-16`}
        ref={inputRef}
        data-challan-focus="vehicle"
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
      />
      {/* ui-exception: clear action is part of the specialized combobox control */}
      {selectedVehicleId && !disabled && <button className={v2 ? "absolute right-atlas-8 top-1/2 -translate-y-1/2 px-atlas-2 text-atlas-lg text-atlas-text-muted hover:text-atlas-text focus-visible:outline-none focus-visible:ring-atlas-focus" : "absolute right-8 top-1/2 mt-0.5 -translate-y-1/2 px-2 text-lg text-slate-500 hover:text-slate-950"}
        type="button"
        aria-label="Clear Vehicle selection"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectVehicle("")}
      >×</button>}
      <span aria-hidden="true" className={v2 ? "pointer-events-none absolute right-atlas-3 top-1/2 -translate-y-1/2 text-atlas-text-muted" : "pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500"}>▾</span>
    </div>

    {isOpen && <div
      id={listboxId}
      role="listbox"
      aria-label="Available Vehicles"
      className={v2 ? "absolute z-30 mt-atlas-1 max-h-64 w-full overflow-y-auto rounded-atlas-control border border-atlas-border-strong bg-atlas-surface py-atlas-1 text-atlas-sm shadow-atlas-medium" : "absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-xl"}
    >
      {options.length === 0
        ? <p className={v2 ? "px-atlas-3 py-atlas-3 text-atlas-text-muted" : "px-3 py-3 text-slate-500"}>No active Vehicle matches.</p>
        : options.map((vehicle, index) => {
          // ui-exception: listbox options belong to the specialized vehicle combobox
          return <button className={v2
              ? `flex min-h-atlas-12 w-full items-center justify-between gap-atlas-3 px-atlas-3 py-atlas-2 text-left focus-visible:outline-none focus-visible:ring-atlas-focus ${index === highlightedIndex ? "bg-atlas-primary-surface text-atlas-primary" : "text-atlas-text hover:bg-atlas-surface-hover"}`
              : `flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${index === highlightedIndex ? "bg-cyan-50 text-cyan-950" : "text-slate-900 hover:bg-slate-50"}`}
            key={vehicle.id}
            id={`${listboxId}-${vehicle.id}`}
            type="button"
            role="option"
            aria-selected={vehicle.id === selectedVehicleId}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => selectVehicle(vehicle.id)}
          >
            <span className={v2 ? "font-atlas-semibold" : "font-semibold"}>{vehicle.vehicleNumber}</span>
            <span className={v2 ? "text-atlas-xs text-atlas-text-muted" : "text-xs text-slate-500"}>Wage {vehicle.deliveryWageTrackingEnabled ? "ON" : "OFF"}</span>
          </button>;
        })}
    </div>}
  </div>;
}

function BrickTypeCombobox({
  v2,
  brickTypes,
  selectedBrickTypeId,
  label,
  focusName,
  disabled,
  inputRef,
  onSelect,
  onSelectionComplete,
}: Readonly<{
  v2: boolean;
  brickTypes: readonly BrickType[];
  selectedBrickTypeId: string;
  label: string;
  focusName: string;
  disabled: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  onSelect: (brickTypeId: string) => void;
  onSelectionComplete: () => void;
}>) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const selectedBrickType = brickTypes.find((brickType) => brickType.id === selectedBrickTypeId);
  const highlightedBrickType = brickTypes[highlightedIndex];

  useEffect(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
  }, [selectedBrickTypeId]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  function openList() {
    if (disabled) return;
    const selectedIndex = brickTypes.findIndex((brickType) => brickType.id === selectedBrickTypeId);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : brickTypes.length > 0 ? 0 : -1);
    setIsOpen(true);
  }

  function selectBrickType(brickTypeId: string, shouldAdvance = true) {
    onSelect(brickTypeId);
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (shouldAdvance) onSelectionComplete();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
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
      setHighlightedIndex((current) => Math.min(current + 1, brickTypes.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setHighlightedIndex((current) => current <= 0 ? brickTypes.length - 1 : current - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!isOpen) {
        openList();
      } else if (highlightedBrickType) {
        selectBrickType(highlightedBrickType.id);
      }
    }
  }

  return <div
    ref={rootRef}
    className="relative"
    data-brick-type-combobox
    onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setIsOpen(false);
      setHighlightedIndex(-1);
    }}
  >
    <label htmlFor={inputId} className={v2 ? "mb-atlas-1 block text-atlas-sm font-atlas-medium text-atlas-text-muted" : "block text-xs font-medium text-slate-600"}>{label}</label>
    <div className="relative">
      {/* ui-exception: specialized accessible Brick Type combobox */}
      <input className={v2
          ? "min-h-atlas-12 w-full cursor-pointer rounded-atlas-control border border-atlas-border-strong bg-atlas-surface px-atlas-3 py-atlas-2 pr-atlas-16 text-atlas-base text-atlas-text placeholder:text-atlas-text-subtle hover:border-atlas-primary-border focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus disabled:cursor-not-allowed disabled:border-atlas-border disabled:bg-atlas-surface-disabled disabled:text-atlas-text-disabled"
          : `${inputClass} cursor-pointer pr-16`}
        ref={inputRef}
        data-challan-focus={focusName}
        id={inputId}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={highlightedBrickType ? `${listboxId}-${highlightedBrickType.id}` : undefined}
        aria-haspopup="listbox"
        readOnly
        placeholder="Select brick type"
        value={selectedBrickType?.name ?? ""}
        onClick={openList}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      {/* ui-exception: clear action is part of the specialized combobox control */}
      {selectedBrickTypeId && !disabled && <button className={v2 ? "absolute right-atlas-8 top-1/2 -translate-y-1/2 px-atlas-2 text-atlas-lg text-atlas-text-muted hover:text-atlas-text focus-visible:outline-none focus-visible:ring-atlas-focus" : "absolute right-8 top-1/2 mt-0.5 -translate-y-1/2 px-2 text-lg text-slate-500 hover:text-slate-950"}
        type="button"
        tabIndex={-1}
        aria-label="Clear Brick Type selection"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectBrickType("", false)}
      >×</button>}
      <span aria-hidden="true" className={v2 ? "pointer-events-none absolute right-atlas-3 top-1/2 -translate-y-1/2 text-atlas-text-muted" : "pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500"}>▾</span>
    </div>

    {isOpen && <div
      id={listboxId}
      role="listbox"
      aria-label={label}
      className={v2 ? "absolute z-30 mt-atlas-1 max-h-64 w-full overflow-y-auto rounded-atlas-control border border-atlas-border-strong bg-atlas-surface py-atlas-1 text-atlas-sm shadow-atlas-medium" : "absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-xl"}
    >
      {brickTypes.map((brickType, index) => {
        // ui-exception: listbox options belong to the specialized Brick Type combobox
        return <button className={v2
            ? `block min-h-atlas-12 w-full px-atlas-3 py-atlas-2 text-left focus-visible:outline-none focus-visible:ring-atlas-focus ${index === highlightedIndex ? "bg-atlas-primary-surface text-atlas-primary" : "text-atlas-text hover:bg-atlas-surface-hover"}`
            : `block w-full px-3 py-2 text-left ${index === highlightedIndex ? "bg-cyan-50 text-cyan-950" : "text-slate-900 hover:bg-slate-50"}`}
        key={brickType.id}
        id={`${listboxId}-${brickType.id}`}
        type="button"
        role="option"
        aria-selected={brickType.id === selectedBrickTypeId}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setHighlightedIndex(index)}
        onClick={() => selectBrickType(brickType.id)}
      >
        <span className={v2 ? "font-atlas-semibold" : "font-semibold"}>{brickType.name}</span>{brickType.isActive ? "" : <span className={v2 ? "ml-atlas-2 text-atlas-xs text-atlas-text-muted" : "ml-2 text-xs text-slate-500"}>inactive</span>}
      </button>;
      })}
    </div>}
  </div>;
}

function ChallanDetail({
  challan,
  isConfirmingVoid,
  isVoiding,
  onCancelVoid,
  onConfirmVoid,
}: Readonly<{
  challan: Challan;
  isConfirmingVoid: boolean;
  isVoiding: boolean;
  onCancelVoid: () => void;
  onConfirmVoid: () => void;
}>) {
  const queryClient = useQueryClient();
  const eligibility = getChallanEligibility(challan);
  const flexibleLines = getSavedChallanFlexibleLineViews(challan.flexibleLines);
  const vehicleDetails = getSavedChallanVehicleDetails(challan);
  const challanStatus = resolveStatusPresentation(CHALLAN_STATUS, challan.status);
  const financialLockStatus = challan.isLocked
    ? resolveBooleanStatusPresentation(CHALLAN_FINANCIAL_LOCK_STATUS, true)
    : null;
  const paymentStateQuery = useQuery({
    queryKey: challanPaymentStateKey(challan.factoryId, challan.id),
    queryFn: () => getChallanPaymentState(challan.factoryId, challan.id),
  });
  const paymentHistoryQuery = useQuery({
    queryKey: customerPaymentHistoryKey(challan.factoryId, challan.customerId),
    queryFn: () => listCustomerPayments(challan.factoryId, challan.customerId),
  });
  const paymentStateCurrent = isCustomerPaymentReadCurrent({
    isFetching: paymentStateQuery.isFetching, error: paymentStateQuery.error,
    dataUpdatedAt: paymentStateQuery.dataUpdatedAt,
    isInvalidated: queryClient.getQueryState(challanPaymentStateKey(challan.factoryId, challan.id))?.isInvalidated,
  });
  const paymentHistoryCurrent = isCustomerPaymentReadCurrent({
    isFetching: paymentHistoryQuery.isFetching, error: paymentHistoryQuery.error,
    dataUpdatedAt: paymentHistoryQuery.dataUpdatedAt,
    isInvalidated: queryClient.getQueryState(customerPaymentHistoryKey(challan.factoryId, challan.customerId))?.isInvalidated,
  });
  const paymentStatus = paymentStateCurrent && paymentStateQuery.data
    ? resolveStatusPresentation(
        CHALLAN_PAYMENT_STATUS,
        paymentStateQuery.data.paymentState,
      )
    : null;
  const paymentHistory = getSavedChallanPaymentHistoryEntries(
    paymentHistoryCurrent ? paymentHistoryQuery.data ?? [] : [],
    challan.id,
  );

  return (
    <article aria-labelledby="saved-challan-heading" className="text-atlas-text">
      <header className="border-b border-atlas-border-strong pb-atlas-5">
        <div className="flex flex-col gap-atlas-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Saved Challan
            </p>
            <div className="mt-atlas-1 flex flex-wrap items-center gap-atlas-2">
              <h3 id="saved-challan-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">
                {formatChallanLabel(challan.challanNumber)}
              </h3>
              <StatusPill label={challanStatus.label} tone={challanStatus.tone} />
              {financialLockStatus && <StatusPill label={financialLockStatus.label} tone={financialLockStatus.tone} />}
              {paymentStatus && <StatusPill label={paymentStatus.label} tone={paymentStatus.tone} />}
            </div>
            {!challan.challanNumber && (
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
                No manual Challan number was recorded.
              </p>
            )}
            <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
              {formatDateOnly(challan.challanDate)} · {challan.customerNameSnapshot}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">
              Challan total
            </p>
            <p className="mt-atlas-1 text-atlas-2xl font-atlas-semibold tabular-nums text-atlas-text">
              {formatIndianCurrency(challan.challanTotal, MONEY_WITH_PAISE)}
            </p>
            <Link
              href={`/office/challans/${challan.id}`}
              target="_blank"
              rel="noreferrer"
              className="mt-atlas-2 inline-flex min-h-atlas-12 items-center rounded-atlas-button px-atlas-2 text-atlas-sm font-atlas-semibold text-atlas-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus"
            >
              Print / download PDF
            </Link>
          </div>
        </div>
        {eligibility.reason === "void" && (
          <p className="mt-atlas-3 text-atlas-sm text-atlas-text-muted">Correction and void are unavailable for a Void Challan.</p>
        )}

      </header>

      {isConfirmingVoid && eligibility.canVoid && (
        <ChallanVoidConfirmation
          challanNumber={challan.challanNumber}
          isVoiding={isVoiding}
          onCancel={onCancelVoid}
          onConfirm={onConfirmVoid}
        />
      )}

      {challan.status === "void" && (
        <div className="mt-atlas-4">
          <Feedback tone="neutral" role="status">
            This Challan is Void. Its saved snapshots and financial history remain permanent.
          </Feedback>
        </div>
      )}

      <section aria-labelledby="saved-challan-context-heading" className="mt-atlas-6">
        <h4 id="saved-challan-context-heading" className="text-atlas-xl font-atlas-semibold">
          Customer and delivery
        </h4>
        <div className="mt-atlas-3 grid gap-atlas-5 border-y border-atlas-border py-atlas-4 md:grid-cols-2">
          <dl aria-label="Saved customer snapshot" className="grid gap-atlas-3 sm:grid-cols-2">
            <SnapshotValue label="Customer snapshot" value={challan.customerNameSnapshot} />
            <SnapshotValue label="Mobile snapshot" value={challan.customerMobileSnapshot || "Not recorded"} />
            <div className="sm:col-span-2">
              <SnapshotValue label="Delivery address snapshot" value={challan.customerAddressSnapshot || "Not recorded"} />
            </div>
          </dl>
          <dl aria-label="Saved Vehicle information" className="grid content-start gap-atlas-3 sm:grid-cols-2">
            <SnapshotValue label="Vehicle Number" value={vehicleDetails.vehicleNumber ?? "No vehicle"} />
            {vehicleDetails.tripLabourWage !== null && (
              <div>
                <SnapshotValue
                  label="Trip Labour Wage"
                  value={formatIndianCurrency(vehicleDetails.tripLabourWage, MONEY_WITH_PAISE)}
                />
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">
                  Internal only · not customer-facing
                </p>
              </div>
            )}
          </dl>
        </div>

        <details aria-label="Saved company snapshot" className="border-b border-atlas-border">
          <summary className="flex min-h-atlas-12 cursor-pointer items-center font-atlas-semibold focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
            Company snapshot used for this Challan
          </summary>
          <dl className="grid gap-atlas-3 pb-atlas-4 sm:grid-cols-2">
            <SnapshotValue label="Company snapshot" value={challan.companyNameSnapshot} />
            <SnapshotValue label="Company mobile snapshot" value={challan.companyMobileSnapshot || "Not recorded"} />
            <SnapshotValue label="Business description snapshot" value={challan.companyBusinessDescriptionSnapshot || "Not recorded"} />
            <SnapshotValue label="Company address snapshot" value={challan.companyAddressSnapshot || "Not recorded"} />
            {challan.companyGstinSnapshot && <SnapshotValue label="GSTIN snapshot" value={challan.companyGstinSnapshot} />}
          </dl>
        </details>
      </section>

      <section aria-labelledby="saved-challan-items-heading" className="mt-atlas-7">
        <h4 id="saved-challan-items-heading" className="text-atlas-xl font-atlas-semibold">
          Saved brick lines
        </h4>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">
          Quantities, rates, and amounts are the historical values saved with this Challan.
        </p>

        {challan.items.length === 0 ? (
          <EmptyState title="No brick lines" description="This saved Challan contains notes or extra charges only." />
        ) : (
          <>
            <div className="mt-atlas-4 hidden md:block">
              <TableContainer>
                <Table>
                  <TableCaption visuallyHidden>Saved brick lines for {formatChallanLabel(challan.challanNumber)}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Particulars snapshot</TableHeaderCell>
                      <TableHeaderCell numeric>Quantity</TableHeaderCell>
                      <TableHeaderCell numeric>Rate / 1,000</TableHeaderCell>
                      <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {challan.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><span className="font-atlas-medium">{item.brickParticularsSnapshot}</span></TableCell>
                        <TableCell numeric>{formatIndianNumber(item.quantity)}</TableCell>
                        <TableCell numeric>{formatIndianCurrency(item.ratePer1000Bricks, MONEY_WITH_PAISE)}</TableCell>
                        <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(item.lineAmount, MONEY_WITH_PAISE)}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
            <ul className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden">
              {challan.items.map((item) => (
                <li key={item.id} className="py-atlas-4">
                  <p className="font-atlas-semibold text-atlas-text">{item.brickParticularsSnapshot}</p>
                  <dl className="mt-atlas-3 grid grid-cols-2 gap-atlas-3">
                    <SnapshotValue label="Quantity" value={formatIndianNumber(item.quantity)} numeric />
                    <SnapshotValue label="Rate / 1,000" value={formatIndianCurrency(item.ratePer1000Bricks, MONEY_WITH_PAISE)} numeric />
                    <div className="col-span-2">
                      <SnapshotValue label={ATLAS_UI_STRINGS.fields.amount} value={formatIndianCurrency(item.lineAmount, MONEY_WITH_PAISE)} numeric emphasize />
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="saved-challan-flexible-lines-heading" className="mt-atlas-6">
        <h4 id="saved-challan-flexible-lines-heading" className="text-atlas-lg font-atlas-semibold">
          Additional lines / notes
        </h4>
        {flexibleLines.length === 0 ? (
          <div className="mt-atlas-3">
            <EmptyState title="No additional lines or notes" />
          </div>
        ) : (
          <ul className="mt-atlas-3 divide-y divide-atlas-border border-y border-atlas-border">
            {flexibleLines.map((line) => (
              <li key={line.key} className="py-atlas-4">
                {line.kind === "note" && (
                  <div>
                    <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-info-text">{line.typeLabel}</p>
                    <p className="mt-atlas-1 text-atlas-sm font-atlas-medium text-atlas-text">{line.particulars}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Non-financial · contributes ₹0</p>
                  </div>
                )}
                {line.kind === "extra_charge" && (
                  <div className="grid gap-atlas-3 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-info-text">{line.typeLabel}</p>
                      <p className="mt-atlas-1 text-atlas-sm font-atlas-medium text-atlas-text">{line.particulars}</p>
                      {line.quantity !== null && line.rate !== null && (
                        <p className="mt-atlas-1 text-atlas-xs tabular-nums text-atlas-text-muted">
                          {formatIndianNumber(line.quantity)} × {formatIndianCurrency(line.rate, MONEY_WITH_PAISE)}
                        </p>
                      )}
                    </div>
                    <p className="text-atlas-base font-atlas-semibold tabular-nums text-atlas-text sm:text-right">
                      {formatIndianCurrency(line.amount, MONEY_WITH_PAISE)}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-atlas-7">
      <Card as="section" aria-labelledby="saved-challan-financial-heading" surface="muted">
        <h4 id="saved-challan-financial-heading" className="text-atlas-xl font-atlas-semibold">
          Financial summary
        </h4>
        <dl className="mt-atlas-4 grid gap-atlas-4 sm:grid-cols-3">
          <SnapshotValue
            label="Authoritative Challan total"
            value={formatIndianCurrency(challan.challanTotal, MONEY_WITH_PAISE)}
            numeric
            emphasize
          />
          {paymentStateCurrent && paymentStateQuery.data && (
            <>
              <SnapshotValue label="Paid" value={formatIndianCurrency(paymentStateQuery.data.totalPaid, MONEY_WITH_PAISE)} numeric />
                <SnapshotValue label={ATLAS_UI_STRINGS.payment.outstanding} value={formatIndianCurrency(paymentStateQuery.data.outstandingAmount, MONEY_WITH_PAISE)} numeric emphasize={paymentStateQuery.data.outstandingAmount > 0} />
            </>
          )}
        </dl>
        {!paymentStateCurrent && !paymentStateQuery.error && (
          <div className="mt-atlas-4"><Feedback tone="neutral" role="status">Loading payment position...</Feedback></div>
        )}
        {paymentStateQuery.error && (
          <div className="mt-atlas-4">
            <Feedback tone="danger" role="alert">
              <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{salesOfficeErrorMessage(paymentStateQuery.error, "Could not load the payment position.")}</span>
                <Button variant="secondary" onClick={() => { void paymentStateQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
              </div>
            </Feedback>
          </div>
        )}
      </Card>
      </div>

      <section aria-labelledby="saved-challan-payment-history-heading" className="mt-atlas-6">
        <details className="border-y border-atlas-border">
          <summary className="flex min-h-atlas-12 cursor-pointer items-center justify-between gap-atlas-3 py-atlas-2 font-atlas-semibold focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus">
            <span id="saved-challan-payment-history-heading">{ATLAS_UI_STRINGS.payment.history}</span>
            {paymentHistoryCurrent && (
              <span className="text-atlas-xs font-atlas-medium text-atlas-text-muted">
                {paymentHistory.length} {paymentHistory.length === 1 ? "allocation" : "allocations"}
              </span>
            )}
          </summary>
          <div className="border-t border-atlas-border py-atlas-4">
            {!paymentHistoryCurrent && !paymentHistoryQuery.error && <Feedback tone="neutral" role="status">{ATLAS_UI_STRINGS.payment.loadingHistory}</Feedback>}
            {paymentHistoryQuery.error && (
              <Feedback tone="danger" role="alert">
                <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{salesOfficeErrorMessage(paymentHistoryQuery.error, ATLAS_UI_STRINGS.payment.historyLoadError)}</span>
                  <Button variant="secondary" onClick={() => { void paymentHistoryQuery.refetch(); }}>{ATLAS_UI_STRINGS.actions.retry}</Button>
                </div>
              </Feedback>
            )}
            {paymentHistoryCurrent && paymentHistory.length === 0 && (
              <EmptyState title="No payments allocated" description="No customer payment has been allocated to this Challan." />
            )}
            {paymentHistoryCurrent && paymentHistory.length > 0 && (
              <>
                <div className="hidden md:block">
                  <TableContainer>
                    <Table>
                      <TableCaption visuallyHidden>Payments allocated to {formatChallanLabel(challan.challanNumber)}</TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
                          <TableHeaderCell>Mode</TableHeaderCell>
                          <TableHeaderCell>Receipt</TableHeaderCell>
                          <TableHeaderCell>{ATLAS_UI_STRINGS.fields.note}</TableHeaderCell>
                          <TableHeaderCell numeric>Allocated</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentHistory.map((entry) => (
                          <TableRow key={entry.key}>
                            <TableCell>{formatDateOnly(entry.paymentDate)}</TableCell>
                            <TableCell>{formatCustomerPaymentMethods(entry.methods, entry.paymentMode)}</TableCell>
                            <TableCell><Link className="font-atlas-semibold text-atlas-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus" href={`/office/payments/${entry.paymentId}`} target="_blank" rel="noreferrer">{ATLAS_UI_STRINGS.payment.openReceipt}</Link></TableCell>
                            <TableCell>{entry.note || "—"}</TableCell>
                            <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(entry.allocatedAmount, MONEY_WITH_PAISE)}</span></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </div>
                <ul className="divide-y divide-atlas-border border-y border-atlas-border md:hidden">
                  {paymentHistory.map((entry) => (
                    <li key={entry.key} className="py-atlas-4">
                      <div className="flex items-start justify-between gap-atlas-3">
                        <div>
                          <p className="font-atlas-semibold text-atlas-text">{formatDateOnly(entry.paymentDate)}</p>
                          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{formatCustomerPaymentMethods(entry.methods, entry.paymentMode)}{entry.note ? ` · ${entry.note}` : ""}</p>
                        </div>
                        <p className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(entry.allocatedAmount, MONEY_WITH_PAISE)}</p>
                      </div>
                      <Link className="mt-atlas-2 inline-flex min-h-atlas-12 items-center text-atlas-sm font-atlas-semibold text-atlas-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-atlas-focus" href={`/office/payments/${entry.paymentId}`} target="_blank" rel="noreferrer">{ATLAS_UI_STRINGS.payment.openReceipt}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      </section>

    </article>
  );
}

function ChallanVoidConfirmation({
  challanNumber,
  isVoiding,
  onCancel,
  onConfirm,
}: Readonly<{
  challanNumber: Challan["challanNumber"];
  isVoiding: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  const voidingRef = useRef(isVoiding);
  cancelRef.current = onCancel;
  voidingRef.current = isVoiding;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !voidingRef.current) {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = confirmButtonRef.current?.closest('[role="dialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const title = challanNumber
    ? `Void Challan ${challanNumber}?`
    : "Void this Challan?";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-atlas-4">
      {/* ui-exception: A centered confirmation requires a full-screen dismissal target behind it. */}
      <button type="button" aria-label="Cancel Challan void" disabled={isVoiding} className="absolute inset-0 bg-atlas-text/25 backdrop-blur-sm" onClick={onCancel} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="challan-void-confirmation-title"
        aria-describedby="challan-void-confirmation-description"
        className="relative w-full max-w-md rounded-atlas-dialog border border-atlas-border-strong bg-atlas-surface p-atlas-5 shadow-atlas-high"
      >
        <div className="flex items-start justify-between gap-atlas-3">
          <div className="min-w-0">
            <h2 id="challan-void-confirmation-title" className="text-atlas-lg font-atlas-semibold text-atlas-text">{title}</h2>
            <p id="challan-void-confirmation-description" className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">
              Challan stays in history but won’t count as an active sale.
            </p>
          </div>
          <Button variant="ghost" aria-label="Close confirmation" disabled={isVoiding} onClick={onCancel}><span aria-hidden="true">×</span></Button>
        </div>
        <div className="mt-atlas-5 flex flex-col gap-atlas-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={isVoiding} onClick={onCancel}>{ATLAS_UI_STRINGS.actions.cancel}</Button>
          <Button
            ref={confirmButtonRef}
            variant="danger"
            loading={isVoiding}
            loadingLabel="Voiding..."
            onClick={onConfirm}
          >
            Void
          </Button>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status, isLocked }: Readonly<{ status: ChallanHeader["status"]; isLocked: boolean }>) {
  const lifecycleStatus = resolveStatusPresentation(CHALLAN_STATUS, status);
  const financialLockStatus = isLocked
    ? resolveBooleanStatusPresentation(CHALLAN_FINANCIAL_LOCK_STATUS, true)
    : null;

  return (
    <span className="flex flex-wrap gap-atlas-1 sm:justify-end">
      <StatusPill label={lifecycleStatus.label} tone={lifecycleStatus.tone} />
      {financialLockStatus && <StatusPill label={financialLockStatus.label} tone={financialLockStatus.tone} />}
    </span>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return <label className="block text-xs font-medium text-slate-600">{label}{children}</label>;
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>;
}

function SnapshotValue({
  label,
  value,
  numeric = false,
  emphasize = false,
}: Readonly<{
  label: string;
  value: string;
  numeric?: boolean;
  emphasize?: boolean;
}>) {
  return <div>
    <dt className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">{label}</dt>
    <dd className={`mt-atlas-1 text-atlas-sm ${emphasize ? "font-atlas-semibold text-atlas-primary" : "font-atlas-medium text-atlas-text"} ${numeric ? "tabular-nums" : ""}`}>{value}</dd>
  </div>;
}

function LoadingCard({ label }: Readonly<{ label: string }>) {
  return <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">{label}</div>;
}

function ErrorCard({ message }: Readonly<{ message: string }>) {
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center text-sm font-semibold text-red-700">{message}</div>;
}

function EmptyWorkspace({ onCreate }: Readonly<{ onCreate: () => void }>) {
  return (
    <EmptyState
      title="No Challan selected"
      description="Select a Challan from history or create a new one."
    >
      <Button onClick={onCreate}>Create Challan</Button>
    </EmptyState>
  );
}
