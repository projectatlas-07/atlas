import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabase/client.ts";
import type {
  TransportAssignedWorker,
  TransportCrewAssignment,
  TransportWorkDirection,
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
    work_direction,
    is_active
  )
`;

type TransportCrewAssignmentRow = {
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
    work_direction: TransportWorkDirection;
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

export type AssignTransportWorkerToCrewInput = {
  factoryId: string;
  transportWorkerId: string;
  transportCrewId: string;
};

export class TransportCrewAssignmentServiceError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(error: PostgrestError) {
    super(getAssignmentErrorMessage(error));
    this.name = "TransportCrewAssignmentServiceError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

function getAssignmentErrorMessage(error: PostgrestError): string {
  if (error.code === "23505") {
    return "Transport worker is already assigned to this crew.";
  }
  if (error.code === "23503") {
    return "Transport worker, crew, and assignment must belong to the same factory.";
  }
  return error.message;
}

function mapTransportCrewAssignment(
  row: TransportCrewAssignmentRow,
): TransportCrewAssignment {
  return {
    id: row.id,
    factoryId: row.factory_id,
    transportWorkerId: row.transport_worker_id,
    transportWorkerName: row.transport_worker.name,
    transportWorkerIsActive: row.transport_worker.is_active,
    transportCrewId: row.transport_crew_id,
    transportCrewName: row.transport_crew.name,
    transportCrewWorkDirection: row.transport_crew.work_direction,
    transportCrewIsActive: row.transport_crew.is_active,
    createdAt: row.created_at,
  };
}

export async function listTransportCrewAssignments({
  factoryId,
}: Readonly<{ factoryId: string }>): Promise<TransportCrewAssignment[]> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .select(assignmentSelect)
    .eq("factory_id", factoryId)
    .order("transport_worker_id", { ascending: true })
    .order("transport_crew_id", { ascending: true });

  if (error) throw new TransportCrewAssignmentServiceError(error);
  return ((data ?? []) as unknown as TransportCrewAssignmentRow[])
    .map(mapTransportCrewAssignment)
    .sort((left, right) =>
      left.transportWorkerName.localeCompare(right.transportWorkerName, "en-IN")
      || left.transportCrewName.localeCompare(right.transportCrewName, "en-IN")
      || left.id.localeCompare(right.id),
    );
}

export async function assignTransportWorkerToCrew({
  factoryId,
  transportWorkerId,
  transportCrewId,
}: AssignTransportWorkerToCrewInput): Promise<TransportCrewAssignment> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .insert({
      factory_id: factoryId,
      transport_worker_id: transportWorkerId,
      transport_crew_id: transportCrewId,
    })
    .select(assignmentSelect)
    .single();

  if (error) throw new TransportCrewAssignmentServiceError(error);
  if (!data) throw new Error("Transport crew assignment creation returned no row.");
  return mapTransportCrewAssignment(data as unknown as TransportCrewAssignmentRow);
}

export async function unassignTransportWorkerFromCrew({
  factoryId,
  assignmentId,
}: Readonly<{
  factoryId: string;
  assignmentId: string;
}>): Promise<TransportCrewAssignment> {
  const { data, error } = await supabase
    .from("transport_crew_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("factory_id", factoryId)
    .select(assignmentSelect);

  if (error) throw new TransportCrewAssignmentServiceError(error);
  if (!data || data.length === 0) {
    throw new Error("Transport crew assignment was not removed.");
  }
  if (data.length !== 1) {
    throw new Error("Unexpected result: more than one transport crew assignment was removed.");
  }
  return mapTransportCrewAssignment(data[0] as unknown as TransportCrewAssignmentRow);
}

export async function listAssignedTransportWorkersForCrew({
  factoryId,
  transportCrewId,
}: Readonly<{
  factoryId: string;
  transportCrewId: string;
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
    .eq("transport_crew_id", transportCrewId)
    .eq("transport_worker.is_active", true)
    .order("transport_worker_id", { ascending: true });

  if (error) throw new TransportCrewAssignmentServiceError(error);

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
