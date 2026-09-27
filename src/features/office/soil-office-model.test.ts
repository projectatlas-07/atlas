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
  filterSoilOverviewWorkers,
  formatSoilWorkerLastPaid,
  insertSoilAdjustmentNewestFirst,
  insertSoilPaymentNewestFirst,
  insertSoilRateNewestFirst,
  mergeSoilPaymentSummary,
  SOIL_SECTION_HEADING,
  soilOfficeErrorMessage,
  splitSoilWorkers,
  sumSoilPeriodEarned,
  sumSoilPeriodTrolleys,
} from "./soil-office-model.ts";

const sectionSource = readFileSync(
  new URL("./components/soil-office-section.tsx", import.meta.url),
  "utf8",
);
const accountDrawerSource = readFileSync(
  new URL("./components/soil-trolley-account-drawer.tsx", import.meta.url),
  "utf8",
);
const managementDrawerSource = readFileSync(
  new URL("./components/soil-trolley-management-drawer.tsx", import.meta.url),
  "utf8",
);
const modelSource = readFileSync(
  new URL("./soil-office-model.ts", import.meta.url),
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

test("Soil worker overview is integrated into Office with the focused V2 hierarchy", () => {
  assert.equal(SOIL_SECTION_HEADING, "Soil Supply");
  assert.match(dashboardSource, /<SoilOfficeSection factoryId=\{factoryId!\}/);
  assert.match(sectionSource, /Soil \/ Trolley workers/);
  assert.match(sectionSource, /Select earnings period/);
  assert.match(sectionSource, /Search Soil \/ Trolley workers/);
  for (const heading of ["Worker", "Trolleys", "Last paid", "Action"]) {
    assert.match(sectionSource, new RegExp(`TableHeaderCell[^>]*>${heading}`));
  }
  assert.match(sectionSource, /TableHeaderCell numeric>Available \(authoritative\)/);
  assert.match(sectionSource, /hidden md:block/);
  assert.match(sectionSource, /md:hidden/);
});

test("overview uses authoritative existing reads and Atlas V2 presentation only", () => {
  const overviewSource = sectionSource.slice(
    sectionSource.indexOf("export function SoilOfficeSection"),
  );
  for (const service of [
    "listSoilWorkers",
    "resolveSoilWorkerTrolleyRate",
    "listSoilEarnings",
    "getSoilFinancialSummary",
    "listSoilPayments",
  ]) assert.match(overviewSource, new RegExp(service));
  for (const primitive of ["Button", "EmptyState", "Feedback", "FormField", "Input", "Select", "StatusPill", "TableContainer"]) {
    assert.match(overviewSource, new RegExp(`<${primitive}\\b`));
  }
  assert.match(overviewSource, /sumSoilPeriodEarned/);
  assert.match(overviewSource, /sumSoilPeriodTrolleys/);
  assert.match(overviewSource, /Available balance is authoritative lifetime balance, not period-dependent/);
  assert.doesNotMatch(overviewSource, /supabase|\.from\(|\.rpc\(/);
  assert.doesNotMatch(overviewSource, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
});

test("overview filters only real Soil workers and formats real payment dates", () => {
  const workers: SoilWorker[] = [
    { id: "active", factoryId: "factory-a", name: "Raju Hansda", isActive: true, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z" },
    { id: "archived", factoryId: "factory-a", name: "Sunil Murmu", isActive: false, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z" },
  ];
  assert.deepEqual(filterSoilOverviewWorkers({ workers, lifecycle: "active", search: "raju" }), [workers[0]]);
  assert.deepEqual(filterSoilOverviewWorkers({ workers, lifecycle: "archived", search: "" }), [workers[1]]);
  assert.equal(formatSoilWorkerLastPaid("2026-09-26", "2026-09-26"), "Last paid today");
  assert.equal(formatSoilWorkerLastPaid("2026-09-25", "2026-09-26"), "Last paid 1 day ago");
  assert.equal(formatSoilWorkerLastPaid("2026-09-20", "2026-09-26"), "Last paid 20/09/2026");
  assert.equal(formatSoilWorkerLastPaid(null, "2026-09-26"), "No payments yet");
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
  assert.match(sectionSource, /await createSoilWorker\(creationInput\)/);
  assert.match(sectionSource, /setQueryData<SoilWorker\[]>\(workersKey\(factoryId\)/);
  assert.match(sectionSource, /invalidateQueries\(\{ queryKey: workersKey\(factoryId\) \}\)/);
  assert.match(sectionSource, /setManagementWorkerId\(worker\.id\)/);
  assert.match(sectionSource, /<AddSoilTrolleyWorkerDrawer/);
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
  assert.match(managementDrawerSource, /await createSoilWorkerTrolleyRate\(input\)/);
  assert.match(managementDrawerSource, /insertSoilRateNewestFirst/);
  assert.match(managementDrawerSource, /Past recorded work and earnings are unchanged/);
  assert.doesNotMatch(managementDrawerSource, /updateSoilWorkerTrolleyRate|deleteSoilWorkerTrolleyRate/);
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
  assert.match(managementDrawerSource, /Trolley rate history/);
});

test("financial summary displays all five authoritative T5 fields", () => {
  assert.match(accountDrawerSource, /getSoilFinancialSummary/);
  for (const label of [
    "Total earned", "Office additions", "Office deductions", "Total paid", "Available to pay",
  ]) assert.match(accountDrawerSource, new RegExp(label));
  assert.doesNotMatch(accountDrawerSource, /totalEarned\s*\+\s*.*totalAdditions/);
});

test("Soil worker account uses the focused V2 drawer and shared presentation contracts", () => {
  for (const sharedContract of [
    "Button", "Card", "Input", "Select", "FormField", "StatusPill", "Feedback",
    "EmptyState", "TableContainer", "formatIndianCurrency", "formatDateOnly",
    "SOIL_WORKER_LIFECYCLE_STATUS", "ATLAS_UI_STRINGS",
  ]) assert.match(accountDrawerSource, new RegExp(sharedContract));

  assert.match(sectionSource, /<SoilTrolleyAccountDrawer/);
  assert.match(accountDrawerSource, /role="dialog"/);
  assert.match(accountDrawerSource, /Account &amp; payment/);
  assert.match(accountDrawerSource, /<StatusPill label=\{lifecycleStatus\.label\}/);
  assert.match(accountDrawerSource, /<TableContainer>/);
  assert.match(accountDrawerSource, /<FormField label=/);
  assert.doesNotMatch(accountDrawerSource, /<(?:input|select|table|thead|tbody|tr|th|td)\b/);
  assert.doesNotMatch(
    accountDrawerSource,
    /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/,
  );
});

test("Soil account has intentional mobile histories and truthful archived actions", () => {
  assert.match(accountDrawerSource, /w-full[\s\S]*sm:max-w-md/);
  assert.match(accountDrawerSource, /This worker is archived\. Restore the worker before recording a new payment/);
  assert.match(accountDrawerSource, /paymentUnavailable = !worker\.isActive/);
  assert.match(accountDrawerSource, /Work &amp; earnings history/);
  assert.match(accountDrawerSource, /Office adjustment history/);
});

test("migrated Soil account formatting comes only from the canonical formatter", () => {
  assert.match(modelSource, /from "\.\.\/\.\.\/lib\/formatting\.ts"/);
  assert.doesNotMatch(modelSource, /Intl\.|\.toLocale(?:String|DateString|TimeString)\(/);
  assert.doesNotMatch(modelSource, /formatSoilMoney|formatSoilDate|formatSoilQuantity/);
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
  assert.match(accountDrawerSource, /await createSoilPayment\(input\)/);
  assert.match(accountDrawerSource, /Payment of.*recorded/);
});

test("overpayment is blocked clearly while backend validation remains mapped", () => {
  assert.equal(buildSoilPaymentInput({
    factoryId: "factory-a", soilWorkerId: "worker-a", paymentDate: "2026-08-28",
    amount: "601", availableBalance: 600,
  }), null);
  assert.equal(soilOfficeErrorMessage({ code: "P2802", message: "blocked" }, "fallback"),
    "Payment exceeds this worker's available balance.");
  assert.match(accountDrawerSource, /numericPaymentAmount > summary\.availableBalance/);
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
  assert.match(managementDrawerSource, /await createSoilFinancialAdjustment\(input\)/);
  assert.match(managementDrawerSource, /Addition.*recorded/);
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
  assert.match(managementDrawerSource, /placeholder="Required"/);
});

test("successful mutations update only their summary/history/rate caches without manual refresh", () => {
  assert.match(accountDrawerSource, /setQueryData<SoilFinancialSummary>/);
  assert.match(accountDrawerSource, /setQueryData<SoilPayment\[]>/);
  assert.match(accountDrawerSource, /insertSoilPaymentNewestFirst/);
  assert.match(managementDrawerSource, /setQueryData<SoilFinancialAdjustment\[]>/);
  assert.match(managementDrawerSource, /insertSoilAdjustmentNewestFirst/);

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
    date: "25/08/2026",
    description: "Correction → 4 trolleys × ₹200",
    amount: "−₹400",
    isCorrection: true,
  });
  assert.match(sectionSource, /formatDateOnly/);
  assert.match(sectionSource, /formatIndianCurrency/);
  assert.match(accountDrawerSource, /Work &amp; earnings history/);
  assert.match(accountDrawerSource, /Office adjustment history/);
  assert.match(accountDrawerSource, /Recent payments/);
  assert.doesNotMatch(accountDrawerSource, /edit payment|delete payment|edit adjustment|delete adjustment/i);
});

test("switching period rows changes Period Earned using saved historical amounts", () => {
  const base: SoilEarning = {
    id: "earning-base", factoryId: "factory-a", soilWorkerId: "worker-a",
    soilDailyTrolleyEntryId: "daily-a", workDate: "2026-08-25",
    eventType: "BASE", eventSequence: 1, amount: 1000,
    trolleyQuantitySnapshot: 5, ratePerTrolleySnapshot: 200,
    previousBaseAmountSnapshot: 0, sourceBaseAmountSnapshot: 1000,
    createdAt: "2026-09-30T10:00:00Z",
  };
  const correction: SoilEarning = {
    ...base,
    id: "earning-correction",
    eventType: "CORRECTION",
    eventSequence: 2,
    amount: -200,
    trolleyQuantitySnapshot: 4,
    sourceBaseAmountSnapshot: 800,
  };
  assert.equal(sumSoilPeriodEarned([base, correction]), 800);
  assert.equal(sumSoilPeriodTrolleys([base, correction]), 4);
  assert.equal(sumSoilPeriodEarned([{ ...base, id: "earning-other", amount: 400 }]), 400);
  assert.equal(sumSoilPeriodTrolleys([
    base,
    correction,
    {
      ...base,
      id: "earning-other",
      soilDailyTrolleyEntryId: "daily-b",
      trolleyQuantitySnapshot: 2.5,
    },
  ]), 6.5);
  assert.equal(base.ratePerTrolleySnapshot, 200);
});

test("Soil reuses the shared earnings range while cumulative financial queries stay independent", () => {
  for (const label of [
    "Earnings view", "This week", "Last week", "This month", "Custom dates",
    "Earned in period", "From", "To",
  ]) assert.match(accountDrawerSource, new RegExp(label));
  assert.match(accountDrawerSource, /DEFAULT_WAGE_EARNINGS_DATE_PRESET/);
  assert.match(accountDrawerSource, /useState<WageEarningsDatePreset>\(\s*DEFAULT_WAGE_EARNINGS_DATE_PRESET/);
  assert.match(accountDrawerSource, /resolveWageEarningsDateRange/);
  assert.match(accountDrawerSource, /enabled: earningsRange !== null/);
  assert.match(accountDrawerSource, /earningsRange\?\.fromDate[\s\S]*earningsRange\?\.toDate/);
  assert.match(accountDrawerSource, /Work &amp; earnings history/);
  assert.doesNotMatch(accountDrawerSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(accountDrawerSource, /soilFinancialSummaryQueryKey\([^\n]*earningsRange|soilPaymentsQueryKey\([^\n]*earningsRange|soilAdjustmentsQueryKey\([^\n]*earningsRange/);
  const periodCalculation = accountDrawerSource.slice(
    accountDrawerSource.indexOf("const periodEarned"),
    accountDrawerSource.indexOf("const numericPaymentAmount"),
  );
  assert.match(periodCalculation, /sumSoilPeriodEarned\(earningsQuery\.data/);
  assert.doesNotMatch(periodCalculation, /adjustmentsQuery|paymentsQuery|summaryQuery/);
});

test("financial actions do not refresh or mutate recorded trolley and earning history", () => {
  const paymentBody = accountDrawerSource.slice(
    accountDrawerSource.indexOf("async function submitPayment"),
    accountDrawerSource.indexOf("return (", accountDrawerSource.indexOf("async function submitPayment")),
  );
  const adjustmentBody = managementDrawerSource.slice(
    managementDrawerSource.indexOf("async function submitAdjustment"),
    managementDrawerSource.indexOf("async function toggleLifecycle"),
  );
  assert.doesNotMatch(paymentBody, /saveSoilDaily|soil_daily|soilEarningsQueryKey/);
  assert.doesNotMatch(adjustmentBody, /saveSoilDaily|soil_daily|soilEarningsQueryKey/);
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
  assert.match(sectionSource, /\["archived", `Archived \$\{formatIndianNumber\(archivedCount\)\}`\]/);
  assert.match(sectionSource, /SOIL_WORKER_LIFECYCLE_STATUS/);
  assert.match(managementDrawerSource, /await archiveSoilWorker/);
  assert.match(managementDrawerSource, /await restoreSoilWorker/);
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
  assert.match(managementDrawerSource, /Delete unused worker/);
  assert.match(managementDrawerSource, /Confirm permanent delete/);
  assert.match(managementDrawerSource, /await deleteUnusedSoilWorker/);
  assert.doesNotMatch(managementDrawerSource, /deleteSoilEarning|deleteSoilPayment|deleteSoilFinancialAdjustment/);
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
