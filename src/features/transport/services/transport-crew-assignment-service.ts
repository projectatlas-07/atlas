import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  TransportAssignedWorker,
  TransportGroupAssignment,
} from "../types.ts";

const assignmentSelect = `
  id,
  factory_id,
  transport_worker_id,
  transport_crew_id,
  created_at,
  transport_worker:transport_workers!transport_crew_assignments_worker_factory_fkey(
    id,
    name,
    is_active
  ),
  transport_crew:transport_crews!transport_crew_assignments_crew_factory_fkey(
    id,
    name,
    is_active
  )
`;

type TransportGroupAssignmentRow = {
  id: string;
  factory_id: string;
  transport_worker_id: string;
  transport_crew_id: string;
  created_at: string;
  transport_worker: {
    id: string;
    name: string;
    is_active: boolean;
  };
  transport_crew: {
    id: string;
    name: string;
    is_active: boolean;
  };
};

type TransportAssignedWorkerRow = {
  transport_worker_id: string;
  transport_worker: {
    id: string;
    name: string;
    is_active: boolean;
  };
};

export type AssignTransportWorkerToGroupInput = {
  factoryId: string;
  transportWorkerId: string;
  transportGroupId: string;
};

export class TransportGroupAssignmentServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(getAssignmentErrorMessage(error));
    this.name = "TransportGroupAssignmentServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function getAssignmentErrorMessage(error: PostgrestError): string {
  if (error.code === "23505") {
    return "Transport worker is already assigned to this Transport Group.";
  }
  if (error.code === "23503") {
    return "Transport worker, Transport Group, and assignment must belong to the same factory.";
  }
  return error.message;
}

function mapTransportGroupAssignment(
  row: TransportGroupAssignmentRow,
): TransportGroupAssignment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    transportWorkerId: row.transport_worker_id,
    transportWorkerName: row.transport_worker.name,
    transportWorkerIsActive: row.transport_worker.is_active,
    transportGroupId: row.transport_crew_id,
    transportGroupName: row.transport_crew.name,
    transportGroupIsActive: row.transport_crew.is_active,
    createdAt: row.created_at,
  };
}

export async function listTransportGroupAssignments({
  factoryId,
}: Readonly<{ factoryId: string }>): Promise<TransportGroupAssignment[]> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .select(assignmentSelect)
    .eq("factory_id", factoryId)
    .order("transport_worker_id", { ascending: true })
    .order("transport_crew_id", { ascending: true });

  if (error) throw new TransportGroupAssignmentServiceError(error);
  return ((data ?? []) as unknown as TransportGroupAssignmentRow[])
    .map(mapTransportGroupAssignment)
    .sort((left, right) =>
      left.transportWorkerName.localeCompare(right.transportWorkerName, "en-IN")
      || left.transportGroupName.localeCompare(right.transportGroupName, "en-IN")
      || left.id.localeCompare(right.id),
    );
}

export async function assignTransportWorkerToGroup({
  factoryId,
  transportWorkerId,
  transportGroupId,
}: AssignTransportWorkerToGroupInput): Promise<TransportGroupAssignment> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .insert({
      factory_id: factoryId,
      transport_worker_id: transportWorkerId,
      transport_crew_id: transportGroupId,
    })
    .select(assignmentSelect)
    .single();

  if (error) throw new TransportGroupAssignmentServiceError(error);
  if (!data) throw new Error("Transport Group assignment creation returned no row.");
  return mapTransportGroupAssignment(data as unknown as TransportGroupAssignmentRow);
}

export async function unassignTransportWorkerFromGroup({
  factoryId,
  assignmentId,
}: Readonly<{
  factoryId: string;
  assignmentId: string;
}>): Promise<TransportGroupAssignment> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("factory_id", factoryId)
    .select(assignmentSelect);

  if (error) throw new TransportGroupAssignmentServiceError(error);
  if (!data || data.length === 0) {
    throw new Error("Transport Group assignment was not removed.");
  }
  if (data.length !== 1) {
    throw new Error("Unexpected result: more than one Transport Group assignment was removed.");
  }
  return mapTransportGroupAssignment(data[0] as unknown as TransportGroupAssignmentRow);
}

export async function listAssignedTransportWorkersForGroup({
  factoryId,
  transportGroupId,
}: Readonly<{
  factoryId: string;
  transportGroupId: string;
}>): Promise<TransportAssignedWorker[]> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .select(`
      transport_worker_id,
      transport_worker:transport_workers!transport_crew_assignments_worker_factory_fkey!inner(
        id,
        name,
        is_active
      )
    `)
    .eq("factory_id", factoryId)
    .eq("transport_crew_id", transportGroupId)
    .eq("transport_worker.is_active", true)
    .order("transport_worker_id", { ascending: true });

  if (error) throw new TransportGroupAssignmentServiceError(error);

  return ((data ?? []) as unknown as TransportAssignedWorkerRow[])
    .map((row) => ({
      transportWorkerId: row.transport_worker_id,
      transportWorkerName: row.transport_worker.name,
      transportWorkerIsActive: row.transport_worker.is_active,
    }))
    .sort((left, right) =>
      left.transportWorkerName.localeCompare(right.transportWorkerName, "en-IN")
      || left.transportWorkerId.localeCompare(right.transportWorkerId),
    );
}
