import type { PostgrestError } from "@supabase/supabase-js";
import { assertInclusiveBusinessDateRange } from "../../../lib/business-date-contract.ts";
import { sumFiniteNumbers } from "../../../lib/numeric-total.ts";
import { supabase } from "../../../lib/supabase/client.ts";
import { readAllKeysetPages } from "../../../lib/complete-paginated-read.ts";

export class ProductionReadServiceError extends Error {
  readonly code: string;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = "ProductionReadServiceError";
    this.code = error.code;
  }
}

export async function getProductionQuantityTotal(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  assertInclusiveBusinessDateRange(factoryId, dateFrom, dateTo);
  const data = await readAllKeysetPages(async (afterId, pageSize) => {
    let query = supabase.from("production_entries")
      .select("id, quantity")
      .eq("factory_id", factoryId)
      .gte("production_date", dateFrom)
      .lte("production_date", dateTo)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt("id", afterId);
    const { data: page, error } = await query;
    if (error) throw new ProductionReadServiceError(error);
    return page ?? [];
  });
  return sumFiniteNumbers(
    data.map((entry) => entry.quantity),
    "Production Quantity total",
  );
}
