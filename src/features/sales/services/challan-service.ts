import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  Challan,
  ChallanFlexibleLine,
  ChallanFlexibleLineInput,
  ChallanHeader,
  ChallanItem,
  ChallanItemInput,
  CreateChallanInput,
  FactoryPrintableProfile,
  UpdateChallanInput,
} from "../types.ts";

const FACTORY_COLUMNS =
  "id, name, business_description, village, post_office, police_station, district, state, address, mobile, created_at, updated_at";
const CHALLAN_COLUMNS =
  "id, factory_id, challan_number, challan_date, customer_id, customer_name_snapshot, customer_address_snapshot, customer_mobile_snapshot, company_name_snapshot, company_business_description_snapshot, company_address_snapshot, company_mobile_snapshot, company_village_snapshot, company_post_office_snapshot, company_police_station_snapshot, company_district_snapshot, company_state_snapshot, vehicle_id, vehicle_number_snapshot, delivery_wage_applicable_snapshot, trip_labour_wage, vehicle_number, tractor_labour_rate_snapshot, challan_total, status, is_locked, voided_at, created_at, updated_at";
const CHALLAN_ITEM_COLUMNS =
  "id, factory_id, challan_id, brick_type_id, brick_particulars_snapshot, quantity, rate_per_1000_bricks, pricing_unit, line_amount, line_position, created_at";
const CHALLAN_FLEXIBLE_LINE_COLUMNS =
  "id, factory_id, challan_id, line_type, line_category, order_index, particulars, quantity, rate, amount, created_at";

type FactoryRow = {
  id: string;
  name: string;
  business_description: string;
  village: string;
  post_office: string;
  police_station: string;
  district: string;
  state: string;
  address: string;
  mobile: string;
  created_at: string;
  updated_at: string;
};

type ChallanRow = {
  id: string;
  factory_id: string;
  challan_number: number | string;
  challan_date: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_address_snapshot: string;
  customer_mobile_snapshot: string;
  company_name_snapshot: string;
  company_business_description_snapshot: string;
  company_address_snapshot: string;
  company_mobile_snapshot: string;
  company_village_snapshot: string | null;
  company_post_office_snapshot: string | null;
  company_police_station_snapshot: string | null;
  company_district_snapshot: string | null;
  company_state_snapshot: string | null;
  vehicle_id: string | null;
  vehicle_number_snapshot: string | null;
  delivery_wage_applicable_snapshot: boolean;
  trip_labour_wage: number | string | null;
  vehicle_number: string | null;
  tractor_labour_rate_snapshot: number | string | null;
  challan_total: number | string;
  status: "active" | "void";
  is_locked: boolean;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type ChallanItemRow = {
  id: string;
  factory_id: string;
  challan_id: string;
  brick_type_id: string;
  brick_particulars_snapshot: string;
  quantity: number | string;
  rate_per_1000_bricks: number | string;
  pricing_unit: "PER_1000_BRICKS";
  line_amount: number | string;
  line_position: number;
  created_at: string;
};

type ChallanFlexibleLineRow = {
  id: string;
  factory_id: string;
  challan_id: string;
  line_type: "NOTE" | "EXTRA_CHARGE";
  line_category: "NON_FINANCIAL" | "OTHER_REVENUE";
  order_index: number;
  particulars: string;
  quantity: number | string | null;
  rate: number | string | null;
  amount: number | string;
  created_at: string;
};

export type UpdateFactoryPrintableProfileInput = {
  factoryId: string;
  name: string;
  businessDescription: string;
  village: string;
  postOffice: string;
  policeStation: string;
  district: string;
  state: string;
  mobile: string;
};

export class ChallanServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableChallanError(error));
    this.name = "ChallanServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableChallanError(error: PostgrestError): string {
  if (error.code === "P3002") return "Customer does not belong to this factory.";
  if (error.code === "P3003") return "Challan does not belong to this factory.";
  if (error.code === "P3004") return "Brick type does not belong to this factory.";
  if (error.code === "P3005") return "This Challan is payment-locked and cannot be changed.";
  if (error.code === "P3006") return "A void Challan cannot be changed.";
  if (error.code === "P3010") return "Complete the printable factory profile first.";
  if (error.code === "P3011") {
    return "A Challan must contain at least one brick, NOTE, or EXTRA_CHARGE line.";
  }
  if (error.code === "P3102") return "Vehicle does not belong to this factory.";
  if (error.code === "P3105") return "This Vehicle is archived. Restore it before saving.";
  if (error.code === "P3106") {
    return "Trip Labour Wage is required for this Vehicle and must be a positive amount.";
  }
  if (error.code === "P3111") {
    return "This Challan change would overpay the Vehicle wage account. Review its payments first.";
  }
  if (error.code === "22023" || error.code === "23514") {
    return "Check the Challan date, Vehicle, Trip Labour Wage, brick lines, and flexible lines.";
  }
  return error.message;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function assertCanonicalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("challanDate must be a valid YYYY-MM-DD date.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("challanDate must be a valid YYYY-MM-DD date.");
  }
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

function hasAtMostThreeDecimalPlaces(value: number): boolean {
  return Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7;
}

function assertMoney(value: number, label: string, allowZero: boolean): void {
  if (!Number.isFinite(value)
    || (allowZero ? value < 0 : value <= 0)
    || value >= 1_000_000_000
    || !hasAtMostTwoDecimalPlaces(value)) {
    throw new Error(
      `${label} must be ${allowZero ? "non-negative" : "positive"} and use at most two decimal places.`,
    );
  }
}

function validateItems(items: ChallanItemInput[]): void {
  if (items.length > 100) {
    throw new Error("A Challan supports at most 100 brick items.");
  }
  for (const item of items) {
    requireId(item.brickTypeId, "brickTypeId");
    if (!Number.isSafeInteger(item.quantity)
      || item.quantity <= 0
      || item.quantity > 1_000_000_000) {
      throw new Error("quantity must be a positive whole number up to 1000000000.");
    }
    assertMoney(item.ratePer1000Bricks, "ratePer1000Bricks", false);
  }
}

function mapFactory(row: FactoryRow): FactoryPrintableProfile {
  return {
    id: row.id,
    name: row.name,
    businessDescription: row.business_description,
    village: row.village,
    postOffice: row.post_office,
    policeStation: row.police_station,
    district: row.district,
    state: row.state,
    address: row.address,
    mobile: row.mobile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHeader(row: ChallanRow): ChallanHeader {
  return {
    id: row.id,
    factoryId: row.factory_id,
    challanNumber: Number(row.challan_number),
    challanDate: row.challan_date,
    customerId: row.customer_id,
    customerNameSnapshot: row.customer_name_snapshot,
    customerAddressSnapshot: row.customer_address_snapshot,
    customerMobileSnapshot: row.customer_mobile_snapshot,
    companyNameSnapshot: row.company_name_snapshot,
    companyBusinessDescriptionSnapshot: row.company_business_description_snapshot,
    companyAddressSnapshot: row.company_address_snapshot,
    companyMobileSnapshot: row.company_mobile_snapshot,
    companyVillageSnapshot: row.company_village_snapshot,
    companyPostOfficeSnapshot: row.company_post_office_snapshot,
    companyPoliceStationSnapshot: row.company_police_station_snapshot,
    companyDistrictSnapshot: row.company_district_snapshot,
    companyStateSnapshot: row.company_state_snapshot,
    vehicleId: row.vehicle_id,
    vehicleNumberSnapshot: row.vehicle_number_snapshot,
    deliveryWageApplicableSnapshot: row.delivery_wage_applicable_snapshot,
    tripLabourWage: row.trip_labour_wage === null ? null : Number(row.trip_labour_wage),
    vehicleNumber: row.vehicle_number ?? "",
    tractorLabourRateSnapshot: row.tractor_labour_rate_snapshot === null
      ? 0
      : Number(row.tractor_labour_rate_snapshot),
    challanTotal: Number(row.challan_total),
    status: row.status,
    isLocked: row.is_locked,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: ChallanItemRow): ChallanItem {
  return {
    id: row.id,
    factoryId: row.factory_id,
    challanId: row.challan_id,
    brickTypeId: row.brick_type_id,
    brickParticularsSnapshot: row.brick_particulars_snapshot,
    quantity: Number(row.quantity),
    ratePer1000Bricks: Number(row.rate_per_1000_bricks),
    pricingUnit: row.pricing_unit,
    lineCategory: "BRICK_REVENUE",
    lineAmount: Number(row.line_amount),
    linePosition: row.line_position,
    createdAt: row.created_at,
  };
}

function mapFlexibleLine(row: ChallanFlexibleLineRow): ChallanFlexibleLine {
  const common = {
    id: row.id,
    factoryId: row.factory_id,
    challanId: row.challan_id,
    orderIndex: row.order_index,
    particulars: row.particulars,
    createdAt: row.created_at,
  };
  if (row.line_type === "NOTE") {
    return {
      ...common,
      lineType: "NOTE",
      lineCategory: "NON_FINANCIAL",
      quantity: null,
      rate: null,
      amount: 0,
    };
  }
  return {
    ...common,
    lineType: "EXTRA_CHARGE",
    lineCategory: "OTHER_REVENUE",
    quantity: row.quantity === null ? null : Number(row.quantity),
    rate: row.rate === null ? null : Number(row.rate),
    amount: Number(row.amount),
  };
}

function rpcItems(items: ChallanItemInput[]): Array<{
  brick_type_id: string;
  quantity: number;
  rate: number;
}> {
  return items.map((item) => ({
    brick_type_id: item.brickTypeId,
    quantity: item.quantity,
    rate: item.ratePer1000Bricks,
  }));
}

async function listChallanItems(
  factoryId: string,
  challanId: string,
): Promise<ChallanItem[]> {
  const { data, error } = await supabase
    .from("challan_items")
    .select(CHALLAN_ITEM_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("challan_id", challanId)
    .order("line_position", { ascending: true });

  if (error) throw new ChallanServiceError(error);
  return (data ?? []).map(mapItem);
}

async function listChallanFlexibleLines(
  factoryId: string,
  challanId: string,
): Promise<ChallanFlexibleLine[]> {
  const { data, error } = await supabase
    .from("challan_flexible_lines")
    .select(CHALLAN_FLEXIBLE_LINE_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("challan_id", challanId)
    .order("order_index", { ascending: true });

  if (error) throw new ChallanServiceError(error);
  return (data ?? []).map(mapFlexibleLine);
}

function rpcFlexibleLines(lines: ChallanFlexibleLineInput[] | undefined): Array<{
  line_type: "NOTE" | "EXTRA_CHARGE";
  order_index: number;
  particulars: string;
  quantity?: number;
  rate?: number;
  amount?: number;
}> | undefined {
  if (lines === undefined) return undefined;
  if (lines.length > 100) {
    throw new Error("A Challan supports at most 100 flexible lines.");
  }

  const orderIndexes = new Set<number>();
  return lines.map((line) => {
    if (!Number.isSafeInteger(line.orderIndex) || line.orderIndex < 0) {
      throw new Error("orderIndex must be a non-negative whole number.");
    }
    if (orderIndexes.has(line.orderIndex)) {
      throw new Error("Each flexible line needs a unique orderIndex within the Challan.");
    }
    orderIndexes.add(line.orderIndex);
    const particulars = requireText(line.particulars, "particulars");
    if (particulars.length > 500) {
      throw new Error("particulars must be at most 500 characters.");
    }

    if (line.lineType === "NOTE") {
      if ("amount" in line || "quantity" in line || "rate" in line) {
        throw new Error("A NOTE cannot contain amount, quantity, or rate.");
      }
      return {
        line_type: "NOTE",
        order_index: line.orderIndex,
        particulars,
      };
    }

    const hasQuantity = line.quantity !== undefined;
    const hasRate = line.rate !== undefined;
    if (hasQuantity !== hasRate) {
      throw new Error("EXTRA_CHARGE quantity and rate must be supplied together.");
    }

    if (!hasQuantity) {
      if (line.amount === undefined) {
        throw new Error("EXTRA_CHARGE requires an amount or a complete quantity and rate pair.");
      }
      assertMoney(line.amount, "amount", false);
      return {
        line_type: "EXTRA_CHARGE",
        order_index: line.orderIndex,
        particulars,
        amount: line.amount,
      };
    }

    const quantity = line.quantity as number;
    const rate = line.rate as number;
    if (!Number.isFinite(quantity)
      || quantity <= 0
      || quantity >= 1_000_000_000
      || !hasAtMostThreeDecimalPlaces(quantity)) {
      throw new Error("quantity must be positive and use at most three decimal places.");
    }
    assertMoney(rate, "rate", false);
    const calculatedAmount = Math.round((quantity * rate + Number.EPSILON) * 100) / 100;
    assertMoney(calculatedAmount, "calculated amount", false);
    if (line.amount !== undefined) {
      assertMoney(line.amount, "amount", false);
      if (Math.abs(line.amount - calculatedAmount) >= 1e-7) {
        throw new Error("EXTRA_CHARGE amount must equal quantity multiplied by rate.");
      }
    }
    return {
      line_type: "EXTRA_CHARGE",
      order_index: line.orderIndex,
      particulars,
      quantity,
      rate,
      ...(line.amount === undefined ? {} : { amount: line.amount }),
    };
  });
}

async function listChallanLines(factoryId: string, challanId: string): Promise<{
  items: ChallanItem[];
  flexibleLines: ChallanFlexibleLine[];
}> {
  const [items, flexibleLines] = await Promise.all([
    listChallanItems(factoryId, challanId),
    listChallanFlexibleLines(factoryId, challanId),
  ]);
  return { items, flexibleLines };
}

function validateMutationInput(input: CreateChallanInput): {
  items: ReturnType<typeof rpcItems>;
  flexibleLines: ReturnType<typeof rpcFlexibleLines>;
} {
  requireId(input.factoryId, "factoryId");
  requireId(input.customerId, "customerId");
  if (input.vehicleId !== null) requireId(input.vehicleId, "vehicleId");
  assertCanonicalDate(input.challanDate);
  if (input.tripLabourWage !== null) {
    assertMoney(input.tripLabourWage, "tripLabourWage", false);
  }
  validateItems(input.items);
  return {
    items: rpcItems(input.items),
    flexibleLines: rpcFlexibleLines(input.flexibleLines),
  };
}

export async function getFactoryPrintableProfile(
  factoryId: string,
): Promise<FactoryPrintableProfile> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase
    .from("factories")
    .select(FACTORY_COLUMNS)
    .eq("id", factoryId)
    .maybeSingle();

  if (error) throw new ChallanServiceError(error);
  if (!data) throw new Error("Factory was not found.");
  return mapFactory(data);
}

export async function updateFactoryPrintableProfile({
  factoryId,
  name,
  businessDescription,
  village,
  postOffice,
  policeStation,
  district,
  state,
  mobile,
}: UpdateFactoryPrintableProfileInput): Promise<FactoryPrintableProfile> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase.rpc("update_factory_printable_profile", {
    p_factory_id: factoryId,
    p_name: requireText(name, "name"),
    p_business_description: requireText(businessDescription, "businessDescription"),
    p_village: requireText(village, "village"),
    p_post_office: requireText(postOffice, "postOffice"),
    p_police_station: requireText(policeStation, "policeStation"),
    p_district: requireText(district, "district"),
    p_state: requireText(state, "state"),
    p_mobile: requireText(mobile, "mobile"),
  });

  if (error) throw new ChallanServiceError(error);
  if (!data) throw new Error("update_factory_printable_profile returned no factory.");
  return mapFactory(data);
}

export async function listChallans(factoryId: string): Promise<ChallanHeader[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase
    .from("challans")
    .select(CHALLAN_COLUMNS)
    .eq("factory_id", factoryId)
    .order("challan_date", { ascending: false })
    .order("challan_number", { ascending: false });

  if (error) throw new ChallanServiceError(error);
  return (data ?? []).map(mapHeader);
}

export async function getChallan(
  factoryId: string,
  challanId: string,
): Promise<Challan> {
  requireId(factoryId, "factoryId");
  requireId(challanId, "challanId");
  const { data, error } = await supabase
    .from("challans")
    .select(CHALLAN_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("id", challanId)
    .maybeSingle();

  if (error) throw new ChallanServiceError(error);
  if (!data) throw new Error("Challan was not found.");
  return { ...mapHeader(data), ...await listChallanLines(factoryId, challanId) };
}

export async function createChallan(input: CreateChallanInput): Promise<Challan> {
  const validated = validateMutationInput(input);
  const { data, error } = await supabase.rpc("create_challan", {
    p_factory_id: input.factoryId,
    p_challan_date: input.challanDate,
    p_customer_id: input.customerId,
    p_vehicle_id: input.vehicleId,
    p_trip_labour_wage: input.tripLabourWage,
    p_items: validated.items,
    p_flexible_lines: validated.flexibleLines ?? [],
  });

  if (error) throw new ChallanServiceError(error);
  if (!data) throw new Error("create_challan returned no Challan.");
  return { ...mapHeader(data), ...await listChallanLines(input.factoryId, data.id) };
}

export async function updateChallan(input: UpdateChallanInput): Promise<Challan> {
  requireId(input.challanId, "challanId");
  const validated = validateMutationInput(input);
  const { data, error } = await supabase.rpc("update_challan", {
    p_factory_id: input.factoryId,
    p_challan_id: input.challanId,
    p_challan_date: input.challanDate,
    p_customer_id: input.customerId,
    p_vehicle_id: input.vehicleId,
    p_trip_labour_wage: input.tripLabourWage,
    p_items: validated.items,
    p_flexible_lines: validated.flexibleLines ?? null,
  });

  if (error) throw new ChallanServiceError(error);
  if (!data) throw new Error("update_challan returned no Challan.");
  return {
    ...mapHeader(data),
    ...await listChallanLines(input.factoryId, input.challanId),
  };
}

export async function voidChallan(
  factoryId: string,
  challanId: string,
): Promise<Challan> {
  requireId(factoryId, "factoryId");
  requireId(challanId, "challanId");
  const { data, error } = await supabase.rpc("void_challan", {
    p_factory_id: factoryId,
    p_challan_id: challanId,
  });

  if (error) throw new ChallanServiceError(error);
  if (!data) throw new Error("void_challan returned no Challan.");
  return { ...mapHeader(data), ...await listChallanLines(factoryId, challanId) };
}
