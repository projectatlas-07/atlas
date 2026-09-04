import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDashboardPresentation } from "./dashboard-view-model.ts";
import type { DashboardSnapshot } from "./types.ts";

const componentSource = readFileSync(
  new URL("./components/dashboard-view.tsx", import.meta.url),
  "utf8",
);

const snapshot: DashboardSnapshot = {
  dateFrom: "2026-08-01",
  dateTo: "2026-08-31",
  flows: {
    sales: 125000,
    paymentsReceived: 250001,
    expenses: 350002,
    cashIn: 450003,
    cashOut: 550004,
    productionQuantity: 12345,
    productionLabourPaid: 750006,
    mudSupplyPaid: 850007,
    chamberTransportPaid: 950008,
    soilTrolleyPaid: 1050009,
    staffPaid: 1150010,
    vehicleDeliveryWagePaid: 1250011,
  },
  stocks: {
    cashBalance: 1350012,
    currentCustomerOutstanding: 1450013,
  },
};

const expectedLabels = [
  "Sales",
  "Payments Received",
  "Expenses",
  "Cash In",
  "Cash Out",
  "Production Quantity",
  "Production Labour Paid",
  "Mud Supply Paid",
  "Chamber Transport Paid",
  "Soil/Trolley Paid",
  "Staff Paid",
  "Vehicle Delivery Wage Paid",
  "Cash Balance",
  "Customer Outstanding — Current",
];

test("renders all 14 approved labels and maps every supplied value to its own card", () => {
  const presentation = buildDashboardPresentation(snapshot);
  const cards = [...presentation.businessActivity, ...presentation.currentPosition];
  const valuesByLabel = Object.fromEntries(cards.map((card) => [card.label, card.value]));

  assert.deepEqual(cards.map((card) => card.label), expectedLabels);
  assert.deepEqual(valuesByLabel, {
    Sales: "₹1,25,000.00",
    "Payments Received": "₹2,50,001.00",
    Expenses: "₹3,50,002.00",
    "Cash In": "₹4,50,003.00",
    "Cash Out": "₹5,50,004.00",
    "Production Quantity": "12,345",
    "Production Labour Paid": "₹7,50,006.00",
    "Mud Supply Paid": "₹8,50,007.00",
    "Chamber Transport Paid": "₹9,50,008.00",
    "Soil/Trolley Paid": "₹10,50,009.00",
    "Staff Paid": "₹11,50,010.00",
    "Vehicle Delivery Wage Paid": "₹12,50,011.00",
    "Cash Balance": "₹13,50,012.00",
    "Customer Outstanding — Current": "₹14,50,013.00",
  });
  assert.equal(valuesByLabel["Production Quantity"].includes("₹"), false);
});

test("keeps period activity separate from current position and displays the supplied dates", () => {
  const presentation = buildDashboardPresentation(snapshot);

  assert.equal(presentation.businessActivity.length, 12);
  assert.deepEqual(presentation.currentPosition.map((card) => card.label), [
    "Cash Balance",
    "Customer Outstanding — Current",
  ]);
  assert.equal(presentation.periodLabel, "Selected period: 2026-08-01 to 2026-08-31");
});

test("helper copy distinguishes the approved business meanings", () => {
  const presentation = buildDashboardPresentation(snapshot);
  const cards = [...presentation.businessActivity, ...presentation.currentPosition];
  const helperByLabel = Object.fromEntries(cards.map((card) => [card.label, card.helperText ?? ""]));

  assert.match(helperByLabel.Sales, /unlocked Challan.*change past Sales/i);
  assert.match(helperByLabel["Payments Received"], /Cash In.*all Cash Book Money In/i);
  assert.match(helperByLabel.Expenses, /Cash Out.*actual Cash Book Money Out/i);
  assert.match(helperByLabel["Customer Outstanding — Current"], /Current unpaid.*not a historical balance/i);
});

test("component is prop-only and renders the two responsive card groups", () => {
  assert.match(componentSource, /export interface DashboardViewProps/);
  assert.match(componentSource, /snapshot: DashboardSnapshot/);
  assert.match(componentSource, /buildDashboardPresentation\(snapshot\)/);
  assert.match(componentSource, /heading="Business Activity"/);
  assert.match(componentSource, /heading="Current Position"/);
  assert.match(componentSource, /cards\.map\(\(card\)/);
  assert.doesNotMatch(
    componentSource,
    /getDashboardSnapshot|supabase|\/services\/|compensation-provider|compensation\/providers|fetch\(/i,
  );
});
