"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildVehicleMaintenanceBatchPaymentInput,
  buildCreateVehicleMaintenanceInput,
  buildUpdateVehicleMaintenanceInput,
  canChangeVehicleMaintenance,
  emptyVehicleMaintenanceBatchPaymentForm,
  emptyVehicleMaintenanceForm,
  filterVehicleMaintenanceRecords,
  filterVehicleMaintenanceBatchPayments,
  getVehicleMaintenancePeriodOutstanding,
  summarizeVehicleMaintenance,
  vehicleMaintenanceFormFromSaved,
  type VehicleMaintenanceBatchPaymentForm,
  type VehicleMaintenanceForm,
  type VehicleMaintenanceStateFilter,
} from "../../vehicle-maintenance/vehicle-maintenance-model";
import {
  createVehicleMaintenanceBatchPayment,
  createVehicleMaintenance,
  listVehicleMaintenanceBatchPayments,
  listVehicleMaintenanceRecords,
  updateVehicleMaintenance,
  voidVehicleMaintenance,
} from "../../vehicle-maintenance/services/vehicle-maintenance-service";
import type {
  VehicleMaintenanceBatchPayment,
  VehicleMaintenanceRecord,
} from "../../vehicle-maintenance/types";
import {
  createOrAssignSupplierRole,
  listSuppliersByRole,
} from "../../expenses/services/supplier-role-service";
import type { Supplier } from "../../expenses/types";
import { listVehicles } from "../../sales/services/vehicle-service";
import { formatCustomerPaymentMode, NEW_CUSTOMER_PAYMENT_MODES } from "../../sales/types";
import { formatSalesMoney } from "../sales-office-model";
import { getLocalDate } from "../../../lib/local-date";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { EmptyState, Feedback } from "../../../components/ui/feedback";
import { FormField } from "../../../components/ui/form-field";
import { Input, Select, Textarea } from "../../../components/ui/form-controls";
import { StatusPill } from "../../../components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "../../../components/ui/table";
import { formatDateOnly, formatIndianCurrency, formatIndianNumber } from "../../../lib/formatting";
import {
  resolveStatusPresentation,
  VEHICLE_MAINTENANCE_PAYMENT_STATUS,
  VEHICLE_MAINTENANCE_STATUS,
} from "../../../lib/statuses";
import { ATLAS_UI_STRINGS } from "../../../lib/strings";
import {
  getOfficeVehicleMaintenanceHash,
  getOfficeVehicleMaintenanceArchiveHash,
  getOfficeGaragePaymentsArchiveHash,
  resolveOfficeVehicleMaintenanceAreaFromHash,
  type OfficeVehicleMaintenanceAreaId,
} from "../office-navigation";
import { SearchChoice } from "./search-choice";
import { VehicleMaintenancePaymentDetailDrawer } from "./vehicle-maintenance-payment-detail-drawer";
import { VehicleMaintenanceOfficeWorkspace } from "./vehicle-maintenance-office-workspace";

const suppliersKey = (factoryId: string) => ["office-suppliers-by-role", factoryId, "GARAGE"] as const;
const vehiclesKey = (factoryId: string) => ["office-sales-vehicles", factoryId] as const;
const recordsKey = (factoryId: string) => ["office-vehicle-maintenance-records", factoryId] as const;
const paymentsKey = (factoryId: string) => ["office-vehicle-maintenance-payments", factoryId] as const;

export function VehicleMaintenanceOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [activeArea, setActiveArea] = useState<OfficeVehicleMaintenanceAreaId>("maintenance");
  const [showMaintenanceArchive, setShowMaintenanceArchive] = useState(false);
  const [showPaymentArchive, setShowPaymentArchive] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFromDate, setArchiveFromDate] = useState("");
  const [archiveToDate, setArchiveToDate] = useState("");
  const [archiveVehicleId, setArchiveVehicleId] = useState("");
  const [archiveGarageId, setArchiveGarageId] = useState("");
  const [archiveState, setArchiveState] = useState<VehicleMaintenanceStateFilter>("all");
  const [paymentArchiveSearch, setPaymentArchiveSearch] = useState("");
  const [paymentArchiveFromDate, setPaymentArchiveFromDate] = useState("");
  const [paymentArchiveToDate, setPaymentArchiveToDate] = useState("");
  const [paymentArchiveGarageId, setPaymentArchiveGarageId] = useState("");
  const [paymentArchiveVehicleId, setPaymentArchiveVehicleId] = useState("");
  const [paymentArchiveMode, setPaymentArchiveMode] = useState<VehicleMaintenanceBatchPayment["paymentMode"] | "">("");
  const [paymentDetailId, setPaymentDetailId] = useState("");
  const [form, setForm] = useState<VehicleMaintenanceForm>(() => emptyVehicleMaintenanceForm(localToday));
  const [paymentForm, setPaymentForm] = useState<VehicleMaintenanceBatchPaymentForm>(() => emptyVehicleMaintenanceBatchPaymentForm(localToday));
  const [editingId, setEditingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showGarageDraft, setShowGarageDraft] = useState(false);
  const [garageDraft, setGarageDraft] = useState({ name: "", address: "", mobile: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isSavingGarage, setIsSavingGarage] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const suppliersQuery = useQuery({ queryKey: suppliersKey(factoryId), queryFn: () => listSuppliersByRole(factoryId, "GARAGE") });
  const vehiclesQuery = useQuery({ queryKey: vehiclesKey(factoryId), queryFn: () => listVehicles(factoryId, true) });
  const recordsQuery = useQuery({ queryKey: recordsKey(factoryId), queryFn: () => listVehicleMaintenanceRecords(factoryId) });
  const paymentsQuery = useQuery({ queryKey: paymentsKey(factoryId), queryFn: () => listVehicleMaintenanceBatchPayments(factoryId) });
  const suppliers = suppliersQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const recentRecords = records.slice(0, 8);
  const recentPayments = payments.slice(0, 8);
  const archiveRecords = filterVehicleMaintenanceRecords(
    records,
    archiveFromDate,
    archiveToDate,
    archiveVehicleId,
    archiveGarageId,
    archiveState,
    archiveSearch,
  );
  const archiveSummary = summarizeVehicleMaintenance(archiveRecords);
  const archivePayments = filterVehicleMaintenanceBatchPayments(
    payments,
    paymentArchiveFromDate,
    paymentArchiveToDate,
    paymentArchiveGarageId,
    paymentArchiveVehicleId,
    paymentArchiveMode,
    paymentArchiveSearch,
  );
  const paymentDetail = payments.find((payment) => payment.id === paymentDetailId) ?? null;
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const entryVehicles = vehicles.filter((vehicle) => vehicle.isActive || vehicle.id === form.vehicleId);
  const selectedGarageSummary = summarizeVehicleMaintenance(
    records.filter((record) => record.garageId === paymentForm.garageId),
  );
  const periodOutstanding = getVehicleMaintenancePeriodOutstanding(
    records, paymentForm.garageId, paymentForm.fromDate, paymentForm.toDate,
  );
  const initialDue = Math.max(0, (Number(form.totalAmount) || 0) - (Number(form.initialPaidAmount) || 0));
  const queryError = suppliersQuery.error || vehiclesQuery.error || recordsQuery.error || paymentsQuery.error;

  useEffect(() => {
    function syncVehicleMaintenanceAreaFromHash() {
      const area = resolveOfficeVehicleMaintenanceAreaFromHash(window.location.hash);
      if (area) setActiveArea(area);
      setShowMaintenanceArchive(window.location.hash === getOfficeVehicleMaintenanceArchiveHash());
      const isPaymentArchive = window.location.hash === getOfficeGaragePaymentsArchiveHash();
      setShowPaymentArchive(isPaymentArchive);
      if (!isPaymentArchive) setPaymentDetailId("");
    }

    syncVehicleMaintenanceAreaFromHash();
    window.addEventListener("hashchange", syncVehicleMaintenanceAreaFromHash);
    return () => window.removeEventListener("hashchange", syncVehicleMaintenanceAreaFromHash);
  }, []);

  function selectVehicleMaintenanceArea(area: OfficeVehicleMaintenanceAreaId) {
    setActiveArea(area);
    setShowMaintenanceArchive(false);
    setShowPaymentArchive(false);
    setPaymentDetailId("");
    window.location.hash = getOfficeVehicleMaintenanceHash(area);
  }

  function openMaintenanceArchive() {
    setActiveArea("maintenance");
    setShowMaintenanceArchive(true);
    window.location.hash = getOfficeVehicleMaintenanceArchiveHash();
  }

  function closeMaintenanceArchive() {
    setShowMaintenanceArchive(false);
    window.location.hash = getOfficeVehicleMaintenanceHash("maintenance");
  }

  function openPaymentArchive() {
    setActiveArea("garage-payments");
    setShowMaintenanceArchive(false);
    setShowPaymentArchive(true);
    setPaymentDetailId("");
    window.location.hash = getOfficeGaragePaymentsArchiveHash();
  }

  function closePaymentArchive() {
    setShowPaymentArchive(false);
    setPaymentDetailId("");
    window.location.hash = getOfficeVehicleMaintenanceHash("garage-payments");
  }

  function canOpenMaintenanceFromPayment(maintenanceId: string) {
    return records.some((record) => record.id === maintenanceId);
  }

  function openMaintenanceFromPayment(maintenanceId: string) {
    if (!canOpenMaintenanceFromPayment(maintenanceId)) return;
    setPaymentDetailId("");
    setSelectedId(maintenanceId);
    setActiveArea("maintenance");
    setShowMaintenanceArchive(false);
    setShowPaymentArchive(false);
    setConfirmingVoid(false);
    window.location.hash = getOfficeVehicleMaintenanceHash("maintenance");
  }

  function openCreate() {
    setForm(emptyVehicleMaintenanceForm(localToday));
    setEditingId("");
    setError("");
    setSuccess("");
  }

  function openEdit(record: VehicleMaintenanceRecord) {
    if (!canChangeVehicleMaintenance(record)) return;
    setForm(vehicleMaintenanceFormFromSaved(record));
    setEditingId(record.id);
    if (showMaintenanceArchive) closeMaintenanceArchive();
    setError("");
    setSuccess("");
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      let saved: VehicleMaintenanceRecord;
      if (editingId) {
        const input = buildUpdateVehicleMaintenanceInput(factoryId, editingId, form);
        if (!input) throw new Error("Complete Vehicle, Date, Work / Repair, Garage, and a valid Amount.");
        saved = await updateVehicleMaintenance(input);
      } else {
        const input = buildCreateVehicleMaintenanceInput(factoryId, form);
        if (!input) throw new Error("Complete Vehicle, Date, Work / Repair, Garage, Amount, and valid payment details.");
        saved = await createVehicleMaintenance(input);
      }
      queryClient.setQueryData<VehicleMaintenanceRecord[]>(recordsKey(factoryId), (current = []) =>
        [saved, ...current.filter((record) => record.id !== saved.id)]);
      setSelectedId(saved.id);
      setEditingId("");
      setForm(emptyVehicleMaintenanceForm(localToday));
      await invalidateFinance();
      setSuccess(`Maintenance saved. Total ${formatSalesMoney(saved.totalAmount)}; Outstanding ${formatSalesMoney(saved.outstandingAmount)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Vehicle Maintenance.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveGarage() {
    if (isSavingGarage || !garageDraft.name.trim()) return;
    setIsSavingGarage(true);
    setError("");
    try {
      const garage = await createOrAssignSupplierRole({
        factoryId, role: "GARAGE", ...garageDraft,
      });
      queryClient.setQueryData<Supplier[]>(suppliersKey(factoryId), (current = []) =>
        [...current.filter((supplier) => supplier.id !== garage.id), garage]
          .sort((a, b) => a.name.localeCompare(b.name)));
      setForm((current) => ({ ...current, garageId: garage.id }));
      setGarageDraft({ name: "", address: "", mobile: "" });
      setShowGarageDraft(false);
      await queryClient.invalidateQueries({ queryKey: suppliersKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: ["office-expense-suppliers", factoryId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Garage.");
    } finally {
      setIsSavingGarage(false);
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPayment) return;
    const input = buildVehicleMaintenanceBatchPaymentInput(factoryId, paymentForm, records);
    if (!input) {
      setError("Choose a Garage, valid inclusive range, positive amount within Period Outstanding, payment date, and mode.");
      return;
    }
    setIsSavingPayment(true);
    setError("");
    try {
      await createVehicleMaintenanceBatchPayment(input);
      setPaymentForm(emptyVehicleMaintenanceBatchPaymentForm(localToday));
      await invalidateFinance();
      setSuccess("Garage payment saved and allocated oldest-first with one Cash Book Money Out.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Garage payment.");
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function confirmVoidRecord() {
    if (!selected || !canChangeVehicleMaintenance(selected)) return;
    setIsSaving(true);
    setError("");
    try {
      const saved = await voidVehicleMaintenance(factoryId, selected.id);
      queryClient.setQueryData<VehicleMaintenanceRecord[]>(recordsKey(factoryId), (current = []) =>
        current.map((record) => record.id === saved.id ? saved : record));
      setConfirmingVoid(false);
      await invalidateFinance();
      setSuccess("Unpaid Vehicle Maintenance record voided.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not void Vehicle Maintenance.");
    } finally {
      setIsSaving(false);
    }
  }

  async function invalidateFinance() {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: recordsKey(factoryId) }),
      queryClient.invalidateQueries({ queryKey: paymentsKey(factoryId) }),
      queryClient.invalidateQueries({ queryKey: ["office-expense-records", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-expense-payments", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] }),
    ]);
  }

  return <VehicleMaintenanceOfficeWorkspace activeArea={activeArea} onAreaChange={selectVehicleMaintenanceArea}>
  <section aria-labelledby="vehicle-maintenance-heading">

    {activeArea === "maintenance" && !showMaintenanceArchive && <>
      <div>
        <h2 id="vehicle-maintenance-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Vehicle Maintenance</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record maintenance jobs and review recent vehicle work.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Vehicle Maintenance data.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card as="section" aria-labelledby="new-vehicle-maintenance-heading">
            <form onSubmit={saveRecord}>
              <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="new-vehicle-maintenance-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{editingId ? "Correct Vehicle Maintenance" : "New Vehicle Maintenance"}</h3>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Record the vehicle, garage, repair work, and real cost.</p>
                </div>
                {editingId && <Button type="button" variant="ghost" onClick={openCreate}>Cancel correction</Button>}
              </div>

              <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
                <SearchChoice v2 label="Vehicle" options={entryVehicles.map((vehicle) => ({ id: vehicle.id, label: `${vehicle.vehicleNumber}${vehicle.isActive ? "" : " · Archived"}` }))} selectedId={form.vehicleId} onSelect={(vehicleId) => setForm({ ...form, vehicleId })} placeholder="Search Vehicle" />
                <FormField label="Business date"><Input type="date" required value={form.maintenanceDate} onChange={(event) => setForm({ ...form, maintenanceDate: event.target.value })} /></FormField>
              </div>

              <div className="mt-atlas-3">
                <SearchChoice v2 label="Garage / mechanic" options={suppliers.map((garage) => ({ id: garage.id, label: garage.name }))} selectedId={form.garageId} onSelect={(garageId) => setForm({ ...form, garageId })} placeholder="Search Garage" />
                <div className="mt-atlas-2"><Button type="button" variant="secondary" onClick={() => setShowGarageDraft((current) => !current)}>Add Garage</Button></div>
              </div>

              {showGarageDraft && <fieldset className="mt-atlas-3 rounded-atlas-card border border-atlas-border bg-atlas-surface-muted p-atlas-3">
                <legend className="px-atlas-1 text-atlas-sm font-atlas-semibold text-atlas-text">Add reusable Garage / mechanic</legend>
                <div className="grid gap-atlas-3 sm:grid-cols-3">
                  <FormField label="Name"><Input value={garageDraft.name} onChange={(event) => setGarageDraft({ ...garageDraft, name: event.target.value })} /></FormField>
                  <FormField label="Address (optional)"><Input value={garageDraft.address} onChange={(event) => setGarageDraft({ ...garageDraft, address: event.target.value })} /></FormField>
                  <FormField label="Mobile (optional)"><Input inputMode="tel" value={garageDraft.mobile} onChange={(event) => setGarageDraft({ ...garageDraft, mobile: event.target.value })} /></FormField>
                </div>
                <div className="mt-atlas-3"><Button type="button" loading={isSavingGarage} loadingLabel={ATLAS_UI_STRINGS.feedback.saving} onClick={() => void saveGarage()}>Save Garage</Button></div>
              </fieldset>}

              <div className="mt-atlas-3">
                <FormField label="Work / repair"><Textarea required value={form.workDescription} onChange={(event) => setForm({ ...form, workDescription: event.target.value })} maxLength={300} rows={3} placeholder="Rear tyre replacement and brake inspection" /></FormField>
              </div>

              <div className="mt-atlas-4"><Card surface="muted">
                <div className="grid gap-atlas-3 sm:grid-cols-2">
                  <FormField label="Maintenance amount"><Input inputMode="decimal" required value={form.totalAmount} onChange={(event) => setForm({ ...form, totalAmount: event.target.value })} placeholder="0" /></FormField>
                  {!editingId && <FormField label="Paid now (blank or 0 = unpaid)"><Input inputMode="decimal" value={form.initialPaidAmount} onChange={(event) => setForm({ ...form, initialPaidAmount: event.target.value })} placeholder="0" /></FormField>}
                  {!editingId && Number(form.initialPaidAmount) > 0 && <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select value={form.initialPaymentMode} onChange={(event) => setForm({ ...form, initialPaymentMode: event.target.value })}><option value="">{ATLAS_UI_STRINGS.payment.selectMode}</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>}
                </div>
                <div className="mt-atlas-3 border-t border-atlas-border pt-atlas-3">
                  <MaintenanceTotal label="Amount due" value={initialDue} emphasized />
                </div>
              </Card></div>

              <div className="mt-atlas-5 flex flex-wrap items-center gap-atlas-2">
                <Button type="submit" loading={isSaving} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{editingId ? "Save correction" : "Save Maintenance"}</Button>
                <Button type="button" variant="ghost" onClick={openCreate}>{editingId ? ATLAS_UI_STRINGS.actions.cancel : ATLAS_UI_STRINGS.actions.clear}</Button>
              </div>
            </form>
          </Card>
        </div>

        <Card as="section" aria-labelledby="recent-maintenance-heading">
          <div className="flex h-96 flex-col">
            <div className="border-b border-atlas-border pb-atlas-3">
              <h3 id="recent-maintenance-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Maintenance</h3>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Latest 8 saved vehicle jobs</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {recordsQuery.isLoading ? <EmptyState title="Loading maintenance..." /> : recentRecords.length === 0 ? <EmptyState title="No Vehicle Maintenance saved yet." /> : <ul className="divide-y divide-atlas-border">{recentRecords.map((record) => <li key={record.id} className="py-atlas-3">
                <div className="flex items-start justify-between gap-atlas-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-atlas-2"><p className="truncate text-atlas-sm font-atlas-semibold text-atlas-text">{record.vehicleNumberSnapshot}</p><MaintenanceStatus record={record} /></div>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(record.maintenanceDate)} · {record.garageNameSnapshot}</p>
                    <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-muted">{record.workDescription}</p>
                    <p className="mt-atlas-1 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(record.totalAmount)}</p>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => { setSelectedId(record.id); setConfirmingVoid(false); }}>{ATLAS_UI_STRINGS.actions.open} →</Button>
                </div>
              </li>)}</ul>}
            </div>
            <div className="border-t border-atlas-border pt-atlas-3">
              <Button type="button" variant="ghost" onClick={openMaintenanceArchive}>View all maintenance →</Button>
            </div>
          </div>
        </Card>
      </div>
    </>}

    {activeArea === "maintenance" && showMaintenanceArchive && <>
      <div>
        <Button type="button" variant="ghost" onClick={closeMaintenanceArchive}>← Back to Maintenance</Button>
        <h2 id="vehicle-maintenance-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Maintenance</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review the authoritative Vehicle Maintenance history.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Vehicle Maintenance history.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4"><Card as="section" aria-labelledby="maintenance-archive-filters-heading">
        <h3 id="maintenance-archive-filters-heading" className="sr-only">Maintenance archive filters</h3>
        <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-6">
          <FormField label="Search Maintenance"><Input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="Vehicle, Garage or work / repair" /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" value={archiveFromDate} onChange={(event) => setArchiveFromDate(event.target.value)} /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" value={archiveToDate} onChange={(event) => setArchiveToDate(event.target.value)} /></FormField>
          <FormField label="Vehicle"><Select value={archiveVehicleId} onChange={(event) => setArchiveVehicleId(event.target.value)}><option value="">All Vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}{vehicle.isActive ? "" : " · Archived"}</option>)}</Select></FormField>
          <FormField label="Garage"><Select value={archiveGarageId} onChange={(event) => setArchiveGarageId(event.target.value)}><option value="">All Garages</option>{suppliers.map((garage) => <option key={garage.id} value={garage.id}>{garage.name}</option>)}</Select></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.status}><Select value={archiveState} onChange={(event) => setArchiveState(event.target.value as VehicleMaintenanceStateFilter)}><option value="all">All States</option><option value="unpaid">{resolveStatusPresentation(VEHICLE_MAINTENANCE_PAYMENT_STATUS, "unpaid").label}</option><option value="partially_paid">{resolveStatusPresentation(VEHICLE_MAINTENANCE_PAYMENT_STATUS, "partially_paid").label}</option><option value="paid">{resolveStatusPresentation(VEHICLE_MAINTENANCE_PAYMENT_STATUS, "paid").label}</option><option value="void">{resolveStatusPresentation(VEHICLE_MAINTENANCE_STATUS, "void").label}</option></Select></FormField>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><Card as="section" surface="muted" aria-label="Filtered Maintenance totals">
        <div className="grid grid-cols-2 gap-atlas-3 lg:grid-cols-4">
          <MaintenanceTotal label="Work billed" value={archiveSummary.totalBilled} />
          <MaintenanceTotal label="Paid" value={archiveSummary.totalPaid} />
          <MaintenanceTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={archiveSummary.totalOutstanding} emphasized />
          <div>
            <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">Active jobs</p>
            <p className="mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(archiveSummary.activeJobs)}</p>
          </div>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><TableContainer bounded aria-label="All Maintenance table">
        <Table wide>
          <TableCaption visuallyHidden>All Maintenance records matching the selected filters</TableCaption>
          <TableHeader sticky>
            <TableRow>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
              <TableHeaderCell>Vehicle</TableHeaderCell>
              <TableHeaderCell>Garage</TableHeaderCell>
              <TableHeaderCell>Work / repair</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              <TableHeaderCell numeric>Paid</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.payment.due}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.status}</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archiveRecords.map((record) => <TableRow key={record.id} hoverable selected={selectedId === record.id}>
              <TableCell>{formatDateOnly(record.maintenanceDate)}</TableCell>
              <TableCell><span className="font-atlas-semibold">{record.vehicleNumberSnapshot}</span></TableCell>
              <TableCell>{record.garageNameSnapshot}</TableCell>
              <TableCell><span className="block max-w-sm truncate">{record.workDescription}</span></TableCell>
              <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(record.totalAmount)}</span></TableCell>
              <TableCell numeric>{formatIndianCurrency(record.totalPaid)}</TableCell>
              <TableCell numeric>{formatIndianCurrency(record.outstandingAmount)}</TableCell>
              <TableCell><MaintenanceStatus record={record} /></TableCell>
              <TableCell><Button type="button" variant="ghost" onClick={() => { setSelectedId(record.id); setConfirmingVoid(false); }}>{ATLAS_UI_STRINGS.actions.open} →</Button></TableCell>
            </TableRow>)}
            {!recordsQuery.isLoading && archiveRecords.length === 0 && <TableRow><TableCell colSpan={9}>No Maintenance records match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer></div>
      {recordsQuery.isLoading && <EmptyState title="Loading Vehicle Maintenance history..." />}
    </>}

    {activeArea === "maintenance" && selected && <div className="mt-atlas-4"><Card as="section" aria-labelledby="selected-maintenance-heading">
      <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-atlas-2"><h3 id="selected-maintenance-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{selected.vehicleNumberSnapshot} · {selected.workDescription}</h3><MaintenanceStatus record={selected} /></div>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{formatDateOnly(selected.maintenanceDate)} · {selected.garageNameSnapshot}</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setSelectedId("")}>{ATLAS_UI_STRINGS.actions.close}</Button>
      </div>
      <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-3">
        <MaintenanceTotal label="Total" value={selected.totalAmount} />
        <MaintenanceTotal label="Paid" value={selected.totalPaid} />
        <MaintenanceTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={selected.outstandingAmount} emphasized />
      </div>
      <div className="mt-atlas-4 flex flex-wrap gap-atlas-2">
        <Button type="button" variant="secondary" disabled={!canChangeVehicleMaintenance(selected)} onClick={() => openEdit(selected)}>Correct</Button>
        <Button type="button" variant="secondary" disabled={!canChangeVehicleMaintenance(selected)} onClick={() => setConfirmingVoid(true)}>Void</Button>
        <Button type="button" disabled={selected.status !== "active" || selected.outstandingAmount <= 0} onClick={() => { const next = emptyVehicleMaintenanceBatchPaymentForm(localToday); setPaymentForm({ ...next, garageId: selected.garageId, fromDate: selected.maintenanceDate, toDate: selected.maintenanceDate }); selectVehicleMaintenanceArea("garage-payments"); }}>Pay Garage</Button>
      </div>
      {!canChangeVehicleMaintenance(selected) && selected.totalPaid > 0 && <p className="mt-atlas-3 text-atlas-xs text-atlas-text-muted">Payment history locks this Maintenance job from correction or voiding.</p>}
      {confirmingVoid && <div className="mt-atlas-3"><Feedback role="alert" tone="danger"><p>Void this unpaid Vehicle Maintenance record?</p><div className="mt-atlas-2 flex flex-wrap gap-atlas-2"><Button type="button" variant="danger" loading={isSaving} loadingLabel="Voiding..." onClick={() => void confirmVoidRecord()}>Confirm Void</Button><Button type="button" variant="ghost" onClick={() => setConfirmingVoid(false)}>{ATLAS_UI_STRINGS.actions.cancel}</Button></div></Feedback></div>}
    </Card></div>}

    {activeArea === "garage-payments" && !showPaymentArchive && <>
      <div>
        <h2 id="vehicle-maintenance-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Garage Payments</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record one Garage payment against genuine outstanding Maintenance.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Vehicle Maintenance data.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
        <form onSubmit={savePayment} className="space-y-atlas-4 lg:col-span-2">
          <Card as="section" aria-labelledby="garage-summary-heading">
            <h3 id="garage-summary-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Garage summary</h3>
            <div className="mt-atlas-3 max-w-sm">
              <SearchChoice v2 label="Garage" options={suppliers.map((garage) => ({ id: garage.id, label: garage.name }))} selectedId={paymentForm.garageId} onSelect={(garageId) => setPaymentForm({ ...paymentForm, garageId })} placeholder="Search Garage" />
            </div>
            {paymentForm.garageId ? <div className="mt-atlas-4"><Card surface="muted"><div className="grid gap-atlas-3 sm:grid-cols-3">
              <MaintenanceTotal label="Work billed" value={selectedGarageSummary.totalBilled} />
              <MaintenanceTotal label="Paid" value={selectedGarageSummary.totalPaid} />
              <MaintenanceTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={selectedGarageSummary.totalOutstanding} emphasized />
            </div></Card></div> : <div className="mt-atlas-4"><EmptyState title="Choose a Garage to see its Maintenance totals." /></div>}
          </Card>

          <Card as="section" aria-labelledby="garage-payment-details-heading">
            <h3 id="garage-payment-details-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Payment details</h3>
            <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Atlas applies this payment to eligible Maintenance jobs oldest-first.</p>
            <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-3">
              <FormField label={ATLAS_UI_STRINGS.payment.date}><Input type="date" required value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></FormField>
              <FormField label={ATLAS_UI_STRINGS.payment.amount}><Input inputMode="decimal" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} placeholder="0" /></FormField>
              <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select required value={paymentForm.paymentMode} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMode: event.target.value })}><option value="">{ATLAS_UI_STRINGS.payment.selectMode}</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
            </div>
            <div className="mt-atlas-3"><FormField label="Note / reference (optional)"><Input value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} maxLength={500} placeholder="Transaction reference or note" /></FormField></div>
          </Card>

          <Card as="section" aria-labelledby="outstanding-maintenance-heading">
            <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="outstanding-maintenance-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Outstanding Maintenance</h3>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Eligible jobs are shown in the same oldest-first order used by the backend.</p>
              </div>
              <p className="text-atlas-xs font-atlas-medium text-atlas-primary">Automatic oldest-first allocation</p>
            </div>
            <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
              <FormField label="Settlement from"><Input type="date" required value={paymentForm.fromDate} onChange={(event) => setPaymentForm({ ...paymentForm, fromDate: event.target.value })} /></FormField>
              <FormField label="Settlement to"><Input type="date" required value={paymentForm.toDate} onChange={(event) => setPaymentForm({ ...paymentForm, toDate: event.target.value })} /></FormField>
            </div>
            <div className="mt-atlas-4"><Card surface="muted"><div className="grid gap-atlas-3 sm:grid-cols-3">
              <MaintenanceTotal label={`Period ${ATLAS_UI_STRINGS.payment.outstanding}`} value={periodOutstanding.outstandingAmount} emphasized />
              <div>
                <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">Eligible jobs</p>
                <p className="mt-atlas-1 text-atlas-base font-atlas-semibold tabular-nums text-atlas-text">{periodOutstanding.eligibleCount}</p>
              </div>
              <MaintenanceTotal label="Payment entered" value={Number(paymentForm.amount) || 0} />
            </div></Card></div>
            <div className="mt-atlas-4 max-h-72 overflow-y-auto border-y border-atlas-border">
              {recordsQuery.isLoading ? <EmptyState title="Loading outstanding Maintenance..." /> : periodOutstanding.eligibleRecords.length === 0 ? <EmptyState title={paymentForm.garageId ? "No outstanding Maintenance in this settlement range." : "Choose a Garage to see eligible Maintenance."} /> : <ol className="divide-y divide-atlas-border">{periodOutstanding.eligibleRecords.map((record, index) => <li key={record.id} className="flex items-start justify-between gap-atlas-3 py-atlas-3">
                <div className="min-w-0">
                  <p className="text-atlas-sm font-atlas-semibold text-atlas-text">{index + 1}. {record.vehicleNumberSnapshot}</p>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(record.maintenanceDate)} · {record.workDescription}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-atlas-xs text-atlas-text-muted">{ATLAS_UI_STRINGS.payment.outstanding}</p>
                  <p className="mt-atlas-1 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-primary">{formatIndianCurrency(record.outstandingAmount)}</p>
                </div>
              </li>)}</ol>}
            </div>
            <div className="mt-atlas-4 flex flex-col gap-atlas-3 border-t border-atlas-border pt-atlas-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-atlas-xs text-atlas-text-muted">The saved payment is immutable and creates one Cash Book Money Out.</p>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">The backend rechecks eligibility and outstanding amounts before saving.</p>
              </div>
              <Button type="submit" loading={isSavingPayment} loadingLabel="Saving..." disabled={periodOutstanding.eligibleCount === 0}>Save Garage Payment</Button>
            </div>
          </Card>
        </form>

        <Card as="section" aria-labelledby="recent-garage-payments-heading">
          <div className="flex h-96 flex-col">
            <div className="border-b border-atlas-border pb-atlas-3">
              <h3 id="recent-garage-payments-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Garage Payments</h3>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Latest 8 immutable payments</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {paymentsQuery.isLoading ? <EmptyState title="Loading Garage payments..." /> : recentPayments.length === 0 ? <EmptyState title="No Garage payments saved yet." /> : <ul className="divide-y divide-atlas-border">{recentPayments.map((payment) => <li key={payment.id} className="py-atlas-3">
                <div className="flex items-start justify-between gap-atlas-2">
                  <div className="min-w-0">
                    <p className="truncate text-atlas-sm font-atlas-semibold text-atlas-text">{payment.garageNameSnapshot}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{payment.allocationCount} {payment.allocationCount === 1 ? "job" : "jobs"} allocated{payment.note ? ` · ${payment.note}` : ""}</p>
                  </div>
                  <p className="shrink-0 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(payment.amount)}</p>
                </div>
                <ul className="mt-atlas-2 space-y-atlas-1 border-t border-atlas-border pt-atlas-2">{payment.allocations.map((allocation) => <li key={allocation.maintenanceId} className="flex items-start justify-between gap-atlas-2 text-atlas-xs text-atlas-text-muted"><span className="min-w-0 truncate">{allocation.vehicleNumberSnapshot} · {formatDateOnly(allocation.maintenanceDate)}</span><span className="shrink-0 tabular-nums">{formatIndianCurrency(allocation.allocatedAmount)}</span></li>)}</ul>
              </li>)}</ul>}
            </div>
            <div className="border-t border-atlas-border pt-atlas-3">
              <Button type="button" variant="ghost" onClick={openPaymentArchive}>View all payments →</Button>
            </div>
          </div>
        </Card>
      </div>
    </>}

    {activeArea === "garage-payments" && showPaymentArchive && <>
      <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button type="button" variant="ghost" onClick={closePaymentArchive}>← Back to Garage Payments</Button>
          <h2 id="vehicle-maintenance-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Garage Payments</h2>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review the authoritative grouped Garage Payment history.</p>
        </div>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Garage Payment history.</Feedback>}
      </div>

      <div className="mt-atlas-4"><Card as="section" aria-labelledby="garage-payment-archive-filters-heading">
        <h3 id="garage-payment-archive-filters-heading" className="sr-only">Garage Payment archive filters</h3>
        <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-6">
          <FormField label="Search payments"><Input value={paymentArchiveSearch} onChange={(event) => setPaymentArchiveSearch(event.target.value)} placeholder="Garage, note, vehicle or repair" /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" value={paymentArchiveFromDate} onChange={(event) => setPaymentArchiveFromDate(event.target.value)} /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" value={paymentArchiveToDate} onChange={(event) => setPaymentArchiveToDate(event.target.value)} /></FormField>
          <FormField label="Garage"><Select value={paymentArchiveGarageId} onChange={(event) => setPaymentArchiveGarageId(event.target.value)}><option value="">All Garages</option>{suppliers.map((garage) => <option key={garage.id} value={garage.id}>{garage.name}</option>)}</Select></FormField>
          <FormField label="Vehicle"><Select value={paymentArchiveVehicleId} onChange={(event) => setPaymentArchiveVehicleId(event.target.value)}><option value="">All Vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}{vehicle.isActive ? "" : " · Archived"}</option>)}</Select></FormField>
          <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select value={paymentArchiveMode} onChange={(event) => setPaymentArchiveMode(event.target.value as VehicleMaintenanceBatchPayment["paymentMode"] | "")}><option value="">All Modes</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><TableContainer bounded aria-label="All Garage Payments table">
        <Table wide>
          <TableCaption visuallyHidden>All Garage Payments matching the selected filters</TableCaption>
          <TableHeader sticky>
            <TableRow>
              <TableHeaderCell>{ATLAS_UI_STRINGS.payment.date}</TableHeaderCell>
              <TableHeaderCell>Garage</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.payment.mode}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.note}</TableHeaderCell>
              <TableHeaderCell numeric>Maintenance jobs</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archivePayments.map((payment) => <TableRow key={payment.id} hoverable selected={paymentDetailId === payment.id}>
              <TableCell>{formatDateOnly(payment.paymentDate)}</TableCell>
              <TableCell><span className="font-atlas-semibold">{payment.garageNameSnapshot}</span></TableCell>
              <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(payment.amount)}</span></TableCell>
              <TableCell>{formatCustomerPaymentMode(payment.paymentMode)}</TableCell>
              <TableCell><span className="block max-w-sm truncate">{payment.note || "—"}</span></TableCell>
              <TableCell numeric>{formatIndianNumber(payment.allocationCount)}</TableCell>
              <TableCell><Button type="button" variant="ghost" onClick={() => setPaymentDetailId(payment.id)}>Open payment →</Button></TableCell>
            </TableRow>)}
            {!paymentsQuery.isLoading && archivePayments.length === 0 && <TableRow><TableCell colSpan={7}>No Garage Payments match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer></div>
      {paymentsQuery.isLoading && <EmptyState title="Loading Garage Payment history..." />}
    </>}

    {paymentDetail && <VehicleMaintenancePaymentDetailDrawer
      payment={paymentDetail}
      onClose={() => setPaymentDetailId("")}
      canOpenMaintenance={canOpenMaintenanceFromPayment}
      onOpenMaintenance={openMaintenanceFromPayment}
    />}
  </section>
  </VehicleMaintenanceOfficeWorkspace>;
}

function MaintenanceStatus({ record }: Readonly<{ record: VehicleMaintenanceRecord }>) {
  const presentation = record.status === "void"
    ? resolveStatusPresentation(VEHICLE_MAINTENANCE_STATUS, record.status)
    : resolveStatusPresentation(VEHICLE_MAINTENANCE_PAYMENT_STATUS, record.paymentState);
  return <StatusPill label={presentation.label} tone={presentation.tone} />;
}

function MaintenanceTotal({
  label,
  value,
  emphasized = false,
}: Readonly<{ label: string; value: number; emphasized?: boolean }>) {
  return <div>
    <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">{label}</p>
    <p className={`mt-atlas-1 tabular-nums ${emphasized ? "text-atlas-lg font-atlas-semibold text-atlas-primary" : "text-atlas-base font-atlas-semibold text-atlas-text"}`}>{formatIndianCurrency(value)}</p>
  </div>;
}
