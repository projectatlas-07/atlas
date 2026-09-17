import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { Supplier } from "../types.ts";

export type SupplierRole = "COAL_SELLER" | "GARAGE" | "FUEL_PUMP";

type SupplierRow = {
  id: string; factory_id: string; name: string; address: string | null;
  mobile: string | null; created_at: string; updated_at: string;
};

export class SupplierRoleServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(readableError(error));
    this.name = "SupplierRoleServiceError";
    this.code = error.code;
  }
}

export async function listSuppliersByRole(
  factoryId: string,
  role: SupplierRole,
): Promise<Supplier[]> {
  requireId(factoryId, "factoryId");
  requireRole(role);
  const { data, error } = await supabase.rpc("list_suppliers_by_role", {
    p_factory_id: factoryId,
    p_role: role,
  });
  if (error) throw new SupplierRoleServiceError(error);
  return ((data ?? []) as SupplierRow[]).map(mapSupplier);
}

export async function createOrAssignSupplierRole(input: Readonly<{
  factoryId: string;
  role: SupplierRole;
  name: string;
  address?: string | null;
  mobile?: string | null;
}>): Promise<Supplier> {
  requireId(input.factoryId, "factoryId");
  requireRole(input.role);
  const name = normalizeRequired(input.name, 200, "name");
  const address = normalizeOptional(input.address, 500, "address");
  const mobile = normalizeOptional(input.mobile, 50, "mobile");
  const { data, error } = await supabase.rpc("create_or_assign_supplier_role", {
    p_factory_id: input.factoryId,
    p_role: input.role,
    p_name: name,
    p_address: address,
    p_mobile: mobile,
  });
  if (error) throw new SupplierRoleServiceError(error);
  if (!data) throw new Error("create_or_assign_supplier_role returned no supplier.");
  return mapSupplier(data);
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id, factoryId: row.factory_id, name: row.name,
    address: row.address, mobile: row.mobile,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function readableError(error: PostgrestError): string {
  if (error.code === "P4401") return "Supplier role is invalid.";
  if (error.code === "P4402") return "Choose a supplier assigned as a Coal Seller.";
  if (error.code === "P4403") return "Choose a supplier assigned as a Garage.";
  if (error.code === "P4503") return "Choose a supplier assigned as a Fuel Pump.";
  if (error.code === "P4404") return "Multiple suppliers already use this name. Use a distinct name or resolve the duplicate suppliers first.";
  if (error.code === "42501") return "You do not have access to this factory.";
  return error.message;
}

function requireRole(role: string): asserts role is SupplierRole {
  if (role !== "COAL_SELLER" && role !== "GARAGE" && role !== "FUEL_PUMP") {
    throw new Error("Supplier role is invalid.");
  }
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function normalizeRequired(value: string, maximum: number, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is required and must be at most ${maximum} characters.`);
  }
  return normalized;
}

function normalizeOptional(
  value: string | null | undefined,
  maximum: number,
  label: string,
): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must be at most ${maximum} characters.`);
  }
  return normalized || null;
}
