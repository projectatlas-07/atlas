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

/** Resolves the Office hash without creating a second routing authority. */
export function resolveOfficeAreaFromHash(hash: string): OfficeAreaId {
  const value = hash.replace(/^#/, "");
  if (value === "office-dashboard-feature") return "dashboard";
  if (value === "labour-wages") return "workforce";
  if (value === "new-challan") return "sales";
  return OFFICE_AREA_IDS.has(value) ? value as OfficeAreaId : "dashboard";
}
