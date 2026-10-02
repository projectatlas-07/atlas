import type { CashBookManualEntryStatus } from "@/features/cash-book/types";
import type {
  ExpensePaymentState,
  ExpenseRecordStatus,
} from "@/features/expenses/types";
import type { TransportWeeklyCalculationOutcome } from "@/features/office/transport-weekly-earnings-model";
import type {
  ChallanPaymentState,
  ChallanStatus,
} from "@/features/sales/types";
import type {
  VehicleFuelPaymentState,
  VehicleFuelStatus,
} from "@/features/vehicle-fuel/types";
import type {
  VehicleMaintenancePaymentState,
  VehicleMaintenanceStatus,
} from "@/features/vehicle-maintenance/types";
import type { MudCutoverReadinessStatus } from "@/features/wages/services/mud-cutover-readiness-service";
import type { MudAccountingMode } from "@/features/wages/services/mud-group-configuration-service";
import type { MudShadowCertificationStatus } from "@/features/wages/services/mud-shadow-certification-service";
import type { MudShadowComparisonStatus } from "@/features/wages/services/mud-shadow-comparison-service";
import type { WageRateHistoryStatus } from "@/features/wages/services/wage-rate-service";

export const STATUS_TONES = [
  "success",
  "warning",
  "danger",
  "info",
  "archive",
  "neutral",
] as const;

export type StatusTone = (typeof STATUS_TONES)[number];
export type StatusMachineValue = string | boolean;

export type StatusPresentation<TValue extends StatusMachineValue> = Readonly<{
  value: TValue;
  label: string;
  tone: StatusTone;
}>;

export type StatusPresentationDefinitions<TValue extends string> = Readonly<{
  [Value in TValue]: StatusPresentation<Value>;
}>;

export type StatusPresentationSet<TValue extends string> = Readonly<{
  entity: string;
  definitions: StatusPresentationDefinitions<TValue>;
}>;

export type BooleanStatusPresentationSet = Readonly<{
  entity: string;
  definitions: Readonly<{
    true: StatusPresentation<true>;
    false: StatusPresentation<false>;
  }>;
}>;

type AnyStatusPresentation = StatusPresentation<StatusMachineValue>;

function validateDefinitions(
  entity: string,
  definitions: Readonly<Record<string, AnyStatusPresentation>>,
) {
  const machineValues = new Set<StatusMachineValue>();

  for (const [key, definition] of Object.entries(definitions)) {
    if (machineValues.has(definition.value)) {
      throw new Error(
        `${entity} has a duplicate status mapping for "${String(definition.value)}".`,
      );
    }
    if (String(definition.value) !== key) {
      throw new Error(
        `${entity} status key "${key}" does not match machine value "${String(definition.value)}".`,
      );
    }
    if (!definition.label.trim()) {
      throw new Error(`${entity} status "${key}" must have a label.`);
    }
    if (!STATUS_TONES.includes(definition.tone)) {
      throw new Error(`${entity} status "${key}" has an invalid semantic tone.`);
    }

    machineValues.add(definition.value);
  }
}

export function defineStatusPresentationSet<const TValue extends string>(
  entity: string,
  definitions: StatusPresentationDefinitions<TValue>,
): StatusPresentationSet<TValue> {
  validateDefinitions(entity, definitions);
  return { entity, definitions };
}

function defineBooleanStatusPresentationSet(
  entity: string,
  definitions: BooleanStatusPresentationSet["definitions"],
): BooleanStatusPresentationSet {
  validateDefinitions(entity, definitions);
  return { entity, definitions };
}

export function resolveStatusPresentation<TValue extends string>(
  set: StatusPresentationSet<TValue>,
  value: unknown,
): StatusPresentation<TValue> {
  if (
    typeof value !== "string"
    || !Object.prototype.hasOwnProperty.call(set.definitions, value)
  ) {
    throw new RangeError(
      `Unknown ${set.entity} status "${String(value)}".`,
    );
  }

  return set.definitions[value as TValue];
}

export function resolveBooleanStatusPresentation(
  set: BooleanStatusPresentationSet,
  value: unknown,
): StatusPresentation<boolean> {
  if (typeof value !== "boolean") {
    throw new RangeError(
      `Unknown ${set.entity} status "${String(value)}".`,
    );
  }

  return set.definitions[String(value) as "true" | "false"];
}

export const CHALLAN_STATUS = defineStatusPresentationSet<ChallanStatus>(
  "Challan",
  {
    active: { value: "active", label: "Active", tone: "success" },
    void: { value: "void", label: "Void", tone: "archive" },
  },
);

export const CHALLAN_PAYMENT_STATUS =
  defineStatusPresentationSet<ChallanPaymentState>("Challan payment", {
    unpaid: { value: "unpaid", label: "Unpaid", tone: "warning" },
    partially_paid: {
      value: "partially_paid",
      label: "Partially paid",
      tone: "warning",
    },
    paid: { value: "paid", label: "Paid", tone: "success" },
  });

export const CHALLAN_FINANCIAL_LOCK_STATUS =
  defineBooleanStatusPresentationSet("Challan financial lock", {
    true: { value: true, label: "Financially locked", tone: "info" },
    false: { value: false, label: "Not financially locked", tone: "neutral" },
  });

export const EXPENSE_RECORD_STATUS =
  defineStatusPresentationSet<ExpenseRecordStatus>("Expense record", {
    active: { value: "active", label: "Active", tone: "success" },
    void: { value: "void", label: "Void", tone: "archive" },
  });

export const EXPENSE_PAYMENT_STATUS =
  defineStatusPresentationSet<ExpensePaymentState>("Expense payment", {
    unpaid: { value: "unpaid", label: "Unpaid", tone: "warning" },
    partially_paid: {
      value: "partially_paid",
      label: "Partially paid",
      tone: "warning",
    },
    paid: { value: "paid", label: "Paid", tone: "success" },
  });

export const EXPENSE_FINANCIAL_LOCK_STATUS =
  defineBooleanStatusPresentationSet("Expense financial lock", {
    true: { value: true, label: "Financially locked", tone: "info" },
    false: { value: false, label: "Not financially locked", tone: "neutral" },
  });

// Coal currently reuses the authoritative Expense record/payment unions. Its
// presentation remains separate so its wording can evolve independently.
export const COAL_PURCHASE_STATUS =
  defineStatusPresentationSet<ExpenseRecordStatus>("Coal purchase", {
    active: { value: "active", label: "Active", tone: "success" },
    void: { value: "void", label: "Void", tone: "archive" },
  });

export const COAL_PURCHASE_PAYMENT_STATUS =
  defineStatusPresentationSet<ExpensePaymentState>("Coal purchase payment", {
    unpaid: { value: "unpaid", label: "Unpaid", tone: "warning" },
    partially_paid: {
      value: "partially_paid",
      label: "Partially paid",
      tone: "warning",
    },
    paid: { value: "paid", label: "Paid", tone: "success" },
  });

export const COAL_PURCHASE_FINANCIAL_LOCK_STATUS =
  defineBooleanStatusPresentationSet("Coal purchase financial lock", {
    true: { value: true, label: "Financially locked", tone: "info" },
    false: { value: false, label: "Not financially locked", tone: "neutral" },
  });

export const VEHICLE_FUEL_STATUS =
  defineStatusPresentationSet<VehicleFuelStatus>("Vehicle fuel record", {
    active: { value: "active", label: "Active", tone: "success" },
    void: { value: "void", label: "Void", tone: "archive" },
  });

export const VEHICLE_FUEL_PAYMENT_STATUS =
  defineStatusPresentationSet<VehicleFuelPaymentState>("Vehicle fuel payment", {
    unpaid: { value: "unpaid", label: "Unpaid", tone: "warning" },
    partially_paid: {
      value: "partially_paid",
      label: "Partially paid",
      tone: "warning",
    },
    paid: { value: "paid", label: "Paid", tone: "success" },
  });

export const VEHICLE_FUEL_FINANCIAL_LOCK_STATUS =
  defineBooleanStatusPresentationSet("Vehicle fuel financial lock", {
    true: { value: true, label: "Financially locked", tone: "info" },
    false: { value: false, label: "Not financially locked", tone: "neutral" },
  });

export const VEHICLE_MAINTENANCE_STATUS =
  defineStatusPresentationSet<VehicleMaintenanceStatus>(
    "Vehicle maintenance record",
    {
      active: { value: "active", label: "Active", tone: "success" },
      void: { value: "void", label: "Void", tone: "archive" },
    },
  );

export const VEHICLE_MAINTENANCE_PAYMENT_STATUS =
  defineStatusPresentationSet<VehicleMaintenancePaymentState>(
    "Vehicle maintenance payment",
    {
      unpaid: { value: "unpaid", label: "Unpaid", tone: "warning" },
      partially_paid: {
        value: "partially_paid",
        label: "Partially paid",
        tone: "warning",
      },
      paid: { value: "paid", label: "Paid", tone: "success" },
    },
  );

export const VEHICLE_MAINTENANCE_FINANCIAL_LOCK_STATUS =
  defineBooleanStatusPresentationSet("Vehicle maintenance financial lock", {
    true: { value: true, label: "Financially locked", tone: "info" },
    false: { value: false, label: "Not financially locked", tone: "neutral" },
  });

export const CASH_BOOK_MANUAL_ENTRY_STATUS =
  defineStatusPresentationSet<CashBookManualEntryStatus>(
    "Cash Book manual entry",
    {
      active: { value: "active", label: "Active", tone: "success" },
      void: { value: "void", label: "Void", tone: "archive" },
    },
  );

export const WAGE_RATE_HISTORY_STATUS =
  defineStatusPresentationSet<WageRateHistoryStatus>("Wage rate", {
    current: { value: "current", label: "Current", tone: "success" },
    future: { value: "future", label: "Future", tone: "info" },
    historical: { value: "historical", label: "Historical", tone: "archive" },
  });

type TransportWeeklyCalculationStatus =
  TransportWeeklyCalculationOutcome["status"];

export const TRANSPORT_WEEKLY_CALCULATION_STATUS =
  defineStatusPresentationSet<TransportWeeklyCalculationStatus>(
    "Transport weekly calculation",
    {
      calculated: {
        value: "calculated",
        label: "Calculated and locked",
        tone: "success",
      },
      already_calculated: {
        value: "already_calculated",
        label: "Already calculated",
        tone: "info",
      },
      no_work: { value: "no_work", label: "No work", tone: "neutral" },
    },
  );

export const MUD_ACCOUNTING_MODE_STATUS =
  defineStatusPresentationSet<MudAccountingMode>("Mud accounting mode", {
    LEGACY_WEEKLY: {
      value: "LEGACY_WEEKLY",
      label: "Legacy weekly",
      tone: "archive",
    },
    SHADOW: { value: "SHADOW", label: "Shadow", tone: "info" },
    SETTLEMENT: {
      value: "SETTLEMENT",
      label: "Continuous settlement",
      tone: "success",
    },
  });

export const MUD_SHADOW_COMPARISON_STATUS =
  defineStatusPresentationSet<MudShadowComparisonStatus>(
    "Mud shadow comparison",
    {
      PARITY_OK: { value: "PARITY_OK", label: "Parity confirmed", tone: "success" },
      EXPECTED_RATE_CHANGE_DIFFERENCE: {
        value: "EXPECTED_RATE_CHANGE_DIFFERENCE",
        label: "Expected rate difference",
        tone: "info",
      },
      UNEXPECTED_MISMATCH: {
        value: "UNEXPECTED_MISMATCH",
        label: "Unexpected mismatch",
        tone: "danger",
      },
      CONFIGURATION_ERROR: {
        value: "CONFIGURATION_ERROR",
        label: "Configuration error",
        tone: "danger",
      },
    },
  );

export const MUD_SHADOW_CERTIFICATION_STATUS =
  defineStatusPresentationSet<MudShadowCertificationStatus>(
    "Mud shadow certification",
    {
      READY: { value: "READY", label: "Ready", tone: "success" },
      WAITING_FOR_COMPLETED_WEEK: {
        value: "WAITING_FOR_COMPLETED_WEEK",
        label: "Waiting for completed week",
        tone: "warning",
      },
      CONFIGURATION_ERROR: {
        value: "CONFIGURATION_ERROR",
        label: "Configuration error",
        tone: "danger",
      },
      UNEXPECTED_MISMATCH: {
        value: "UNEXPECTED_MISMATCH",
        label: "Unexpected mismatch",
        tone: "danger",
      },
    },
  );

export const MUD_CUTOVER_READINESS_STATUS =
  defineStatusPresentationSet<MudCutoverReadinessStatus>(
    "Mud cutover readiness",
    {
      READY_FOR_CUTOVER: {
        value: "READY_FOR_CUTOVER",
        label: "Ready for cutover",
        tone: "success",
      },
      BLOCKED: { value: "BLOCKED", label: "Blocked", tone: "warning" },
    },
  );

export const VEHICLE_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Vehicle lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Archived", tone: "archive" },
  });

export const STAFF_WORKER_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Staff worker lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Archived", tone: "archive" },
  });

export const SOIL_WORKER_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Soil worker lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Archived", tone: "archive" },
  });

export const TRANSPORT_WORKER_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Transport worker lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Inactive", tone: "archive" },
  });

export const TRANSPORT_GROUP_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Transport Group lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Inactive", tone: "archive" },
  });

export const LABOUR_GROUP_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Labour group lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Inactive", tone: "archive" },
  });

export const PRODUCTION_LABOURER_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Production labourer lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Archived", tone: "archive" },
  });

export const BRICK_TYPE_LIFECYCLE_STATUS =
  defineBooleanStatusPresentationSet("Brick type lifecycle", {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Inactive", tone: "archive" },
  });

export const ATLAS_STATUS_PRESENTATION_SETS = {
  challan: CHALLAN_STATUS,
  challanPayment: CHALLAN_PAYMENT_STATUS,
  challanFinancialLock: CHALLAN_FINANCIAL_LOCK_STATUS,
  expenseRecord: EXPENSE_RECORD_STATUS,
  expensePayment: EXPENSE_PAYMENT_STATUS,
  expenseFinancialLock: EXPENSE_FINANCIAL_LOCK_STATUS,
  coalPurchase: COAL_PURCHASE_STATUS,
  coalPurchasePayment: COAL_PURCHASE_PAYMENT_STATUS,
  coalPurchaseFinancialLock: COAL_PURCHASE_FINANCIAL_LOCK_STATUS,
  vehicleFuel: VEHICLE_FUEL_STATUS,
  vehicleFuelPayment: VEHICLE_FUEL_PAYMENT_STATUS,
  vehicleFuelFinancialLock: VEHICLE_FUEL_FINANCIAL_LOCK_STATUS,
  vehicleMaintenance: VEHICLE_MAINTENANCE_STATUS,
  vehicleMaintenancePayment: VEHICLE_MAINTENANCE_PAYMENT_STATUS,
  vehicleMaintenanceFinancialLock: VEHICLE_MAINTENANCE_FINANCIAL_LOCK_STATUS,
  cashBookManualEntry: CASH_BOOK_MANUAL_ENTRY_STATUS,
  wageRateHistory: WAGE_RATE_HISTORY_STATUS,
  transportWeeklyCalculation: TRANSPORT_WEEKLY_CALCULATION_STATUS,
  mudAccountingMode: MUD_ACCOUNTING_MODE_STATUS,
  mudShadowComparison: MUD_SHADOW_COMPARISON_STATUS,
  mudShadowCertification: MUD_SHADOW_CERTIFICATION_STATUS,
  mudCutoverReadiness: MUD_CUTOVER_READINESS_STATUS,
  vehicleLifecycle: VEHICLE_LIFECYCLE_STATUS,
  staffWorkerLifecycle: STAFF_WORKER_LIFECYCLE_STATUS,
  soilWorkerLifecycle: SOIL_WORKER_LIFECYCLE_STATUS,
  transportWorkerLifecycle: TRANSPORT_WORKER_LIFECYCLE_STATUS,
  transportGroupLifecycle: TRANSPORT_GROUP_LIFECYCLE_STATUS,
  labourGroupLifecycle: LABOUR_GROUP_LIFECYCLE_STATUS,
  productionLabourerLifecycle: PRODUCTION_LABOURER_LIFECYCLE_STATUS,
  brickTypeLifecycle: BRICK_TYPE_LIFECYCLE_STATUS,
} as const;
