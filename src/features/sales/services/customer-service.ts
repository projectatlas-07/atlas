import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { Customer } from "../types.ts";

const CUSTOMER_COLUMNS =
  "id, factory_id, name, address, mobile, created_at, updated_at";

type CustomerRow = {
  id: string;
  factory_id: string;
  name: string;
  address: string;
  mobile: string;
  created_at: string;
  updated_at: string;
};

export type CustomerInput = {
  factoryId: string;
  name: string;
  address: string;
  mobile: string;
};

export type UpdateCustomerInput = CustomerInput & { customerId: string };

export class CustomerServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(readableCustomerError(error));
    this.name = "CustomerServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function readableCustomerError(error: PostgrestError): string {
  if (error.code === "P3002" || error.code === "23503") {
    return "Customer does not belong to this factory.";
  }
  if (error.code === "22023" || error.code === "23514") {
    return "Check the customer name and contact details.";
  }
  return error.message;
}

function requireId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function normalizeName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Customer name is required.");
  return normalized;
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    address: row.address,
    mobile: row.mobile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomers(factoryId: string): Promise<Customer[]> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new CustomerServiceError(error);
  return (data ?? []).map(mapCustomer);
}

export async function getCustomer(
  factoryId: string,
  customerId: string,
): Promise<Customer> {
  requireId(factoryId, "factoryId");
  requireId(customerId, "customerId");
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("factory_id", factoryId)
    .eq("id", customerId)
    .maybeSingle();

  if (error) throw new CustomerServiceError(error);
  if (!data) throw new Error("Customer was not found.");
  return mapCustomer(data);
}

export async function createCustomer({
  factoryId,
  name,
  address,
  mobile,
}: CustomerInput): Promise<Customer> {
  requireId(factoryId, "factoryId");
  const { data, error } = await supabase.rpc("create_customer", {
    p_factory_id: factoryId,
    p_name: normalizeName(name),
    p_address: address.trim(),
    p_mobile: mobile.trim(),
  });

  if (error) throw new CustomerServiceError(error);
  if (!data) throw new Error("create_customer returned no customer.");
  return mapCustomer(data);
}

export async function updateCustomer({
  factoryId,
  customerId,
  name,
  address,
  mobile,
}: UpdateCustomerInput): Promise<Customer> {
  requireId(factoryId, "factoryId");
  requireId(customerId, "customerId");
  const { data, error } = await supabase.rpc("update_customer", {
    p_factory_id: factoryId,
    p_customer_id: customerId,
    p_name: normalizeName(name),
    p_address: address.trim(),
    p_mobile: mobile.trim(),
  });

  if (error) throw new CustomerServiceError(error);
  if (!data) throw new Error("update_customer returned no customer.");
  return mapCustomer(data);
}
