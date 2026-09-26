import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProductionWorkerLastPaid } from "./production-worker-account-model.ts";

test("Last Paid is derived only from the latest payment date", () => {
  assert.equal(formatProductionWorkerLastPaid("2026-09-24", "2026-09-24"), "Last paid today");
  assert.equal(formatProductionWorkerLastPaid("2026-09-19", "2026-09-24"), "Last paid 5 days ago");
  assert.equal(formatProductionWorkerLastPaid("2026-09-18", "2026-09-24"), "Last paid 18/09/2026");
  assert.equal(formatProductionWorkerLastPaid(null, "2026-09-24"), "No payments yet");
});

test("Last Paid fails safely for invalid dates and never infers payment state", () => {
  assert.equal(formatProductionWorkerLastPaid("not-a-date", "2026-09-24"), "Payment date unavailable");
  assert.equal(formatProductionWorkerLastPaid("2026-09-24", "not-a-date"), "Payment date unavailable");
  assert.equal(formatProductionWorkerLastPaid("2026-09-25", "2026-09-24"), "Last paid 25/09/2026");
});
