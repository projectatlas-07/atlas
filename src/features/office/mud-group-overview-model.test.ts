import assert from "node:assert/strict";
import test from "node:test";
import { formatMudGroupLastPaid } from "./mud-group-overview-model.ts";

test("Mud Last paid wording comes from an actual group payment date", () => {
  assert.equal(formatMudGroupLastPaid("2026-09-24", "2026-09-24"), "Last paid today");
  assert.equal(formatMudGroupLastPaid("2026-09-19", "2026-09-24"), "Last paid 5 days ago");
  assert.equal(formatMudGroupLastPaid("2026-09-18", "2026-09-24"), "Last paid 18/09/2026");
  assert.equal(formatMudGroupLastPaid(null, "2026-09-24"), "No payments yet");
});

test("Mud Last paid wording fails safely for invalid or future dates", () => {
  assert.equal(formatMudGroupLastPaid("not-a-date", "2026-09-24"), "Payment date unavailable");
  assert.equal(formatMudGroupLastPaid("2026-09-24", "not-a-date"), "Payment date unavailable");
  assert.equal(formatMudGroupLastPaid("2026-09-25", "2026-09-24"), "Last paid 25/09/2026");
});
