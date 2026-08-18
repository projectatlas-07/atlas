import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  TransportCrew,
  TransportCrewAssignment,
  TransportCrewWageRate,
} from "@/features/transport/types";
import {
  buildTransportAssignmentInput,
  buildTransportAssignmentListItem,
  buildTransportCrewCreateInput,
  buildTransportCrewWageRateInput,
  buildTransportRateCrewOption,
  buildTransportRateHistoryItem,
  buildTransportWorkerCreateInput,
  formatTransportActiveStatus,
  formatTransportDirection,
  formatTransportRatePerPaya,
  getTransportRateRefreshQueryKeys,
  selectTransportRateCrew,
  transportOfficeErrorMessage,
  transportRateFormAfterSuccess,
  transportRateOfficeErrorMessage,
} from "./transport-office-model.ts";

const assignment: TransportCrewAssignment = {
  id: "assignment-a",
  factoryId: "factory-a",
  transportWorkerId: "worker-a",
  transportWorkerName: "Asha",
  transportWorkerIsActive: false,
  transportCrewId: "crew-a",
  transportCrewName: "Morning carriers",
  transportCrewWorkDirection: "FIELD_TO_KILN",
  transportCrewIsActive: false,
  createdAt: "2026-08-18T03:00:00Z",
};

test("worker creation trims names and rejects blank names", () => {
  assert.deepEqual(buildTransportWorkerCreateInput("factory-a", "  Asha  "), {
    factoryId: "factory-a",
    name: "Asha",
  });
  assert.equal(buildTransportWorkerCreateInput("factory-a", "   "), null);
});

test("worker and crew active states remain visible", () => {
  assert.equal(formatTransportActiveStatus(true), "Active");
  assert.equal(formatTransportActiveStatus(false), "Inactive");
});

test("both crew directions have readable labels", () => {
  assert.equal(formatTransportDirection("FIELD_TO_KILN"), "Field → Kiln");
  assert.equal(formatTransportDirection("KILN_TO_FIELD"), "Kiln → Field");
});

test("crew creation validates name and direction", () => {
  assert.deepEqual(buildTransportCrewCreateInput({
    factoryId: "factory-a",
    name: "  Morning carriers ",
    workDirection: "FIELD_TO_KILN",
  }), {
    factoryId: "factory-a",
    name: "Morning carriers",
    workDirection: "FIELD_TO_KILN",
  });
  assert.equal(buildTransportCrewCreateInput({
    factoryId: "factory-a",
    name: "Morning carriers",
    workDirection: "INVALID",
  }), null);
});

test("assignment payload has no membership dates", () => {
  const payload = buildTransportAssignmentInput({
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
    transportCrewId: "crew-a",
  });
  assert.deepEqual(payload, {
    factoryId: "factory-a",
    transportWorkerId: "worker-a",
    transportCrewId: "crew-a",
  });
  assert.doesNotMatch(JSON.stringify(payload), /effective_from|effective_to|effectiveFrom|effectiveTo/);
  assert.equal(buildTransportAssignmentInput({
    factoryId: "factory-a",
    transportWorkerId: "",
    transportCrewId: "crew-a",
  }), null);
});

test("assignment rows retain inactive worker and crew status", () => {
  assert.deepEqual(buildTransportAssignmentListItem(assignment), {
    assignmentId: "assignment-a",
    workerName: "Asha",
    workerStatus: "Inactive",
    crewName: "Morning carriers",
    crewDirection: "Field → Kiln",
    crewStatus: "Inactive",
  });
});

test("assignment and request errors remain understandable", () => {
  assert.match(
    transportOfficeErrorMessage({
      code: "23505",
      message: "Transport worker is already assigned to this crew.",
    }, "fallback"),
    /already assigned/,
  );
  assert.match(
    transportOfficeErrorMessage({ code: "23503", message: "foreign key" }, "fallback"),
    /same factory/,
  );
  assert.equal(
    transportOfficeErrorMessage({ code: "08006", message: "Database unavailable." }, "fallback"),
    "Database unavailable.",
  );
});

const inactiveCrew: TransportCrew = {
  id: "crew-inactive",
  factoryId: "factory-a",
  name: "Old carriers",
  workDirection: "KILN_TO_FIELD",
  isActive: false,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-18T00:00:00Z",
};

const openRate: TransportCrewWageRate = {
  id: "rate-new",
  factoryId: "factory-a",
  transportCrewId: "crew-a",
  ratePerPaya: 900.5,
  effectiveFrom: "2026-08-18",
  effectiveTo: null,
  createdAt: "2026-08-18T00:00:00Z",
};

test("crew selection retains form values and represents inactive crews", () => {
  const initial = {
    selectedCrewId: "",
    effectiveFrom: "2026-08-18",
    rateInput: "900.5",
  };
  assert.deepEqual(selectTransportRateCrew(initial, "crew-inactive"), {
    ...initial,
    selectedCrewId: "crew-inactive",
  });
  assert.deepEqual(buildTransportRateCrewOption(inactiveCrew), {
    id: "crew-inactive",
    label: "Old carriers (Inactive)",
  });
});

test("integer and decimal rates have concise rupee-per-paya display", () => {
  assert.equal(formatTransportRatePerPaya(800), "₹800 / paya");
  assert.equal(formatTransportRatePerPaya(900.5), "₹900.5 / paya");
});

test("open and closed rate history use Current or the exact end date", () => {
  assert.deepEqual(buildTransportRateHistoryItem(openRate), {
    id: "rate-new",
    formattedRate: "₹900.5 / paya",
    effectiveFrom: "2026-08-18",
    periodEndLabel: "Current",
  });
  assert.deepEqual(buildTransportRateHistoryItem({
    ...openRate,
    id: "rate-old",
    ratePerPaya: 800,
    effectiveFrom: "2026-08-01",
    effectiveTo: "2026-08-17",
  }), {
    id: "rate-old",
    formattedRate: "₹800 / paya",
    effectiveFrom: "2026-08-01",
    periodEndLabel: "2026-08-17",
  });
});

test("positive decimal rate payload accepts a mid-week calendar date", () => {
  assert.deepEqual(buildTransportCrewWageRateInput({
    factoryId: "factory-a",
    selectedCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    rateInput: "900.5",
  }), {
    factoryId: "factory-a",
    transportCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    ratePerPaya: 900.5,
  });
});

test("zero, negative, and invalid-date rate submissions are rejected", () => {
  for (const rateInput of ["0", "-1", "NaN", ""]) {
    assert.equal(buildTransportCrewWageRateInput({
      factoryId: "factory-a",
      selectedCrewId: "crew-a",
      effectiveFrom: "2026-08-18",
      rateInput,
    }), null);
  }
  assert.equal(buildTransportCrewWageRateInput({
    factoryId: "factory-a",
    selectedCrewId: "crew-a",
    effectiveFrom: "2026-02-30",
    rateInput: "800",
  }), null);
});

test("successful submission keeps crew/date and clears only rate input", () => {
  assert.deepEqual(transportRateFormAfterSuccess({
    selectedCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    rateInput: "900",
  }), {
    selectedCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    rateInput: "",
  });
  assert.deepEqual(getTransportRateRefreshQueryKeys(
    "factory-a",
    "crew-a",
    "2026-08-18",
  ), [
    ["office-transport-crew-wage-rates", "factory-a", "crew-a"],
    ["office-transport-current-crew-wage-rate", "factory-a", "crew-a", "2026-08-18"],
  ]);
});

test("failed validation preserves every entered rate form value", () => {
  const form = {
    selectedCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    rateInput: "-900",
  };
  assert.equal(buildTransportCrewWageRateInput({ factoryId: "factory-a", ...form }), null);
  assert.deepEqual(form, {
    selectedCrewId: "crew-a",
    effectiveFrom: "2026-08-18",
    rateInput: "-900",
  });
});

test("expected transport rate failures have focused messages", () => {
  assert.match(transportRateOfficeErrorMessage({
    code: "P0001",
    message: "A transport crew wage rate already starts on 2026-08-18.",
  }, "fallback"), /already starts/);
  assert.match(transportRateOfficeErrorMessage({
    code: "P0001",
    message: "Backdated transport crew wage rates are not allowed.",
  }, "fallback"), /Backdated/);
  assert.match(transportRateOfficeErrorMessage({
    code: "23P01",
    message: "overlap",
  }, "fallback"), /ambiguous/);
});
