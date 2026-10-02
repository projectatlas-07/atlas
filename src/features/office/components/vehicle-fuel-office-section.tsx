"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildCreateVehicleFuelInput,
  buildUpdateVehicleFuelInput,
  buildVehicleFuelBatchPaymentInput,
  canChangeVehicleFuel,
  emptyVehicleFuelBatchPaymentForm,
  emptyVehicleFuelForm,
  filterVehicleFuelBatchPayments,
  filterVehicleFuelRecords,
  formatFuelTime,
  getDerivedFuelMeasurementField,
  getLocalTime,
  getVehicleFuelPeriodOutstanding,
  relativeRefuelAge,
  summarizeVehicleFuel,
  updateFuelMeasurement,
  vehicleFuelFormFromSaved,
  type FuelMeasurementField,
  type VehicleFuelBatchPaymentForm,
  type VehicleFuelForm,
  type VehicleFuelStateFilter,
} from "../../vehicle-fuel/vehicle-fuel-model";
import {
  createVehicleFuel,
  createVehicleFuelBatchPayment,
  getPreviousVehicleRefuel,
  listVehicleFuelBatchPayments,
  listVehicleFuelRecords,
  updateVehicleFuel,
  voidVehicleFuel,
} from "../../vehicle-fuel/services/vehicle-fuel-service";
import type { VehicleFuelBatchPayment, VehicleFuelRecord } from "../../vehicle-fuel/types";
import { createOrAssignSupplierRole, listSuppliersByRole } from "../../expenses/services/supplier-role-service";
import type { Supplier } from "../../expenses/types";
import { listVehicles } from "../../sales/services/vehicle-service";
import { formatCustomerPaymentMode, NEW_CUSTOMER_PAYMENT_MODES } from "../../sales/types";
import { formatSalesMoney } from "../sales-office-model";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { EmptyState, Feedback } from "../../../components/ui/feedback";
import { FormField } from "../../../components/ui/form-field";
import { Input, Select } from "../../../components/ui/form-controls";
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
import { getLocalDate } from "../../../lib/local-date";
import {
  resolveStatusPresentation,
  VEHICLE_FUEL_PAYMENT_STATUS,
  VEHICLE_FUEL_STATUS,
} from "../../../lib/statuses";
import { ATLAS_UI_STRINGS } from "../../../lib/strings";
import {
  getOfficeFuelEntriesArchiveHash,
  getOfficeFuelBookHash,
  getOfficePumpPaymentsArchiveHash,
  resolveOfficeFuelBookAreaFromHash,
  type OfficeFuelBookAreaId,
} from "../office-navigation";
import { FuelBookOfficeWorkspace } from "./fuel-book-office-workspace";
import { SearchChoice } from "./search-choice";
import { VehicleFuelPaymentDetailDrawer } from "./vehicle-fuel-payment-detail-drawer";

const pumpsKey = (factoryId: string) => ["office-suppliers-by-role", factoryId, "FUEL_PUMP"] as const;
const vehiclesKey = (factoryId: string) => ["office-sales-vehicles", factoryId] as const;
const recordsKey = (factoryId: string) => ["office-vehicle-fuel-records", factoryId] as const;
const paymentsKey = (factoryId: string) => ["office-vehicle-fuel-payments", factoryId] as const;

export function VehicleFuelOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [activeArea, setActiveArea] = useState<OfficeFuelBookAreaId>("fuel-entries");
  const [showFuelEntriesArchive, setShowFuelEntriesArchive] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFromDate, setArchiveFromDate] = useState("");
  const [archiveToDate, setArchiveToDate] = useState("");
  const [archiveVehicleId, setArchiveVehicleId] = useState("");
  const [archivePumpId, setArchivePumpId] = useState("");
  const [archiveFuelType, setArchiveFuelType] = useState<VehicleFuelRecord["fuelType"] | "">("");
  const [archiveState, setArchiveState] = useState<VehicleFuelStateFilter>("all");
  const [showPaymentArchive, setShowPaymentArchive] = useState(false);
  const [paymentArchiveSearch, setPaymentArchiveSearch] = useState("");
  const [paymentArchiveFromDate, setPaymentArchiveFromDate] = useState("");
  const [paymentArchiveToDate, setPaymentArchiveToDate] = useState("");
  const [paymentArchivePumpId, setPaymentArchivePumpId] = useState("");
  const [paymentArchiveVehicleId, setPaymentArchiveVehicleId] = useState("");
  const [paymentArchiveMode, setPaymentArchiveMode] = useState<VehicleFuelBatchPayment["paymentMode"] | "">("");
  const [paymentDetailId, setPaymentDetailId] = useState("");
  const [form, setForm] = useState<VehicleFuelForm>(() => emptyVehicleFuelForm(localToday, getLocalTime()));
  const [paymentForm, setPaymentForm] = useState<VehicleFuelBatchPaymentForm>(() => emptyVehicleFuelBatchPaymentForm(localToday));
  const [editingId, setEditingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [showPumpDraft, setShowPumpDraft] = useState(false);
  const [pumpDraft, setPumpDraft] = useState({ name: "", address: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isSavingPump, setIsSavingPump] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const pumpsQuery = useQuery({ queryKey: pumpsKey(factoryId), queryFn: () => listSuppliersByRole(factoryId, "FUEL_PUMP") });
  const vehiclesQuery = useQuery({ queryKey: vehiclesKey(factoryId), queryFn: () => listVehicles(factoryId, true) });
  const recordsQuery = useQuery({ queryKey: recordsKey(factoryId), queryFn: () => listVehicleFuelRecords(factoryId) });
  const paymentsQuery = useQuery({ queryKey: paymentsKey(factoryId), queryFn: () => listVehicleFuelBatchPayments(factoryId) });
  const previousQuery = useQuery({
    queryKey: ["office-previous-refuel", factoryId, form.vehicleId, form.fuelDate, form.fuelTime, editingId],
    queryFn: () => getPreviousVehicleRefuel(factoryId, form.vehicleId, form.fuelDate, form.fuelTime, editingId || null),
    enabled: activeArea === "fuel-entries" && Boolean(form.vehicleId && form.fuelDate && form.fuelTime),
  });
  const pumps = pumpsQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const recentRecords = records.slice(0, 8);
  const archiveRecords = filterVehicleFuelRecords(
    records,
    archiveFromDate,
    archiveToDate,
    archiveVehicleId,
    archivePumpId,
    archiveSearch,
    archiveFuelType,
    archiveState,
  );
  const archiveSummary = summarizeVehicleFuel(archiveRecords);
  const recentPayments = payments
    .filter((payment) => !paymentForm.pumpId || payment.pumpId === paymentForm.pumpId)
    .slice(0, 8);
  const archivePayments = filterVehicleFuelBatchPayments(
    payments,
    paymentArchiveFromDate,
    paymentArchiveToDate,
    paymentArchivePumpId,
    paymentArchiveVehicleId,
    paymentArchiveMode,
    paymentArchiveSearch,
  );
  const paymentDetail = payments.find((payment) => payment.id === paymentDetailId) ?? null;
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const entryVehicles = vehicles.filter((vehicle) => vehicle.isActive || vehicle.id === form.vehicleId);
  const pumpSummary = summarizeVehicleFuel(
    records.filter((record) => record.pumpId === paymentForm.pumpId),
  );
  const periodOutstanding = getVehicleFuelPeriodOutstanding(
    records, paymentForm.pumpId, paymentForm.fromDate, paymentForm.toDate,
  );
  const initialDue = Math.max(0, (Number(form.fuelAmount) || 0) - (Number(form.initialPaidAmount) || 0));
  const derivedField = getDerivedFuelMeasurementField(form);
  const queryError = pumpsQuery.error || vehiclesQuery.error || recordsQuery.error || paymentsQuery.error;

  useEffect(() => {
    function syncFuelBookAreaFromHash() {
      const area = resolveOfficeFuelBookAreaFromHash(window.location.hash);
      if (area) {
        setActiveArea(area);
        setShowFuelEntriesArchive(window.location.hash === getOfficeFuelEntriesArchiveHash());
        const isPaymentArchive = window.location.hash === getOfficePumpPaymentsArchiveHash();
        setShowPaymentArchive(isPaymentArchive);
        if (!isPaymentArchive) setPaymentDetailId("");
      }
    }

    syncFuelBookAreaFromHash();
    window.addEventListener("hashchange", syncFuelBookAreaFromHash);
    return () => window.removeEventListener("hashchange", syncFuelBookAreaFromHash);
  }, []);

  function selectFuelBookArea(area: OfficeFuelBookAreaId) {
    setActiveArea(area);
    setShowFuelEntriesArchive(false);
    setShowPaymentArchive(false);
    setPaymentDetailId("");
    window.location.hash = getOfficeFuelBookHash(area);
  }

  function openFuelEntriesArchive() {
    setActiveArea("fuel-entries");
    setShowFuelEntriesArchive(true);
    window.location.hash = getOfficeFuelEntriesArchiveHash();
  }

  function closeFuelEntriesArchive() {
    setShowFuelEntriesArchive(false);
    window.location.hash = getOfficeFuelBookHash("fuel-entries");
  }

  function openPaymentArchive() {
    setActiveArea("pump-payments");
    setShowFuelEntriesArchive(false);
    setShowPaymentArchive(true);
    setPaymentDetailId("");
    window.location.hash = getOfficePumpPaymentsArchiveHash();
  }

  function closePaymentArchive() {
    setShowPaymentArchive(false);
    setPaymentDetailId("");
    window.location.hash = getOfficeFuelBookHash("pump-payments");
  }

  function canOpenFuelEntryFromPayment(fuelRecordId: string) {
    return records.some((record) => record.id === fuelRecordId);
  }

  function openFuelEntryFromPayment(fuelRecordId: string) {
    if (!canOpenFuelEntryFromPayment(fuelRecordId)) return;
    setPaymentDetailId("");
    setSelectedId(fuelRecordId);
    setActiveArea("fuel-entries");
    setShowFuelEntriesArchive(false);
    setShowPaymentArchive(false);
    setConfirmingVoid(false);
    window.location.hash = getOfficeFuelBookHash("fuel-entries");
  }

  function openCreate() {
    setForm(emptyVehicleFuelForm(getLocalDate(), getLocalTime()));
    setEditingId("");
    setError("");
    setSuccess("");
  }

  function openEdit(record: VehicleFuelRecord) {
    if (!canChangeVehicleFuel(record)) return;
    setForm(vehicleFuelFormFromSaved(record));
    setEditingId(record.id);
    if (showFuelEntriesArchive) closeFuelEntriesArchive();
    setError("");
    setSuccess("");
  }

  function changeMeasurement(field: FuelMeasurementField, value: string) {
    setForm((current) => updateFuelMeasurement(current, field, value));
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      let saved: VehicleFuelRecord;
      if (editingId) {
        const input = buildUpdateVehicleFuelInput(factoryId, editingId, form);
        if (!input) throw new Error("Complete Vehicle, Pump, date, time, Fuel Type, and any two of Litres, Rate, and Amount.");
        saved = await updateVehicleFuel(input);
      } else {
        const input = buildCreateVehicleFuelInput(factoryId, form);
        if (!input) throw new Error("Complete Vehicle, Pump, date, time, Fuel Type, any two measurements, and valid payment details.");
        saved = await createVehicleFuel(input);
      }
      queryClient.setQueryData<VehicleFuelRecord[]>(recordsKey(factoryId), (current = []) =>
        [saved, ...current.filter((record) => record.id !== saved.id)]);
      setSelectedId(saved.id);
      setEditingId("");
      setForm(emptyVehicleFuelForm(getLocalDate(), getLocalTime()));
      await invalidateFinance();
      setSuccess(`Fuel saved. Total ${formatSalesMoney(saved.fuelAmount)}; Outstanding ${formatSalesMoney(saved.outstandingAmount)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Fuel entry.");
    } finally {
      setIsSaving(false);
    }
  }

  async function savePump() {
    if (isSavingPump) return;
    if (!pumpDraft.name.trim() || !pumpDraft.address.trim()) {
      setError("Enter both Pump Name and Address / Location.");
      return;
    }
    setIsSavingPump(true);
    setError("");
    try {
      const pump = await createOrAssignSupplierRole({
        factoryId, role: "FUEL_PUMP", name: pumpDraft.name, address: pumpDraft.address,
      });
      queryClient.setQueryData<Supplier[]>(pumpsKey(factoryId), (current = []) =>
        [...current.filter((supplier) => supplier.id !== pump.id), pump]
          .sort((a, b) => a.name.localeCompare(b.name)));
      setForm((current) => ({ ...current, pumpId: pump.id }));
      setPumpDraft({ name: "", address: "" });
      setShowPumpDraft(false);
      await queryClient.invalidateQueries({ queryKey: pumpsKey(factoryId) });
      await queryClient.invalidateQueries({ queryKey: ["office-expense-suppliers", factoryId] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Fuel Pump.");
    } finally {
      setIsSavingPump(false);
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingPayment) return;
    const input = buildVehicleFuelBatchPaymentInput(factoryId, paymentForm, records);
    if (!input) {
      setError("Choose a Pump, valid inclusive range, positive amount within Period Outstanding, payment date, and mode.");
      return;
    }
    setIsSavingPayment(true);
    setError("");
    try {
      const paymentId = await createVehicleFuelBatchPayment(input);
      setSelectedPaymentId(paymentId);
      setPaymentForm(emptyVehicleFuelBatchPaymentForm(localToday));
      await invalidateFinance();
      setSuccess("Batch Pump payment saved and allocated oldest-first with one Cash Book Money Out.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Pump payment.");
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function confirmVoidRecord() {
    if (!selected || !canChangeVehicleFuel(selected)) return;
    setIsSaving(true);
    setError("");
    try {
      const saved = await voidVehicleFuel(factoryId, selected.id);
      queryClient.setQueryData<VehicleFuelRecord[]>(recordsKey(factoryId), (current = []) =>
        current.map((record) => record.id === saved.id ? saved : record));
      setConfirmingVoid(false);
      await invalidateFinance();
      setSuccess("Unpaid Fuel entry voided.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not void Fuel entry.");
    } finally {
      setIsSaving(false);
    }
  }

  async function invalidateFinance() {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: recordsKey(factoryId) }),
      queryClient.invalidateQueries({ queryKey: paymentsKey(factoryId) }),
      queryClient.invalidateQueries({ queryKey: ["office-previous-refuel", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-expense-records", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-expense-payments", factoryId] }),
      queryClient.invalidateQueries({ queryKey: ["office-cash-book-day", factoryId] }),
    ]);
  }

  return <FuelBookOfficeWorkspace activeArea={activeArea} onAreaChange={selectFuelBookArea}>
  <section aria-labelledby="vehicle-fuel-heading">
    {activeArea === "fuel-entries" && !showFuelEntriesArchive && <>
      <div>
        <h2 id="vehicle-fuel-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Fuel Book</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record vehicle fuel entries and review recent fuel purchases.</p>
      </div>
      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Vehicle Fuel data.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>
    </>}

    {activeArea === "pump-payments" && !showPaymentArchive && <>
      <div>
        <h2 id="vehicle-fuel-heading" className="text-atlas-2xl font-atlas-semibold text-atlas-text">Pump Payments</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Record one Fuel Pump payment against genuine outstanding Fuel Entries.</p>
      </div>
      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Pump Payment data.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>
    </>}

    {activeArea === "fuel-entries" && !showFuelEntriesArchive && <>
      <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card as="section" aria-labelledby="new-fuel-entry-heading">
            <form onSubmit={saveRecord}>
              <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="new-fuel-entry-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{editingId ? "Correct Fuel Entry" : "New Fuel Entry"}</h3>
                  <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Record the vehicle, Fuel Pump, quantity, rate, and payment.</p>
                </div>
                {editingId && <Button type="button" variant="ghost" onClick={openCreate}>Cancel correction</Button>}
              </div>

              <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
                <SearchChoice v2 label="Vehicle" options={entryVehicles.map((vehicle) => ({ id: vehicle.id, label: `${vehicle.vehicleNumber}${vehicle.isActive ? "" : " · Archived"}` }))} selectedId={form.vehicleId} onSelect={(vehicleId) => setForm({ ...form, vehicleId })} placeholder="Search Vehicle" />
                <div>
                  <SearchChoice v2 label="Fuel Pump" options={pumps.map((pump) => ({ id: pump.id, label: pump.name }))} selectedId={form.pumpId} onSelect={(pumpId) => setForm({ ...form, pumpId })} placeholder="Search Pump" />
                  <div className="mt-atlas-2"><Button type="button" variant="secondary" onClick={() => setShowPumpDraft((current) => !current)}>Add New Pump</Button></div>
                </div>
              </div>

              {showPumpDraft && <fieldset className="mt-atlas-3 rounded-atlas-card border border-atlas-border bg-atlas-surface-muted p-atlas-3">
                <legend className="px-atlas-1 text-atlas-sm font-atlas-semibold text-atlas-text">Add reusable Fuel Pump</legend>
                <div className="grid gap-atlas-3 sm:grid-cols-2">
                  <FormField label="Pump Name"><Input required value={pumpDraft.name} onChange={(event) => setPumpDraft({ ...pumpDraft, name: event.target.value })} /></FormField>
                  <FormField label="Address / Location"><Input required value={pumpDraft.address} onChange={(event) => setPumpDraft({ ...pumpDraft, address: event.target.value })} /></FormField>
                </div>
                <div className="mt-atlas-3"><Button type="button" loading={isSavingPump} loadingLabel={ATLAS_UI_STRINGS.feedback.saving} onClick={() => void savePump()}>Save Pump</Button></div>
              </fieldset>}

              {form.vehicleId && <div className="mt-atlas-3"><Feedback tone="info">{previousQuery.isLoading ? "Checking previous refuel…" : previousQuery.error ? "Could not load previous refuel." : previousQuery.data ? <>Last refuel: {relativeRefuelAge(previousQuery.data.fuelDate)} · {formatDateOnly(previousQuery.data.fuelDate)}, <FuelTime value={previousQuery.data.fuelTime} /> · {formatIndianNumber(previousQuery.data.litres)} L {previousQuery.data.fuelType === "DIESEL" ? "Diesel" : "Petrol"}</> : "No previous refuel recorded"}</Feedback></div>}

              <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-3">
                <FormField label="Business date"><Input type="date" required value={form.fuelDate} onChange={(event) => setForm({ ...form, fuelDate: event.target.value })} /></FormField>
                <FormField label="Time"><Input type="time" required value={form.fuelTime} onChange={(event) => setForm({ ...form, fuelTime: event.target.value })} /></FormField>
                <FormField label="Fuel Type"><Select value={form.fuelType} onChange={(event) => setForm({ ...form, fuelType: event.target.value as VehicleFuelForm["fuelType"] })}><option value="DIESEL">Diesel</option><option value="PETROL">Petrol</option></Select></FormField>
              </div>

              <div className="mt-atlas-4"><Card surface="muted">
                <h4 className="text-atlas-sm font-atlas-semibold text-atlas-text">Fuel calculation</h4>
                <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Enter any two values; Atlas calculates the third.</p>
                <div className="mt-atlas-3 grid gap-atlas-3 sm:grid-cols-3">
                  <MeasurementInput label="Litres" field="litres" value={form.litres} derivedField={derivedField} onChange={changeMeasurement} placeholder="40" />
                  <MeasurementInput label="Rate / Litre" field="ratePerLitre" value={form.ratePerLitre} derivedField={derivedField} onChange={changeMeasurement} placeholder="92" />
                  <MeasurementInput label="Amount" field="fuelAmount" value={form.fuelAmount} derivedField={derivedField} onChange={changeMeasurement} placeholder="3680" />
                </div>
              </Card></div>

              {!editingId && <div className="mt-atlas-4"><Card surface="muted">
                <div className="grid gap-atlas-3 sm:grid-cols-3">
                  <FormField label="Paid now (blank or 0 = unpaid)"><Input inputMode="decimal" value={form.initialPaidAmount} onChange={(event) => setForm({ ...form, initialPaidAmount: event.target.value })} placeholder="0" /></FormField>
                  {Number(form.initialPaidAmount) > 0 && <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select value={form.initialPaymentMode} onChange={(event) => setForm({ ...form, initialPaymentMode: event.target.value })}><option value="">{ATLAS_UI_STRINGS.payment.selectMode}</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>}
                  <FuelTotal label="Amount due" value={initialDue} emphasized />
                </div>
              </Card></div>}

              <div className="mt-atlas-5 flex flex-wrap items-center gap-atlas-2">
                <Button type="submit" loading={isSaving} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>{editingId ? "Save correction" : "Save Fuel Entry"}</Button>
                <Button type="button" variant="ghost" onClick={openCreate}>{editingId ? ATLAS_UI_STRINGS.actions.cancel : ATLAS_UI_STRINGS.actions.clear}</Button>
              </div>
            </form>
          </Card>
        </div>

        <Card as="section" aria-labelledby="recent-fuel-entries-heading">
          <div className="flex h-96 flex-col">
            <div className="border-b border-atlas-border pb-atlas-3">
              <h3 id="recent-fuel-entries-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Fuel Entries</h3>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Latest 8 saved entries</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {recordsQuery.isLoading ? <EmptyState title="Loading Fuel Entries..." /> : recentRecords.length === 0 ? <EmptyState title="No Fuel Entries saved yet." /> : <ul className="divide-y divide-atlas-border">{recentRecords.map((record) => <li key={record.id} className="py-atlas-3">
                <div className="flex items-start justify-between gap-atlas-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-atlas-2"><p className="truncate text-atlas-sm font-atlas-semibold text-atlas-text">{record.vehicleNumberSnapshot}</p><FuelEntryStatus record={record} /></div>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(record.fuelDate)} · <FuelTime value={record.fuelTime} /></p>
                    <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-muted">{record.pumpNameSnapshot} · {record.fuelType === "DIESEL" ? "Diesel" : "Petrol"} · {formatIndianNumber(record.litres)} L</p>
                    <p className="mt-atlas-1 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(record.fuelAmount)}</p>
                    <p className="mt-atlas-1 text-atlas-xs tabular-nums text-atlas-text-muted">Paid {formatIndianCurrency(record.totalPaid)} · Due {formatIndianCurrency(record.outstandingAmount)}</p>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => { setSelectedId(record.id); setConfirmingVoid(false); }}>{ATLAS_UI_STRINGS.actions.open} →</Button>
                </div>
              </li>)}</ul>}
            </div>
            <div className="border-t border-atlas-border pt-atlas-3">
              <Button type="button" variant="ghost" onClick={openFuelEntriesArchive}>View all fuel entries →</Button>
            </div>
          </div>
        </Card>
      </div>
    </>}

    {activeArea === "fuel-entries" && showFuelEntriesArchive && <>
      <div>
        <Button type="button" variant="ghost" onClick={closeFuelEntriesArchive}>← Back to Fuel Entries</Button>
        <h2 id="vehicle-fuel-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Fuel Entries</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review the authoritative Fuel Entry history.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Fuel Entry history.</Feedback>}
        {error && <Feedback role="alert" tone="danger">{error}</Feedback>}
        {success && <Feedback role="status" tone="success">{success}</Feedback>}
      </div>

      <div className="mt-atlas-4"><Card as="section" aria-labelledby="fuel-entry-archive-filters-heading">
        <h3 id="fuel-entry-archive-filters-heading" className="sr-only">Fuel Entry archive filters</h3>
        <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Search Fuel Entries"><Input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="Vehicle or Fuel Pump" /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" value={archiveFromDate} onChange={(event) => setArchiveFromDate(event.target.value)} /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" value={archiveToDate} onChange={(event) => setArchiveToDate(event.target.value)} /></FormField>
          <FormField label="Vehicle"><Select value={archiveVehicleId} onChange={(event) => setArchiveVehicleId(event.target.value)}><option value="">All Vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}{vehicle.isActive ? "" : " · Archived"}</option>)}</Select></FormField>
          <FormField label="Fuel Pump"><Select value={archivePumpId} onChange={(event) => setArchivePumpId(event.target.value)}><option value="">All Fuel Pumps</option>{pumps.map((pump) => <option key={pump.id} value={pump.id}>{pump.name}</option>)}</Select></FormField>
          <FormField label="Fuel Type"><Select value={archiveFuelType} onChange={(event) => setArchiveFuelType(event.target.value as VehicleFuelRecord["fuelType"] | "")}><option value="">All Fuel Types</option><option value="DIESEL">Diesel</option><option value="PETROL">Petrol</option></Select></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.status}><Select value={archiveState} onChange={(event) => setArchiveState(event.target.value as VehicleFuelStateFilter)}><option value="all">All States</option><option value="unpaid">{resolveStatusPresentation(VEHICLE_FUEL_PAYMENT_STATUS, "unpaid").label}</option><option value="partially_paid">{resolveStatusPresentation(VEHICLE_FUEL_PAYMENT_STATUS, "partially_paid").label}</option><option value="paid">{resolveStatusPresentation(VEHICLE_FUEL_PAYMENT_STATUS, "paid").label}</option><option value="void">{resolveStatusPresentation(VEHICLE_FUEL_STATUS, "void").label}</option></Select></FormField>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><Card as="section" surface="muted" aria-label="Filtered Fuel Entry totals">
        <div className="grid grid-cols-2 gap-atlas-3 lg:grid-cols-4">
          <div><p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">Total Fuel</p><p className="mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums text-atlas-text">{formatIndianNumber(archiveSummary.totalLitres)} L</p></div>
          <FuelTotal label="Total Amount" value={archiveSummary.totalPurchased} />
          <FuelTotal label="Paid" value={archiveSummary.totalPaid} />
          <FuelTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={archiveSummary.totalOutstanding} emphasized />
        </div>
      </Card></div>

      <div className="mt-atlas-3"><TableContainer bounded aria-label="All Fuel Entries table">
        <Table wide>
          <TableCaption visuallyHidden>All Fuel Entries matching the selected filters</TableCaption>
          <TableHeader sticky>
            <TableRow>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.date}</TableHeaderCell>
              <TableHeaderCell>Time</TableHeaderCell>
              <TableHeaderCell>Vehicle</TableHeaderCell>
              <TableHeaderCell>Fuel Pump</TableHeaderCell>
              <TableHeaderCell>Fuel Type</TableHeaderCell>
              <TableHeaderCell numeric>Litres</TableHeaderCell>
              <TableHeaderCell numeric>Rate / Litre</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              <TableHeaderCell numeric>Paid</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.payment.due}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.status}</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archiveRecords.map((record) => <TableRow key={record.id} hoverable selected={selectedId === record.id}>
              <TableCell>{formatDateOnly(record.fuelDate)}</TableCell>
              <TableCell><FuelTime value={record.fuelTime} /></TableCell>
              <TableCell><span className="font-atlas-semibold">{record.vehicleNumberSnapshot}</span></TableCell>
              <TableCell>{record.pumpNameSnapshot}</TableCell>
              <TableCell>{record.fuelType === "DIESEL" ? "Diesel" : "Petrol"}</TableCell>
              <TableCell numeric>{formatIndianNumber(record.litres)} L</TableCell>
              <TableCell numeric>{formatIndianCurrency(record.ratePerLitre)}</TableCell>
              <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(record.fuelAmount)}</span></TableCell>
              <TableCell numeric>{formatIndianCurrency(record.totalPaid)}</TableCell>
              <TableCell numeric>{formatIndianCurrency(record.outstandingAmount)}</TableCell>
              <TableCell><FuelEntryStatus record={record} /></TableCell>
              <TableCell><Button type="button" variant="ghost" onClick={() => { setSelectedId(record.id); setConfirmingVoid(false); }}>{ATLAS_UI_STRINGS.actions.open} →</Button></TableCell>
            </TableRow>)}
            {!recordsQuery.isLoading && archiveRecords.length === 0 && <TableRow><TableCell colSpan={12}>No Fuel Entries match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer></div>
      {recordsQuery.isLoading && <EmptyState title="Loading Fuel Entry history..." />}
    </>}

    {activeArea === "pump-payments" && !showPaymentArchive && <div className="mt-atlas-4 grid items-start gap-atlas-4 lg:grid-cols-3">
      <form onSubmit={savePayment} className="space-y-atlas-4 lg:col-span-2">
        <Card as="section" aria-labelledby="pump-summary-heading">
          <h3 id="pump-summary-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Pump summary</h3>
          <div className="mt-atlas-3 max-w-md">
            <SearchChoice v2 label="Fuel Pump" options={pumps.map((pump) => ({ id: pump.id, label: pump.name }))} selectedId={paymentForm.pumpId} onSelect={(pumpId) => setPaymentForm({ ...paymentForm, pumpId })} placeholder="Search Pump" />
          </div>
          {paymentForm.pumpId ? <div className="mt-atlas-4"><Card surface="muted"><div className="grid gap-atlas-3 sm:grid-cols-3">
            <FuelTotal label="Fuel Purchased" value={pumpSummary.totalPurchased} />
            <FuelTotal label="Paid" value={pumpSummary.totalPaid} />
            <FuelTotal label="Outstanding" value={pumpSummary.totalOutstanding} emphasized />
          </div></Card></div> : <div className="mt-atlas-4"><EmptyState title="Choose a Fuel Pump to see its Fuel totals." /></div>}
        </Card>

        <Card as="section" aria-labelledby="pump-payment-details-heading">
          <h3 id="pump-payment-details-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Payment details</h3>
          <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">One immutable payment is allocated to eligible Fuel Entries oldest-first.</p>
          <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-3">
            <FormField label={ATLAS_UI_STRINGS.payment.date}><Input type="date" required value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></FormField>
            <FormField label={ATLAS_UI_STRINGS.payment.amount}><Input inputMode="decimal" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} placeholder="0" /></FormField>
            <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select required value={paymentForm.paymentMode} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMode: event.target.value })}><option value="">{ATLAS_UI_STRINGS.payment.selectMode}</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
          </div>
          <div className="mt-atlas-3"><FormField label="Note / reference (optional)"><Input value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} maxLength={500} placeholder="Transaction reference or note" /></FormField></div>
        </Card>

        <Card as="section" aria-labelledby="outstanding-fuel-entries-heading">
          <div className="flex flex-col gap-atlas-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="outstanding-fuel-entries-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Outstanding Fuel Entries</h3>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">Eligible entries are shown in the same oldest-first order used by the backend.</p>
            </div>
            <p className="text-atlas-xs text-atlas-text-muted">Inclusive settlement range</p>
          </div>
          <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-2">
            <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" required value={paymentForm.fromDate} onChange={(event) => setPaymentForm({ ...paymentForm, fromDate: event.target.value })} /></FormField>
            <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" required value={paymentForm.toDate} onChange={(event) => setPaymentForm({ ...paymentForm, toDate: event.target.value })} /></FormField>
          </div>
          {!paymentForm.pumpId ? <EmptyState title="Choose a Fuel Pump to see outstanding Fuel Entries." /> : recordsQuery.isLoading ? <EmptyState title="Loading outstanding Fuel Entries..." /> : periodOutstanding.eligibleCount === 0 ? <EmptyState title="No outstanding Fuel Entries in this range." description="Change the inclusive date range or choose another Fuel Pump." /> : <ol className="mt-atlas-4 max-h-80 overflow-y-auto divide-y divide-atlas-border">{periodOutstanding.eligibleRecords.map((record, index) => <li key={record.id} className="flex items-start gap-atlas-3 py-atlas-3">
            <span aria-hidden="true" className="flex h-atlas-6 w-atlas-6 shrink-0 items-center justify-center rounded-atlas-pill bg-atlas-primary-surface text-atlas-xs font-atlas-semibold text-atlas-primary">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-atlas-sm font-atlas-semibold text-atlas-text">{record.vehicleNumberSnapshot}</p>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatDateOnly(record.fuelDate)} · <FuelTime value={record.fuelTime} /> · {record.fuelType === "DIESEL" ? "Diesel" : "Petrol"} · {formatIndianNumber(record.litres)} L</p>
              <p className="mt-atlas-1 text-atlas-xs tabular-nums text-atlas-text-muted">Total {formatIndianCurrency(record.fuelAmount)} · Paid {formatIndianCurrency(record.totalPaid)}</p>
            </div>
            <div className="text-right"><p className="text-atlas-xs text-atlas-text-muted">Due</p><p className="mt-atlas-1 text-atlas-sm font-atlas-semibold tabular-nums text-atlas-primary">{formatIndianCurrency(record.outstandingAmount)}</p></div>
          </li>)}</ol>}
          <div className="mt-atlas-4 flex flex-col gap-atlas-3 border-t border-atlas-border pt-atlas-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">Period Outstanding</p>
              <p className="mt-atlas-1 text-atlas-xl font-atlas-semibold tabular-nums text-atlas-primary">{formatIndianCurrency(periodOutstanding.outstandingAmount)}</p>
              <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatIndianNumber(periodOutstanding.eligibleCount)} eligible {periodOutstanding.eligibleCount === 1 ? "entry" : "entries"}; allocation is finalized by the backend.</p>
            </div>
            <Button type="submit" disabled={periodOutstanding.eligibleCount === 0} loading={isSavingPayment} loadingLabel={ATLAS_UI_STRINGS.feedback.saving}>Save Pump Payment</Button>
          </div>
        </Card>
      </form>

      <Card as="section" aria-labelledby="recent-pump-payments-heading">
        <div className="flex h-96 flex-col">
          <div className="border-b border-atlas-border pb-atlas-3">
            <h3 id="recent-pump-payments-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">Recent Pump Payments</h3>
            <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{paymentForm.pumpId ? "Recent payments for the selected Pump" : "Latest saved Pump Payments"}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {paymentsQuery.isLoading ? <EmptyState title="Loading Pump Payments..." /> : recentPayments.length === 0 ? <EmptyState title="No Pump Payments saved yet." /> : <ul className="divide-y divide-atlas-border">{recentPayments.map((payment) => {
              const isOpen = selectedPaymentId === payment.id;
              return <li key={payment.id} className="py-atlas-3">
                <div className="flex items-start justify-between gap-atlas-2">
                  <div className="min-w-0">
                    <p className="text-atlas-sm font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(payment.amount)}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{payment.pumpName} · {formatDateOnly(payment.paymentDate)}</p>
                    <p className="mt-atlas-1 text-atlas-xs text-atlas-text-muted">{formatCustomerPaymentMode(payment.paymentMode)} · {formatIndianNumber(payment.allocationCount)} {payment.allocationCount === 1 ? "entry" : "entries"}</p>
                    {payment.note && <p className="mt-atlas-1 truncate text-atlas-xs text-atlas-text-muted">{payment.note}</p>}
                  </div>
                  <Button type="button" variant="ghost" aria-expanded={isOpen} onClick={() => setSelectedPaymentId(isOpen ? "" : payment.id)}>{isOpen ? ATLAS_UI_STRINGS.actions.close : `${ATLAS_UI_STRINGS.actions.open} →`}</Button>
                </div>
                {isOpen && <div className="mt-atlas-3 rounded-atlas-control border border-atlas-border bg-atlas-surface-muted p-atlas-3">
                  <p className="text-atlas-xs font-atlas-semibold text-atlas-text">Persisted oldest-first allocations</p>
                  <ul className="mt-atlas-2 divide-y divide-atlas-border">{payment.allocations.map((allocation) => <li key={allocation.fuelRecordId} className="flex items-start justify-between gap-atlas-2 py-atlas-2 text-atlas-xs">
                    <span className="text-atlas-text-muted">{formatDateOnly(allocation.fuelDate)} · {allocation.vehicleNumberSnapshot}</span>
                    <span className="font-atlas-semibold tabular-nums text-atlas-text">{formatIndianCurrency(allocation.allocatedAmount)}</span>
                  </li>)}</ul>
                </div>}
              </li>;
            })}</ul>}
          </div>
          <div className="border-t border-atlas-border pt-atlas-3">
            <Button type="button" variant="ghost" onClick={openPaymentArchive}>View all payments →</Button>
          </div>
        </div>
      </Card>
    </div>}

    {activeArea === "pump-payments" && showPaymentArchive && <>
      <div>
        <Button type="button" variant="ghost" onClick={closePaymentArchive}>← Back to Pump Payments</Button>
        <h2 id="vehicle-fuel-heading" className="mt-atlas-2 text-atlas-2xl font-atlas-semibold text-atlas-text">All Pump Payments</h2>
        <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">Search and review the authoritative grouped Pump Payment history.</p>
      </div>

      <div className="mt-atlas-4 space-y-atlas-3">
        {queryError && <Feedback role="alert" tone="danger">Could not load Pump Payment history.</Feedback>}
      </div>

      <div className="mt-atlas-4"><Card as="section" aria-labelledby="pump-payment-archive-filters-heading">
        <h3 id="pump-payment-archive-filters-heading" className="sr-only">Pump Payment archive filters</h3>
        <div className="grid gap-atlas-3 md:grid-cols-2 xl:grid-cols-6">
          <FormField label="Search payments"><Input value={paymentArchiveSearch} onChange={(event) => setPaymentArchiveSearch(event.target.value)} placeholder="Fuel Pump, note or vehicle" /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.fromDate}><Input type="date" value={paymentArchiveFromDate} onChange={(event) => setPaymentArchiveFromDate(event.target.value)} /></FormField>
          <FormField label={ATLAS_UI_STRINGS.fields.toDate}><Input type="date" value={paymentArchiveToDate} onChange={(event) => setPaymentArchiveToDate(event.target.value)} /></FormField>
          <FormField label="Fuel Pump"><Select value={paymentArchivePumpId} onChange={(event) => setPaymentArchivePumpId(event.target.value)}><option value="">All Fuel Pumps</option>{pumps.map((pump) => <option key={pump.id} value={pump.id}>{pump.name}</option>)}</Select></FormField>
          <FormField label="Vehicle"><Select value={paymentArchiveVehicleId} onChange={(event) => setPaymentArchiveVehicleId(event.target.value)}><option value="">All Vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}{vehicle.isActive ? "" : " · Archived"}</option>)}</Select></FormField>
          <FormField label={ATLAS_UI_STRINGS.payment.mode}><Select value={paymentArchiveMode} onChange={(event) => setPaymentArchiveMode(event.target.value as VehicleFuelBatchPayment["paymentMode"] | "")}><option value="">All Modes</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</Select></FormField>
        </div>
      </Card></div>

      <div className="mt-atlas-3"><TableContainer bounded aria-label="All Pump Payments table">
        <Table wide>
          <TableCaption visuallyHidden>All Pump Payments matching the selected filters</TableCaption>
          <TableHeader sticky>
            <TableRow>
              <TableHeaderCell>{ATLAS_UI_STRINGS.payment.date}</TableHeaderCell>
              <TableHeaderCell>Fuel Pump</TableHeaderCell>
              <TableHeaderCell numeric>{ATLAS_UI_STRINGS.fields.amount}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.payment.mode}</TableHeaderCell>
              <TableHeaderCell>{ATLAS_UI_STRINGS.fields.note}</TableHeaderCell>
              <TableHeaderCell numeric>Fuel Entries</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archivePayments.map((payment) => <TableRow key={payment.id} hoverable selected={paymentDetailId === payment.id}>
              <TableCell>{formatDateOnly(payment.paymentDate)}</TableCell>
              <TableCell><span className="font-atlas-semibold">{payment.pumpName}</span></TableCell>
              <TableCell numeric><span className="font-atlas-semibold">{formatIndianCurrency(payment.amount)}</span></TableCell>
              <TableCell>{formatCustomerPaymentMode(payment.paymentMode)}</TableCell>
              <TableCell><span className="block max-w-sm truncate">{payment.note || "—"}</span></TableCell>
              <TableCell numeric>{formatIndianNumber(payment.allocationCount)}</TableCell>
              <TableCell><Button type="button" variant="ghost" onClick={() => setPaymentDetailId(payment.id)}>Open payment →</Button></TableCell>
            </TableRow>)}
            {!paymentsQuery.isLoading && archivePayments.length === 0 && <TableRow><TableCell colSpan={7}>No Pump Payments match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer></div>
      {paymentsQuery.isLoading && <EmptyState title="Loading Pump Payment history..." />}
    </>}

    {activeArea === "fuel-entries" && selected && <div className="mt-atlas-4"><Card as="section" aria-labelledby="selected-fuel-entry-heading">
      <div className="flex flex-col gap-atlas-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-atlas-2"><h3 id="selected-fuel-entry-heading" className="text-atlas-lg font-atlas-semibold text-atlas-text">{selected.vehicleNumberSnapshot} · {selected.pumpNameSnapshot}</h3><FuelEntryStatus record={selected} /></div>
          <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{formatDateOnly(selected.fuelDate)}, <FuelTime value={selected.fuelTime} /> · {formatIndianNumber(selected.litres)} L {selected.fuelType === "DIESEL" ? "Diesel" : "Petrol"} at {formatIndianCurrency(selected.ratePerLitre)} / L</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setSelectedId("")}>{ATLAS_UI_STRINGS.actions.close}</Button>
      </div>
      <div className="mt-atlas-4 grid gap-atlas-3 sm:grid-cols-3">
        <FuelTotal label="Total" value={selected.fuelAmount} />
        <FuelTotal label="Paid" value={selected.totalPaid} />
        <FuelTotal label={ATLAS_UI_STRINGS.payment.outstanding} value={selected.outstandingAmount} emphasized />
      </div>
      <div className="mt-atlas-4 flex flex-wrap gap-atlas-2">
        <Button type="button" variant="secondary" disabled={!canChangeVehicleFuel(selected)} onClick={() => openEdit(selected)}>Correct</Button>
        <Button type="button" variant="secondary" disabled={!canChangeVehicleFuel(selected)} onClick={() => setConfirmingVoid(true)}>Void</Button>
      </div>
      {!canChangeVehicleFuel(selected) && selected.totalPaid > 0 && <p className="mt-atlas-3 text-atlas-xs text-atlas-text-muted">Payment history locks this Fuel entry from correction or voiding.</p>}
      {confirmingVoid && <div className="mt-atlas-3"><Feedback role="alert" tone="danger"><p>Void this unpaid Fuel entry?</p><div className="mt-atlas-2 flex flex-wrap gap-atlas-2"><Button type="button" variant="danger" loading={isSaving} loadingLabel="Voiding..." onClick={() => void confirmVoidRecord()}>Confirm Void</Button><Button type="button" variant="ghost" onClick={() => setConfirmingVoid(false)}>{ATLAS_UI_STRINGS.actions.cancel}</Button></div></Feedback></div>}
    </Card></div>}

    {paymentDetail && <VehicleFuelPaymentDetailDrawer
      payment={paymentDetail}
      onClose={() => setPaymentDetailId("")}
      canOpenFuelEntry={canOpenFuelEntryFromPayment}
      onOpenFuelEntry={openFuelEntryFromPayment}
    />}

  </section>
  </FuelBookOfficeWorkspace>;
}

function MeasurementInput({ label, field, value, derivedField, onChange, placeholder }: Readonly<{
  label: string; field: FuelMeasurementField; value: string;
  derivedField: FuelMeasurementField | null;
  onChange: (field: FuelMeasurementField, value: string) => void;
  placeholder: string;
}>) {
  const derived = field === derivedField;
  return <FormField label={<>{label}{derived && <span className="ml-atlas-1 text-atlas-xs font-atlas-semibold text-atlas-primary">Calculated</span>}</>}><Input inputMode="decimal" required value={value} onChange={(event) => onChange(field, event.target.value)} placeholder={placeholder} /></FormField>;
}

function FuelEntryStatus({ record }: Readonly<{ record: VehicleFuelRecord }>) {
  const status = record.status === "void"
    ? resolveStatusPresentation(VEHICLE_FUEL_STATUS, record.status)
    : resolveStatusPresentation(VEHICLE_FUEL_PAYMENT_STATUS, record.paymentState);
  return <StatusPill label={status.label} tone={status.tone} />;
}

function FuelTime({ value }: Readonly<{ value: string }>) {
  return <>{formatFuelTime(value)}</>;
}

function FuelTotal({ label, value, emphasized = false }: Readonly<{ label: string; value: number; emphasized?: boolean }>) {
  return <div><p className="text-atlas-xs font-atlas-medium text-atlas-text-muted">{label}</p><p className={`mt-atlas-1 text-atlas-lg font-atlas-semibold tabular-nums ${emphasized ? "text-atlas-primary" : "text-atlas-text"}`}>{formatIndianCurrency(value)}</p></div>;
}
