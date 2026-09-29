import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  getChallanBrickQuantity,
  getSalesRegisterPaymentLabel,
  resolveSalesDateRange,
  summarizeSalesRegister,
  type SalesRegisterEntry,
} from "./sales-register-model.ts";

const registerSource = readFileSync(
  new URL("../office/components/sales-register-section.tsx", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("./services/sales-register-service.ts", import.meta.url),
  "utf8",
);
const officeSource = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);

const entries: SalesRegisterEntry[] = [
  {
    challanId: "active-a",
    challanNumber: "10",
    challanDate: "2026-08-27",
    customerNameSnapshot: "Historical Customer A",
    items: [
      { particularsSnapshot: "Historical Class One", quantity: 1500, linePosition: 1 },
      { particularsSnapshot: "Historical Class Two", quantity: 750, linePosition: 2 },
    ],
    brickRevenue: 4000,
    otherRevenue: 321.09,
    totalRevenue: 4321.09,
    vehicleNumber: "RJ14AB1234",
    status: "active",
    paymentState: "partially_paid",
    paidAmount: 1000,
    outstandingAmount: 3321.09,
  },
  {
    challanId: "void-a",
    challanNumber: "9",
    challanDate: "2026-08-26",
    customerNameSnapshot: "Historical Customer B",
    items: [{ particularsSnapshot: "Historical Red Brick", quantity: 9999, linePosition: 1 }],
    brickRevenue: 99999,
    otherRevenue: 0,
    totalRevenue: 99999,
    vehicleNumber: "RJ14AB9999",
    status: "void",
    paymentState: null,
    paidAmount: 0,
    outstandingAmount: 0,
  },
  {
    challanId: "active-b",
    challanNumber: "8",
    challanDate: "2026-08-25",
    customerNameSnapshot: "Historical Customer C",
    items: [{ particularsSnapshot: "Historical Class Three", quantity: 500, linePosition: 1 }],
    brickRevenue: 1000,
    otherRevenue: 0,
    totalRevenue: 1000,
    vehicleNumber: "RJ14AB5678",
    status: "active",
    paymentState: "paid",
    paidAmount: 1000,
    outstandingAmount: 0,
  },
];

test("active and void Challans both remain visible in the register", () => {
  assert.deepEqual(entries.map((entry) => entry.status), ["active", "void", "active"]);
  assert.match(registerSource, /entries\.map/);
  assert.match(registerSource, /resolveStatusPresentation\(CHALLAN_STATUS, entry\.status\)/);
  assert.match(registerSource, /<StatusPill label=\{lifecycleStatus\.label\} tone=\{lifecycleStatus\.tone\}/);
});

test("duplicate visible numbers remain separate Sales Register transactions", () => {
  const duplicates = [
    { ...entries[0]!, challanId: "duplicate-a", challanNumber: "11" },
    {
      ...entries[2]!,
      challanId: "duplicate-b",
      challanNumber: "11",
      customerNameSnapshot: "Another Customer",
    },
  ];
  assert.deepEqual(duplicates.map((entry) => entry.challanId), ["duplicate-a", "duplicate-b"]);
  assert.deepEqual(summarizeSalesRegister(duplicates), {
    brickRevenue: 5000,
    otherRevenue: 321.09,
    totalRevenue: 5321.09,
    activeChallans: 2,
    totalBrickQuantity: 2750,
    voidChallans: 0,
  });
});

test("void Challans are excluded from every active Sales summary total", () => {
  assert.deepEqual(summarizeSalesRegister(entries), {
    brickRevenue: 5000,
    otherRevenue: 321.09,
    totalRevenue: 5321.09,
    activeChallans: 2,
    totalBrickQuantity: 2750,
    voidChallans: 1,
  });
});

test("multiple brick rows aggregate quantity without duplicating any revenue value", () => {
  assert.equal(getChallanBrickQuantity(entries[0]), 2250);
  assert.deepEqual(summarizeSalesRegister([entries[0]]), {
    brickRevenue: 4000,
    otherRevenue: 321.09,
    totalRevenue: 4321.09,
    activeChallans: 1,
    totalBrickQuantity: 2250,
    voidChallans: 0,
  });
  assert.match(registerSource, /getChallanBrickQuantity\(entry\)/);
  assert.match(registerSource, /formatIndianCurrency\(entry\.totalRevenue, MONEY_WITH_PAISE\)/);
});

test("register shows authoritative Unpaid, Partial, and Paid state without changing revenue classification", () => {
  assert.equal(getSalesRegisterPaymentLabel({ ...entries[0]!, paymentState: "unpaid" }), "Unpaid");
  assert.equal(getSalesRegisterPaymentLabel(entries[0]!), "Partial");
  assert.equal(getSalesRegisterPaymentLabel(entries[1]!), "—");
  assert.equal(getSalesRegisterPaymentLabel(entries[2]!), "Paid");
  assert.deepEqual(
    [entries[0]?.brickRevenue, entries[0]?.otherRevenue, entries[0]?.totalRevenue],
    [4000, 321.09, 4321.09],
  );
  assert.match(registerSource, /Paid \{formatIndianCurrency\(entry\.paidAmount, MONEY_WITH_PAISE\)\}/);
  assert.match(registerSource, /Due \{formatIndianCurrency\(entry\.outstandingAmount, MONEY_WITH_PAISE\)\}/);
});

test("Sales Register exposes an explicit uncluttered three-way revenue summary", () => {
  assert.match(registerSource, /label="Brick Revenue"[\s\S]*summary\.brickRevenue/);
  assert.match(registerSource, /label="Other Revenue"[\s\S]*summary\.otherRevenue/);
  assert.match(registerSource, /label="Total Revenue"[\s\S]*summary\.totalRevenue/);
  assert.doesNotMatch(registerSource, /Total Sales amount/);
});

test("register presentation uses saved customer and brick snapshots", () => {
  assert.match(registerSource, /entry\.customerNameSnapshot/);
  assert.match(registerSource, /item\.particularsSnapshot/);
  assert.match(serviceSource, /customer_name_snapshot/);
  assert.match(serviceSource, /brick_particulars_snapshot/);
});

test("Today, Monday-based week, and month ranges use local business-date boundaries", () => {
  assert.deepEqual(resolveSalesDateRange("today", "2026-08-27"), {
    fromDate: "2026-08-27",
    toDate: "2026-08-27",
  });
  assert.deepEqual(resolveSalesDateRange("week", "2026-08-27"), {
    fromDate: "2026-08-24",
    toDate: "2026-08-27",
  });
  assert.deepEqual(resolveSalesDateRange("week", "2026-08-30"), {
    fromDate: "2026-08-24",
    toDate: "2026-08-30",
  });
  assert.deepEqual(resolveSalesDateRange("month", "2026-08-27"), {
    fromDate: "2026-08-01",
    toDate: "2026-08-27",
  });
});

test("Yesterday uses exactly one previous local calendar date for both boundaries", () => {
  assert.match(registerSource, /value: "yesterday", label: "Yesterday"/);
  assert.deepEqual(resolveSalesDateRange("yesterday", "2026-08-27"), {
    fromDate: "2026-08-26",
    toDate: "2026-08-26",
  });
  assert.deepEqual(resolveSalesDateRange("yesterday", "2026-09-01"), {
    fromDate: "2026-08-31",
    toDate: "2026-08-31",
  });
  assert.deepEqual(resolveSalesDateRange("yesterday", "2027-01-01"), {
    fromDate: "2026-12-31",
    toDate: "2026-12-31",
  });
});

test("custom ranges are inclusive and reject reversed or invalid boundaries", () => {
  assert.deepEqual(resolveSalesDateRange(
    "custom",
    "2026-08-27",
    "2026-07-31",
    "2026-08-01",
  ), {
    fromDate: "2026-07-31",
    toDate: "2026-08-01",
  });
  assert.equal(resolveSalesDateRange("custom", "2026-08-27", "2026-08-02", "2026-08-01"), null);
  assert.equal(resolveSalesDateRange("custom", "2026-08-27", "2026-02-30", "2026-03-01"), null);
});

test("register opens the existing S3 Challan and introduces no Sale entry or storage", () => {
  assert.match(registerSource, /Open Challan/);
  assert.match(registerSource, /\/office\/challans\/\$\{entry\.challanId\}/);
  assert.match(officeSource, /<SalesRegisterSection/);
  assert.doesNotMatch(registerSource, /Create Sale|Enter Sale|Record Sale/i);
  assert.doesNotMatch(serviceSource, /\.from\(["']sales["']\)|insert\(|update\(|delete\(/i);
});

test("Sales Register V2 matches the approved dense reference with intentional mobile cards", () => {
  for (const primitive of [
    "Button",
    "Card",
    "EmptyState",
    "Feedback",
    "FormField",
    "Input",
    "StatusPill",
    "TableContainer",
  ]) assert.match(registerSource, new RegExp(`<${primitive}\\b`));
  assert.match(registerSource, /className="hidden md:block"/);
  assert.match(registerSource, /className="space-y-atlas-3 md:hidden"/);
  assert.match(registerSource, /<TableHeader sticky>/);
  assert.match(registerSource, /<TableRow hoverable>/);
  assert.match(registerSource, /formatIndianNumber\(getChallanBrickQuantity\(entry\)\)/);
  assert.doesNotMatch(registerSource, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(registerSource, /(?:p|m|gap|space-[xy]|rounded|shadow|max-h|min-w)-\[[^\]]+\]/);
});

test("Sales Register V2 adds no reference-only tax, export, inventory, or accounting semantics", () => {
  assert.doesNotMatch(registerSource, /GST|CGST|SGST|IGST|tax rate|taxable value|CSV|Export report|inventory deduction|settlement/i);
  assert.doesNotMatch(registerSource, /\bcreateCustomerPayment\b|\bcreateChallan\b|\bupdateChallan\b|\bvoidChallan\b|\.from\(|\.rpc\(/);
});
