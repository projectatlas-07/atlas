import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type { StaffCategory, StaffWorker } from "../types.ts";

const STAFF_CATEGORY_COLUMNS =
  "id, factory_id, name, created_at, updated_at";
const STAFF_WORKER_COLUMNS =
  "id, factory_id, name, staff_category_id, reference_salary, is_active, created_at, updated_at";

type StaffCategoryRow = {
  id: string;
  factory_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type StaffWorkerRow = {
  id: string;
  factory_id: string;
  name: string;
  staff_category_id: string;
  reference_salary: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateStaffWorkerInput = {
  factoryId: string;
  name: string;
  staffCategoryId: string;
  referenceSalary: number;
};

export type StaffCategoryMutationInput = {
  factoryId: string;
  staffCategoryId: string;
};

export type UpdateStaffReferenceSalaryInput = {
  factoryId: string;
  staffWorkerId: string;
  referenceSalary: number;
};

export type StaffWorkerLifecycleInput = {
  factoryId: string;
  staffWorkerId: string;
};

export class StaffWorkerServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "StaffWorkerServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function mapStaffWorker(row: StaffWorkerRow): StaffWorker {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    staffCategoryId: row.staff_category_id,
    referenceSalary: row.reference_salary,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStaffCategory(row: StaffCategoryRow): StaffCategory {
  return {
    id: row.id,
    factoryId: row.factory_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireTrimmedName(name: string, label = "Staff worker"): string {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error(`${label} name is required.`);
  return trimmedName;
}

export async function listStaffCategories(factoryId: string): Promise<StaffCategory[]> {
  const { data, error } = await supabase
    .from("staff_categories")
    .select(STAFF_CATEGORY_COLUMNS)
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new StaffWorkerServiceError(error);
  return (data ?? []).map(mapStaffCategory);
}

export async function createStaffCategory(input: Readonly<{
  factoryId: string;
  name: string;
}>): Promise<StaffCategory> {
  const { data, error } = await supabase
    .from("staff_categories")
    .insert({
      factory_id: input.factoryId,
      name: requireTrimmedName(input.name, "Staff category"),
    })
    .select(STAFF_CATEGORY_COLUMNS)
    .single();

  if (error) throw new StaffWorkerServiceError(error);
  if (!data) throw new Error("Staff category creation returned no row.");
  return mapStaffCategory(data);
}

export async function updateStaffCategory({
  factoryId,
  staffCategoryId,
  name,
}: StaffCategoryMutationInput & { name: string }): Promise<StaffCategory> {
  const { data, error } = await supabase.rpc("update_staff_category", {
    p_factory_id: factoryId,
    p_staff_category_id: staffCategoryId,
    p_name: requireTrimmedName(name, "Staff category"),
  });

  if (error) throw new StaffWorkerServiceError(error);
  if (!data) throw new Error("update_staff_category returned no category.");
  return mapStaffCategory(data);
}

export async function deleteStaffCategory({
  factoryId,
  staffCategoryId,
}: StaffCategoryMutationInput): Promise<void> {
  const { data, error } = await supabase.rpc("delete_staff_category", {
    p_factory_id: factoryId,
    p_staff_category_id: staffCategoryId,
  });

  if (error) throw new StaffWorkerServiceError(error);
  if (data !== staffCategoryId) {
    throw new Error("delete_staff_category did not return the deleted category ID.");
  }
}

export async function listStaffWorkers(factoryId: string): Promise<StaffWorker[]> {
  const { data, error } = await supabase
    .from("staff_workers")
    .select(STAFF_WORKER_COLUMNS)
    .eq("factory_id", factoryId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new StaffWorkerServiceError(error);
  return (data ?? []).map(mapStaffWorker);
}

/** Authoritative Staff creation path. */
export async function createStaffWorker({
  factoryId,
  name,
  staffCategoryId,
  referenceSalary,
}: CreateStaffWorkerInput): Promise<StaffWorker> {
  const { data, error } = await supabase.rpc(
    "create_staff_worker_with_reference_salary",
    {
      p_factory_id: factoryId,
      p_name: requireTrimmedName(name),
      p_staff_category_id: staffCategoryId,
      p_reference_salary: referenceSalary,
    },
  );

  if (error) throw new StaffWorkerServiceError(error);
  if (!data) {
    throw new Error("create_staff_worker_with_reference_salary returned no worker.");
  }

  return mapStaffWorker(data);
}

export async function updateStaffReferenceSalary({
  factoryId,
  staffWorkerId,
  referenceSalary,
}: UpdateStaffReferenceSalaryInput): Promise<StaffWorker> {
  const { data, error } = await supabase.rpc("update_staff_reference_salary", {
    p_factory_id: factoryId,
    p_staff_worker_id: staffWorkerId,
    p_reference_salary: referenceSalary,
  });

  if (error) throw new StaffWorkerServiceError(error);
  if (!data) throw new Error("update_staff_reference_salary returned no worker.");

  return mapStaffWorker(data);
}

export async function archiveStaffWorker({
  factoryId,
  staffWorkerId,
}: StaffWorkerLifecycleInput): Promise<StaffWorker> {
  const { data, error } = await supabase.rpc("archive_staff_worker", {
    p_factory_id: factoryId,
    p_staff_worker_id: staffWorkerId,
  });

  if (error) throw new StaffWorkerServiceError(error);
  if (!data) throw new Error("archive_staff_worker returned no worker.");
  return mapStaffWorker(data);
}

export async function restoreStaffWorker({
  factoryId,
  staffWorkerId,
}: StaffWorkerLifecycleInput): Promise<StaffWorker> {
  const { data, error } = await supabase.rpc("restore_staff_worker", {
    p_factory_id: factoryId,
    p_staff_worker_id: staffWorkerId,
  });

  if (error) throw new StaffWorkerServiceError(error);
  if (!data) throw new Error("restore_staff_worker returned no worker.");
  return mapStaffWorker(data);
}

export async function deleteStaffWorker({
  factoryId,
  staffWorkerId,
}: StaffWorkerLifecycleInput): Promise<void> {
  const { data, error } = await supabase.rpc("delete_staff_worker", {
    p_factory_id: factoryId,
    p_staff_worker_id: staffWorkerId,
  });

  if (error) throw new StaffWorkerServiceError(error);
  if (data !== staffWorkerId) {
    throw new Error("delete_staff_worker did not return the deleted worker ID.");
  }
}
