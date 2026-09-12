import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Challan } from "@/features/sales/types";
import {
  buildPrintableChallan,
  formatPrintableDate,
  formatPrintableMoney,
  formatPrintableQuantity,
} from "./challan-print-model.ts";

const screenSource = readFileSync(
  new URL("./components/challan-print-screen.tsx", import.meta.url),
  "utf8",
);
const documentSource = screenSource.slice(screenSource.indexOf("export function RoadChallanDocument"));
const officeSource = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const printCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const routeSource = readFileSync(
  new URL("../../app/office/challans/[challanId]/page.tsx", import.meta.url),
  "utf8",
);

const savedChallan: Challan = {
  id: "challan-internal-id",
  factoryId: "factory-internal-id",
  challanNumber: "42",
  challanDate: "2026-08-26",
  customerId: "customer-internal-id",
  customerNameSnapshot: "Historical Customer",
  customerAddressSnapshot: "Historical Delivery Address",
  customerMobileSnapshot: "9111111111",
  companyNameSnapshot: "Historical Atlas Bricks",
  companyBusinessDescriptionSnapshot: "Manufacturers of quality bricks",
  companyAddressSnapshot: "Historical Factory Address",
  companyMobileSnapshot: "9000000000",
  companyVillageSnapshot: null,
  companyPostOfficeSnapshot: null,
  companyPoliceStationSnapshot: null,
  companyDistrictSnapshot: null,
  companyStateSnapshot: null,
  vehicleId: "vehicle-a",
  vehicleNumberSnapshot: "RJ14AB1234",
  deliveryWageApplicableSnapshot: true,
  tripLabourWage: 987.65,
  vehicleNumber: "RJ14AB1234",
  tractorLabourRateSnapshot: 987.65,
  challanTotal: 4321.09,
  status: "active",
  isLocked: true,
  voidedAt: null,
  createdAt: "2026-08-26T10:00:00Z",
  updatedAt: "2026-08-26T10:00:00Z",
  items: [
    {
      id: "item-internal-a",
      factoryId: "factory-internal-id",
      challanId: "challan-internal-id",
      brickTypeId: "brick-current-a",
      brickParticularsSnapshot: "Historical Class One",
      quantity: 1500,
      ratePer1000Bricks: 2000,
      pricingUnit: "PER_1000_BRICKS",
      lineCategory: "BRICK_REVENUE",
      lineAmount: 3000.01,
      linePosition: 1,
      createdAt: "2026-08-26T10:00:00Z",
    },
    {
      id: "item-internal-b",
      factoryId: "factory-internal-id",
      challanId: "challan-internal-id",
      brickTypeId: "brick-current-b",
      brickParticularsSnapshot: "Historical Class Two",
      quantity: 750,
      ratePer1000Bricks: 1761.44,
      pricingUnit: "PER_1000_BRICKS",
      lineCategory: "BRICK_REVENUE",
      lineAmount: 1321.08,
      linePosition: 2,
      createdAt: "2026-08-26T10:00:00Z",
    },
  ],
  flexibleLines: [],
};

test("printable model uses only saved company and customer snapshots", () => {
  const printable = buildPrintableChallan(savedChallan);
  assert.deepEqual(printable.company, {
    name: "Historical Atlas Bricks",
    businessDescription: "Manufacturers of quality bricks",
    addressKind: "legacy",
    address: "Historical Factory Address",
    mobile: "9000000000",
  });
  assert.deepEqual(printable.customer, {
    name: "Historical Customer",
    address: "Historical Delivery Address",
    mobile: "9111111111",
  });
});

test("print preserves a manual Challan reference and leaves a missing reference blank", () => {
  assert.equal(
    buildPrintableChallan({ ...savedChallan, challanNumber: "2026/145" }).challanNumber,
    "2026/145",
  );
  assert.equal(
    buildPrintableChallan({ ...savedChallan, challanNumber: null }).challanNumber,
    null,
  );
  assert.match(documentSource, /challan\.challanNumber \?\? ""/);
  assert.doesNotMatch(documentSource, /challan\.id|challan-internal-id|N\/A|Untitled/);
});

test("structured snapshots render without consulting or using the legacy address", () => {
  const printable = buildPrintableChallan({
    ...savedChallan,
    companyAddressSnapshot: "Compatibility address that must not win",
    companyVillageSnapshot: "Rampur",
    companyPostOfficeSnapshot: "Rampur Head",
    companyPoliceStationSnapshot: "Kotwali",
    companyDistrictSnapshot: "Jaipur",
    companyStateSnapshot: "Rajasthan",
  });
  assert.deepEqual(printable.company, {
    name: "Historical Atlas Bricks",
    businessDescription: "Manufacturers of quality bricks",
    mobile: "9000000000",
    addressKind: "structured",
    village: "Rampur",
    postOffice: "Rampur Head",
    policeStation: "Kotwali",
    district: "Jaipur",
    state: "Rajasthan",
  });
});

test("all brick snapshot rows and authoritative saved amounts pass through unchanged", () => {
  const printable = buildPrintableChallan(savedChallan);
  assert.deepEqual(printable.lines, [
    {
      lineKind: "BRICK",
      quantity: 1500,
      particulars: "Historical Class One",
      rate: 2000,
      amount: 3000.01,
    },
    {
      lineKind: "BRICK",
      quantity: 750,
      particulars: "Historical Class Two",
      rate: 1761.44,
      amount: 1321.08,
    },
  ]);
  assert.equal(printable.total, 4321.09);
  assert.equal(printable.vehicleNumber, "RJ14AB1234");
});

test("Amount-driven non-round Rate prints the saved ₹80,000 without recomputation", () => {
  const printable = buildPrintableChallan({
    ...savedChallan,
    challanTotal: 80000,
    items: [{
      ...savedChallan.items[0]!,
      quantity: 12347,
      pricingMode: "AMOUNT",
      ratePer1000Bricks: 6479.306714182,
      lineAmount: 80000,
    }],
  });
  assert.deepEqual(printable.lines[0], {
    lineKind: "BRICK",
    quantity: 12347,
    particulars: "Historical Class One",
    rate: 6479.306714182,
    amount: 80000,
  });
  assert.equal(printable.total, 80000);
});

test("printable model excludes internal operational and database fields", () => {
  const serialized = JSON.stringify(buildPrintableChallan(savedChallan));
  assert.doesNotMatch(serialized, /987\.65|tractor|isLocked|internal-id|brick-current/i);
});

test("print formatting is local-date safe and consistently Indian", () => {
  assert.equal(formatPrintableDate("2026-08-26"), "26/08/2026");
  assert.equal(formatPrintableQuantity(150000), "1,50,000");
  assert.equal(formatPrintableMoney(4321.09), "₹4,321.09");
});

test("customer-facing document renders every row, delivery, total, and signatures", () => {
  assert.match(documentSource, /challan\.lines\.map/);
  assert.match(documentSource, /line\.particulars/);
  assert.match(documentSource, /line\.amount/);
  assert.match(documentSource, /challan\.total/);
  assert.match(documentSource, /challan\.vehicleNumber/);
  assert.match(documentSource, /challan\.vehicleNumber &&/);
  assert.match(documentSource, /Signature of Driver/);
  assert.match(documentSource, /Received the goods in good condition/);
  assert.match(documentSource, /Customer&amp;apos;s Signature|Customer&apos;s Signature/);
  assert.match(documentSource, /Manager&amp;apos;s Signature|Manager&apos;s Signature/);
});

test("void Challans remain printable with an obvious VOID indication", () => {
  assert.equal(buildPrintableChallan({ ...savedChallan, status: "void" }).isVoid, true);
  assert.match(documentSource, /challan\.isVoid &&/);
  assert.match(documentSource, />VOID</);
});

test("print-only document contains no Office or internal customer-facing fields", () => {
  assert.doesNotMatch(documentSource, /tractor|labour rate|isLocked|locked state|accounting|database ID|Office detail/i);
  assert.match(screenSource, /className="print-hidden/);
  assert.match(printCss, /@media print/);
  assert.match(printCss, /\.print-hidden/);
  assert.match(printCss, /break-inside: avoid/);
});

test("Office links to the dedicated authenticated route with browser-native print and PDF actions", () => {
  assert.match(officeSource, /View Challan/);
  assert.match(officeSource, /\/office\/challans\/\$\{challan\.id\}/);
  assert.match(routeSource, /<AuthGuard>/);
  assert.match(screenSource, />Print</);
  assert.match(screenSource, />Download PDF</);
  assert.match(screenSource, /window\.print\(\)/);
  assert.match(screenSource, /Save as PDF/);
});
