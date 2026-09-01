import type {
  Challan,
  ChallanFlexibleLine,
  ChallanFlexibleLineInput,
  ChallanFlexibleLineType,
  ChallanHeader,
  ChallanItemInput,
  CreateChallanInput,
  Customer,
  FactoryPrintableProfile,
  UpdateChallanInput,
  Vehicle,
} from "@/features/sales/types";

export const SALES_SECTION_HEADING = "Sales / Challan";

export type ChallanLineForm = {
  key: string;
  brickTypeId: string;
  quantity: string;
  ratePer1000Bricks: string;
};

export type ChallanExtraChargeMode = "DIRECT_AMOUNT" | "QUANTITY_RATE";

export type ChallanNoteLineForm = {
  key: string;
  lineType: "NOTE";
  particulars: string;
};

export type ChallanExtraChargeLineForm = {
  key: string;
  lineType: "EXTRA_CHARGE";
  particulars: string;
  chargeMode: ChallanExtraChargeMode;
  amount: string;
  quantity: string;
  rate: string;
};

export type ChallanFlexibleLineForm = ChallanNoteLineForm | ChallanExtraChargeLineForm;

export type SavedChallanFlexibleLineView =
  | {
    key: string;
    kind: "note";
    typeLabel: "Note";
    particulars: string;
  }
  | {
    key: string;
    kind: "extra_charge";
    typeLabel: "Extra Charge";
    particulars: string;
    quantity: number | null;
    rate: number | null;
    amount: number;
  };

export type SavedChallanVehicleDetails = {
  vehicleNumber: string | null;
  tripLabourWage: number | null;
};

export type ChallanFormState = {
  challanDate: string;
  customerId: string;
  vehicleId: string;
  selectedVehicleIsActive: boolean;
  vehicleDeliveryWageTrackingEnabled: boolean;
  tripLabourWage: string;
  lines: ChallanLineForm[];
  flexibleLines: ChallanFlexibleLineForm[];
};

export type QuickCustomerForm = {
  name: string;
  address: string;
  mobile: string;
};

export type FactoryProfileForm = {
  name: string;
  businessDescription: string;
  village: string;
  postOffice: string;
  policeStation: string;
  district: string;
  state: string;
  mobile: string;
};

export function factoryProfileFormFromSaved(
  profile: FactoryPrintableProfile,
): FactoryProfileForm {
  return {
    name: profile.name,
    businessDescription: profile.businessDescription,
    village: profile.village,
    postOffice: profile.postOffice,
    policeStation: profile.policeStation,
    district: profile.district,
    state: profile.state,
    mobile: profile.mobile,
  };
}

export function isFactoryPrintableProfileComplete(
  profile: Pick<
    FactoryPrintableProfile,
    "name" | "businessDescription" | "village" | "postOffice" | "policeStation" | "district" | "state" | "mobile"
  > | null | undefined,
): boolean {
  return Boolean(profile
    && profile.name.trim()
    && profile.businessDescription.trim()
    && profile.village.trim()
    && profile.postOffice.trim()
    && profile.policeStation.trim()
    && profile.district.trim()
    && profile.state.trim()
    && profile.mobile.trim());
}

export function buildFactoryProfileInput(
  factoryId: string,
  form: Readonly<FactoryProfileForm>,
) {
  const name = form.name.trim().replace(/\s+/g, " ");
  const businessDescription = form.businessDescription.trim().replace(/\s+/g, " ");
  const village = form.village.trim().replace(/\s+/g, " ");
  const postOffice = form.postOffice.trim().replace(/\s+/g, " ");
  const policeStation = form.policeStation.trim().replace(/\s+/g, " ");
  const district = form.district.trim().replace(/\s+/g, " ");
  const state = form.state.trim().replace(/\s+/g, " ");
  const mobile = form.mobile.trim().replace(/\s+/g, " ");
  if (!factoryId || !name || !businessDescription || !village || !postOffice
    || !policeStation || !district || !state || !mobile) return null;
  return {
    factoryId,
    name,
    businessDescription,
    village,
    postOffice,
    policeStation,
    district,
    state,
    mobile,
  };
}

export function emptyChallanLine(key: string): ChallanLineForm {
  return { key, brickTypeId: "", quantity: "", ratePer1000Bricks: "" };
}

export function addChallanLine(
  lines: readonly ChallanLineForm[],
  key: string,
): ChallanLineForm[] {
  return [...lines, emptyChallanLine(key)];
}

export function removeChallanLine(
  lines: readonly ChallanLineForm[],
  key: string,
): ChallanLineForm[] {
  return lines.filter((line) => line.key !== key);
}

export function emptyChallanFlexibleLine(
  key: string,
  lineType: ChallanFlexibleLineType,
): ChallanFlexibleLineForm {
  if (lineType === "NOTE") return { key, lineType, particulars: "" };
  return {
    key,
    lineType,
    particulars: "",
    chargeMode: "DIRECT_AMOUNT",
    amount: "",
    quantity: "",
    rate: "",
  };
}

export function addChallanFlexibleLine(
  lines: readonly ChallanFlexibleLineForm[],
  key: string,
  lineType: ChallanFlexibleLineType,
): ChallanFlexibleLineForm[] {
  return [...lines, emptyChallanFlexibleLine(key, lineType)];
}

export function removeChallanFlexibleLine(
  lines: readonly ChallanFlexibleLineForm[],
  key: string,
): ChallanFlexibleLineForm[] {
  return lines.filter((line) => line.key !== key);
}

export function moveChallanFlexibleLine(
  lines: readonly ChallanFlexibleLineForm[],
  key: string,
  direction: "up" | "down",
): ChallanFlexibleLineForm[] {
  const currentIndex = lines.findIndex((line) => line.key === key);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= lines.length) return [...lines];
  const moved = [...lines];
  [moved[currentIndex], moved[targetIndex]] = [moved[targetIndex]!, moved[currentIndex]!];
  return moved;
}

export function selectCustomer(
  customers: readonly Customer[],
  customerId: string,
): Customer | null {
  return customers.find((customer) => customer.id === customerId) ?? null;
}

export function getSavedChallanFlexibleLineViews(
  lines: readonly ChallanFlexibleLine[],
): SavedChallanFlexibleLineView[] {
  return [...lines]
    .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
    .map((line) => line.lineType === "NOTE"
      ? {
        key: line.id,
        kind: "note",
        typeLabel: "Note",
        particulars: line.particulars,
      }
      : {
        key: line.id,
        kind: "extra_charge",
        typeLabel: "Extra Charge",
        particulars: line.particulars,
        quantity: line.quantity,
        rate: line.rate,
        amount: line.amount,
      });
}

export function buildQuickCustomerInput(
  factoryId: string,
  form: Readonly<QuickCustomerForm>,
) {
  const name = form.name.trim().replace(/\s+/g, " ");
  if (!factoryId || !name) return null;
  return {
    factoryId,
    name,
    address: form.address.trim(),
    mobile: form.mobile.trim(),
  };
}

export function calculateLineAmountPreview(
  quantityInput: string,
  rateInput: string,
): number | null {
  const quantity = parsePositiveWholeNumber(quantityInput);
  const rate = parseMoney(rateInput, false);
  if (quantity === null || rate === null) return null;

  const ratePaise = Math.round(rate * 100);
  const lineAmountPaise = Math.round((quantity * ratePaise) / 1000);
  return lineAmountPaise / 100;
}

export function calculateChallanTotalPreview(
  lines: readonly ChallanLineForm[],
  flexibleLines: readonly ChallanFlexibleLineForm[] = [],
): number {
  const brickPaise = lines.reduce((total, line) => {
    const amount = calculateLineAmountPreview(line.quantity, line.ratePer1000Bricks);
    return total + (amount === null ? 0 : Math.round(amount * 100));
  }, 0);
  const flexiblePaise = flexibleLines.reduce((total, line) => {
    const amount = calculateFlexibleLineAmountPreview(line);
    return total + (amount === null ? 0 : Math.round(amount * 100));
  }, 0);
  return (brickPaise + flexiblePaise) / 100;
}

export function calculateFlexibleLineAmountPreview(
  line: Readonly<ChallanFlexibleLineForm>,
): number | null {
  if (line.lineType === "NOTE") return 0;
  if (line.chargeMode === "DIRECT_AMOUNT") return parseMoney(line.amount, false);
  const quantity = parsePositiveDecimal(line.quantity, 3);
  const rate = parseMoney(line.rate, false);
  if (quantity === null || rate === null) return null;
  return Math.round((quantity * rate + Number.EPSILON) * 100) / 100;
}

export function buildCreateChallanInput(
  factoryId: string,
  form: Readonly<ChallanFormState>,
): CreateChallanInput | null {
  const common = buildChallanInput(factoryId, form);
  return common;
}

export function buildUpdateChallanInput(
  factoryId: string,
  challanId: string,
  form: Readonly<ChallanFormState>,
): UpdateChallanInput | null {
  const common = buildChallanInput(factoryId, form);
  return common && challanId ? { ...common, challanId } : null;
}

export function challanFormFromSaved(
  challan: Challan,
  vehicles: readonly Vehicle[] = [],
): ChallanFormState {
  const currentVehicle = vehicles.find((vehicle) => vehicle.id === challan.vehicleId);
  const liveTrackingEnabled = currentVehicle?.deliveryWageTrackingEnabled
    ?? challan.deliveryWageApplicableSnapshot;
  return {
    challanDate: challan.challanDate,
    customerId: challan.customerId,
    vehicleId: challan.vehicleId ?? "",
    selectedVehicleIsActive: currentVehicle?.isActive ?? challan.vehicleId === null,
    vehicleDeliveryWageTrackingEnabled: liveTrackingEnabled,
    tripLabourWage: liveTrackingEnabled && challan.tripLabourWage !== null
      ? String(challan.tripLabourWage)
      : "",
    lines: challan.items.map((item) => ({
      key: `saved-${item.id}`,
      brickTypeId: item.brickTypeId,
      quantity: String(item.quantity),
      ratePer1000Bricks: String(item.ratePer1000Bricks),
    })),
    flexibleLines: [...challan.flexibleLines]
      .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
      .map((line): ChallanFlexibleLineForm => {
        if (line.lineType === "NOTE") {
          return {
            key: `saved-flexible-${line.id}`,
            lineType: "NOTE",
            particulars: line.particulars,
          };
        }
        const usesQuantityRate = line.quantity !== null && line.rate !== null;
        return {
          key: `saved-flexible-${line.id}`,
          lineType: "EXTRA_CHARGE",
          particulars: line.particulars,
          chargeMode: usesQuantityRate ? "QUANTITY_RATE" : "DIRECT_AMOUNT",
          amount: usesQuantityRate ? "" : String(line.amount),
          quantity: usesQuantityRate ? String(line.quantity) : "",
          rate: usesQuantityRate ? String(line.rate) : "",
        };
      }),
  };
}

export function selectVehicleForChallan(
  form: Readonly<ChallanFormState>,
  vehicles: readonly Vehicle[],
  vehicleId: string,
): ChallanFormState {
  const selected = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const trackingEnabled = selected?.deliveryWageTrackingEnabled ?? false;
  return {
    ...form,
    vehicleId,
    selectedVehicleIsActive: selected?.isActive ?? vehicleId === "",
    vehicleDeliveryWageTrackingEnabled: trackingEnabled,
    tripLabourWage: trackingEnabled ? form.tripLabourWage : "",
  };
}

export function getChallanEligibility(challan: Pick<ChallanHeader, "status" | "isLocked">): {
  canEdit: boolean;
  canVoid: boolean;
  reason: "locked" | "void" | null;
} {
  if (challan.isLocked) return { canEdit: false, canVoid: false, reason: "locked" };
  if (challan.status === "void") return { canEdit: false, canVoid: false, reason: "void" };
  return { canEdit: true, canVoid: true, reason: null };
}

export function getSavedCustomerSnapshot(challan: ChallanHeader) {
  return {
    name: challan.customerNameSnapshot,
    address: challan.customerAddressSnapshot,
    mobile: challan.customerMobileSnapshot,
  };
}

export function getSavedChallanVehicleDetails(
  challan: Pick<
    ChallanHeader,
    "vehicleNumberSnapshot" | "deliveryWageApplicableSnapshot" | "tripLabourWage"
  >,
): SavedChallanVehicleDetails {
  return {
    vehicleNumber: challan.vehicleNumberSnapshot,
    tripLabourWage: challan.deliveryWageApplicableSnapshot
      ? challan.tripLabourWage
      : null,
  };
}

export function upsertChallanNewestFirst(
  challans: readonly ChallanHeader[],
  saved: ChallanHeader,
): ChallanHeader[] {
  return [...challans.filter((challan) => challan.id !== saved.id), saved].sort(
    (left, right) => right.challanDate.localeCompare(left.challanDate)
      || right.challanNumber - left.challanNumber
      || right.id.localeCompare(left.id),
  );
}

export function formatSalesMoney(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatChallanDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function salesOfficeErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  if (code === "P3002") return "Choose a customer from this factory.";
  if (code === "P3003") return "This Challan is not available for this factory.";
  if (code === "P3004") return "Choose brick types from this factory.";
  if (code === "P3005") return "This Challan is locked and cannot be edited or voided.";
  if (code === "P3006") return "A void Challan cannot be changed.";
  if (code === "P3010") return "Complete the printable factory profile before creating a Challan.";
  if (code === "P3011") return "Add at least one brick row, note, or extra charge.";
  if (code === "P3102") return "Choose a Vehicle from this factory.";
  if (code === "P3105") return "That Vehicle is archived. Restore it or choose another Vehicle.";
  if (code === "P3106") return "Enter a positive Trip Labour Wage for the selected Vehicle.";
  if (code === "P3111") {
    return "This change would overpay the Vehicle wage account. Review its payments first.";
  }
  if (code === "42501" || code === "401") return "You do not have access to manage these Challans.";
  if (code === "22023" || code === "23514") {
    return "Check the date, Vehicle, Trip Labour Wage, brick rows, and additional lines.";
  }
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || fallback;
}

export function factoryProfileErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Could not save the Factory / Challan Profile.";
  const failure = error as { code?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  if (code === "22023" || code === "23514") return "Complete all four Factory / Challan Profile fields.";
  if (code === "42501" || code === "401") return "You do not have access to update this factory profile.";
  if (/failed to fetch|networkerror|network request|load failed/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return message || "Could not save the Factory / Challan Profile.";
}

function buildChallanInput(
  factoryId: string,
  form: Readonly<ChallanFormState>,
): CreateChallanInput | null {
  if (!factoryId || getChallanFormError(form)) return null;
  const tripLabourWage = form.vehicleDeliveryWageTrackingEnabled
    ? parseMoney(form.tripLabourWage, false)!
    : null;

  const items: ChallanItemInput[] = form.lines.map((line) => ({
    brickTypeId: line.brickTypeId,
    quantity: parsePositiveWholeNumber(line.quantity)!,
    ratePer1000Bricks: parseMoney(line.ratePer1000Bricks, false)!,
  }));
  const flexibleLines: ChallanFlexibleLineInput[] = form.flexibleLines.map((line, orderIndex) => {
    const particulars = normalizeParticulars(line.particulars);
    if (line.lineType === "NOTE") return { lineType: "NOTE", orderIndex, particulars };
    if (line.chargeMode === "DIRECT_AMOUNT") {
      return {
        lineType: "EXTRA_CHARGE",
        orderIndex,
        particulars,
        amount: parseMoney(line.amount, false)!,
      };
    }
    return {
      lineType: "EXTRA_CHARGE",
      orderIndex,
      particulars,
      quantity: parsePositiveDecimal(line.quantity, 3)!,
      rate: parseMoney(line.rate, false)!,
    };
  });

  return {
    factoryId,
    challanDate: form.challanDate,
    customerId: form.customerId,
    vehicleId: form.vehicleId || null,
    tripLabourWage,
    items,
    flexibleLines,
  };
}

export function getChallanFormError(form: Readonly<ChallanFormState>): string | null {
  if (!form.customerId) return "Choose a customer.";
  if (!isCanonicalDate(form.challanDate)) return "Choose a valid Challan date.";
  if (form.vehicleId && !form.selectedVehicleIsActive) {
    return "Choose an active Vehicle or No vehicle.";
  }
  if (form.vehicleDeliveryWageTrackingEnabled
    && parseMoney(form.tripLabourWage, false) === null) {
    return "Enter a positive Trip Labour Wage for this Vehicle.";
  }
  if (form.lines.length > 100) return "A Challan supports at most 100 brick rows.";
  if (form.flexibleLines.length > 100) return "A Challan supports at most 100 additional lines.";
  if (form.lines.length === 0 && form.flexibleLines.length === 0) {
    return "Add at least one brick row, note, or extra charge.";
  }

  for (const [index, line] of form.lines.entries()) {
    if (!line.brickTypeId
      || parsePositiveWholeNumber(line.quantity) === null
      || parseMoney(line.ratePer1000Bricks, false) === null) {
      return `Complete or remove brick row ${index + 1}.`;
    }
  }

  for (const [index, line] of form.flexibleLines.entries()) {
    const label = line.lineType === "NOTE" ? "note" : "extra charge";
    const particulars = normalizeParticulars(line.particulars);
    if (!particulars) return `Enter particulars for ${label} ${index + 1}.`;
    if (particulars.length > 500) return `Keep ${label} ${index + 1} particulars within 500 characters.`;
    if (line.lineType === "NOTE") continue;
    if (line.chargeMode === "DIRECT_AMOUNT") {
      if (parseMoney(line.amount, false) === null) {
        return `Enter a positive amount for extra charge ${index + 1}.`;
      }
      continue;
    }
    if (parsePositiveDecimal(line.quantity, 3) === null
      || parseMoney(line.rate, false) === null) {
      return `Enter both a valid quantity and rate for extra charge ${index + 1}.`;
    }
  }
  return null;
}

function normalizeParticulars(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parsePositiveWholeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000_000
    ? parsed
    : null;
}

function parseMoney(value: string, allowZero: boolean): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)
    || (allowZero ? parsed < 0 : parsed <= 0)
    || parsed >= 1_000_000_000
    || Math.abs(parsed * 100 - Math.round(parsed * 100)) >= 1e-7) return null;
  return parsed;
}

function parsePositiveDecimal(value: string, decimalPlaces: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  const factor = 10 ** decimalPlaces;
  if (!Number.isFinite(parsed)
    || parsed <= 0
    || parsed >= 1_000_000_000
    || Math.abs(parsed * factor - Math.round(parsed * factor)) >= 1e-7) return null;
  return parsed;
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
