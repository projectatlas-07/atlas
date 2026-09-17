"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildVehicleMaintenanceBatchPaymentInput,
  buildCreateVehicleMaintenanceInput,
  buildUpdateVehicleMaintenanceInput,
  canChangeVehicleMaintenance,
  emptyVehicleMaintenanceBatchPaymentForm,
  emptyVehicleMaintenanceForm,
  filterVehicleMaintenanceRecords,
  getVehicleMaintenancePeriodOutstanding,
  summarizeVehicleMaintenance,
  vehicleMaintenanceFormFromSaved,
  type VehicleMaintenanceBatchPaymentForm,
  type VehicleMaintenanceForm,
} from "../../vehicle-maintenance/vehicle-maintenance-model";
import {
  createVehicleMaintenanceBatchPayment,
  createVehicleMaintenance,
  listVehicleMaintenanceBatchPayments,
  listVehicleMaintenanceRecords,
  updateVehicleMaintenance,
  voidVehicleMaintenance,
} from "../../vehicle-maintenance/services/vehicle-maintenance-service";
import type { VehicleMaintenanceRecord } from "../../vehicle-maintenance/types";
import {
  createOrAssignSupplierRole,
  listSuppliersByRole,
} from "../../expenses/services/supplier-role-service";
import type { Supplier } from "../../expenses/types";
import { listVehicles } from "../../sales/services/vehicle-service";
import { formatCustomerPaymentMode, NEW_CUSTOMER_PAYMENT_MODES } from "../../sales/types";
import { formatChallanDate, formatSalesMoney } from "../sales-office-model";
import { getLocalDate } from "../../../lib/local-date";
import { SearchChoice } from "./search-choice";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 disabled:bg-slate-100";
const primaryButton = "h-10 rounded-lg bg-stone-900 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "h-10 rounded-lg border border-stone-400 bg-white px-4 text-sm font-bold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50";
const suppliersKey = (factoryId: string) => ["office-suppliers-by-role", factoryId, "GARAGE"] as const;
const vehiclesKey = (factoryId: string) => ["office-sales-vehicles", factoryId] as const;
const recordsKey = (factoryId: string) => ["office-vehicle-maintenance-records", factoryId] as const;
const paymentsKey = (factoryId: string) => ["office-vehicle-maintenance-payments", factoryId] as const;

export function VehicleMaintenanceOfficeSection({ factoryId }: Readonly<{ factoryId: string }>) {
  const queryClient = useQueryClient();
  const [localToday] = useState(() => getLocalDate());
  const [form, setForm] = useState<VehicleMaintenanceForm>(() => emptyVehicleMaintenanceForm(localToday));
  const [paymentForm, setPaymentForm] = useState<VehicleMaintenanceBatchPaymentForm>(() => emptyVehicleMaintenanceBatchPaymentForm(localToday));
  const [editingId, setEditingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showGarageDraft, setShowGarageDraft] = useState(false);
  const [garageDraft, setGarageDraft] = useState({ name: "", address: "", mobile: "" });
  const [fromDate, setFromDate] = useState(`${localToday.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(localToday);
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [garageFilter, setGarageFilter] = useState("");
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
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const entryVehicles = vehicles.filter((vehicle) => vehicle.isActive || vehicle.id === form.vehicleId);
  const filteredRecords = filterVehicleMaintenanceRecords(records, fromDate, toDate, vehicleFilter, garageFilter);
  const filteredPayments = payments.filter((payment) => payment.paymentDate >= fromDate
    && payment.paymentDate <= toDate
    && (!vehicleFilter || payment.vehicleIds.includes(vehicleFilter))
    && (!garageFilter || payment.garageId === garageFilter));
  const summary = summarizeVehicleMaintenance(filteredRecords);
  const periodOutstanding = getVehicleMaintenancePeriodOutstanding(
    records, paymentForm.garageId, paymentForm.fromDate, paymentForm.toDate,
  );
  const initialDue = Math.max(0, (Number(form.totalAmount) || 0) - (Number(form.initialPaidAmount) || 0));
  const queryError = suppliersQuery.error || vehiclesQuery.error || recordsQuery.error || paymentsQuery.error;

  function openCreate() {
    setForm(emptyVehicleMaintenanceForm(localToday));
    setEditingId("");
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openEdit(record: VehicleMaintenanceRecord) {
    if (!canChangeVehicleMaintenance(record)) return;
    setForm(vehicleMaintenanceFormFromSaved(record));
    setEditingId(record.id);
    setShowForm(true);
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
      setShowForm(false);
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
      setShowPayment(false);
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

  return <section aria-labelledby="vehicle-maintenance-heading" className="rounded-2xl border border-stone-300 bg-stone-50 p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="vehicle-maintenance-heading" className="text-2xl font-black tracking-tight">Vehicle Maintenance</h2><p className="mt-1 text-sm text-slate-600">Repairs, Garage dues, payments, and vehicle history</p></div><div className="flex gap-2"><button type="button" onClick={openCreate} className={primaryButton}>New Maintenance</button><button type="button" onClick={() => { setPaymentForm(emptyVehicleMaintenanceBatchPaymentForm(localToday)); setShowPayment(true); }} className={secondaryButton}>Pay Garage</button></div></div>
    {queryError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Could not load Vehicle Maintenance data.</p>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {success && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

    {showForm && <form onSubmit={saveRecord} className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{editingId ? "Correct Vehicle Maintenance" : "New Vehicle Maintenance"}</h3><button type="button" onClick={() => { setShowForm(false); setEditingId(""); }} className="text-sm font-semibold">Close</button></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SearchChoice label="Vehicle" options={entryVehicles.map((vehicle) => ({ id: vehicle.id, label: `${vehicle.vehicleNumber}${vehicle.isActive ? "" : " · Archived"}` }))} selectedId={form.vehicleId} onSelect={(vehicleId) => setForm({ ...form, vehicleId })} placeholder="Search Vehicle" />
        <label className="text-xs font-medium text-slate-600">Maintenance date<input type="date" required value={form.maintenanceDate} onChange={(event) => setForm({ ...form, maintenanceDate: event.target.value })} className={inputClass} /></label>
        <SearchChoice label="Mechanic / Garage" options={suppliers.map((garage) => ({ id: garage.id, label: garage.name }))} selectedId={form.garageId} onSelect={(garageId) => setForm({ ...form, garageId })} placeholder="Search Garage" />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-xs font-medium text-slate-600">Work / Repair<textarea required value={form.workDescription} onChange={(event) => setForm({ ...form, workDescription: event.target.value })} maxLength={300} rows={3} placeholder="Rear tyre replacement" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" /></label><label className="text-xs font-medium text-slate-600">Maintenance Amount<input inputMode="decimal" required value={form.totalAmount} onChange={(event) => setForm({ ...form, totalAmount: event.target.value })} placeholder="8000" className={inputClass} /></label></div>
      <button type="button" onClick={() => setShowGarageDraft((current) => !current)} className={`${secondaryButton} mt-3`}>Add Garage</button>
      {showGarageDraft && <fieldset className="mt-3 rounded-lg bg-stone-50 p-4"><legend className="font-bold">Add reusable Mechanic / Garage</legend><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs">Name<input value={garageDraft.name} onChange={(event) => setGarageDraft({ ...garageDraft, name: event.target.value })} className={inputClass} /></label><label className="text-xs">Address (optional)<input value={garageDraft.address} onChange={(event) => setGarageDraft({ ...garageDraft, address: event.target.value })} className={inputClass} /></label><label className="text-xs">Mobile (optional)<input value={garageDraft.mobile} onChange={(event) => setGarageDraft({ ...garageDraft, mobile: event.target.value })} className={inputClass} /></label></div><button type="button" disabled={isSavingGarage} onClick={() => void saveGarage()} className={`${primaryButton} mt-3`}>Save Garage</button></fieldset>}
      {!editingId && <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium text-slate-600">Paid now (blank or 0 = unpaid)<input inputMode="decimal" value={form.initialPaidAmount} onChange={(event) => setForm({ ...form, initialPaidAmount: event.target.value })} placeholder="0" className={inputClass} /></label>{Number(form.initialPaidAmount) > 0 && <label className="text-xs font-medium text-slate-600">Payment mode<select value={form.initialPaymentMode} onChange={(event) => setForm({ ...form, initialPaymentMode: event.target.value })} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label>}<Money label="Automatic Due" value={initialDue} /></div>}
      <button type="submit" disabled={isSaving} className={`${primaryButton} mt-5`}>{isSaving ? "Saving..." : editingId ? "Save correction" : "Save Maintenance"}</button>
    </form>}

    {showPayment && <form onSubmit={savePayment} className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">Settle Garage Dues</h3><p className="mt-1 text-sm text-slate-600">One payment, automatically allocated to the oldest outstanding Maintenance jobs first.</p></div><button type="button" onClick={() => setShowPayment(false)} className="text-sm font-semibold">Close</button></div><div className="mt-4 grid gap-3 md:grid-cols-3"><SearchChoice label="Garage" options={suppliers.map((garage) => ({ id: garage.id, label: garage.name }))} selectedId={paymentForm.garageId} onSelect={(garageId) => setPaymentForm({ ...paymentForm, garageId })} placeholder="Search Garage" /><label className="text-xs font-medium text-slate-600">From Date<input type="date" required value={paymentForm.fromDate} onChange={(event) => setPaymentForm({ ...paymentForm, fromDate: event.target.value })} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">To Date<input type="date" required value={paymentForm.toDate} onChange={(event) => setPaymentForm({ ...paymentForm, toDate: event.target.value })} className={inputClass} /></label></div><div className="mt-3 rounded-lg bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-800">Period Outstanding</p><p className="mt-1 text-2xl font-black text-amber-950">{formatSalesMoney(periodOutstanding.outstandingAmount)}</p><p className="mt-1 text-sm text-amber-900">{periodOutstanding.eligibleCount} outstanding {periodOutstanding.eligibleCount === 1 ? "job" : "jobs"}</p></div><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs font-medium text-slate-600">Payment Amount<input inputMode="decimal" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">Payment Date<input type="date" required value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} className={inputClass} /></label><label className="text-xs font-medium text-slate-600">Payment Mode<select required value={paymentForm.paymentMode} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMode: event.target.value })} className={inputClass}><option value="">Select mode</option>{NEW_CUSTOMER_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCustomerPaymentMode(mode)}</option>)}</select></label></div><label className="mt-3 block max-w-xl text-xs font-medium text-slate-600">Note (optional)<input value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} maxLength={500} className={inputClass} /></label><button type="submit" disabled={isSavingPayment || periodOutstanding.eligibleCount === 0} className={`${primaryButton} mt-4`}>{isSavingPayment ? "Saving..." : "Save Garage Payment"}</button></form>}

    <section aria-labelledby="maintenance-history-heading" className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-5"><h3 id="maintenance-history-heading" className="text-xl font-bold">Vehicle and Garage Maintenance history</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-medium">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium">Vehicle<select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className={inputClass}><option value="">All vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}{vehicle.isActive ? "" : " · Archived"}</option>)}</select></label><label className="text-xs font-medium">Garage<select value={garageFilter} onChange={(event) => setGarageFilter(event.target.value)} className={inputClass}><option value="">All garages</option>{suppliers.map((garage) => <option key={garage.id} value={garage.id}>{garage.name}</option>)}</select></label></div></div><div className="grid grid-cols-2 bg-stone-50 sm:grid-cols-4"><Money label="Work billed" value={summary.totalBilled} /><Money label="Paid against jobs" value={summary.totalPaid} /><Money label="Outstanding" value={summary.totalOutstanding} /><div className="p-4"><p className="text-xs uppercase text-slate-500">Active jobs</p><p className="mt-1 text-lg font-bold">{summary.activeJobs}</p></div></div><div className="overflow-auto"><table className="w-full min-w-[70rem] text-left text-sm"><thead className="border-y border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">Vehicle</th><th className="px-3 py-3">Work / Repair</th><th className="px-3 py-3">Garage</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Due</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredRecords.map((record) => <tr key={record.id} onClick={() => { setSelectedId(record.id); setConfirmingVoid(false); }} className="cursor-pointer hover:bg-stone-50"><td className="px-3 py-3">{formatChallanDate(record.maintenanceDate)}</td><td className="px-3 py-3 font-semibold">{record.vehicleNumberSnapshot}</td><td className="px-3 py-3">{record.workDescription}</td><td className="px-3 py-3">{record.garageNameSnapshot}</td><td className="px-3 py-3 text-right font-bold">{formatSalesMoney(record.totalAmount)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(record.totalPaid)}</td><td className="px-3 py-3 text-right">{formatSalesMoney(record.outstandingAmount)}</td><td className="px-3 py-3">{record.status === "void" ? "Void" : record.paymentState === "partially_paid" ? "Partial" : record.paymentState === "paid" ? "Paid" : "Unpaid"}</td></tr>)}</tbody></table>{filteredRecords.length === 0 && <p className="p-6 text-sm text-slate-500">No Vehicle Maintenance in this range.</p>}</div></section>

    {selected && <section className="mt-6 rounded-xl border border-stone-300 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">{selected.vehicleNumberSnapshot} · {selected.workDescription}</h3><p className="mt-1 text-sm text-slate-600">{formatChallanDate(selected.maintenanceDate)} · {selected.garageNameSnapshot}</p></div><button type="button" onClick={() => setSelectedId("")} className="text-sm font-semibold">Close</button></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Money label="Total" value={selected.totalAmount} /><Money label="Paid" value={selected.totalPaid} /><Money label="Outstanding" value={selected.outstandingAmount} /></div><div className="mt-4 flex gap-2"><button type="button" disabled={!canChangeVehicleMaintenance(selected)} onClick={() => openEdit(selected)} className={secondaryButton}>Correct</button><button type="button" disabled={!canChangeVehicleMaintenance(selected)} onClick={() => setConfirmingVoid(true)} className={secondaryButton}>Void</button><button type="button" disabled={selected.status !== "active" || selected.outstandingAmount <= 0} onClick={() => { const next = emptyVehicleMaintenanceBatchPaymentForm(localToday); setPaymentForm({ ...next, garageId: selected.garageId, fromDate: selected.maintenanceDate, toDate: selected.maintenanceDate }); setShowPayment(true); }} className={primaryButton}>Pay Garage</button></div>{!canChangeVehicleMaintenance(selected) && selected.totalPaid > 0 && <p className="mt-3 text-xs text-slate-500">Payment history locks this Maintenance job from correction or voiding.</p>}{confirmingVoid && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm"><p className="font-semibold text-red-800">Void this unpaid Vehicle Maintenance record?</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void confirmVoidRecord()} className="h-9 rounded bg-red-700 px-3 font-bold text-white">Confirm Void</button><button type="button" onClick={() => setConfirmingVoid(false)} className={secondaryButton}>Cancel</button></div></div>}</section>}

    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold">Garage payment history</h3><p className="mt-1 text-xs text-slate-500">Filtered by the same dates, Vehicle, and Garage above. Each immutable payment appears once with its allocation details.</p>{filteredPayments.length === 0 ? <p className="mt-4 text-sm text-slate-500">No Garage payments in this range.</p> : <ul className="mt-4 space-y-3">{filteredPayments.map((payment) => <li key={payment.id} className="rounded-lg border border-slate-200 p-4 text-sm"><div className="flex flex-wrap justify-between gap-3"><span><strong>{payment.garageNameSnapshot}</strong> · {formatChallanDate(payment.paymentDate)} · {formatCustomerPaymentMode(payment.paymentMode)} · Garage settlement · {payment.allocationCount} {payment.allocationCount === 1 ? "job" : "jobs"}{payment.note ? ` · ${payment.note}` : ""}</span><span className="font-bold">{formatSalesMoney(payment.amount)}</span></div><ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">{payment.allocations.map((allocation) => <li key={allocation.maintenanceId} className="flex flex-wrap justify-between gap-3 py-2"><span>{formatChallanDate(allocation.maintenanceDate)} · {allocation.vehicleNumberSnapshot} · {allocation.workDescription}</span><span className="font-semibold">{formatSalesMoney(allocation.allocatedAmount)}</span></li>)}</ul></li>)}</ul>}</section>
  </section>;
}

function Money({ label, value }: Readonly<{ label: string; value: number }>) {
  return <div className="p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{formatSalesMoney(value)}</p></div>;
}
