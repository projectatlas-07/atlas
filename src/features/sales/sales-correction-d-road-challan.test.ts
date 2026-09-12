import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Challan, ChallanFlexibleLine, ChallanItem } from "./types.ts";
import { buildPrintableChallan } from "./challan-print-model.ts";

const printModelSource = readFileSync(
  new URL("./challan-print-model.ts", import.meta.url),
  "utf8",
);
const printScreenSource = readFileSync(
  new URL("./components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);
const printDocumentSource = printScreenSource.slice(
  printScreenSource.indexOf("export function RoadChallanDocument"),
);
const challanServiceSource = readFileSync(
  new URL("./services/challan-service.ts", import.meta.url),
  "utf8",
);
const officeSource = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const registerSource = readFileSync(
  new URL("./services/sales-register-service.ts", import.meta.url),
  "utf8",
);
const printCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function brick(
  particulars: string,
  amount: number,
  linePosition = 1,
): ChallanItem {
  return {
    id: `brick-${linePosition}`,
    factoryId: "factory-a",
    challanId: "challan-a",
    brickTypeId: `brick-type-${linePosition}`,
    brickParticularsSnapshot: particulars,
    quantity: 50_000,
    ratePer1000Bricks: 2_000,
    pricingUnit: "PER_1000_BRICKS",
    lineCategory: "BRICK_REVENUE",
    lineAmount: amount,
    linePosition,
    createdAt: "2026-09-01T10:00:00Z",
  };
}

function note(particulars: string, orderIndex: number): ChallanFlexibleLine {
  return {
    id: `note-${orderIndex}`,
    factoryId: "factory-a",
    challanId: "challan-a",
    lineType: "NOTE",
    lineCategory: "NON_FINANCIAL",
    orderIndex,
    particulars,
    quantity: null,
    rate: null,
    amount: 0,
    createdAt: "2026-09-01T10:00:00Z",
  };
}

function extraCharge(
  particulars: string,
  amount: number,
  orderIndex: number,
  quantity: number | null = null,
  rate: number | null = null,
): ChallanFlexibleLine {
  return {
    id: `charge-${orderIndex}`,
    factoryId: "factory-a",
    challanId: "challan-a",
    lineType: "EXTRA_CHARGE",
    lineCategory: "OTHER_REVENUE",
    orderIndex,
    particulars,
    quantity,
    rate,
    amount,
    createdAt: "2026-09-01T10:00:00Z",
  };
}

function savedChallan(overrides: Partial<Challan> = {}): Challan {
  return {
    id: "challan-a",
    factoryId: "factory-a",
    challanNumber: "108",
    challanDate: "2026-09-01",
    customerId: "customer-a",
    customerNameSnapshot: "Historical Customer",
    customerAddressSnapshot: "Historical Customer Address",
    customerMobileSnapshot: "9111111111",
    companyNameSnapshot: "Historical Atlas Bricks",
    companyBusinessDescriptionSnapshot: "Manufacturers of quality bricks",
    companyAddressSnapshot: "Historical Legacy Factory Address",
    companyMobileSnapshot: "9000000000",
    companyVillageSnapshot: "Rampur",
    companyPostOfficeSnapshot: "Rampur Head",
    companyPoliceStationSnapshot: "Kotwali",
    companyDistrictSnapshot: "Jaipur",
    companyStateSnapshot: "Rajasthan",
    vehicleId: "vehicle-a",
    vehicleNumberSnapshot: "WB12AB1234",
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 750,
    vehicleNumber: "LEGACY-OLD-VALUE",
    tractorLabourRateSnapshot: 750,
    challanTotal: 100_000,
    status: "active",
    isLocked: false,
    voidedAt: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    items: [brick("Class One Bricks", 100_000)],
    flexibleLines: [],
    ...overrides,
  };
}

test("brick-only customer document uses historical snapshots and the authoritative total", () => {
  const printable = buildPrintableChallan(savedChallan());
  assert.equal(printable.company.name, "Historical Atlas Bricks");
  assert.equal(printable.customer.name, "Historical Customer");
  assert.equal(printable.vehicleNumber, "WB12AB1234");
  assert.equal(printable.total, 100_000);
  assert.deepEqual(printable.lines, [{
    lineKind: "BRICK",
    quantity: 50_000,
    particulars: "Class One Bricks",
    rate: 2_000,
    amount: 100_000,
  }]);
});

test("NOTE prints as non-financial content and never changes the saved total", () => {
  const printable = buildPrintableChallan(savedChallan({
    flexibleLines: [note("Delivered in good condition", 0)],
  }));
  assert.deepEqual(printable.lines[1], {
    lineKind: "NOTE",
    particulars: "Delivered in good condition",
  });
  assert.equal(printable.total, 100_000);
  assert.doesNotMatch(JSON.stringify(printable.lines[1]), /amount|quantity|rate/);
  assert.match(printDocumentSource, /<span className="font-bold">Note:<\/span>/);
});

test("brick plus Extra Charge prints the persisted amount once and trusts saved total", () => {
  const printable = buildPrintableChallan(savedChallan({
    challanTotal: 102_000,
    flexibleLines: [extraCharge("Loading", 2_000, 0)],
  }));
  assert.deepEqual(printable.lines[1], {
    lineKind: "EXTRA_CHARGE",
    quantity: null,
    particulars: "Loading",
    rate: null,
    amount: 2_000,
  });
  assert.equal(printable.total, 102_000);
  assert.equal(printable.lines.filter((line) => line.particulars === "Loading").length, 1);
});

test("mixed flexible lines follow persisted order after established brick order", () => {
  const printable = buildPrintableChallan(savedChallan({
    items: [brick("Second Brick", 40_000, 2), brick("First Brick", 60_000, 1)],
    flexibleLines: [
      note("Note C", 2),
      note("Note A", 0),
      extraCharge("Charge B", 2_000, 1),
      extraCharge("Charge D", 500, 3),
    ],
    challanTotal: 102_500,
  }));
  assert.deepEqual(
    printable.lines.map((line) => line.particulars),
    ["First Brick", "Second Brick", "Note A", "Charge B", "Note C", "Charge D"],
  );
  for (const particulars of ["Note A", "Charge B", "Note C", "Charge D"]) {
    assert.equal(printable.lines.filter((line) => line.particulars === particulars).length, 1);
  }
});

test("Extra-Charge-only and Note-only Challans remain useful printable documents", () => {
  const chargeOnly = buildPrintableChallan(savedChallan({
    items: [],
    flexibleLines: [extraCharge("Manual charge", 5_000, 0)],
    challanTotal: 5_000,
  }));
  assert.equal(chargeOnly.lines.length, 1);
  assert.equal(chargeOnly.lines[0].lineKind, "EXTRA_CHARGE");
  assert.equal(chargeOnly.total, 5_000);

  const noteOnly = buildPrintableChallan(savedChallan({
    items: [],
    flexibleLines: [note("Handle with care", 0)],
    challanTotal: 0,
  }));
  assert.equal(noteOnly.lines.length, 1);
  assert.equal(noteOnly.lines[0].lineKind, "NOTE");
  assert.equal(noteOnly.total, 0);
  assert.doesNotMatch(printDocumentSource, /No brick lines/);
});

test("quantity-rate Extra Charge preserves quantity, rate, and authoritative amount", () => {
  const printable = buildPrintableChallan(savedChallan({
    items: [],
    flexibleLines: [extraCharge("Engine Oil", 1_000, 0, 2.5, 400)],
    challanTotal: 1_000,
  }));
  assert.deepEqual(printable.lines[0], {
    lineKind: "EXTRA_CHARGE",
    particulars: "Engine Oil",
    quantity: 2.5,
    rate: 400,
    amount: 1_000,
  });
  assert.match(printDocumentSource, /formatPrintableQuantity\(line\.quantity\)/);
  assert.match(printDocumentSource, /formatPrintableMoney\(line\.rate\)/);
  assert.match(printDocumentSource, /formatPrintableMoney\(line\.amount\)/);
});

test("saved Vehicle prints for either wage mode and remains independent of Vehicle Master", () => {
  const wageEnabled = buildPrintableChallan(savedChallan({
    vehicleNumberSnapshot: "WB 57B 1234",
    deliveryWageApplicableSnapshot: true,
    tripLabourWage: 750,
  }));
  const wageDisabled = buildPrintableChallan(savedChallan({
    vehicleNumberSnapshot: "WB 57B 1234",
    deliveryWageApplicableSnapshot: false,
    tripLabourWage: null,
  }));
  const changedArchivedMaster = { vehicleNumber: "CHANGED-NUMBER", isActive: false };
  assert.equal(wageEnabled.vehicleNumber, "WB 57B 1234");
  assert.equal(wageDisabled.vehicleNumber, "WB 57B 1234");
  assert.notEqual(wageDisabled.vehicleNumber, changedArchivedMaster.vehicleNumber);
  assert.doesNotMatch(printModelSource, /listVehicles|vehicle-service|isActive/);
});

test("Vehicle snapshot is primary, legacy fallback is minimal, and no Vehicle row is rendered", () => {
  assert.equal(buildPrintableChallan(savedChallan()).vehicleNumber, "WB12AB1234");
  assert.equal(buildPrintableChallan(savedChallan({
    vehicleNumberSnapshot: null,
    vehicleNumber: "PRE-C2-VEHICLE",
  })).vehicleNumber, "PRE-C2-VEHICLE");
  assert.equal(buildPrintableChallan(savedChallan({
    vehicleId: null,
    vehicleNumberSnapshot: null,
    vehicleNumber: "",
  })).vehicleNumber, null);
  assert.match(printDocumentSource, /challan\.vehicleNumber &&/);
  assert.doesNotMatch(printDocumentSource, /challan\.vehicleNumber \?\?/);
  assert.ok(
    printDocumentSource.indexOf("Vehicle No.:")
      < printDocumentSource.indexOf("challan-print-table"),
    "Saved Vehicle number must print before the variable-length line table.",
  );
});

test("print headers and non-note row cells share the requested column order", () => {
  const header = printDocumentSource.slice(
    printDocumentSource.indexOf("<thead>"),
    printDocumentSource.indexOf("</thead>"),
  );
  const row = printDocumentSource.slice(
    printDocumentSource.indexOf(": <tr key="),
    printDocumentSource.indexOf("</tr>)}"),
  );
  const headerPositions = ["No.", "Particulars", "Quantity", "Rate", "Amount"]
    .map((label) => header.indexOf(`>${label}</th>`));
  assert.ok(headerPositions.every((position) => position >= 0));
  assert.deepEqual(headerPositions, [...headerPositions].sort((left, right) => left - right));

  const cellPositions = [
    ">{index + 1}</td>",
    ">{line.particulars}</td>",
    "formatPrintableQuantity(line.quantity)",
    "formatPrintableMoney(line.rate)",
    "formatPrintableMoney(line.amount)",
  ].map((expression) => row.indexOf(expression));
  assert.ok(cellPositions.every((position) => position >= 0));
  assert.deepEqual(cellPositions, [...cellPositions].sort((left, right) => left - right));
});

test("customer print excludes internal wage state while retaining Vehicle and saved total", () => {
  const printable = buildPrintableChallan(savedChallan({ challanTotal: 102_000 }));
  const serialized = JSON.stringify(printable);
  assert.equal(printable.vehicleNumber, "WB12AB1234");
  assert.equal(printable.total, 102_000);
  assert.doesNotMatch(serialized, /750|Trip Labour|deliveryWage|tractor/i);
  assert.doesNotMatch(printModelSource + printDocumentSource, /tripLabourWage|deliveryWageApplicableSnapshot|tractorLabourRateSnapshot|Trip Labour Wage|Delivery Wage Tracking/);
});

test("structured company and legacy fallback both stay historical", () => {
  const structured = buildPrintableChallan(savedChallan());
  assert.equal(structured.company.addressKind, "structured");
  assert.doesNotMatch(JSON.stringify(structured.company), /today|current/i);

  const legacy = buildPrintableChallan(savedChallan({
    companyVillageSnapshot: null,
    companyPostOfficeSnapshot: null,
    companyPoliceStationSnapshot: null,
    companyDistrictSnapshot: null,
    companyStateSnapshot: null,
  }));
  assert.deepEqual(legacy.company, {
    name: "Historical Atlas Bricks",
    businessDescription: "Manufacturers of quality bricks",
    mobile: "9000000000",
    addressKind: "legacy",
    address: "Historical Legacy Factory Address",
  });
  assert.doesNotMatch(printModelSource, /FactoryPrintableProfile|getFactory|\.from\(["']factories/);
});

test("View, Print, and Download PDF share one business document and preserve VOID", () => {
  assert.match(printScreenSource, /<RoadChallanDocument challan=\{challan\} \/>/);
  assert.match(printScreenSource, />Print<\/button>/);
  assert.match(printScreenSource, />Download PDF<\/button>/);
  assert.equal((printScreenSource.match(/window\.print\(\)/g) ?? []).length, 1);
  assert.equal(buildPrintableChallan(savedChallan({ status: "void" })).isVoid, true);
  assert.match(printDocumentSource, /challan\.isVoid &&/);
});

test("Correction D changes no writes, totals, reporting, payments, or unrelated Office behavior", () => {
  assert.match(challanServiceSource, /const saved = await getChallan|export async function getChallan/);
  assert.match(printScreenSource, /getChallan\(factory\.factoryId, challanId\)/);
  assert.match(printModelSource, /total: challan\.challanTotal/);
  assert.doesNotMatch(printModelSource + printScreenSource, /challanTotal\s*[+\-=]|\.from\(|\.rpc\(/);
  assert.match(registerSource, /brickRevenuePaise[\s\S]*otherRevenuePaise[\s\S]*totalRevenuePaise/);
  assert.match(officeSource, /Authoritative Challan total/);
  assert.match(printCss, /\.challan-print-table tr,[\s\S]*break-inside: avoid/);
});
