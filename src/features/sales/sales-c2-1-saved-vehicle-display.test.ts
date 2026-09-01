import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  formatSalesMoney,
  getSavedChallanVehicleDetails,
} from "../office/sales-office-model.ts";

const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const detail = office.slice(
  office.indexOf("function ChallanDetail"),
  office.indexOf("function StatusBadge"),
);
const challanService = readFileSync(new URL("./services/challan-service.ts", import.meta.url), "utf8");
const register = readFileSync(new URL("./sales-register-model.ts", import.meta.url), "utf8");
const printModel = readFileSync(new URL("./challan-print-model.ts", import.meta.url), "utf8");
const printScreen = readFileSync(
  new URL("./components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);

test("saved wage-tracked Challan exposes its historical Vehicle number and internal wage", () => {
  const saved = getSavedChallanVehicleDetails({
    vehicleNumberSnapshot: "WB12AB1234",
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 750,
  });
  assert.deepEqual(saved, {
    vehicleNumber: "WB12AB1234",
    tripLabourWage: 750,
  });
  assert.equal(formatSalesMoney(saved.tripLabourWage!), "₹750.00");
  assert.match(detail, /Saved Vehicle information/);
  assert.match(detail, /label="Vehicle Number"/);
  assert.match(detail, /label="Trip Labour Wage"/);
  assert.match(detail, /Internal only · not customer-facing/);
});

test("no-Vehicle and non-wage-tracked snapshots render without a fabricated number or ₹0 wage", () => {
  assert.deepEqual(getSavedChallanVehicleDetails({
    vehicleNumberSnapshot: null,
    deliveryWageApplicableSnapshot: false,
    tripLabourWage: null,
  }), {
    vehicleNumber: null,
    tripLabourWage: null,
  });
  assert.deepEqual(getSavedChallanVehicleDetails({
    vehicleNumberSnapshot: "WB12OFF123",
    deliveryWageApplicableSnapshot: false,
    tripLabourWage: 0,
  }), {
    vehicleNumber: "WB12OFF123",
    tripLabourWage: null,
  });
  assert.match(detail, /vehicleDetails\.vehicleNumber \?\? "No vehicle"/);
  assert.match(detail, /vehicleDetails\.tripLabourWage !== null/);
});

test("live Vehicle changes and archive state cannot alter historical display", () => {
  const historicalSnapshot = {
    vehicleNumberSnapshot: "WB12AB1234",
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 750,
  } as const;
  const liveVehicleAfterChange = {
    vehicleNumber: "RENAMED-LIVE-VALUE",
    deliveryWageTrackingEnabled: false,
    isActive: false,
  };
  assert.deepEqual(getSavedChallanVehicleDetails(historicalSnapshot), {
    vehicleNumber: "WB12AB1234",
    tripLabourWage: 750,
  });
  assert.equal(liveVehicleAfterChange.isActive, false);
  assert.doesNotMatch(detail, /vehicles\.find|selectedVehicle|challan\.vehicleNumber\b/);
});

test("C2.1 leaves the authoritative total and C2 write path unchanged", () => {
  assert.match(detail, /Authoritative Challan total/);
  assert.match(detail, /challan\.challanTotal/);
  assert.doesNotMatch(detail, /challanTotal\s*[+\-=]|tripLabourWage\s*[+\-]/);
  assert.match(challanService, /p_vehicle_id: input\.vehicleId/);
  assert.match(challanService, /p_trip_labour_wage: input\.tripLabourWage/);
  assert.match(office, /selectVehicleForChallan/);
  assert.match(office, /createChallan\(input\)/);
  assert.match(office, /updateChallan\(input\)/);
});

test("C1/C1.1 flexible display and A5 revenue split remain intact", () => {
  assert.match(detail, /Saved brick lines/);
  assert.match(detail, /Additional lines \/ notes/);
  assert.match(detail, /flexibleLines\.map/);
  assert.match(register, /brickRevenue[\s\S]*otherRevenue[\s\S]*totalRevenue/);
});

test("Correction D makes the historical snapshot primary on print without exposing wages", () => {
  assert.match(printModel, /snapshotVehicleNumber = challan\.vehicleNumberSnapshot/);
  assert.match(printModel, /snapshotVehicleNumber \|\| legacyVehicleNumber \|\| null/);
  assert.doesNotMatch(printModel, /tripLabourWage|deliveryWageApplicableSnapshot/);
  assert.match(printScreen, /Vehicle No\.:/);
  assert.doesNotMatch(printScreen, /Trip Labour Wage|Saved Vehicle information/);
});
