import { isLocalDate } from "../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../sales/types.ts";
import type {
  CreateVehicleMaintenanceBatchPaymentInput,
  CreateVehicleMaintenanceInput,
  CreateVehicleMaintenancePaymentInput,
  UpdateVehicleMaintenanceInput,
  VehicleMaintenanceRecord,
} from "./types.ts";

export type VehicleMaintenanceForm = {
  maintenanceDate: string;
  vehicleId: string;
  garageId: string;
  workDescription: string;
  totalAmount: string;
  initialPaidAmount: string;
  initialPaymentMode: string;
};

export type VehicleMaintenancePaymentForm = {
  maintenanceId: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
};

export type VehicleMaintenanceBatchPaymentForm = {
  garageId: string;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
};

export type VehicleMaintenancePeriodOutstanding = {
  eligibleCount: number;
  outstandingAmount: number;
  eligibleRecords: VehicleMaintenanceRecord[];
};

export type VehicleMaintenanceSummary = {
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  activeJobs: number;
};

export function emptyVehicleMaintenanceForm(localToday: string): VehicleMaintenanceForm {
  return {
    maintenanceDate: localToday,
    vehicleId: "",
    garageId: "",
    workDescription: "",
    totalAmount: "",
    initialPaidAmount: "",
    initialPaymentMode: "",
  };
}

export function vehicleMaintenanceFormFromSaved(
  record: VehicleMaintenanceRecord,
): VehicleMaintenanceForm {
  return {
    maintenanceDate: record.maintenanceDate,
    vehicleId: record.vehicleId,
    garageId: record.garageId,
    workDescription: record.workDescription,
    totalAmount: formatMoney(record.totalAmount),
    initialPaidAmount: "",
    initialPaymentMode: "",
  };
}

export function buildCreateVehicleMaintenanceInput(
  factoryId: string,
  form: VehicleMaintenanceForm,
): CreateVehicleMaintenanceInput | null {
  const common = buildCommonInput(factoryId, form);
  if (!common) return null;
  const paidPaise = form.initialPaidAmount.trim()
    ? parseMoney(form.initialPaidAmount, true)
    : 0n;
  if (paidPaise === null || paidPaise > common.totalPaise) return null;
  if (paidPaise > 0n && !isNewCustomerPaymentMode(form.initialPaymentMode)) return null;
  return {
    ...common.input,
    initialPaidAmount: Number(paidPaise) / 100,
    initialPaymentMode: paidPaise > 0n
      ? form.initialPaymentMode as CreateVehicleMaintenanceInput["initialPaymentMode"]
      : null,
  };
}

export function buildUpdateVehicleMaintenanceInput(
  factoryId: string,
  maintenanceId: string,
  form: VehicleMaintenanceForm,
): UpdateVehicleMaintenanceInput | null {
  const common = buildCommonInput(factoryId, form);
  return common && maintenanceId.trim()
    ? { ...common.input, maintenanceId }
    : null;
}

export function emptyVehicleMaintenancePaymentForm(
  localToday: string,
  maintenanceId = "",
): VehicleMaintenancePaymentForm {
  return { maintenanceId, paymentDate: localToday, amount: "", paymentMode: "", note: "" };
}

export function emptyVehicleMaintenanceBatchPaymentForm(
  localToday: string,
): VehicleMaintenanceBatchPaymentForm {
  return {
    garageId: "",
    fromDate: `${localToday.slice(0, 7)}-01`,
    toDate: localToday,
    paymentDate: localToday,
    amount: "",
    paymentMode: "",
    note: "",
  };
}

export function getVehicleMaintenancePeriodOutstanding(
  records: readonly VehicleMaintenanceRecord[],
  garageId: string,
  fromDate: string,
  toDate: string,
): VehicleMaintenancePeriodOutstanding {
  if (!garageId.trim() || !isLocalDate(fromDate) || !isLocalDate(toDate) || fromDate > toDate) {
    return { eligibleCount: 0, outstandingAmount: 0, eligibleRecords: [] };
  }
  const eligibleRecords = records.filter((record) => record.garageId === garageId
    && record.maintenanceDate >= fromDate && record.maintenanceDate <= toDate
    && record.status === "active" && record.outstandingAmount > 0)
    .sort(compareMaintenanceOldestFirst);
  const outstandingPaise = eligibleRecords.reduce(
    (sum, record) => sum + Math.round(record.outstandingAmount * 100), 0,
  );
  return {
    eligibleCount: eligibleRecords.length,
    outstandingAmount: outstandingPaise / 100,
    eligibleRecords,
  };
}

export function buildVehicleMaintenanceBatchPaymentInput(
  factoryId: string,
  form: VehicleMaintenanceBatchPaymentForm,
  records: readonly VehicleMaintenanceRecord[],
): CreateVehicleMaintenanceBatchPaymentInput | null {
  const period = getVehicleMaintenancePeriodOutstanding(
    records, form.garageId, form.fromDate, form.toDate,
  );
  const amountPaise = parseMoney(form.amount, false);
  if (!factoryId.trim() || period.eligibleCount === 0
    || !isLocalDate(form.paymentDate) || amountPaise === null
    || !isNewCustomerPaymentMode(form.paymentMode)
    || normalizeText(form.note).length > 500
    || amountPaise > BigInt(Math.round(period.outstandingAmount * 100))) return null;
  return {
    factoryId,
    garageId: form.garageId,
    fromDate: form.fromDate,
    toDate: form.toDate,
    paymentDate: form.paymentDate,
    amount: Number(amountPaise) / 100,
    paymentMode: form.paymentMode,
    note: normalizeText(form.note) || null,
  };
}

export function buildVehicleMaintenancePaymentInput(
  factoryId: string,
  form: VehicleMaintenancePaymentForm,
  records: readonly VehicleMaintenanceRecord[],
): CreateVehicleMaintenancePaymentInput | null {
  const record = records.find((candidate) => candidate.id === form.maintenanceId);
  const amountPaise = parseMoney(form.amount, false);
  if (!factoryId.trim() || !record || record.status !== "active"
    || record.outstandingAmount <= 0 || !isLocalDate(form.paymentDate)
    || amountPaise === null || !isNewCustomerPaymentMode(form.paymentMode)
    || normalizeText(form.note).length > 500
    || amountPaise > BigInt(Math.round(record.outstandingAmount * 100))) return null;
  return {
    factoryId,
    maintenanceId: record.id,
    paymentDate: form.paymentDate,
    amount: Number(amountPaise) / 100,
    paymentMode: form.paymentMode,
    note: normalizeText(form.note) || null,
  };
}

export function filterVehicleMaintenanceRecords(
  records: readonly VehicleMaintenanceRecord[],
  fromDate: string,
  toDate: string,
  vehicleId = "",
  garageId = "",
): VehicleMaintenanceRecord[] {
  if (!isLocalDate(fromDate) || !isLocalDate(toDate) || fromDate > toDate) return [];
  return records.filter((record) => record.maintenanceDate >= fromDate
    && record.maintenanceDate <= toDate
    && (!vehicleId || record.vehicleId === vehicleId)
    && (!garageId || record.garageId === garageId));
}

export function summarizeVehicleMaintenance(
  records: readonly VehicleMaintenanceRecord[],
): VehicleMaintenanceSummary {
  let billedPaise = 0;
  let paidPaise = 0;
  let outstandingPaise = 0;
  let activeJobs = 0;
  for (const record of records) {
    if (record.status === "void") continue;
    activeJobs += 1;
    billedPaise += Math.round(record.totalAmount * 100);
    paidPaise += Math.round(record.totalPaid * 100);
    outstandingPaise += Math.round(record.outstandingAmount * 100);
  }
  return {
    totalBilled: billedPaise / 100,
    totalPaid: paidPaise / 100,
    totalOutstanding: outstandingPaise / 100,
    activeJobs,
  };
}

export function canChangeVehicleMaintenance(
  record: Pick<VehicleMaintenanceRecord, "status" | "isLocked" | "totalPaid">,
): boolean {
  return record.status === "active" && !record.isLocked && record.totalPaid === 0;
}

function compareMaintenanceOldestFirst(
  left: VehicleMaintenanceRecord,
  right: VehicleMaintenanceRecord,
): number {
  return left.maintenanceDate.localeCompare(right.maintenanceDate)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function buildCommonInput(factoryId: string, form: VehicleMaintenanceForm): {
  input: Omit<CreateVehicleMaintenanceInput, "initialPaidAmount" | "initialPaymentMode">;
  totalPaise: bigint;
} | null {
  const workDescription = normalizeText(form.workDescription);
  const totalPaise = parseMoney(form.totalAmount, false);
  if (!factoryId.trim() || !isLocalDate(form.maintenanceDate)
    || !form.vehicleId.trim() || !form.garageId.trim()
    || !workDescription || workDescription.length > 300 || totalPaise === null) return null;
  return {
    totalPaise,
    input: {
      factoryId,
      maintenanceDate: form.maintenanceDate,
      vehicleId: form.vehicleId,
      garageId: form.garageId,
      workDescription,
      totalAmount: Number(totalPaise) / 100,
    },
  };
}

function parseMoney(value: string, allowZero: boolean): bigint | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if ((!allowZero && paise <= 0n) || paise >= 1_000_000_000_000_000_000n) return null;
  return paise;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatMoney(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}
