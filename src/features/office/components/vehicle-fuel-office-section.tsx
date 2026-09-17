"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildCreateVehicleFuelInput,
  buildUpdateVehicleFuelInput,
  buildVehicleFuelBatchPaymentInput,
  canChangeVehicleFuel,
  emptyVehicleFuelBatchPaymentForm,
  emptyVehicleFuelForm,
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
import type { VehicleFuelRecord } from "../../vehicle-fuel/types";
import { createOrAssignSupplierRole, listSuppliersByRole } from "../../expenses/services/supplier-role-service";
import type { Supplier } from "../../expenses/types";
import { listVehicles } from "../../sales/services/vehicle-service";
import { formatCustomerPaymentMode, NEW_CUSTOMER_PAYMENT_MODES } from "../../sales/types";
import { formatChallanDate, formatSalesMoney } from "../sales-office-model";
import { getLocalDate } from "../../../lib/local-date";
import { SearchChoice } from "./search-choice";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100";
const primaryButton = "h-10 rounded-lg bg-stone-900 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-10 rounded-lg border border-stone-400 bg-white px-4 text-sm font-bold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50";
const pumpsKey = (factoryId: string) => ["office-suppliers-by-role", factoryId, "FUEL_PUMP"] as const;
const vehiclesKey = (factoryId: string) => ["office-sales-vehicles", factoryId] as const;
const recordsKey = (factoryId: string) => ["office-vehicle-fuel-records", factoryId] as const;
const paymentsKey = (factoryId: string) => ["office-vehicle-fuel-payments", factoryId] as const;

export function VehicleFuelOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [form, setForm] = useState<VehicleFuelForm>(() => emptyVehicleFuelForm(localToday, getLocalTime()));
  const [paymentForm, setPaymentForm] = useState<VehicleFuelBatchPaymentForm>(() => emptyVehicleFuelBatchPaymentForm(localToday));
  const [editingId, setEditingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showPumpDraft, setShowPumpDraft] = useState(false);
  const [pumpDraft, setPumpDraft] = useState({ name: "", address: "" });
  const [fromDate, setFromDate] = useState(`${localToday.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(localToday);
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [pumpFilter, setPumpFilter] = useState("");
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
    enabled: showForm && Boolean(form.vehicleId && form.fuelDate && form.fuelTime),
  });
  const pumps = pumpsQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const entryVehicles = vehicles.filter((vehicle) => vehicle.isActive || vehicle.id === form.vehicleId);
  const filteredRecords = filterVehicleFuelRecords(records, fromDate, toDate, vehicleFilter, pumpFilter);
  const filteredPayments = payments.filter((payment) => payment.paymentDate >= fromDate
    && payment.paymentDate <= toDate
    && (!vehicleFilter || payment.vehicleIds.includes(vehicleFilter))
    && (!pumpFilter || payment.pumpId === pumpFilter));
  const summary = summarizeVehicleFuel(filteredRecords);
  const periodOutstanding = getVehicleFuelPeriodOutstanding(
    records, paymentForm.pumpId, paymentForm.fromDate, paymentForm.toDate,
  );
  const initialDue = Math.max(0, (Number(form.fuelAmount) || 0) - (Number(form.initialPaidAmount) || 0));
  const derivedField = getDerivedFuelMeasurementField(form);
  const queryError = pumpsQuery.error || vehiclesQuery.error || recordsQuery.error || paymentsQuery.error;

  function openCreate() {
    setForm(emptyVehicleFuelForm(getLocalDate(), getLocalTime()));
    setEditingId("");
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openEdit(record: VehicleFuelRecord) {
    if (!canChangeVehicleFuel(record)) return;
    setForm(vehicleFuelFormFromSaved(record));
    setEditingId(record.id);
    setShowForm(true);
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
      setShowForm(false);
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
      await createVehicleFuelBatchPayment(input);
      setShowPayment(false);
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

  return <section aria-labelledby="vehicle-fuel-heading" className="rounded-2xl border border-stone-300 bg-stone-50 p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="vehicle-fuel-heading" className="text-2xl font-black tracking-tight">Vehicle Fuel Book</h2><p className="mt-1 text-sm text-slate-600">Fast refuels, Pump dues, payments, and chronological Vehicle history</p></div><div className="flex gap-2"><button type="button" onClick={openCreate} className={primaryButton}>New Fuel Entry</button><button type="button" onClick={() => { setPaymentForm(emptyVehicleFuelBatchPaymentForm(localToday)); setShowPayment(true); }} className={secondaryButton}>Pay Pump</button></div></div>
    {queryError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Could not load Vehicle Fuel data.</p>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {success && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

    {showForm && <form onSubmit={saveRecord} className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{editingId ? "Correct Fuel Entry" : "New Fuel Entry"}</h3><button type="button" onClick={() => { setShowForm(false); setEditingId(""); }} className="text-sm font-semibold">Close</button></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SearchChoice label="Vehicle" options={entryVehicles.map((vehicle) => ({ id: vehicle.id, label: `${vehicle.vehicleNumber}${vehicle.isActive ? "" : " · Archived"}` }))} selectedId={form.vehicleId} onSelect={(vehicleId) => setForm({ ...form, vehicleId })} placeholder="Search Vehicle" />
        <SearchChoice label="Fuel Pump" options={pumps.map((pump) => ({ id: pump.id, label: pump.name }))} selectedId={form.pumpId} onSelect={(pumpId) => setForm({ ...form, pumpId })} placeholder="Search Pump" />
      </div>
      {form.vehicleId && <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950">{previousQuery.isLoading ? "Checking previous refuel…" : previousQuery.error ? "Could not load previous refuel." : previousQuery.data ? <>Last refuel: {relativeRefuelAge(previousQuery.data.fuelDate)} · {formatChallanDate(previousQuery.data.fuelDate)}, {formatFuelTime(previousQuery.data.fuelTime)} · {previousQuery.data.litres.toLocaleString("en-IN")} L {previousQuery.data.fuelType === "DIESEL" ? "Diesel" : "Petrol"}</> : "No previous refuel recorded"}</div>}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">Date<input type="date" required value={form.fuelDate} onChange={(event) => setForm({ ...form, fuelDate: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Time<input type="time" required value={form.fuelTime} onChange={(event) => setForm({ ...form, fuelTime: event.target.value })} className={inputClass} /></label>
        <label className="text-xs font-medium text-slate-600">Fuel Type<select value={form.fuelType} onChange={(event) => setForm({ ...form, fuelType: event.target.value as VehicleFuelForm["fuelType"] })} className={inputClass}><option value="DIESEL">Diesel</option><option value="PETROL">Petrol</option></select></label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MeasurementInput label="Litres" field="litres" value={form.litres} derivedField={derivedField} onChange={changeMeasurement} placeholder="40" />
        <MeasurementInput label="Rate / Litre" field="ratePerLitre" value={form.ratePerLitre} derivedField={derivedField} onChange={changeMeasurement} placeholder="92" />
        <MeasurementInput label="Amount" field="fuelAmount" value={form.fuelAmount} derivedField={derivedField} onChange={changeMeasurement} placeholder="3680" />
      </div>
      <p className="mt-2 text-xs text-slate-500">Enter any two values; Atlas calculates the third.</p>
      <button type="button" onClick={() => setShowPumpDraft((current) => !current)} className={`${secondaryButton} mt-3`}>Add New Pump</button>
      {showPumpDraft && <fieldset className="mt-3 rounded-lg bg-stone-50 p-4"><legend className="font-bold">Add reusable Fuel Pump</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Pump Name<input required value={pumpDraft.name} onChange={(event) => setPumpDraft({ ...pumpDraft, name: event.target.value })} className={inputClass} /></label><label className="text-xs">Address / Location<input required value={pumpDraft.address} onChange={(event) => setPumpDraft({ ...pumpDraft, address: event.target.value })} className={inputClass} /></label></div><button type="button" disabled={isSavingPump} onClick={() => void savePump()} className={`${primaryButton} mt-3`}>Save Pump</button></fieldset>}
      {!editingId && <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium text-slate-600">Paid now (blank or 0 = unpaid)<input inputMode="decimal" value={form.initialPaidAmount} onChange={(event) => setForm({ ...form, initialPaidAmount: event.target.value })} placeholder="0" className={inputClass} /></label>{Number(form.initialPaidAmount) > 0 && <label className="text-xs font-medium text-slate-600">Payment mode<select value={form.initialPaymentMode} onChange={(event) => setForm({ ...form, initialPaymentMode: event.target.value })} className={inputClass}><option value="">Choose mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label>}<div className="rounded-lg bg-stone-100 p-3"><p className="text-xs text-slate-500">Automatic Due</p><p className="mt-1 text-lg font-bold">{formatSalesMoney(initialDue)}</p></div></div>}
      <div className="mt-5 flex gap-2"><button disabled={isSaving} className={primaryButton}>{isSaving ? "Saving…" : editingId ? "Save Correction" : "Save Fuel Entry"}</button><button type="button" onClick={() => { setShowForm(false); setEditingId(""); }} className={secondaryButton}>Cancel</button></div>
    </form>}

    {showPayment && <form onSubmit={savePayment} className="mt-6 rounded-xl border border-stone-300 bg-white p-5"><div className="flex justify-between"><div><h3 className="text-lg font-bold">Settle Pump Dues</h3><p className="mt-1 text-sm text-slate-600">One payment, automatically allocated to the oldest outstanding refuels first.</p></div><button type="button" onClick={() => setShowPayment(false)} className="text-sm font-semibold">Close</button></div><div className="mt-4 grid gap-3 md:grid-cols-3"><SearchChoice label="Fuel Pump" options={pumps.map((pump) => ({ id: pump.id, label: pump.name }))} selectedId={paymentForm.pumpId} onSelect={(pumpId) => setPaymentForm({ ...paymentForm, pumpId })} placeholder="Search Pump" /><label className="text-xs">From date<input type="date" required value={paymentForm.fromDate} onChange={(event) => setPaymentForm({ ...paymentForm, fromDate: event.target.value })} className={inputClass} /></label><label className="text-xs">To date<input type="date" required value={paymentForm.toDate} onChange={(event) => setPaymentForm({ ...paymentForm, toDate: event.target.value })} className={inputClass} /></label></div><div className="mt-3 rounded-lg bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-800">Period Outstanding</p><p className="mt-1 text-2xl font-black text-amber-950">{formatSalesMoney(periodOutstanding.outstandingAmount)}</p><p className="mt-1 text-sm text-amber-900">{periodOutstanding.eligibleCount} outstanding Fuel {periodOutstanding.eligibleCount === 1 ? "entry" : "entries"}</p></div><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs">Payment Amount<input inputMode="decimal" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} className={inputClass} /></label><label className="text-xs">Payment date<input type="date" required value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} className={inputClass} /></label><label className="text-xs">Mode<select required value={paymentForm.paymentMode} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMode: event.target.value })} className={inputClass}><option value="">Choose mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label></div><label className="mt-3 block text-xs">Note (optional)<input value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} maxLength={500} className={inputClass} /></label><button disabled={isSavingPayment || periodOutstanding.eligibleCount === 0} className={`${primaryButton} mt-4`}>{isSavingPayment ? "Saving…" : "Save Batch Payment"}</button></form>}

    <section aria-labelledby="fuel-history-heading" className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-5"><h3 id="fuel-history-heading" className="text-xl font-bold">Vehicle and Pump Fuel history</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-medium">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium">Vehicle<select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className={inputClass}><option value="">All vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}{vehicle.isActive ? "" : " · Archived"}</option>)}</select></label><label className="text-xs font-medium">Fuel Pump<select value={pumpFilter} onChange={(event) => setPumpFilter(event.target.value)} className={inputClass}><option value="">All pumps</option>{pumps.map((pump) => <option key={pump.id} value={pump.id}>{pump.name}</option>)}</select></label></div></div><div className="grid grid-cols-2 bg-stone-50 sm:grid-cols-4"><Metric label="Fuel purchased" value={formatSalesMoney(summary.totalPurchased)} /><Metric label="Paid" value={formatSalesMoney(summary.totalPaid)} /><Metric label="Outstanding" value={formatSalesMoney(summary.totalOutstanding)} /><Metric label="Litres" value={`${summary.totalLitres.toLocaleString("en-IN")} L`} /></div><div className="overflow-auto"><table className="w-full min-w-[80rem] text-left text-sm"><thead className="border-y border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Date / Time</th><th className="px-3 py-3">Vehicle</th><th className="px-3 py-3">Pump</th><th className="px-3 py-3">Fuel</th><th className="px-3 py-3 text-right">Litres</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Due</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredRecords.map((record) => <tr key={record.id} onClick={() => { setSelectedId(record.id); setConfirmingVoid(false); }} className="cursor-pointer hover:bg-stone-50"><td className="px-3 py-3">{formatChallanDate(record.fuelDate)}<br/><span className="text-xs text-slate-500">{formatFuelTime(record.fuelTime)}</span></td><td className="px-3 py-3 font-semibold">{record.vehicleNumberSnapshot}</td><td className="px-3 py-3">{record.pumpNameSnapshot}</td><td className="px-3 py-3">{record.fuelType === "DIESEL" ? "Diesel" : "Petrol"}</td><td className="px-3 py-3 text-right">{record.litres.toLocaleString("en-IN")}</td><td className="px-3 py-3 text-right">{formatSalesMoney(record.ratePerLitre)}</td><td className="px-3 py-3 text-right font-bold">{formatSalesMoney(record.fuelAmount)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(record.totalPaid)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(record.outstandingAmount)}</td><td className="px-3 py-3">{record.status === "void" ? "Void" : record.paymentState === "partially_paid" ? "Partial" : record.paymentState === "paid" ? "Paid" : "Unpaid"}</td></tr>)}</tbody></table>{filteredRecords.length === 0 && <p className="p-6 text-sm text-slate-500">No Fuel entries in this range.</p>}</div></section>

    {selected && <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-lg font-bold">{selected.vehicleNumberSnapshot} · {selected.pumpNameSnapshot}</h3><p className="text-sm text-slate-600">{formatChallanDate(selected.fuelDate)}, {formatFuelTime(selected.fuelTime)} · {selected.litres.toLocaleString("en-IN")} L {selected.fuelType === "DIESEL" ? "Diesel" : "Petrol"}</p></div>{canChangeVehicleFuel(selected) ? <div className="flex gap-2"><button type="button" onClick={() => openEdit(selected)} className={secondaryButton}>Correct</button>{confirmingVoid ? <><button type="button" onClick={() => void confirmVoidRecord()} className="h-10 rounded-lg bg-red-700 px-4 text-sm font-bold text-white">Confirm Void</button><button type="button" onClick={() => setConfirmingVoid(false)} className={secondaryButton}>Cancel</button></> : <button type="button" onClick={() => setConfirmingVoid(true)} className={secondaryButton}>Void</button>}</div> : <p className="text-sm font-semibold text-amber-800">Payment history locks this Fuel entry.</p>}</div></section>}

    <section className="mt-6 rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 p-5"><h3 className="text-xl font-bold">Pump payment history</h3><p className="mt-1 text-sm text-slate-600">Each payment appears once; full refuel allocations stay here instead of expanding the Cash Book row.</p></div><div className="overflow-auto"><table className="w-full min-w-[80rem] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Payment date</th><th className="px-3 py-3">Pump</th><th className="px-3 py-3">Refuel allocations</th><th className="px-3 py-3">Mode</th><th className="px-3 py-3">Note</th><th className="px-3 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredPayments.map((payment) => <tr key={payment.id} className="align-top"><td className="px-3 py-3">{formatChallanDate(payment.paymentDate)}</td><td className="px-3 py-3 font-semibold">{payment.pumpName}<br/><span className="text-xs font-normal text-slate-500">{payment.allocationCount} {payment.allocationCount === 1 ? "refuel" : "refuels"}</span></td><td className="px-3 py-3"><ul className="divide-y divide-slate-100">{payment.allocations.map((allocation) => <li key={allocation.fuelRecordId} className="flex flex-wrap justify-between gap-3 py-1 first:pt-0 last:pb-0"><span>{formatChallanDate(allocation.fuelDate)}, {formatFuelTime(allocation.fuelTime)} · {allocation.vehicleNumberSnapshot} · {allocation.fuelType === "DIESEL" ? "Diesel" : "Petrol"} · {allocation.litres.toLocaleString("en-IN")} L</span><span className="font-semibold">{formatSalesMoney(allocation.allocatedAmount)}</span></li>)}</ul></td><td className="px-3 py-3">{formatCustomerPaymentMode(payment.paymentMode)}</td><td className="px-3 py-3">{payment.note ?? "—"}</td><td className="px-3 py-3 text-right font-bold">{formatSalesMoney(payment.amount)}</td></tr>)}</tbody></table>{filteredPayments.length === 0 && <p className="p-6 text-sm text-slate-500">No Pump payments in this range.</p>}</div></section>
  </section>;
}

function MeasurementInput({ label, field, value, derivedField, onChange, placeholder }: Readonly<{
  label: string; field: FuelMeasurementField; value: string;
  derivedField: FuelMeasurementField | null;
  onChange: (field: FuelMeasurementField, value: string) => void;
  placeholder: string;
}>) {
  const derived = field === derivedField;
  return <label className="text-xs font-medium text-slate-600">{label}{derived && <span className="ml-1 text-emerald-700">Calculated</span>}<input inputMode="decimal" required value={value} onChange={(event) => onChange(field, event.target.value)} placeholder={placeholder} className={`${inputClass} ${derived ? "bg-emerald-50" : ""}`} /></label>;
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
}
