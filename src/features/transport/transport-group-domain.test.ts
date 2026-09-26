import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const runtimeFiles = [
  "./types.ts",
  "./services/transport-crew-service.ts",
  "./services/transport-crew-assignment-service.ts",
  "./services/transport-daily-entry-service.ts",
  "./services/transport-daily-operations-service.ts",
  "./services/transport-weekly-earning-read-service.ts",
  "./transport-daily-entry-screen-model.ts",
  "./components/transport-daily-entry-screen.tsx",
  "../office/transport-office-model.ts",
  "../office/transport-weekly-earnings-model.ts",
  "../office/components/transport-office-section.tsx",
  "../office/components/production-office-workspace.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

const runtimeSource = runtimeFiles.join("\n");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260926000066_remove_transport_work_direction.sql", import.meta.url),
  "utf8",
);

test("current Transport Group UI and services have no direction contract", () => {
  assert.doesNotMatch(
    runtimeSource,
    /work_direction|workDirection|WorkDirection|FIELD_TO_KILN|KILN_TO_FIELD|formatTransportDirection/,
  );
  assert.match(runtimeSource, /Transport Group/);
});

test("the forward migration only removes direction from the existing physical group table", () => {
  assert.match(migration, /alter table public\.transport_crews/);
  assert.match(migration, /drop constraint transport_crews_work_direction_check/);
  assert.match(migration, /drop column work_direction/);
  assert.doesNotMatch(
    migration,
    /transport_crew_assignments|transport_daily_entries|transport_daily_attendance|transport_crew_wage_rates|transport_weekly|transport_withdrawals|create table|unique/i,
  );
});
