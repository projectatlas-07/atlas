export const OFFICE_AREAS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "production", label: "Production" },
  { id: "workforce", label: "Workforce" },
  { id: "sales", label: "Sales" },
  { id: "purchases-expenses", label: "Purchases & Expenses" },
  { id: "cash-book", label: "Cash Book" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
] as const;

export type OfficeAreaId = (typeof OFFICE_AREAS)[number]["id"];

const OFFICE_AREA_IDS = new Set<string>(OFFICE_AREAS.map((area) => area.id));

export const OFFICE_PRODUCTION_AREAS = [
  { id: "brick", label: "Brick Production", hash: "brick-production" },
  { id: "chamber", label: "Chamber Transport", hash: "chamber-transport" },
  { id: "soil", label: "Soil / Trolley", hash: "soil" },
] as const;

export type OfficeProductionAreaId = (typeof OFFICE_PRODUCTION_AREAS)[number]["id"];

export const OFFICE_PURCHASES_EXPENSES_AREAS = [
  { id: "coal", label: "Coal", hash: "coal" },
  { id: "vehicle-maintenance", label: "Vehicle Maintenance", hash: "vehicle-maintenance" },
  { id: "fuel-book", label: "Fuel Book", hash: "fuel-book" },
  { id: "costs-outgoings", label: "Costs & Outgoings", hash: "costs-outgoings" },
] as const;

export type OfficePurchasesExpensesAreaId = (typeof OFFICE_PURCHASES_EXPENSES_AREAS)[number]["id"];

export const OFFICE_COAL_AREAS = [
  { id: "coal-purchases", label: "Coal Purchases", hash: "coal-purchases" },
  { id: "seller-payments", label: "Seller Payments", hash: "coal-seller-payments" },
] as const;

export type OfficeCoalAreaId = (typeof OFFICE_COAL_AREAS)[number]["id"];

export const OFFICE_VEHICLE_MAINTENANCE_AREAS = [
  { id: "maintenance", label: "Maintenance", hash: "vehicle-maintenance" },
  { id: "garage-payments", label: "Garage Payments", hash: "vehicle-maintenance-garage-payments" },
] as const;

export type OfficeVehicleMaintenanceAreaId = (typeof OFFICE_VEHICLE_MAINTENANCE_AREAS)[number]["id"];

export const OFFICE_FUEL_BOOK_AREAS = [
  { id: "fuel-entries", label: "Fuel Entries", hash: "fuel-book" },
  { id: "pump-payments", label: "Pump Payments", hash: "fuel-book-pump-payments" },
] as const;

export type OfficeFuelBookAreaId = (typeof OFFICE_FUEL_BOOK_AREAS)[number]["id"];

export const OFFICE_COSTS_OUTGOINGS_AREAS = [
  { id: "costs", label: "Costs", hash: "costs-outgoings" },
  { id: "outgoing-payments", label: "Outgoing Payments", hash: "costs-outgoings-payments" },
] as const;

export type OfficeCostsOutgoingsAreaId = (typeof OFFICE_COSTS_OUTGOINGS_AREAS)[number]["id"];

export const OFFICE_COAL_PURCHASES_ARCHIVE_HASH = "#all-coal-purchases";
export const OFFICE_COAL_SELLER_PAYMENTS_ARCHIVE_HASH = "#all-seller-payments";
export const OFFICE_VEHICLE_MAINTENANCE_ARCHIVE_HASH = "#all-maintenance";
export const OFFICE_GARAGE_PAYMENTS_ARCHIVE_HASH = "#all-garage-payments";
export const OFFICE_FUEL_ENTRIES_ARCHIVE_HASH = "#all-fuel-entries";
export const OFFICE_PUMP_PAYMENTS_ARCHIVE_HASH = "#all-pump-payments";
export const OFFICE_COSTS_ARCHIVE_HASH = "#all-costs";
export const OFFICE_OUTGOING_PAYMENTS_ARCHIVE_HASH = "#all-outgoing-payments";

/** Resolves only hashes owned by the Office Production workspace. */
export function resolveOfficeProductionAreaFromHash(hash: string): OfficeProductionAreaId | null {
  const value = hash.replace(/^#/, "");
  if (value === "production" || value === "brick-production") return "brick";
  if (value === "transport" || value === "chamber-transport") return "chamber";
  if (value === "soil") return "soil";
  return null;
}

export function getOfficeProductionHash(areaId: OfficeProductionAreaId): string {
  const area = OFFICE_PRODUCTION_AREAS.find((candidate) => candidate.id === areaId);
  return `#${area?.hash ?? "brick-production"}`;
}

export function getOfficeProductionHref(areaId: OfficeProductionAreaId): string {
  return `/office${getOfficeProductionHash(areaId)}`;
}

/** Maps retired root recording hashes into the canonical Office Production workspace. */
export function resolveLegacyProductionRedirect(hash: string): string {
  return getOfficeProductionHref(resolveOfficeProductionAreaFromHash(hash) ?? "brick");
}

/** Resolves only hashes owned by the Purchases & Expenses workspace. */
export function resolveOfficePurchasesExpensesAreaFromHash(
  hash: string,
): OfficePurchasesExpensesAreaId | null {
  const value = hash.replace(/^#/, "");
  if (value === "purchases-expenses") return "coal";
  if (resolveOfficeCoalAreaFromHash(hash)) return "coal";
  if (resolveOfficeVehicleMaintenanceAreaFromHash(hash)) return "vehicle-maintenance";
  if (resolveOfficeFuelBookAreaFromHash(hash)) return "fuel-book";
  if (resolveOfficeCostsOutgoingsAreaFromHash(hash)) return "costs-outgoings";
  const area = OFFICE_PURCHASES_EXPENSES_AREAS.find((candidate) => candidate.hash === value);
  return area?.id ?? null;
}

export function getOfficePurchasesExpensesHash(areaId: OfficePurchasesExpensesAreaId): string {
  const area = OFFICE_PURCHASES_EXPENSES_AREAS.find((candidate) => candidate.id === areaId);
  return `#${area?.hash ?? "coal"}`;
}

/** Resolves only hashes owned by the Coal workspace. */
export function resolveOfficeCoalAreaFromHash(hash: string): OfficeCoalAreaId | null {
  const value = hash.replace(/^#/, "");
  if (value === "coal" || value === "all-coal-purchases") return "coal-purchases";
  if (value === "all-seller-payments") return "seller-payments";
  const area = OFFICE_COAL_AREAS.find((candidate) => candidate.hash === value);
  return area?.id ?? null;
}

export function getOfficeCoalPurchasesArchiveHash(): string {
  return OFFICE_COAL_PURCHASES_ARCHIVE_HASH;
}

export function getOfficeCoalSellerPaymentsArchiveHash(): string {
  return OFFICE_COAL_SELLER_PAYMENTS_ARCHIVE_HASH;
}

export function getOfficeCoalHash(areaId: OfficeCoalAreaId): string {
  const area = OFFICE_COAL_AREAS.find((candidate) => candidate.id === areaId);
  return `#${area?.hash ?? "coal-purchases"}`;
}

/** Resolves only hashes owned by the Vehicle Maintenance workspace. */
export function resolveOfficeVehicleMaintenanceAreaFromHash(
  hash: string,
): OfficeVehicleMaintenanceAreaId | null {
  const value = hash.replace(/^#/, "");
  if (value === "all-maintenance") return "maintenance";
  if (value === "all-garage-payments") return "garage-payments";
  const area = OFFICE_VEHICLE_MAINTENANCE_AREAS.find((candidate) => candidate.hash === value);
  return area?.id ?? null;
}

export function getOfficeVehicleMaintenanceArchiveHash(): string {
  return OFFICE_VEHICLE_MAINTENANCE_ARCHIVE_HASH;
}

export function getOfficeGaragePaymentsArchiveHash(): string {
  return OFFICE_GARAGE_PAYMENTS_ARCHIVE_HASH;
}

export function getOfficeVehicleMaintenanceHash(areaId: OfficeVehicleMaintenanceAreaId): string {
  const area = OFFICE_VEHICLE_MAINTENANCE_AREAS.find((candidate) => candidate.id === areaId);
  return `#${area?.hash ?? "vehicle-maintenance"}`;
}

/** Resolves only hashes owned by the Fuel Book workspace. */
export function resolveOfficeFuelBookAreaFromHash(
  hash: string,
): OfficeFuelBookAreaId | null {
  const value = hash.replace(/^#/, "");
  if (value === "all-fuel-entries") return "fuel-entries";
  if (value === "all-pump-payments") return "pump-payments";
  const area = OFFICE_FUEL_BOOK_AREAS.find((candidate) => candidate.hash === value);
  return area?.id ?? null;
}

export function getOfficeFuelEntriesArchiveHash(): string {
  return OFFICE_FUEL_ENTRIES_ARCHIVE_HASH;
}

export function getOfficePumpPaymentsArchiveHash(): string {
  return OFFICE_PUMP_PAYMENTS_ARCHIVE_HASH;
}

export function getOfficeFuelBookHash(areaId: OfficeFuelBookAreaId): string {
  const area = OFFICE_FUEL_BOOK_AREAS.find((candidate) => candidate.id === areaId);
  return `#${area?.hash ?? "fuel-book"}`;
}

/** Resolves only hashes owned by the Costs & Outgoings workspace. */
export function resolveOfficeCostsOutgoingsAreaFromHash(
  hash: string,
): OfficeCostsOutgoingsAreaId | null {
  const value = hash.replace(/^#/, "");
  if (value === "all-costs") return "costs";
  if (value === "all-outgoing-payments") return "outgoing-payments";
  const area = OFFICE_COSTS_OUTGOINGS_AREAS.find((candidate) => candidate.hash === value);
  return area?.id ?? null;
}

export function getOfficeCostsArchiveHash(): string {
  return OFFICE_COSTS_ARCHIVE_HASH;
}

export function getOfficeOutgoingPaymentsArchiveHash(): string {
  return OFFICE_OUTGOING_PAYMENTS_ARCHIVE_HASH;
}

export function getOfficeCostsOutgoingsHash(areaId: OfficeCostsOutgoingsAreaId): string {
  const area = OFFICE_COSTS_OUTGOINGS_AREAS.find((candidate) => candidate.id === areaId);
  return `#${area?.hash ?? "costs-outgoings"}`;
}

/** Resolves the Office hash without creating a second routing authority. */
export function resolveOfficeAreaFromHash(hash: string): OfficeAreaId {
  const value = hash.replace(/^#/, "");
  if (value === "office-dashboard-feature") return "dashboard";
  if (value === "labour-wages") return "workforce";
  if (value === "new-challan") return "sales";
  if (resolveOfficeProductionAreaFromHash(hash)) return "production";
  if (resolveOfficePurchasesExpensesAreaFromHash(hash)) return "purchases-expenses";
  return OFFICE_AREA_IDS.has(value) ? value as OfficeAreaId : "dashboard";
}
