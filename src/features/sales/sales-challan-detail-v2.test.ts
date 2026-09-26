import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getSavedChallanPaymentHistoryEntries } from "../office/sales-office-model.ts";
import type { CustomerPayment } from "./types.ts";

const office = readFileSync(
  new URL("../office/components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const detail = office.slice(
  office.indexOf("function ChallanDetail"),
  office.indexOf("function StatusBadge"),
);

const paymentBase = {
  factoryId: "factory-a",
  customerId: "customer-a",
  customerNameSnapshot: "Historical Customer",
  customerAddressSnapshot: "Historical Address",
  customerMobileSnapshot: "9000000000",
  companyNameSnapshot: "Historical Factory",
  companyBusinessDescriptionSnapshot: "Bricks",
  companyAddressSnapshot: "Factory Address",
  companyMobileSnapshot: "9111111111",
  paymentMode: "cash",
  note: null,
  createdAt: "2026-09-20T04:30:00Z",
} as const;

test("saved detail follows the approved identity-to-actions hierarchy", () => {
  const labels = [
    "saved-challan-heading",
    "saved-challan-context-heading",
    "saved-challan-items-heading",
    "saved-challan-flexible-lines-heading",
    "saved-challan-financial-heading",
    "saved-challan-payment-history-heading",
    "saved-challan-actions-heading",
  ];

  for (let index = 1; index < labels.length; index += 1) {
    assert.ok(
      detail.indexOf(labels[index - 1]!) < detail.indexOf(labels[index]!),
      `${labels[index - 1]} must appear before ${labels[index]}`,
    );
  }

  assert.match(detail, /No manual Challan number was recorded/);
  assert.match(detail, /formatDateOnly\(challan\.challanDate\)/);
  assert.match(detail, /challan\.customerNameSnapshot/);
  assert.match(detail, /formatIndianCurrency\(challan\.challanTotal, MONEY_WITH_PAISE\)/);
});

test("lifecycle, payment, and financial-lock statuses stay separate and canonical", () => {
  assert.match(detail, /resolveStatusPresentation\(CHALLAN_STATUS, challan\.status\)/);
  assert.match(detail, /resolveStatusPresentation\([\s\S]*CHALLAN_PAYMENT_STATUS/);
  assert.match(detail, /resolveBooleanStatusPresentation\(CHALLAN_FINANCIAL_LOCK_STATUS, true\)/);
  assert.match(detail, /<StatusPill label=\{challanStatus\.label\}/);
  assert.match(detail, /<StatusPill label=\{financialLockStatus\.label\}/);
  assert.match(detail, /<StatusPill label=\{paymentStatus\.label\}/);
  assert.match(detail, /getChallanEligibility\(challan\)/);
  assert.match(detail, /disabled=\{!eligibility\.canEdit\}/);
  assert.match(detail, /disabled=\{!eligibility\.canVoid\}/);
  assert.match(detail, /financially locks this Challan/);
  assert.match(detail, /This Challan is Void/);
});

test("saved snapshots remain the only customer, company, Vehicle, and wage sources", () => {
  for (const field of [
    "customerNameSnapshot",
    "customerMobileSnapshot",
    "customerAddressSnapshot",
    "companyNameSnapshot",
    "companyMobileSnapshot",
    "companyBusinessDescriptionSnapshot",
    "companyAddressSnapshot",
    "companyGstinSnapshot",
  ]) assert.match(detail, new RegExp(`challan\\.${field}`));

  assert.match(detail, /getSavedChallanVehicleDetails\(challan\)/);
  assert.match(detail, /vehicleDetails\.vehicleNumber/);
  assert.match(detail, /vehicleDetails\.tripLabourWage/);
  assert.doesNotMatch(detail, /customers\.find|vehicles\.find|selectedCustomer|selectedVehicle|FactoryPrintableProfile/);
});

test("desktop tables and mobile records use shared V2 presentation contracts", () => {
  for (const contract of [
    "Button",
    "Card",
    "EmptyState",
    "Feedback",
    "StatusPill",
    "TableContainer",
    "TableCaption",
    "TableHeaderCell",
    "TableCell",
  ]) assert.match(detail, new RegExp(`<${contract}\\b`));

  assert.match(detail, /className="mt-atlas-4 hidden md:block"/);
  assert.match(detail, /className="mt-atlas-4 divide-y divide-atlas-border border-y border-atlas-border md:hidden"/);
  assert.match(detail, /className="hidden md:block"[\s\S]*Payments allocated/);
  assert.match(detail, /border-y border-atlas-border md:hidden/);
  assert.match(detail, /formatIndianNumber\(item\.quantity\)/);
  assert.doesNotMatch(detail, /formatSalesMoney|formatChallanDate|\.toLocaleString\(/);
  assert.doesNotMatch(detail, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(detail, /(?:insert|update|delete)\(|\.from\(|\.rpc\(/);
});

test("payment position and immutable allocation history reuse existing authorities", () => {
  assert.match(detail, /getChallanPaymentState\(challan\.factoryId, challan\.id\)/);
  assert.match(detail, /listCustomerPayments\(challan\.factoryId, challan\.customerId\)/);
  assert.match(detail, /getSavedChallanPaymentHistoryEntries/);
  assert.match(detail, /paymentStateQuery\.data\.totalPaid/);
  assert.match(detail, /paymentStateQuery\.data\.outstandingAmount/);
  assert.match(detail, /No payments allocated/);
  assert.match(detail, /\/office\/payments\/\$\{entry\.paymentId\}/);
  assert.match(detail, /Print \/ download PDF/);
});

test("payment-history view filters allocations without recalculating authoritative amounts", () => {
  const payments: CustomerPayment[] = [
    {
      ...paymentBase,
      id: "payment-2",
      paymentDate: "2026-09-22",
      amount: 900,
      paymentMode: "upi",
      note: "Second receipt",
      allocations: [
        {
          id: "allocation-other",
          factoryId: "factory-a",
          paymentId: "payment-2",
          challanId: "challan-other",
          challanNumber: "20",
          challanDate: "2026-09-20",
          allocatedAmount: 300,
          createdAt: "2026-09-22T04:30:00Z",
        },
        {
          id: "allocation-2",
          factoryId: "factory-a",
          paymentId: "payment-2",
          challanId: "challan-a",
          challanNumber: "18",
          challanDate: "2026-09-18",
          allocatedAmount: 600,
          createdAt: "2026-09-22T04:30:01Z",
        },
      ],
    },
    {
      ...paymentBase,
      id: "payment-1",
      paymentDate: "2026-09-21",
      amount: 400,
      allocations: [{
        id: "allocation-1",
        factoryId: "factory-a",
        paymentId: "payment-1",
        challanId: "challan-a",
        challanNumber: "18",
        challanDate: "2026-09-18",
        allocatedAmount: 400,
        createdAt: "2026-09-21T04:30:00Z",
      }],
    },
  ];

  assert.deepEqual(getSavedChallanPaymentHistoryEntries(payments, "challan-a"), [
    {
      key: "allocation-2",
      paymentId: "payment-2",
      paymentDate: "2026-09-22",
      paymentMode: "upi",
      note: "Second receipt",
      allocatedAmount: 600,
    },
    {
      key: "allocation-1",
      paymentId: "payment-1",
      paymentDate: "2026-09-21",
      paymentMode: "cash",
      note: null,
      allocatedAmount: 400,
    },
  ]);
  assert.deepEqual(getSavedChallanPaymentHistoryEntries(payments, "missing"), []);
});
