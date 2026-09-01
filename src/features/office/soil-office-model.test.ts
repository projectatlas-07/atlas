import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type {
  CreatedSoilPayment,
  SoilEarning,
  SoilFinancialAdjustment,
  SoilFinancialSummary,
  SoilPayment,
  SoilWorker,
  SoilWorkerTrolleyRate,
} from "@/features/soil/types";
import {
  buildSoilAdjustmentInput,
  buildSoilEarningHistoryItem,
  buildSoilPaymentInput,
  buildSoilRateChangeInput,
  buildSoilWorkerCreateInput,
  canOfferUnusedSoilWorkerDelete,
  formatSoilDate,
  formatSoilMoney,
  insertSoilAdjustmentNewestFirst,
  insertSoilPaymentNewestFirst,
  insertSoilRateNewestFirst,
  mergeSoilPaymentSummary,
  SOIL_SECTION_HEADING,
  soilOfficeErrorMessage,
  splitSoilWorkers,
} from "./soil-office-model.ts";

const sectionSource = readFileSync(
  new URL("./components/soil-office-section.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("./components/office-dashboard.tsx", import.meta.url),
  "utf8",
);
const productionSoilSource = readFileSync(
  new URL("../soil/components/soil-daily-entry-screen.tsx", import.meta.url),
  "utf8",
);

const summary: SoilFinancialSummary = {
  totalEarned: 1000,
  totalAdditions: 500,
  totalDeductions: 300,
  totalPaid: 600,
  availableBalance: 600,
};

test("Soil worker list is integrated into Office with compact cards and an empty state", () => {
  assert.equal(SOIL_SECTION_HEADING, "Soil Supply");
  assert.match(dashboardSource, /<SoilOfficeSection factoryId=\{factoryId!\}/);
  assert.match(sectionSource, /Active Soil workers/);
  assert.match(sectionSource, /No active Soil workers/);
  assert.match(sectionSource, /Open details/);
  assert.match(sectionSource, /Current rate:/);
  assert.match(sectionSource, /label="Earned"/);
  assert.match(sectionSource, /label="Paid"/);
  assert.match(sectionSource, /label="Available"/);
});

test("worker creation normalizes input and uses the atomic worker plus initial-rate service", () => {
  assert.deepEqual(buildSoilWorkerCreateInput({
    factoryId: "factory-a",
    name: "  Raju   Kumar  ",
    initialRate: "200",
    effectiveFrom: "2026-08-01",
  }), {
    factoryId: "factory-a",
    name: "Raju Kumar",
    initialRatePerTrolley: 200,
    initialEffectiveFrom: "2026-08-01",
  });
  assert.equal(buildSoilWorkerCreateInput({
    factoryId: "factory-a", name: " ", initialRate: "200", effectiveFrom: "2026-08-01",
  }), null);
  assert.match(sectionSource, /await createSoilWorker\(input\)/);
  assert.match(sectionSource, /setQueryData<SoilWorker\[]>\(workersKey\(factoryId\)/);
  assert.match(sectionSource, /setSelectedWorkerId\(worker\.id\)/);
});

test("rate change requires a positive rate and date and refreshes current rate without editing history", () => {
  assert.deepEqual(buildSoilRateChangeInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", rate: "220.5",
    effectiveFrom: "2026-09-01",
  }), {
    factoryId: "factory-a",
    soilWorkerId: "worker-a",
    ratePerTrolley: 220.5,
    effectiveFrom: "2026-09-01",
  });
  assert.equal(buildSoilRateChangeInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", rate: "0",
    effectiveFrom: "2026-09-01",
  }), null);
  assert.match(sectionSource, /await createSoilWorkerTrolleyRate\(input\)/);
  assert.match(sectionSource, /insertSoilRateNewestFirst/);
  assert.match(sectionSource, /Past work and earnings are unchanged/);
  assert.doesNotMatch(sectionSource, /updateSoilWorkerTrolleyRate|deleteSoilWorkerTrolleyRate/);
});

test("rate history remains deterministic and read-only", () => {
  const rate = (id: string, effectiveFrom: string): SoilWorkerTrolleyRate => ({
    id, factoryId: "factory-a", soilWorkerId: "worker-a", ratePerTrolley: 200,
    effectiveFrom, effectiveTo: null, createdAt: `${effectiveFrom}T10:00:00Z`,
  });
  assert.deepEqual(
    insertSoilRateNewestFirst([rate("old", "2026-08-01")], rate("new", "2026-09-01"))
      .map((item) => item.id),
    ["new", "old"],
  );
  assert.match(sectionSource, /Trolley rate history/);
});

test("financial summary displays all five authoritative T5 fields", () => {
  assert.match(sectionSource, /getSoilFinancialSummary/);
  for (const label of [
    "Total Earned", "Total Additions", "Total Deductions", "Total Paid", "Available Balance",
  ]) assert.match(sectionSource, new RegExp(`label="${label}"`));
  assert.doesNotMatch(sectionSource, /totalEarned\s*\+\s*.*totalAdditions/);
});

test("successful payment input and cache update preserve the authoritative summary", () => {
  assert.deepEqual(buildSoilPaymentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", paymentDate: "2026-08-28",
    amount: "250.5", availableBalance: 600,
  }), {
    factoryId: "factory-a", soilWorkerId: "worker-a", paymentDate: "2026-08-28", amount: 250.5,
  });
  const payment: CreatedSoilPayment = {
    id: "payment-a", factoryId: "factory-a", soilWorkerId: "worker-a",
    paymentDate: "2026-08-28", amount: 250, createdAt: "2026-08-28T10:00:00Z",
    totalEarned: 1000, totalPaid: 850, availableBalance: 350,
  };
  assert.deepEqual(mergeSoilPaymentSummary(summary, payment), {
    ...summary, totalEarned: 1000, totalPaid: 850, availableBalance: 350,
  });
  assert.match(sectionSource, /await createSoilPayment\(input\)/);
  assert.match(sectionSource, /Payment recorded and balance updated/);
});

test("overpayment is blocked clearly while backend validation remains mapped", () => {
  assert.equal(buildSoilPaymentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", paymentDate: "2026-08-28",
    amount: "601", availableBalance: 600,
  }), null);
  assert.equal(soilOfficeErrorMessage({ code: "P2802", message: "blocked" }, "fallback"),
    "Payment exceeds this worker's available balance.");
  assert.match(sectionSource, /amount > summary\.availableBalance/);
});

test("addition input is normalized and updates summary and history immediately", () => {
  assert.deepEqual(buildSoilAdjustmentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", adjustmentType: "ADDITION",
    adjustmentDate: "2026-08-28", amount: "500", reason: "  Festival bonus  ",
    availableBalance: 600,
  }), {
    factoryId: "factory-a", soilWorkerId: "worker-a", adjustmentType: "ADDITION",
    adjustmentDate: "2026-08-28", amount: 500, reason: "Festival bonus",
  });
  assert.match(sectionSource, /await createSoilFinancialAdjustment\(input\)/);
  assert.match(sectionSource, /Addition.*recorded and balance updated/);
});

test("deduction input respects available balance", () => {
  assert.ok(buildSoilAdjustmentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", adjustmentType: "DEDUCTION",
    adjustmentDate: "2026-08-28", amount: "300", reason: "Absent part of day",
    availableBalance: 600,
  }));
  assert.equal(buildSoilAdjustmentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", adjustmentType: "DEDUCTION",
    adjustmentDate: "2026-08-28", amount: "601", reason: "Absent part of day",
    availableBalance: 600,
  }), null);
  assert.equal(soilOfficeErrorMessage({ code: "P2902", message: "blocked" }, "fallback"),
    "Deduction exceeds this worker's available balance.");
});

test("adjustment type, date, positive amount, and required reason are validated", () => {
  for (const invalid of [
    { adjustmentType: "" as const, amount: "1", reason: "Reason", date: "2026-08-28" },
    { adjustmentType: "ADDITION" as const, amount: "0", reason: "Reason", date: "2026-08-28" },
    { adjustmentType: "ADDITION" as const, amount: "1", reason: " ", date: "2026-08-28" },
    { adjustmentType: "ADDITION" as const, amount: "1", reason: "Reason", date: "2026-02-30" },
  ]) assert.equal(buildSoilAdjustmentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a",
    adjustmentType: invalid.adjustmentType,
    adjustmentDate: invalid.date, amount: invalid.amount, reason: invalid.reason,
    availableBalance: 600,
  }), null);
  assert.match(sectionSource, /placeholder="Required"/);
});

test("successful mutations update only their summary/history/rate caches without manual refresh", () => {
  assert.match(sectionSource, /setQueryData<SoilFinancialSummary>/);
  assert.match(sectionSource, /setQueryData<SoilPayment\[]>/);
  assert.match(sectionSource, /insertSoilPaymentNewestFirst/);
  assert.match(sectionSource, /setQueryData<SoilFinancialAdjustment\[]>/);
  assert.match(sectionSource, /insertSoilAdjustmentNewestFirst/);

  const payments: SoilPayment[] = [
    { id: "old", factoryId: "factory-a", soilWorkerId: "worker-a", paymentDate: "2026-08-20", amount: 100, createdAt: "2026-08-20T10:00:00Z" },
  ];
  assert.deepEqual(insertSoilPaymentNewestFirst(payments, {
    ...payments[0], id: "new", paymentDate: "2026-08-28",
  }).map((item) => item.id), ["new", "old"]);
  const adjustments: SoilFinancialAdjustment[] = [
    { id: "old", factoryId: "factory-a", soilWorkerId: "worker-a", adjustmentType: "ADDITION", adjustmentDate: "2026-08-20", amount: 100, reason: "Old", createdAt: "2026-08-20T10:00:00Z" },
  ];
  assert.deepEqual(insertSoilAdjustmentNewestFirst(adjustments, {
    ...adjustments[0], id: "new", adjustmentDate: "2026-08-28",
  }).map((item) => item.id), ["new", "old"]);
});

test("earnings, payment, and adjustment histories are read-only and corrections remain audit events", () => {
  const correction: SoilEarning = {
    id: "earning-correction", factoryId: "factory-a", soilWorkerId: "worker-a",
    soilDailyTrolleyEntryId: "daily-a", workDate: "2026-08-25",
    eventType: "CORRECTION", eventSequence: 2, amount: -400,
    trolleyQuantitySnapshot: 4, ratePerTrolleySnapshot: 200,
    previousBaseAmountSnapshot: 1200, sourceBaseAmountSnapshot: 800,
    createdAt: "2026-08-26T10:00:00Z",
  };
  assert.deepEqual(buildSoilEarningHistoryItem(correction), {
    id: "earning-correction",
    date: "25 Aug 2026",
    description: "Correction → 4 trolleys × ₹200.00",
    amount: "−₹400.00",
    isCorrection: true,
  });
  assert.equal(formatSoilDate("2026-08-25"), "25 Aug 2026");
  assert.equal(formatSoilMoney(1000), "₹1,000.00");
  assert.match(sectionSource, /Work and earnings/);
  assert.match(sectionSource, /Adjustments/);
  assert.match(sectionSource, /Payments/);
  assert.match(sectionSource, /Read-only histories/);
  assert.doesNotMatch(sectionSource, /edit payment|delete payment|edit adjustment|delete adjustment/i);
});

test("financial actions do not refresh or mutate recorded trolley and earning history", () => {
  const paymentBody = sectionSource.slice(
    sectionSource.indexOf("async function submitPayment"),
    sectionSource.indexOf("async function submitAdjustment"),
  );
  const adjustmentBody = sectionSource.slice(
    sectionSource.indexOf("async function submitAdjustment"),
    sectionSource.indexOf("return (", sectionSource.indexOf("async function submitAdjustment")),
  );
  assert.doesNotMatch(paymentBody, /saveSoilDaily|soil_daily|earningsKey/);
  assert.doesNotMatch(adjustmentBody, /saveSoilDaily|soil_daily|earningsKey/);
});

test("production Soil UI remains trolley-quantity only", () => {
  assert.match(productionSoilSource, /Trolley Quantity/i);
  assert.doesNotMatch(productionSoilSource, /createSoilPayment|Record Payment|Adjustment|Available Balance|Total Paid/i);
  assert.doesNotMatch(dashboardSource, /soil-daily-entry-screen/);
});

test("T7 separates active and archived workers without losing either identity", () => {
  const workers: SoilWorker[] = [
    { id: "active", factoryId: "factory-a", name: "Active", isActive: true, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z" },
    { id: "archived", factoryId: "factory-a", name: "Archived", isActive: false, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z" },
  ];
  assert.deepEqual(splitSoilWorkers(workers), {
    active: [workers[0]],
    archived: [workers[1]],
  });
  assert.match(sectionSource, /Archived Soil workers/);
  assert.match(sectionSource, /cannot receive trolley entries/);
  assert.match(sectionSource, /await archiveSoilWorker/);
  assert.match(sectionSource, /await restoreSoilWorker/);
});

test("T7 offers permanent delete only after loaded histories are empty", () => {
  assert.equal(canOfferUnusedSoilWorkerDelete({
    historiesLoaded: true, earningCount: 0, paymentCount: 0, adjustmentCount: 0,
  }), true);
  for (const blocked of [
    { historiesLoaded: false, earningCount: 0, paymentCount: 0, adjustmentCount: 0 },
    { historiesLoaded: true, earningCount: 1, paymentCount: 0, adjustmentCount: 0 },
    { historiesLoaded: true, earningCount: 0, paymentCount: 1, adjustmentCount: 0 },
    { historiesLoaded: true, earningCount: 0, paymentCount: 0, adjustmentCount: 1 },
  ]) assert.equal(canOfferUnusedSoilWorkerDelete(blocked), false);
  assert.match(sectionSource, /Delete unused worker/);
  assert.match(sectionSource, /Confirm permanent delete/);
  assert.match(sectionSource, /await deleteUnusedSoilWorker/);
  assert.doesNotMatch(sectionSource, /deleteSoilEarning|deleteSoilPayment|deleteSoilFinancialAdjustment/);
});

test("T7 lifecycle failures tell Office to restore or archive instead", () => {
  assert.equal(
    soilOfficeErrorMessage({ code: "P2A03", message: "blocked" }, "fallback"),
    "Archived Soil workers cannot receive trolley entries. Restore the worker first.",
  );
  assert.equal(
    soilOfficeErrorMessage({ code: "P2A04", message: "blocked" }, "fallback"),
    "This Soil worker has historical records and cannot be deleted. Archive the worker instead.",
  );
});
