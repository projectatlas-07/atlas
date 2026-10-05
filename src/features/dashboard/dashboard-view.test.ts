import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDashboardPresentation } from "./dashboard-view-model.ts";
import type { OwnerDashboardSnapshot } from "./types.ts";

const componentSource = readFileSync(
  new URL("./components/dashboard-view.tsx", import.meta.url),
  "utf8",
);
const viewModelSource = readFileSync(
  new URL("./dashboard-view-model.ts", import.meta.url),
  "utf8",
);

function ownerSnapshot(overrides: Partial<OwnerDashboardSnapshot["today"]["flows"]> = {}): OwnerDashboardSnapshot {
  return {
    today: {
      dateFrom: "2026-09-23",
      dateTo: "2026-09-23",
      flows: {
        sales: 125000,
        paymentsReceived: 25001,
        expenses: 35002,
        productionQuantity: 12345,
        productionLabourPaid: 75006,
        mudSupplyPaid: 85007,
        chamberTransportPaid: 95008,
        soilTrolleyPaid: 105009,
        staffPaid: 115010,
        vehicleDeliveryWagePaid: 125011,
        ...overrides,
      },
      stocks: {
        currentCustomerOutstanding: 145013,
      },
      cashBook: {
        status: "started",
        moneyIn: 45003,
        moneyOut: 55004,
        balance: 135012,
      },
    },
    thisWeekSales: {
      dateFrom: "2026-09-21",
      dateTo: "2026-09-23",
      amount: 250000,
    },
  };
}

test("builds the owner hierarchy from authoritative values with central Indian formatting", () => {
  const presentation = buildDashboardPresentation(ownerSnapshot());

  assert.equal(presentation.todayDateLabel, "23/09/2026");
  assert.equal(presentation.todaySales.value, "₹1,25,000.00");
  assert.deepEqual(presentation.todayProduction, {
    recorded: true,
    value: "12,345",
    description: "Quantity from today’s production entries.",
    href: "#production",
  });
  assert.equal(presentation.thisWeekSales.value, "₹2,50,000.00");
  assert.equal(presentation.thisWeekSales.description, "21/09/2026 to 23/09/2026");
  assert.deepEqual(presentation.currentPosition.map(({ label, value, href }) => ({ label, value, href })), [
    { label: "Cash balance", value: "₹1,35,012.00", href: "#cash-book" },
    { label: "Customer outstanding", value: "₹1,45,013.00", href: "#sales" },
  ]);
  assert.equal(presentation.hasRecordedActivity, true);
});

test("zero production is one consistent not-recorded state and never a competing value", () => {
  const presentation = buildDashboardPresentation(ownerSnapshot({ productionQuantity: 0 }));

  assert.deepEqual(presentation.todayProduction, {
    recorded: false,
    value: "Not recorded yet",
    description: "Record production in the existing daily workflow.",
    href: "#production",
  });
  assert.equal(presentation.attention[0]?.title, "Today’s production is not recorded");
  assert.equal(presentation.attention[0]?.value, undefined);
});

test("attention uses only absent production and current outstanding without inventing urgency", () => {
  const open = buildDashboardPresentation(ownerSnapshot({ productionQuantity: 0 }));
  assert.deepEqual(open.attention.map((item) => item.title), [
    "Today’s production is not recorded",
    "Customer balance remains open",
  ]);
  assert.match(open.attention[1]?.description ?? "", /not an overdue calculation/i);

  const clearSnapshot = ownerSnapshot();
  clearSnapshot.today.stocks.currentCustomerOutstanding = 0;
  assert.deepEqual(buildDashboardPresentation(clearSnapshot).attention, []);
});

test("zero activity gets an explicit empty state while zero Sales remains a truthful value", () => {
  const snapshot = ownerSnapshot({
    sales: 0,
    paymentsReceived: 0,
    expenses: 0,
  });
  snapshot.today.cashBook = { status: "started", moneyIn: 0, moneyOut: 0, balance: 0 };
  const presentation = buildDashboardPresentation(snapshot);

  assert.equal(presentation.todaySales.value, "₹0.00");
  assert.match(presentation.todaySales.description, /No active Challan value/i);
  assert.equal(presentation.hasRecordedActivity, false);
  assert.match(componentSource, /No money activity recorded today/);
});

test("uninitialized Cash Book is explicit and introduces no fabricated financial values", () => {
  const snapshot = ownerSnapshot({ paymentsReceived: 0, expenses: 0 });
  snapshot.today.cashBook = { status: "not_started" };

  const presentation = buildDashboardPresentation(snapshot);
  const cashPosition = presentation.currentPosition.find((item) => item.label === "Cash balance");

  assert.equal(cashPosition?.value, "Cash Book not started");
  assert.equal(cashPosition?.href, "#cash-book");
  assert.match(cashPosition?.description ?? "", /one-time setup/i);
  assert.equal(presentation.activity.some((item) => item.label === "Cash In"), false);
  assert.equal(presentation.activity.some((item) => item.label === "Cash Out"), false);
  assert.equal(presentation.hasRecordedActivity, false);
  assert.doesNotMatch(JSON.stringify(presentation.currentPosition), /₹0\.00/);
});

test("an initialized legitimate zero remains a real Cash Book value", () => {
  const snapshot = ownerSnapshot({ paymentsReceived: 0, expenses: 0 });
  snapshot.today.cashBook = { status: "started", moneyIn: 0, moneyOut: 0, balance: 0 };

  const presentation = buildDashboardPresentation(snapshot);

  assert.equal(presentation.currentPosition[0]?.value, "₹0.00");
  assert.deepEqual(
    presentation.activity.filter((item) => item.href === "#cash-book").map(({ label, value }) => ({ label, value })),
    [
      { label: "Cash In", value: "₹0.00" },
      { label: "Cash Out", value: "₹0.00" },
    ],
  );
  assert.equal(presentation.hasRecordedActivity, false);
});

test("view is presentational, token-based, responsive, and links only to existing areas", () => {
  assert.match(componentSource, /snapshot: OwnerDashboardSnapshot/);
  assert.match(componentSource, /title="Today"/);
  assert.match(componentSource, /title="Needs attention"/);
  assert.match(componentSource, /title="Overview"/);
  assert.match(componentSource, /sm:grid-cols-2/);
  assert.match(componentSource, /lg:grid-cols-2/);
  assert.match(componentSource, /min-h-atlas-12/);
  assert.match(componentSource, /tabular-nums/);
  assert.match(componentSource, /<Card/);
  assert.match(componentSource, /<EmptyState/);
  assert.doesNotMatch(componentSource, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(componentSource, /getDashboardSnapshot|supabase|\/services\/|compensation-provider|compensation\/providers|fetch\(/i);
});

test("Dashboard does not surface ambiguous payables or Production-versus-Sales reconciliation", () => {
  assert.doesNotMatch(`${componentSource}\n${viewModelSource}`, /payable|parity|certification|settlement preview|production.{0,20}(?:vs|versus).{0,20}sales/i);
  assert.doesNotMatch(viewModelSource, /productionLabourPaid|mudSupplyPaid|chamberTransportPaid|soilTrolleyPaid|staffPaid|vehicleDeliveryWagePaid/);
});
