import assert from "node:assert/strict";
import test from "node:test";

import {
  ATLAS_STATUS_PRESENTATION_SETS,
  CHALLAN_PAYMENT_STATUS,
  CHALLAN_STATUS,
  MUD_ACCOUNTING_MODE_STATUS,
  MUD_CUTOVER_READINESS_STATUS,
  MUD_SHADOW_CERTIFICATION_STATUS,
  MUD_SHADOW_COMPARISON_STATUS,
  STATUS_TONES,
  TRANSPORT_WEEKLY_CALCULATION_STATUS,
  VEHICLE_LIFECYCLE_STATUS,
  WAGE_RATE_HISTORY_STATUS,
  defineStatusPresentationSet,
  resolveBooleanStatusPresentation,
  resolveStatusPresentation,
  type StatusMachineValue,
  type StatusPresentation,
} from "./statuses.ts";

test("every supported status has one valid presentation definition", () => {
  for (const [setName, set] of Object.entries(ATLAS_STATUS_PRESENTATION_SETS)) {
    const definitions = Object.values(set.definitions) as Array<
      StatusPresentation<StatusMachineValue>
    >;
    const values = definitions.map((definition) => definition.value);

    assert.ok(definitions.length > 0, `${setName} must define statuses`);
    assert.equal(
      new Set(values).size,
      values.length,
      `${setName} must not duplicate machine values`,
    );

    for (const [key, definition] of Object.entries(set.definitions)) {
      assert.equal(String(definition.value), key, `${setName}.${key}`);
      assert.ok(definition.label.length > 0, `${setName}.${key} label`);
      assert.ok(
        STATUS_TONES.includes(definition.tone),
        `${setName}.${key} semantic tone`,
      );
      assert.doesNotMatch(
        definition.tone,
        /(?:bg-|text-|border-|#|rgb|hsl)/,
        `${setName}.${key} must not contain styling`,
      );
    }
  }
});

test("core business status labels and tones are stable", () => {
  assert.deepEqual(CHALLAN_STATUS.definitions, {
    active: { value: "active", label: "Active", tone: "success" },
    void: { value: "void", label: "Void", tone: "archive" },
  });
  assert.deepEqual(CHALLAN_PAYMENT_STATUS.definitions, {
    unpaid: { value: "unpaid", label: "Unpaid", tone: "warning" },
    partially_paid: {
      value: "partially_paid",
      label: "Partially paid",
      tone: "warning",
    },
    paid: { value: "paid", label: "Paid", tone: "success" },
  });
  assert.deepEqual(VEHICLE_LIFECYCLE_STATUS.definitions, {
    true: { value: true, label: "Active", tone: "success" },
    false: { value: false, label: "Archived", tone: "archive" },
  });
});

test("wage and accounting status labels and tones are stable", () => {
  assert.deepEqual(WAGE_RATE_HISTORY_STATUS.definitions, {
    current: { value: "current", label: "Current", tone: "success" },
    future: { value: "future", label: "Future", tone: "info" },
    historical: { value: "historical", label: "Historical", tone: "archive" },
  });
  assert.deepEqual(TRANSPORT_WEEKLY_CALCULATION_STATUS.definitions, {
    calculated: {
      value: "calculated",
      label: "Calculated and locked",
      tone: "success",
    },
    already_calculated: {
      value: "already_calculated",
      label: "Already calculated",
      tone: "info",
    },
    no_work: { value: "no_work", label: "No work", tone: "neutral" },
  });
  assert.deepEqual(MUD_ACCOUNTING_MODE_STATUS.definitions, {
    LEGACY_WEEKLY: {
      value: "LEGACY_WEEKLY",
      label: "Legacy weekly",
      tone: "archive",
    },
    SHADOW: { value: "SHADOW", label: "Shadow", tone: "info" },
    SETTLEMENT: {
      value: "SETTLEMENT",
      label: "Continuous settlement",
      tone: "success",
    },
  });
  assert.deepEqual(MUD_SHADOW_COMPARISON_STATUS.definitions, {
    PARITY_OK: { value: "PARITY_OK", label: "Parity confirmed", tone: "success" },
    EXPECTED_RATE_CHANGE_DIFFERENCE: {
      value: "EXPECTED_RATE_CHANGE_DIFFERENCE",
      label: "Expected rate difference",
      tone: "info",
    },
    UNEXPECTED_MISMATCH: {
      value: "UNEXPECTED_MISMATCH",
      label: "Unexpected mismatch",
      tone: "danger",
    },
    CONFIGURATION_ERROR: {
      value: "CONFIGURATION_ERROR",
      label: "Configuration error",
      tone: "danger",
    },
  });
  assert.deepEqual(MUD_SHADOW_CERTIFICATION_STATUS.definitions, {
    READY: { value: "READY", label: "Ready", tone: "success" },
    WAITING_FOR_COMPLETED_WEEK: {
      value: "WAITING_FOR_COMPLETED_WEEK",
      label: "Waiting for completed week",
      tone: "warning",
    },
    CONFIGURATION_ERROR: {
      value: "CONFIGURATION_ERROR",
      label: "Configuration error",
      tone: "danger",
    },
    UNEXPECTED_MISMATCH: {
      value: "UNEXPECTED_MISMATCH",
      label: "Unexpected mismatch",
      tone: "danger",
    },
  });
  assert.deepEqual(MUD_CUTOVER_READINESS_STATUS.definitions, {
    READY_FOR_CUTOVER: {
      value: "READY_FOR_CUTOVER",
      label: "Ready for cutover",
      tone: "success",
    },
    BLOCKED: { value: "BLOCKED", label: "Blocked", tone: "warning" },
  });
});

test("unknown string and boolean statuses fail instead of guessing", () => {
  assert.throws(
    () => resolveStatusPresentation(CHALLAN_STATUS, "cancelled"),
    /Unknown Challan status "cancelled"/,
  );
  assert.throws(
    () => resolveBooleanStatusPresentation(VEHICLE_LIFECYCLE_STATUS, "inactive"),
    /Unknown Vehicle lifecycle status "inactive"/,
  );
});

test("definition construction rejects mismatched and duplicate machine values", () => {
  assert.throws(
    () => defineStatusPresentationSet("Broken", {
      active: { value: "void", label: "Active", tone: "success" },
    } as never),
    /does not match machine value/,
  );
  assert.throws(
    () => defineStatusPresentationSet("Broken", {
      first: { value: "first", label: "First", tone: "neutral" },
      second: { value: "first", label: "Second", tone: "neutral" },
    } as never),
    /duplicate status mapping/,
  );
});
