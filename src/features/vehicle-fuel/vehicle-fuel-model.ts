import { isLocalDate } from "../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../sales/types.ts";
import type {
  CreateVehicleFuelInput,
  CreateVehicleFuelBatchPaymentInput,
  CreateVehicleFuelPaymentInput,
  FuelType,
  UpdateVehicleFuelInput,
  VehicleFuelBatchPayment,
  VehicleFuelRecord,
} from "./types.ts";

export type FuelMeasurementField = "litres" | "ratePerLitre" | "fuelAmount";

export type VehicleFuelForm = {
  fuelDate: string;
  fuelTime: string;
  vehicleId: string;
  pumpId: string;
  fuelType: FuelType;
  litres: string;
  ratePerLitre: string;
  fuelAmount: string;
  authoritativeFields: FuelMeasurementField[];
  initialPaidAmount: string;
  initialPaymentMode: string;
};

export type VehicleFuelPaymentForm = {
  fuelRecordId: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
};

export type VehicleFuelBatchPaymentForm = {
  pumpId: string;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
};

export type VehicleFuelPeriodOutstanding = {
  eligibleCount: number;
  outstandingAmount: number;
  eligibleRecords: VehicleFuelRecord[];
};

export type VehicleFuelSummary = {
  totalPurchased: number;
  totalPaid: number;
  totalOutstanding: number;
  totalLitres: number;
};

export type VehicleFuelPaymentReconciliation = {
  allocatedAmount: number;
  remainingAmount: number;
  reconciles: boolean;
};

export type VehicleFuelStateFilter = "all" | "unpaid" | "partially_paid" | "paid" | "void";

const FIELD_ORDER: FuelMeasurementField[] = ["litres", "ratePerLitre", "fuelAmount"];

export function getLocalTime(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function isLocalTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function emptyVehicleFuelForm(localToday: string, localTime: string): VehicleFuelForm {
  return {
    fuelDate: localToday,
    fuelTime: localTime,
    vehicleId: "",
    pumpId: "",
    fuelType: "DIESEL",
    litres: "",
    ratePerLitre: "",
    fuelAmount: "",
    authoritativeFields: [],
    initialPaidAmount: "",
    initialPaymentMode: "",
  };
}

export function vehicleFuelFormFromSaved(record: VehicleFuelRecord): VehicleFuelForm {
  return {
    fuelDate: record.fuelDate,
    fuelTime: record.fuelTime.slice(0, 5),
    vehicleId: record.vehicleId,
    pumpId: record.pumpId,
    fuelType: record.fuelType,
    litres: formatScaled(BigInt(Math.round(record.litres * 1_000_000)), 6),
    ratePerLitre: formatScaled(BigInt(Math.round(record.ratePerLitre * 1_000_000)), 6),
    fuelAmount: formatScaled(BigInt(Math.round(record.fuelAmount * 100)), 2),
    authoritativeFields: ["litres", "ratePerLitre"],
    initialPaidAmount: "",
    initialPaymentMode: "",
  };
}

export function updateFuelMeasurement(
  form: VehicleFuelForm,
  field: FuelMeasurementField,
  value: string,
): VehicleFuelForm {
  const authoritativeFields = [
    ...form.authoritativeFields.filter((candidate) => candidate !== field),
    field,
  ].slice(-2) as FuelMeasurementField[];
  const next = { ...form, [field]: value, authoritativeFields };
  if (authoritativeFields.length < 2) return next;
  const derivedField = FIELD_ORDER.find((candidate) => !authoritativeFields.includes(candidate))!;
  return { ...next, [derivedField]: deriveFuelMeasurement(next, derivedField) ?? "" };
}

export function getDerivedFuelMeasurementField(
  form: Pick<VehicleFuelForm, "authoritativeFields">,
): FuelMeasurementField | null {
  if (form.authoritativeFields.length !== 2) return null;
  return FIELD_ORDER.find((field) => !form.authoritativeFields.includes(field)) ?? null;
}

export function buildCreateVehicleFuelInput(
  factoryId: string,
  form: VehicleFuelForm,
): CreateVehicleFuelInput | null {
  const common = buildCommonInput(factoryId, form);
  if (!common) return null;
  const paidPaise = form.initialPaidAmount.trim()
    ? parseScaled(form.initialPaidAmount, 2, true)
    : 0n;
  if (paidPaise === null || paidPaise > common.amountPaise) return null;
  if (paidPaise > 0n && !isNewCustomerPaymentMode(form.initialPaymentMode)) return null;
  return {
    ...common.input,
    initialPaidAmount: Number(paidPaise) / 100,
    initialPaymentMode: paidPaise > 0n
      ? form.initialPaymentMode as CreateVehicleFuelInput["initialPaymentMode"]
      : null,
  };
}

export function buildUpdateVehicleFuelInput(
  factoryId: string,
  fuelRecordId: string,
  form: VehicleFuelForm,
): UpdateVehicleFuelInput | null {
  const common = buildCommonInput(factoryId, form);
  return common && fuelRecordId.trim() ? { ...common.input, fuelRecordId } : null;
}

export function emptyVehicleFuelPaymentForm(
  localToday: string,
  fuelRecordId = "",
): VehicleFuelPaymentForm {
  return { fuelRecordId, paymentDate: localToday, amount: "", paymentMode: "", note: "" };
}

export function emptyVehicleFuelBatchPaymentForm(localToday: string): VehicleFuelBatchPaymentForm {
  return {
    pumpId: "",
    fromDate: `${localToday.slice(0, 7)}-01`,
    toDate: localToday,
    paymentDate: localToday,
    amount: "",
    paymentMode: "",
    note: "",
  };
}

export function getVehicleFuelPeriodOutstanding(
  records: readonly VehicleFuelRecord[],
  pumpId: string,
  fromDate: string,
  toDate: string,
): VehicleFuelPeriodOutstanding {
  if (!pumpId.trim() || !isLocalDate(fromDate) || !isLocalDate(toDate) || fromDate > toDate) {
    return { eligibleCount: 0, outstandingAmount: 0, eligibleRecords: [] };
  }
  const eligibleRecords = records.filter((record) => record.pumpId === pumpId
    && record.fuelDate >= fromDate && record.fuelDate <= toDate
    && record.status === "active" && record.outstandingAmount > 0)
    .sort(compareFuelOldestFirst);
  const outstandingPaise = eligibleRecords.reduce(
    (sum, record) => sum + Math.round(record.outstandingAmount * 100), 0,
  );
  return {
    eligibleCount: eligibleRecords.length,
    outstandingAmount: outstandingPaise / 100,
    eligibleRecords,
  };
}

export function buildVehicleFuelBatchPaymentInput(
  factoryId: string,
  form: VehicleFuelBatchPaymentForm,
  records: readonly VehicleFuelRecord[],
): CreateVehicleFuelBatchPaymentInput | null {
  const period = getVehicleFuelPeriodOutstanding(
    records, form.pumpId, form.fromDate, form.toDate,
  );
  const amountPaise = parseScaled(form.amount, 2, false);
  if (!factoryId.trim() || period.eligibleCount === 0
    || !isLocalDate(form.paymentDate) || amountPaise === null
    || !isNewCustomerPaymentMode(form.paymentMode)
    || normalizeText(form.note).length > 500
    || amountPaise > BigInt(Math.round(period.outstandingAmount * 100))) return null;
  return {
    factoryId,
    pumpId: form.pumpId,
    fromDate: form.fromDate,
    toDate: form.toDate,
    paymentDate: form.paymentDate,
    amount: Number(amountPaise) / 100,
    paymentMode: form.paymentMode,
    note: normalizeText(form.note) || null,
  };
}

export function buildVehicleFuelPaymentInput(
  factoryId: string,
  form: VehicleFuelPaymentForm,
  records: readonly VehicleFuelRecord[],
): CreateVehicleFuelPaymentInput | null {
  const record = records.find((candidate) => candidate.id === form.fuelRecordId);
  const amountPaise = parseScaled(form.amount, 2, false);
  if (!factoryId.trim() || !record || record.status !== "active"
    || record.outstandingAmount <= 0 || !isLocalDate(form.paymentDate)
    || amountPaise === null || !isNewCustomerPaymentMode(form.paymentMode)
    || normalizeText(form.note).length > 500
    || amountPaise > BigInt(Math.round(record.outstandingAmount * 100))) return null;
  return {
    factoryId,
    fuelRecordId: record.id,
    paymentDate: form.paymentDate,
    amount: Number(amountPaise) / 100,
    paymentMode: form.paymentMode,
    note: normalizeText(form.note) || null,
  };
}

export function filterVehicleFuelRecords(
  records: readonly VehicleFuelRecord[],
  fromDate: string,
  toDate: string,
  vehicleId = "",
  pumpId = "",
  search = "",
  fuelType: FuelType | "" = "",
  state: VehicleFuelStateFilter = "all",
): VehicleFuelRecord[] {
  if ((fromDate && !isLocalDate(fromDate)) || (toDate && !isLocalDate(toDate))
    || (fromDate && toDate && fromDate > toDate)) return [];
  const query = search.trim().toLocaleLowerCase("en-IN");
  return records.filter((record) => (!fromDate || record.fuelDate >= fromDate)
    && (!toDate || record.fuelDate <= toDate)
    && (!vehicleId || record.vehicleId === vehicleId)
    && (!pumpId || record.pumpId === pumpId)
    && (!query || record.vehicleNumberSnapshot.toLocaleLowerCase().includes(query)
      || record.pumpNameSnapshot.toLocaleLowerCase().includes(query))
    && (!fuelType || record.fuelType === fuelType)
    && matchesVehicleFuelState(record, state))
    .sort((left, right) => right.fuelDate.localeCompare(left.fuelDate)
      || right.fuelTime.localeCompare(left.fuelTime)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id));
}

function matchesVehicleFuelState(
  record: VehicleFuelRecord,
  state: VehicleFuelStateFilter,
): boolean {
  if (state === "all") return true;
  if (state === "void") return record.status === "void";
  return record.status === "active" && record.paymentState === state;
}

export function summarizeVehicleFuel(records: readonly VehicleFuelRecord[]): VehicleFuelSummary {
  let purchasedPaise = 0;
  let paidPaise = 0;
  let outstandingPaise = 0;
  let litresMicrolitres = 0;
  for (const record of records) {
    if (record.status === "void") continue;
    purchasedPaise += Math.round(record.fuelAmount * 100);
    paidPaise += Math.round(record.totalPaid * 100);
    outstandingPaise += Math.round(record.outstandingAmount * 100);
    litresMicrolitres += Math.round(record.litres * 1_000_000);
  }
  return {
    totalPurchased: purchasedPaise / 100,
    totalPaid: paidPaise / 100,
    totalOutstanding: outstandingPaise / 100,
    totalLitres: litresMicrolitres / 1_000_000,
  };
}

export function filterVehicleFuelBatchPayments(
  payments: readonly VehicleFuelBatchPayment[],
  fromDate: string,
  toDate: string,
  pumpId = "",
  vehicleId = "",
  paymentMode: VehicleFuelBatchPayment["paymentMode"] | "" = "",
  searchTerm = "",
): VehicleFuelBatchPayment[] {
  if ((fromDate && !isLocalDate(fromDate)) || (toDate && !isLocalDate(toDate))
    || (fromDate && toDate && fromDate > toDate)) return [];
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("en-IN");
  return payments.filter((payment) => (!fromDate || payment.paymentDate >= fromDate)
    && (!toDate || payment.paymentDate <= toDate)
    && (!pumpId || payment.pumpId === pumpId)
    && (!vehicleId || payment.vehicleIds.includes(vehicleId))
    && (!paymentMode || payment.paymentMode === paymentMode)
    && (!normalizedSearch || [
      payment.pumpName,
      payment.note ?? "",
      ...payment.allocations.map((allocation) => allocation.vehicleNumberSnapshot),
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedSearch))))
    .sort((left, right) => right.paymentDate.localeCompare(left.paymentDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id));
}

export function getVehicleFuelPaymentAllocationReconciliation(
  payment: Pick<VehicleFuelBatchPayment, "amount" | "allocations">,
): VehicleFuelPaymentReconciliation {
  const paymentPaise = Math.round(payment.amount * 100);
  const allocatedPaise = payment.allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.allocatedAmount * 100),
    0,
  );
  return {
    allocatedAmount: allocatedPaise / 100,
    remainingAmount: (paymentPaise - allocatedPaise) / 100,
    reconciles: paymentPaise === allocatedPaise,
  };
}

export function canChangeVehicleFuel(
  record: Pick<VehicleFuelRecord, "status" | "isLocked" | "totalPaid">,
): boolean {
  return record.status === "active" && !record.isLocked && record.totalPaid === 0;
}

export function formatFuelTime(value: string): string {
  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

export function relativeRefuelAge(fuelDate: string, now = new Date()): string {
  if (!isLocalDate(fuelDate)) return "";
  const then = Date.UTC(Number(fuelDate.slice(0, 4)), Number(fuelDate.slice(5, 7)) - 1, Number(fuelDate.slice(8, 10)));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((today - then) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days > 1) return `${days} days ago`;
  return "future-dated";
}

function compareFuelOldestFirst(left: VehicleFuelRecord, right: VehicleFuelRecord): number {
  return left.fuelDate.localeCompare(right.fuelDate)
    || left.fuelTime.localeCompare(right.fuelTime)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function buildCommonInput(factoryId: string, form: VehicleFuelForm): {
  input: Omit<CreateVehicleFuelInput, "initialPaidAmount" | "initialPaymentMode">;
  amountPaise: bigint;
} | null {
  if (!factoryId.trim() || !isLocalDate(form.fuelDate) || !isLocalTime(form.fuelTime)
    || !form.vehicleId.trim() || !form.pumpId.trim()
    || (form.fuelType !== "DIESEL" && form.fuelType !== "PETROL")) return null;
  const derivedField = getDerivedFuelMeasurementField(form);
  if (!derivedField || deriveFuelMeasurement(form, derivedField) !== form[derivedField]) return null;
  const litres = parseScaled(form.litres, 6, false);
  const rate = parseScaled(form.ratePerLitre, 6, false);
  const amount = parseScaled(form.fuelAmount, 2, false);
  if (litres === null || rate === null || amount === null) return null;
  return {
    amountPaise: amount,
    input: {
      factoryId,
      fuelDate: form.fuelDate,
      fuelTime: form.fuelTime,
      vehicleId: form.vehicleId,
      pumpId: form.pumpId,
      fuelType: form.fuelType,
      litres: derivedField === "litres" ? null : Number(litres) / 1_000_000,
      ratePerLitre: derivedField === "ratePerLitre" ? null : Number(rate) / 1_000_000,
      fuelAmount: derivedField === "fuelAmount" ? null : Number(amount) / 100,
    },
  };
}

function deriveFuelMeasurement(form: VehicleFuelForm, derivedField: FuelMeasurementField): string | null {
  const litres = parseScaled(form.litres, 6, false);
  const rate = parseScaled(form.ratePerLitre, 6, false);
  const amount = parseScaled(form.fuelAmount, 2, false);
  if (derivedField === "fuelAmount" && litres !== null && rate !== null) {
    return formatScaled(roundDivide(litres * rate * 100n, 1_000_000_000_000n), 2);
  }
  if (derivedField === "ratePerLitre" && litres !== null && amount !== null && litres > 0n) {
    return formatScaled(roundDivide(amount * 1_000_000_000_000n, litres * 100n), 6);
  }
  if (derivedField === "litres" && rate !== null && amount !== null && rate > 0n) {
    return formatScaled(roundDivide(amount * 1_000_000_000_000n, rate * 100n), 6);
  }
  return null;
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function parseScaled(value: string, decimalPlaces: number, allowZero: boolean): bigint | null {
  const match = value.trim().match(new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimalPlaces}}))?$`));
  if (!match) return null;
  const factor = 10n ** BigInt(decimalPlaces);
  const scaled = BigInt(match[1]!) * factor
    + BigInt((match[2] ?? "").padEnd(decimalPlaces, "0") || "0");
  if ((!allowZero && scaled <= 0n) || scaled > 9_000_000_000_000_000n) return null;
  return scaled;
}

function formatScaled(value: bigint, decimalPlaces: number): string {
  const factor = 10n ** BigInt(decimalPlaces);
  const fraction = String(value % factor).padStart(decimalPlaces, "0").replace(/0+$/, "");
  return `${value / factor}${fraction ? `.${fraction}` : ""}`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
