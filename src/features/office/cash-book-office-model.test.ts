import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ATLAS_UI_STRINGS } from "../../lib/strings.ts";
import type { CashBookMovement } from "../cash-book/types.ts";
import {
  formatCustomerPaymentMethods,
  formatCustomerPaymentMode,
} from "../sales/types.ts";
import {
  buildCashBookInitializationInput,
  buildCashBookManualEntryInput,
  emptyCashBookInitializationForm,
  emptyCashBookManualEntryForm,
  getCashBookNavigationDate,
  getCashBookReceiptHref,
  isCashBookInitializationRequired,
} from "./cash-book-office-model.ts";

const sectionSource = readFileSync(
  new URL("./components/cash-book-office-section.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);
const requestId = "10000000-0000-4000-8000-000000000001";

const customerPayment: CashBookMovement = {
  sourceType: "customer_payment",
  sourceId: "payment-a",
  businessDate: "2026-08-27",
  direction: "in",
  amount: 60_000,
  paymentMode: "upi",
  paymentMethods: [{ mode: "upi", splitAmount: null }],
  counterparty: "Diego Forlan",
  description: "Challans #12, #15",
  note: null,
  sourceStatus: "active",
  createdAt: "2026-08-27T10:00:00Z",
};

test("uninitialized factory shows the one-time initialization flow", () => {
  const error = Object.assign(new Error("Initialize the Cash Book first."), { code: "P3201" });
  assert.equal(isCashBookInitializationRequired(error), true);
  assert.deepEqual(emptyCashBookInitializationForm("2026-08-27"), {
    startDate: "2026-08-27", openingBalance: "",
  });
  assert.match(sectionSource, /Cash Book start date/);
  assert.match(sectionSource, /amount the factory already has when beginning Atlas Cash Book/);
});

test("initialization request contains only the S6A controlled RPC inputs", () => {
  assert.deepEqual(buildCashBookInitializationInput("factory-a", {
    startDate: "2026-08-27", openingBalance: "20000.50",
  }), {
    factoryId: "factory-a", startDate: "2026-08-27", openingBalance: 20_000.5,
  });
  assert.deepEqual(buildCashBookInitializationInput("factory-a", {
    startDate: "2026-08-27", openingBalance: "0",
  })?.openingBalance, 0);
  assert.equal(buildCashBookInitializationInput("factory-a", {
    startDate: "2026-02-30", openingBalance: "20000",
  }), null);
  assert.match(sectionSource, /await initializeCashBook\(input\)/);
});

test("previous, today, and next navigation use local calendar dates across boundaries", () => {
  assert.equal(getCashBookNavigationDate("previous", "2026-09-01", "2026-09-01"), "2026-08-31");
  assert.equal(getCashBookNavigationDate("today", "2026-08-31", "2026-09-01"), "2026-09-01");
  assert.equal(getCashBookNavigationDate("next", "2026-12-31", "2026-09-01"), "2027-01-01");
  assert.equal(getCashBookNavigationDate("previous", "invalid", "2026-09-01"), null);
  assert.doesNotMatch(sectionSource, /toISOString|setUTC|getUTC/);
});

test("initialized screen uses the authoritative S6A day response without frontend balance math", () => {
  assert.match(sectionSource, /getCashBookDay\(factoryId, selectedDate\)/);
  for (const field of ["openingBalance", "totalMoneyIn", "totalMoneyOut", "closingBalance"]) {
    assert.match(sectionSource, new RegExp(`day\\.summary\\.${field}`));
  }
  assert.doesNotMatch(sectionSource, /openingBalance\s*[+]\s*|totalMoneyIn\s*[-]\s*/);
  assert.match(dashboardSource, /<CashBookOfficeSection factoryId=\{factoryId!\}/);
});

test("Cash Book removes redundant headers and keeps its daily workspace viewport-bounded", () => {
  assert.match(shellSource, /activeArea !== "cash-book"/);
  assert.doesNotMatch(sectionSource, /Daily money in and money out/);
  assert.doesNotMatch(sectionSource, /tracking-wider text-emerald-800">Cash Book/);
  assert.match(sectionSource, /aria-label="Cash Book" className="min-h-0"/);
  assert.match(sectionSource, /lg:h-\[calc\(100dvh-var\(--atlas-space-16\)\)\]/);
  assert.match(sectionSource, /grid shrink-0 grid-cols-2/);
  for (const control of ["Previous day", "Today", "Next day", "Add Money In", "Add Money Out"]) {
    assert.match(sectionSource, new RegExp(control));
  }
});

test("Cash Book gates summary and both responsive movement columns behind authoritative freshness", () => {
  assert.match(sectionSource, /const dayCurrent = !dayQuery\.isPaused && isCustomerPaymentReadCurrent/);
  assert.match(sectionSource, /isInvalidated: queryClient\.getQueryState\(cashBookDayKey\(factoryId, selectedDate\)\)\?\.isInvalidated/);
  const gated = sectionSource.slice(sectionSource.indexOf("{dayCurrent ? <>"),
    sectionSource.indexOf('</> : <Feedback tone="warning">'));
  assert.match(gated, /<CashBookSummary day=\{dayQuery\.data\}/);
  assert.match(gated, /entries=\{dayQuery\.data\.moneyIn\}/);
  assert.match(gated, /entries=\{dayQuery\.data\.moneyOut\}/);
  assert.match(gated, /lg:grid-cols-2/);
  assert.match(sectionSource, /ATLAS_UI_STRINGS\.cashBook\.outdated/);
  assert.match(sectionSource, /dayQuery\.data && !initializationRequired/);
  assert.match(sectionSource, /dayQuery\.isPaused && !dayQuery\.data && !initializationRequired/);
  assert.match(sectionSource, /initializationRequired && <CashBookInitializationSetup/);
});

test("Cash Book Refresh is read-only and remains available during paused or failed reads", () => {
  const refresh = sectionSource.slice(sectionSource.indexOf("async function refreshDay()"), sectionSource.indexOf("return ("));
  assert.match(refresh, /refreshCashBookQueries\(queryClient, \{ factoryId, businessDate: selectedDate \}\)/);
  assert.doesNotMatch(refresh, /create|initializeCashBook|voidCashBookManualEntry/);
  const controls = sectionSource.match(/<Button[^>]+onClick=\{\(\) => void refreshDay\(\)\}[^>]*>/g) ?? [];
  assert.equal(controls.length, 3);
  assert.ok(controls.every((control) => !control.includes("disabled=")));
  assert.match(sectionSource, /ATLAS_UI_STRINGS\.payment\.refresh/);
});

test("daily histories use one bounded mobile region and independent desktop column scrolling", () => {
  const columns = sectionSource.slice(
    sectionSource.indexOf("function CashBookColumn"),
    sectionSource.indexOf("function CashBookEntryRow"),
  );
  assert.match(sectionSource, /max-h-96 min-h-0 flex-1 overflow-y-auto[^"]*lg:overflow-hidden/);
  assert.match(columns, /lg:flex lg:min-h-0 lg:flex-col/);
  assert.match(columns, /lg:shrink-0/);
  assert.match(columns, /lg:min-h-0 lg:flex-1 lg:overflow-y-auto/);
  assert.equal((sectionSource.match(/<CashBookColumn\b/g) ?? []).length, 2);
  assert.doesNotMatch(columns, /slice\(|pagination|overflow-x/);
});

test("customer and multi-Challan payments remain one Money In source row with receipt navigation", () => {
  assert.equal(getCashBookReceiptHref(customerPayment), "/office/payments/payment-a");
  assert.equal([customerPayment].length, 1);
  assert.match(sectionSource, /dayQuery\.data\.moneyIn/);
  assert.match(sectionSource, /getCashBookReceiptHref/);
  assert.match(sectionSource, /\{ATLAS_UI_STRINGS\.payment\.openReceipt\}<\/Link>/);
  assert.equal(ATLAS_UI_STRINGS.payment.openReceipt, "Open receipt");
  assert.doesNotMatch(sectionSource, /allocations\.map/);
});

test("customer payment methods render authoritatively without changing one-movement totals", () => {
  assert.deepEqual([
    "cash", "upi", "bank_transfer", "cheque", "other", "unspecified", "multiple",
  ].map((mode) => formatCustomerPaymentMode(mode as CashBookMovement["paymentMode"])), [
    "Cash", "UPI", "Bank Transfer", "Cheque", "Other", "Legacy / Unspecified", "Multiple",
  ]);
  assert.equal(formatCustomerPaymentMethods(
    customerPayment.paymentMethods,
    customerPayment.paymentMode,
    { includeSplitAmounts: false },
  ), "UPI");
  assert.equal(formatCustomerPaymentMethods(
    [
      { mode: "upi", splitAmount: null },
      { mode: "cheque", splitAmount: null },
    ],
    "multiple",
    { includeSplitAmounts: false },
  ), "UPI + Cheque");
  assert.equal(formatCustomerPaymentMethods(
    [
      { mode: "upi", splitAmount: 10_000 },
      { mode: "cheque", splitAmount: 90_000 },
    ],
    "multiple",
    { includeSplitAmounts: false },
  ), "UPI + Cheque");
  assert.equal(formatCustomerPaymentMethods([], "upi", {
    includeSplitAmounts: false,
  }), "UPI");
  assert.equal(formatCustomerPaymentMethods([], "multiple", {
    includeSplitAmounts: false,
  }), "Multiple");
  assert.match(sectionSource, /formatCustomerPaymentMethods\([\s\S]*entry\.paymentMethods[\s\S]*includeSplitAmounts: false/);
  assert.match(sectionSource, /entry\.sourceType === "customer_payment"/);
});

test("manual Money In and Money Out use one validated controlled request shape", () => {
  const form = {
    businessDate: "2026-08-27",
    amount: "100000",
    paymentMode: "bank_transfer",
    partyDetails: "  Owner   temporary money ",
    note: " Working capital ",
  };
  assert.deepEqual(buildCashBookManualEntryInput(
    "factory-a", requestId, "in", form,
  ), {
    factoryId: "factory-a", requestId, businessDate: "2026-08-27",
    direction: "in", amount: 100_000, paymentMode: "bank_transfer",
    partyDetails: "Owner temporary money", note: "Working capital",
  });
  assert.equal(buildCashBookManualEntryInput(
    "factory-a", requestId, "out", { ...form, amount: "0" },
  ), null);
  assert.equal(buildCashBookManualEntryInput(
    "factory-a", requestId, "out", { ...form, paymentMode: "" },
  ), null);
  assert.deepEqual(emptyCashBookManualEntryForm("2026-08-27"), {
    businessDate: "2026-08-27", amount: "", paymentMode: "", partyDetails: "", note: "",
  });
  assert.match(sectionSource, /await createCashBookManualEntry\(input\)/);
  assert.match(sectionSource, /if \(isSaving/);
  assert.match(sectionSource, /invalidateQueries/);
});

test("manual correction is confirm-void only and keeps void rows historically visible", () => {
  assert.match(sectionSource, /Void Entry/);
  assert.match(sectionSource, /Confirm void/);
  assert.match(sectionSource, /await voidCashBookManualEntry/);
  assert.match(sectionSource, /sourceStatus === "void"/);
  assert.match(sectionSource, />VOID</);
  assert.doesNotMatch(sectionSource, />Edit</);
  assert.doesNotMatch(sectionSource, />Delete</);
  assert.doesNotMatch(sectionSource, /\.filter\([^)]*sourceStatus/);
});

test("empty columns and carried balances remain explicit", () => {
  assert.match(sectionSource, /No money received on this date/);
  assert.match(sectionSource, /No money paid out on this date/);
  assert.match(sectionSource, /Opening and closing still carry forward/);
});
