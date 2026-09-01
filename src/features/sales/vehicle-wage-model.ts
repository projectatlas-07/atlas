import {
  resolveSalesDateRange,
  type SalesDatePreset,
  type SalesDateRange,
} from "./sales-register-model.ts";
import type { ChallanStatus, Vehicle } from "./types.ts";

export type VehicleWageDatePreset = SalesDatePreset;
export type VehicleWageDateRange = SalesDateRange;

export type VehicleWageChallanSnapshot = {
  challanId: string;
  challanNumber: number;
  challanDate: string;
  vehicleId: string | null;
  vehicleNumberSnapshot: string | null;
  deliveryWageApplicableSnapshot: boolean;
  tripLabourWage: number | null;
  status: ChallanStatus;
};

export type VehicleWageTrip = {
  challanId: string;
  challanNumber: number;
  challanDate: string;
  vehicleId: string;
  vehicleNumberSnapshot: string;
  tripLabourWage: number;
};

export type VehicleWageAccountSummary = {
  vehicleId: string;
  vehicleNumber: string;
  isActive: boolean;
  deliveryWageTrackingEnabled: boolean;
  earnedAmount: number;
  qualifyingTripCount: number;
  trips: VehicleWageTrip[];
};

export type VehicleWageDateRangeSummary = {
  earnedAmount: number;
  qualifyingTripCount: number;
  vehicleCountWithEarnings: number;
};

export type VehicleWageLifetimeAccount = {
  totalEarned: number;
  totalPaid: number;
  availableBalance: number;
};

export type VehicleWagePayment = {
  id: string;
  factoryId: string;
  vehicleId: string;
  paymentDate: string;
  amount: number;
  note: string | null;
  createdAt: string;
  createdBy: string;
  reversal: VehicleWagePaymentReversal | null;
};

export type VehicleWagePaymentReversal = {
  id: string;
  factoryId: string;
  paymentId: string;
  reversalDate: string;
  reason: string;
  createdAt: string;
  createdBy: string;
};

export type RecordedVehicleWagePayment = VehicleWagePayment
  & VehicleWageLifetimeAccount;

export type RecordVehicleWagePaymentInput = {
  factoryId: string;
  vehicleId: string;
  paymentDate: string;
  amount: number;
  note: string | null;
};

export type ReverseVehicleWagePaymentInput = {
  factoryId: string;
  paymentId: string;
  reversalDate: string;
  reason: string;
};

export type ReversedVehicleWagePayment = VehicleWagePaymentReversal
  & VehicleWageLifetimeAccount
  & {
    vehicleId: string;
    amount: number;
  };

export function buildVehicleWagePaymentInput(
  factoryId: string,
  vehicleId: string,
  paymentDate: string,
  amountText: string,
  noteText: string,
): RecordVehicleWagePaymentInput | null {
  if (!factoryId.trim() || !vehicleId.trim() || !isCanonicalDate(paymentDate)) {
    return null;
  }
  const normalizedAmount = amountText.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedAmount)) return null;
  const amount = Number(normalizedAmount);
  const amountPaise = moneyToPaise(amount);
  if (amountPaise === null || amountPaise <= 0 || amount >= 1_000_000_000) {
    return null;
  }
  const note = noteText.trim().replace(/\s+/g, " ") || null;
  if (note && (note.length > 500 || /[\u0000-\u001f\u007f]/.test(note))) {
    return null;
  }
  return { factoryId, vehicleId, paymentDate, amount, note };
}

export function buildVehicleWagePaymentReversalInput(
  factoryId: string,
  paymentId: string,
  paymentDate: string,
  reversalDate: string,
  reasonText: string,
): ReverseVehicleWagePaymentInput | null {
  const reason = reasonText.trim().replace(/\s+/g, " ");
  if (!factoryId.trim()
    || !paymentId.trim()
    || !isCanonicalDate(paymentDate)
    || !isCanonicalDate(reversalDate)
    || reversalDate < paymentDate
    || !reason
    || reason.length > 500
    || /[\u0000-\u001f\u007f]/.test(reason)) return null;
  return { factoryId, paymentId, reversalDate, reason };
}

export function applyVehicleWagePaymentReversal(
  current: readonly VehicleWagePayment[],
  reversal: ReversedVehicleWagePayment,
): VehicleWagePayment[] {
  return current.map((payment) => payment.id === reversal.paymentId
    ? {
        ...payment,
        reversal: {
          id: reversal.id,
          factoryId: reversal.factoryId,
          paymentId: reversal.paymentId,
          reversalDate: reversal.reversalDate,
          reason: reversal.reason,
          createdAt: reversal.createdAt,
          createdBy: reversal.createdBy,
        },
      }
    : payment);
}

export function insertVehicleWagePaymentNewestFirst(
  current: readonly VehicleWagePayment[],
  payment: VehicleWagePayment,
): VehicleWagePayment[] {
  return [...current.filter((item) => item.id !== payment.id), payment].sort(
    (left, right) => right.paymentDate.localeCompare(left.paymentDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id),
  );
}

export function resolveVehicleWageDateRange(
  preset: VehicleWageDatePreset,
  localToday: string,
  customFrom = "",
  customTo = "",
): VehicleWageDateRange | null {
  return resolveSalesDateRange(preset, localToday, customFrom, customTo);
}

export function isVehicleWageDateRange(
  range: VehicleWageDateRange,
): boolean {
  return resolveSalesDateRange(
    "custom",
    range.toDate,
    range.fromDate,
    range.toDate,
  ) !== null;
}

export function getEligibleVehicleWageTrips(
  snapshots: readonly VehicleWageChallanSnapshot[],
): VehicleWageTrip[] {
  const seenChallanIds = new Set<string>();
  const trips: VehicleWageTrip[] = [];

  for (const snapshot of snapshots) {
    const tripWagePaise = moneyToPaise(snapshot.tripLabourWage);
    if (snapshot.status !== "active"
      || !snapshot.vehicleId
      || !snapshot.vehicleNumberSnapshot
      || !snapshot.deliveryWageApplicableSnapshot
      || tripWagePaise === null
      || tripWagePaise <= 0) continue;
    if (seenChallanIds.has(snapshot.challanId)) {
      throw new Error(`Vehicle wage source duplicated Challan #${snapshot.challanNumber}.`);
    }
    seenChallanIds.add(snapshot.challanId);
    trips.push({
      challanId: snapshot.challanId,
      challanNumber: snapshot.challanNumber,
      challanDate: snapshot.challanDate,
      vehicleId: snapshot.vehicleId,
      vehicleNumberSnapshot: snapshot.vehicleNumberSnapshot,
      tripLabourWage: snapshot.tripLabourWage as number,
    });
  }

  return trips.sort((left, right) =>
    right.challanDate.localeCompare(left.challanDate)
    || right.challanNumber - left.challanNumber
    || left.challanId.localeCompare(right.challanId));
}

export function buildVehicleWageAccounts(
  vehicles: readonly Vehicle[],
  trips: readonly VehicleWageTrip[],
): VehicleWageAccountSummary[] {
  const accounts = new Map<string, VehicleWageAccountSummary>();
  for (const vehicle of vehicles) {
    accounts.set(vehicle.id, {
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      isActive: vehicle.isActive,
      deliveryWageTrackingEnabled: vehicle.deliveryWageTrackingEnabled,
      earnedAmount: 0,
      qualifyingTripCount: 0,
      trips: [],
    });
  }

  for (const trip of trips) {
    let account = accounts.get(trip.vehicleId);
    if (!account) {
      account = {
        vehicleId: trip.vehicleId,
        vehicleNumber: trip.vehicleNumberSnapshot,
        isActive: false,
        deliveryWageTrackingEnabled: false,
        earnedAmount: 0,
        qualifyingTripCount: 0,
        trips: [],
      };
      accounts.set(trip.vehicleId, account);
    }
    account.trips.push(trip);
    account.qualifyingTripCount += 1;
    account.earnedAmount = addMoney(account.earnedAmount, trip.tripLabourWage);
  }

  for (const account of accounts.values()) {
    account.trips.sort((left, right) =>
      right.challanDate.localeCompare(left.challanDate)
      || right.challanNumber - left.challanNumber
      || left.challanId.localeCompare(right.challanId));
    if (account.trips[0]) {
      account.vehicleNumber = account.trips[0].vehicleNumberSnapshot;
    }
  }

  return [...accounts.values()].sort((left, right) =>
    Number(right.qualifyingTripCount > 0) - Number(left.qualifyingTripCount > 0)
    || left.vehicleNumber.localeCompare(right.vehicleNumber, "en-IN")
    || left.vehicleId.localeCompare(right.vehicleId));
}

export function summarizeVehicleWageRange(
  accounts: readonly VehicleWageAccountSummary[],
): VehicleWageDateRangeSummary {
  let earnedPaise = 0;
  let qualifyingTripCount = 0;
  let vehicleCountWithEarnings = 0;
  for (const account of accounts) {
    const accountPaise = moneyToPaise(account.earnedAmount);
    if (accountPaise === null) {
      throw new Error("Vehicle wage account contains an invalid earned amount.");
    }
    earnedPaise += accountPaise ?? 0;
    qualifyingTripCount += account.qualifyingTripCount;
    if (account.qualifyingTripCount > 0) vehicleCountWithEarnings += 1;
  }
  return {
    earnedAmount: earnedPaise / 100,
    qualifyingTripCount,
    vehicleCountWithEarnings,
  };
}

function addMoney(left: number, right: number): number {
  const leftPaise = moneyToPaise(left);
  const rightPaise = moneyToPaise(right);
  if (leftPaise === null || rightPaise === null) {
    throw new Error("Vehicle wage source contains an invalid Trip Labour Wage.");
  }
  return (leftPaise + rightPaise) / 100;
}

function moneyToPaise(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const paise = Math.round(value * 100);
  if (!Number.isSafeInteger(paise)
    || Math.abs(value * 100 - paise) >= 1e-7) return null;
  return paise;
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
