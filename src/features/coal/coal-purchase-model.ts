import { isLocalDate } from "../../lib/local-date.ts";
import { isNewCustomerPaymentMode } from "../sales/types.ts";
import type {
  CoalPurchase,
  CoalPayment,
  CoalPurchaseMeasurementInput,
  CreateCoalPaymentInput,
  CreateCoalPurchaseInput,
  CreateCoalSelectivePaymentInput,
  UpdateCoalPurchaseInput,
} from "./types.ts";

export type CoalMeasurementField = "quantity" | "rate" | "coalAmount";

export type CoalPurchaseForm = {
  purchaseDate: string;
  sellerId: string;
  coalNameReferenceId: string;
  sourceReferenceId: string;
  coalChallanNumber: string;
  vehicleNumber: string;
  quantity: string;
  rate: string;
  coalAmount: string;
  authoritativeFields: CoalMeasurementField[];
  hasSeparateFreight: boolean;
  separateFreightAmount: string;
  initialPaidAmount: string;
  initialPaymentMode: string;
};

export type CoalPaymentForm = {
  purchaseId: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
};

export type CoalSelectivePaymentForm = {
  sellerId: string;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  amount: string;
  paymentMode: string;
  note: string;
  allocations: Record<string, string>;
};

export type CoalSelectivePaymentStatus = {
  periodOutstanding: number;
  selectedPurchases: number;
  paymentAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
  selectedPayment: number;
  canSubmit: boolean;
  error: string;
};

export type CoalPurchaseSummary = {
  totalPurchased: number;
  totalPaid: number;
  totalOutstanding: number;
  activePurchases: number;
};

export type CoalPaymentStatusFilter = "all" | "unpaid" | "partial" | "paid";

const FIELD_ORDER: CoalMeasurementField[] = ["quantity", "rate", "coalAmount"];

export function emptyCoalPurchaseForm(localToday: string): CoalPurchaseForm {
  return {
    purchaseDate: localToday,
    sellerId: "",
    coalNameReferenceId: "",
    sourceReferenceId: "",
    coalChallanNumber: "",
    vehicleNumber: "",
    quantity: "",
    rate: "",
    coalAmount: "",
    authoritativeFields: [],
    hasSeparateFreight: false,
    separateFreightAmount: "",
    initialPaidAmount: "",
    initialPaymentMode: "",
  };
}

export function coalPurchaseFormFromSaved(purchase: CoalPurchase): CoalPurchaseForm {
  return {
    purchaseDate: purchase.purchaseDate,
    sellerId: purchase.sellerId,
    coalNameReferenceId: purchase.coalNameReferenceId,
    sourceReferenceId: purchase.sourceReferenceId,
    coalChallanNumber: purchase.coalChallanNumber ?? "",
    vehicleNumber: purchase.vehicleNumberSnapshot,
    quantity: formatDecimal(purchase.quantity, 6),
    rate: formatDecimal(purchase.rate, 6),
    coalAmount: formatDecimal(purchase.coalAmount, 2),
    authoritativeFields: ["quantity", "rate"],
    hasSeparateFreight: purchase.separateFreightAmount > 0,
    separateFreightAmount: purchase.separateFreightAmount > 0
      ? formatDecimal(purchase.separateFreightAmount, 2)
      : "",
    initialPaidAmount: "",
    initialPaymentMode: "",
  };
}

export function updateCoalMeasurement(
  form: CoalPurchaseForm,
  field: CoalMeasurementField,
  value: string,
): CoalPurchaseForm {
  const authoritativeFields = [
    ...form.authoritativeFields.filter((candidate) => candidate !== field),
    field,
  ].slice(-2) as CoalMeasurementField[];
  const next = { ...form, [field]: value, authoritativeFields };
  if (authoritativeFields.length < 2) return next;
  const derivedField = FIELD_ORDER.find((candidate) => !authoritativeFields.includes(candidate))!;
  const derivedValue = deriveMeasurement(next, derivedField);
  return { ...next, [derivedField]: derivedValue ?? "" };
}

export function getDerivedCoalMeasurementField(
  form: Pick<CoalPurchaseForm, "authoritativeFields">,
): CoalMeasurementField | null {
  if (form.authoritativeFields.length !== 2) return null;
  return FIELD_ORDER.find((field) => !form.authoritativeFields.includes(field)) ?? null;
}

export function getCoalFinalTotal(form: CoalPurchaseForm): number | null {
  const coalAmountPaise = parseScaled(form.coalAmount, 2, false);
  if (coalAmountPaise === null) return null;
  const freightPaise = form.hasSeparateFreight
    ? parseScaled(form.separateFreightAmount, 2, true)
    : 0n;
  if (freightPaise === null) return null;
  return Number(coalAmountPaise + freightPaise) / 100;
}

export function buildCreateCoalPurchaseInput(
  factoryId: string,
  form: CoalPurchaseForm,
): CreateCoalPurchaseInput | null {
  const common = buildCoalPurchaseInput(factoryId, form);
  if (!common) return null;
  const initialPaidPaise = form.initialPaidAmount.trim()
    ? parseScaled(form.initialPaidAmount, 2, true)
    : 0n;
  if (initialPaidPaise === null) return null;
  const finalTotalPaise = BigInt(Math.round(common.finalTotal * 100));
  if (initialPaidPaise > finalTotalPaise) return null;
  if (initialPaidPaise > 0n && !isNewCustomerPaymentMode(form.initialPaymentMode)) return null;
  return {
    ...common.input,
    initialPaidAmount: Number(initialPaidPaise) / 100,
    initialPaymentMode: initialPaidPaise > 0n
      ? form.initialPaymentMode as CreateCoalPurchaseInput["initialPaymentMode"]
      : null,
  };
}

export function buildUpdateCoalPurchaseInput(
  factoryId: string,
  purchaseId: string,
  form: CoalPurchaseForm,
): UpdateCoalPurchaseInput | null {
  const common = buildCoalPurchaseInput(factoryId, form);
  return common && purchaseId.trim() ? { ...common.input, purchaseId } : null;
}

export function emptyCoalPaymentForm(localToday: string, purchaseId = ""): CoalPaymentForm {
  return { purchaseId, paymentDate: localToday, amount: "", paymentMode: "", note: "" };
}

export function buildCoalPaymentInput(
  factoryId: string,
  form: CoalPaymentForm,
  purchases: readonly CoalPurchase[],
): CreateCoalPaymentInput | null {
  const purchase = purchases.find((candidate) => candidate.id === form.purchaseId);
  const amountPaise = parseScaled(form.amount, 2, false);
  if (!factoryId.trim() || !purchase || purchase.status !== "active"
    || purchase.outstandingAmount <= 0 || !isLocalDate(form.paymentDate)
    || amountPaise === null || !isNewCustomerPaymentMode(form.paymentMode)
    || normalizeText(form.note).length > 500
    || amountPaise > BigInt(Math.round(purchase.outstandingAmount * 100))) return null;
  return {
    factoryId,
    purchaseId: purchase.id,
    paymentDate: form.paymentDate,
    amount: Number(amountPaise) / 100,
    paymentMode: form.paymentMode,
    note: normalizeText(form.note) || null,
  };
}

export function emptyCoalSelectivePaymentForm(localToday: string): CoalSelectivePaymentForm {
  return {
    sellerId: "",
    fromDate: `${localToday.slice(0, 7)}-01`,
    toDate: localToday,
    paymentDate: localToday,
    amount: "",
    paymentMode: "",
    note: "",
    allocations: {},
  };
}

export function getEligibleCoalSettlementPurchases(
  purchases: readonly CoalPurchase[],
  sellerId: string,
  fromDate: string,
  toDate: string,
): CoalPurchase[] {
  if (!sellerId || !isLocalDate(fromDate) || !isLocalDate(toDate) || fromDate > toDate) return [];
  return purchases.filter((purchase) => purchase.factoryId
    && purchase.sellerId === sellerId
    && purchase.purchaseDate >= fromDate
    && purchase.purchaseDate <= toDate
    && purchase.status === "active"
    && purchase.outstandingAmount > 0)
    .sort((left, right) => left.purchaseDate.localeCompare(right.purchaseDate)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id));
}

export function toggleCoalSettlementPurchase(
  form: CoalSelectivePaymentForm,
  purchase: CoalPurchase,
  selected: boolean,
): CoalSelectivePaymentForm {
  const allocations = { ...form.allocations };
  if (selected) allocations[purchase.id] = formatDecimal(purchase.outstandingAmount, 2);
  else delete allocations[purchase.id];
  return { ...form, amount: formatCoalAllocationTotal(allocations), allocations };
}

export function setCoalSettlementAllocation(
  form: CoalSelectivePaymentForm,
  purchaseId: string,
  amount: string,
): CoalSelectivePaymentForm {
  if (!Object.prototype.hasOwnProperty.call(form.allocations, purchaseId)) return form;
  const allocations = { ...form.allocations, [purchaseId]: amount };
  return { ...form, amount: formatCoalAllocationTotal(allocations), allocations };
}

export function setCoalSettlementPaymentAmount(
  form: CoalSelectivePaymentForm,
  amount: string,
): CoalSelectivePaymentForm {
  const selectedPurchaseIds = Object.keys(form.allocations);
  if (selectedPurchaseIds.length !== 1) return { ...form, amount };
  return {
    ...form,
    amount,
    allocations: { [selectedPurchaseIds[0]!]: amount },
  };
}

export function getCoalSelectivePaymentStatus(
  form: CoalSelectivePaymentForm,
  purchases: readonly CoalPurchase[],
): CoalSelectivePaymentStatus {
  const eligible = getEligibleCoalSettlementPurchases(
    purchases, form.sellerId, form.fromDate, form.toDate,
  );
  const eligibleById = new Map(eligible.map((purchase) => [purchase.id, purchase]));
  const selected = Object.entries(form.allocations);
  const paymentPaise = parseScaled(form.amount, 2, false);
  let selectedPaise = 0n;
  let error = "";
  if (!form.sellerId) error = "Choose a Coal Seller.";
  else if (!isLocalDate(form.fromDate) || !isLocalDate(form.toDate) || form.fromDate > form.toDate) {
    error = "Choose a valid inclusive date range.";
  } else if (!isLocalDate(form.paymentDate)) error = "Choose a valid payment date.";
  else if (paymentPaise === null) error = "Enter a payment amount greater than zero.";
  else if (!isNewCustomerPaymentMode(form.paymentMode)) error = "Choose a payment mode.";
  else if (normalizeText(form.note).length > 500) error = "Note must be at most 500 characters.";
  else if (selected.length === 0) error = "Select at least one Coal Purchase.";

  for (const [purchaseId, rawAmount] of selected) {
    const purchase = eligibleById.get(purchaseId);
    const amountPaise = parseScaled(rawAmount, 2, false);
    if (!purchase && !error) error = "A selected Coal Purchase is no longer eligible.";
    else if (amountPaise === null && !error) error = "Every selected purchase needs a positive Pay This Time amount.";
    else if (purchase && amountPaise !== null
      && amountPaise > BigInt(Math.round(purchase.outstandingAmount * 100)) && !error) {
      error = `Payment for ${purchase.coalChallanNumber ? `Challan ${purchase.coalChallanNumber}` : purchase.coalNameSnapshot} exceeds its outstanding amount.`;
    }
    if (amountPaise !== null) selectedPaise += amountPaise;
  }
  const safePaymentPaise = paymentPaise ?? 0n;
  const remainingPaise = safePaymentPaise - selectedPaise;
  if (!error && remainingPaise !== 0n) {
    error = remainingPaise > 0n
      ? "Allocate the full payment amount before saving."
      : "Allocated amount cannot exceed the payment amount.";
  }
  const periodPaise = eligible.reduce(
    (total, purchase) => total + BigInt(Math.round(purchase.outstandingAmount * 100)), 0n,
  );
  return {
    periodOutstanding: Number(periodPaise) / 100,
    selectedPurchases: selected.length,
    paymentAmount: Number(safePaymentPaise) / 100,
    allocatedAmount: Number(selectedPaise) / 100,
    remainingAmount: Number(remainingPaise) / 100,
    selectedPayment: Number(selectedPaise) / 100,
    canSubmit: !error && selected.length > 0 && selectedPaise > 0n,
    error,
  };
}

export function buildCoalSelectivePaymentInput(
  factoryId: string,
  form: CoalSelectivePaymentForm,
  purchases: readonly CoalPurchase[],
): CreateCoalSelectivePaymentInput | null {
  const status = getCoalSelectivePaymentStatus(form, purchases);
  if (!factoryId.trim() || !status.canSubmit) return null;
  return {
    factoryId,
    sellerId: form.sellerId,
    fromDate: form.fromDate,
    toDate: form.toDate,
    paymentDate: form.paymentDate,
    paymentMode: form.paymentMode as CreateCoalSelectivePaymentInput["paymentMode"],
    note: normalizeText(form.note) || null,
    allocations: Object.entries(form.allocations).map(([purchaseId, amount]) => ({
      purchaseId,
      amount: Number(parseScaled(amount, 2, false)!) / 100,
    })),
  };
}

export function filterCoalPurchases(
  purchases: readonly CoalPurchase[],
  fromDate: string,
  toDate: string,
  sellerId = "",
  paymentStatus: CoalPaymentStatusFilter = "all",
  searchTerm = "",
): CoalPurchase[] {
  if (!isLocalDate(fromDate) || !isLocalDate(toDate) || fromDate > toDate) return [];
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("en-IN");
  return purchases.filter((purchase) => purchase.purchaseDate >= fromDate
    && purchase.purchaseDate <= toDate
    && (!sellerId || purchase.sellerId === sellerId)
    && matchesCoalPaymentStatus(purchase, paymentStatus)
    && (!normalizedSearch || [
      purchase.sellerNameSnapshot,
      purchase.coalNameSnapshot,
      purchase.sourceLocationSnapshot,
      purchase.coalChallanNumber ?? "",
      purchase.vehicleNumberSnapshot,
    ].some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedSearch))))
    .sort((left, right) => right.purchaseDate.localeCompare(left.purchaseDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id));
}

export function filterCoalPayments(
  payments: readonly CoalPayment[],
  fromDate: string,
  toDate: string,
  sellerId = "",
  paymentMode: CoalPayment["paymentMode"] | "" = "",
  searchTerm = "",
): CoalPayment[] {
  if (!isLocalDate(fromDate) || !isLocalDate(toDate) || fromDate > toDate) return [];
  const seenPaymentIds = new Set<string>();
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("en-IN");
  return payments.filter((payment) => {
    if (seenPaymentIds.has(payment.id)
      || payment.paymentDate < fromDate
      || payment.paymentDate > toDate
      || (sellerId && payment.sellerId !== sellerId)
      || (paymentMode && payment.paymentMode !== paymentMode)
      || (normalizedSearch && ![
        payment.sellerNameSnapshot,
        payment.note ?? "",
        ...payment.allocations.flatMap((allocation) => [
          allocation.coalChallanNumber ?? "",
          allocation.coalNameSnapshot,
          allocation.sourceLocationSnapshot,
          allocation.vehicleNumberSnapshot,
        ]),
      ].some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedSearch)))) return false;
    seenPaymentIds.add(payment.id);
    return true;
  }).sort((left, right) => right.paymentDate.localeCompare(left.paymentDate)
    || right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id));
}

export function getCoalPaymentAllocationReconciliation(
  payment: Pick<CoalPayment, "amount" | "allocations">,
): { allocatedAmount: number; remainingAmount: number; reconciles: boolean } {
  const paymentPaise = Math.round(payment.amount * 100);
  const allocatedPaise = payment.allocations.reduce(
    (total, allocation) => total + Math.round(allocation.allocatedAmount * 100),
    0,
  );
  const remainingPaise = paymentPaise - allocatedPaise;
  return {
    allocatedAmount: allocatedPaise / 100,
    remainingAmount: remainingPaise / 100,
    reconciles: remainingPaise === 0,
  };
}

function matchesCoalPaymentStatus(
  purchase: CoalPurchase,
  paymentStatus: CoalPaymentStatusFilter,
): boolean {
  if (paymentStatus === "all") return true;
  if (purchase.status === "void") return false;
  if (paymentStatus === "unpaid") return purchase.totalPaid === 0 && purchase.outstandingAmount > 0;
  if (paymentStatus === "partial") return purchase.totalPaid > 0 && purchase.outstandingAmount > 0;
  return purchase.outstandingAmount === 0;
}

export function summarizeCoalPurchases(
  purchases: readonly CoalPurchase[],
): CoalPurchaseSummary {
  let purchasedPaise = 0;
  let paidPaise = 0;
  let outstandingPaise = 0;
  let activePurchases = 0;
  for (const purchase of purchases) {
    if (purchase.status === "void") continue;
    activePurchases += 1;
    purchasedPaise += Math.round(purchase.finalTotal * 100);
    paidPaise += Math.round(purchase.totalPaid * 100);
    outstandingPaise += Math.round(purchase.outstandingAmount * 100);
  }
  return {
    totalPurchased: purchasedPaise / 100,
    totalPaid: paidPaise / 100,
    totalOutstanding: outstandingPaise / 100,
    activePurchases,
  };
}

export function canChangeCoalPurchase(
  purchase: Pick<CoalPurchase, "status" | "isLocked" | "totalPaid">,
): boolean {
  return purchase.status === "active" && !purchase.isLocked && purchase.totalPaid === 0;
}

function buildCoalPurchaseInput(factoryId: string, form: CoalPurchaseForm): {
  input: Omit<CreateCoalPurchaseInput, "initialPaidAmount" | "initialPaymentMode">;
  finalTotal: number;
} | null {
  if (!factoryId.trim() || !isLocalDate(form.purchaseDate) || !form.sellerId.trim()
    || !form.coalNameReferenceId.trim() || !form.sourceReferenceId.trim()) return null;
  const vehicleNumber = normalizeText(form.vehicleNumber).toUpperCase();
  const challanNumber = normalizeText(form.coalChallanNumber);
  if (!vehicleNumber || vehicleNumber.length > 100 || challanNumber.length > 100) return null;
  const derivedField = getDerivedCoalMeasurementField(form);
  if (!derivedField || deriveMeasurement(form, derivedField) !== form[derivedField]) return null;
  const quantity = parseScaled(form.quantity, 6, false);
  const rate = parseScaled(form.rate, 6, false);
  const coalAmount = parseScaled(form.coalAmount, 2, false);
  const finalTotal = getCoalFinalTotal(form);
  if (quantity === null || rate === null || coalAmount === null || finalTotal === null) return null;
  const measurements: CoalPurchaseMeasurementInput = {
    quantity: derivedField === "quantity" ? null : Number(quantity) / 1_000_000,
    rate: derivedField === "rate" ? null : Number(rate) / 1_000_000,
    coalAmount: derivedField === "coalAmount" ? null : Number(coalAmount) / 100,
  };
  return {
    finalTotal,
    input: {
      factoryId,
      purchaseDate: form.purchaseDate,
      sellerId: form.sellerId,
      coalNameReferenceId: form.coalNameReferenceId,
      sourceReferenceId: form.sourceReferenceId,
      coalChallanNumber: challanNumber || null,
      vehicleNumber,
      ...measurements,
      separateFreightAmount: form.hasSeparateFreight
        ? Number(parseScaled(form.separateFreightAmount, 2, true)!) / 100
        : 0,
    },
  };
}

function deriveMeasurement(form: CoalPurchaseForm, derivedField: CoalMeasurementField): string | null {
  const quantity = parseScaled(form.quantity, 6, false);
  const rate = parseScaled(form.rate, 6, false);
  const amount = parseScaled(form.coalAmount, 2, false);
  if (derivedField === "coalAmount" && quantity !== null && rate !== null) {
    return formatScaled(roundDivide(quantity * rate * 100n, 1_000_000_000_000n), 2);
  }
  if (derivedField === "rate" && quantity !== null && amount !== null && quantity > 0n) {
    return formatScaled(roundDivide(amount * 1_000_000_000_000n, quantity * 100n), 6);
  }
  if (derivedField === "quantity" && rate !== null && amount !== null && rate > 0n) {
    return formatScaled(roundDivide(amount * 1_000_000_000_000n, rate * 100n), 6);
  }
  return null;
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function parseScaled(value: string, decimalPlaces: number, allowZero: boolean): bigint | null {
  const normalized = value.trim();
  const match = normalized.match(new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimalPlaces}}))?$`));
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

function formatDecimal(value: number, decimalPlaces: number): string {
  return value.toFixed(decimalPlaces).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatCoalAllocationTotal(allocations: Readonly<Record<string, string>>): string {
  const values = Object.values(allocations);
  if (values.length === 0) return "";
  let totalPaise = 0n;
  for (const value of values) {
    const paise = parseScaled(value, 2, false);
    if (paise === null) return "";
    totalPaise += paise;
  }
  return formatScaled(totalPaise, 2);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
