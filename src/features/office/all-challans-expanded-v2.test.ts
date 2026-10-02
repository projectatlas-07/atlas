import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const expanded = readFileSync(
  new URL("./components/all-challans-expanded-view.tsx", import.meta.url),
  "utf8",
);
const sales = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const model = readFileSync(
  new URL("./sales-office-model.ts", import.meta.url),
  "utf8",
);

test("main Challans history opens and returns from one mounted expanded view", () => {
  assert.match(sales, /useState<ChallansWorkspaceView>\("main"\)/);
  assert.match(sales, /onClick=\{\(\) => showChallansView\("all"\)\}>View all Challans/);
  assert.equal((sales.match(/<AllChallansExpandedView\b/g) ?? []).length, 1);
  assert.match(sales, /hidden=\{challansView !== "main"\}/);
  assert.match(sales, /hidden=\{challansView !== "all"\}/);
  assert.match(expanded, /← Back to Challans/);
  assert.match(sales, /onBack=\{\(\) => showChallansView\("main"\)\}/);
});

test("expanded rows open the authoritative UUID through the existing detail flow", () => {
  assert.match(sales, /onOpen=\{\(challanId\) => \{[\s\S]*openChallan\(challanId\);[\s\S]*setChallansView\("main"\)/);
  assert.match(expanded, /key=\{challan\.id\}/);
  assert.match(expanded, /onOpen=\{\(\) => onOpen\(challan\.id\)\}/);
  assert.match(sales, /queryFn: \(\) => listChallans\(factoryId\)/);
  assert.doesNotMatch(expanded, /supabase|\.from\(|\.rpc\(|fetch\(/);
});

test("expanded filters represent real and separate Atlas concepts", () => {
  for (const label of ["Today", "This Week", "This Month", "Custom", "All time"]) {
    assert.ok(expanded.includes(`label: "${label}"`));
  }
  assert.match(expanded, /label="Lifecycle"/);
  assert.match(expanded, /label="Financial lock"/);
  assert.match(expanded, /value: "active", label: CHALLAN_STATUS\.definitions\.active\.label/);
  assert.match(expanded, /value: "void", label: CHALLAN_STATUS\.definitions\.void\.label/);
  assert.match(expanded, /value: "locked", label: CHALLAN_FINANCIAL_LOCK_STATUS\.definitions\.true\.label/);
  assert.match(expanded, /value: "unlocked", label: CHALLAN_FINANCIAL_LOCK_STATUS\.definitions\.false\.label/);
  assert.match(model, /filterChallansForExpandedView/);
  assert.match(model, /challan\.challanNumber/);
  assert.match(model, /challan\.customerNameSnapshot/);
  assert.match(model, /challan\.customerAddressSnapshot/);
  assert.match(model, /challan\.vehicleNumberSnapshot/);
});

test("expanded filters use one compact responsive toolbar", () => {
  assert.match(
    expanded,
    /aria-label="All Challans filters"[\s\S]*border-y border-atlas-border bg-atlas-surface py-atlas-2[\s\S]*flex flex-wrap items-end gap-atlas-2 xl:flex-nowrap/,
  );
  assert.match(expanded, /className="w-full min-w-0 xl:flex-1"/);
  assert.match(expanded, /<FilterGroup[\s\S]*label="Period"/);
  assert.match(expanded, /<FormField label="Lifecycle">[\s\S]*<Select/);
  assert.match(expanded, /<FormField label="Financial lock">[\s\S]*<Select/);
  assert.match(
    expanded,
    /period === "custom"[\s\S]*mt-atlas-2 grid max-w-xl gap-atlas-2 border-t border-atlas-border pt-atlas-2/,
  );
  assert.doesNotMatch(expanded, /<Card as="section" aria-label="All Challans filters">/);
});

test("compact presentation preserves every expanded filter input", () => {
  assert.match(expanded, /value=\{searchText\}[\s\S]*setSearchText\(event\.target\.value\)/);
  assert.match(expanded, /selected=\{period\}[\s\S]*onSelect=\{setPeriod\}/);
  assert.match(expanded, /value=\{lifecycle\}[\s\S]*setLifecycle\(event\.target\.value as ChallanHistoryLifecycle\)/);
  assert.match(expanded, /value=\{financialLock\}[\s\S]*setFinancialLock\(event\.target\.value as ChallanHistoryFinancialLock\)/);
  assert.match(expanded, /value=\{customFrom\}[\s\S]*setCustomFrom\(event\.target\.value\)/);
  assert.match(expanded, /value=\{customTo\}[\s\S]*setCustomTo\(event\.target\.value\)/);
  assert.match(
    expanded,
    /filterChallansForExpandedView\(challans, \{[\s\S]*searchText,[\s\S]*period,[\s\S]*lifecycle,[\s\S]*financialLock,[\s\S]*localToday,[\s\S]*customFrom,[\s\S]*customTo/,
  );
});

test("expanded history relies on the shared query cache and keeps only error Retry", () => {
  assert.match(sales, /queryKey: challansKey\(factoryId\),[\s\S]*queryFn: \(\) => listChallans\(factoryId\)/);
  assert.match(sales, /function cacheSavedChallan[\s\S]*setQueryData<ChallanHeader\[]>[\s\S]*invalidateQueries\(\{ queryKey: challansKey\(factoryId\) \}\)/);
  assert.match(sales, /function cacheSavedPayment[\s\S]*applyPaymentLocks[\s\S]*invalidateQueries\(\{ queryKey: challansKey\(factoryId\) \}\)/);
  assert.match(sales, /function handleSaved[\s\S]*cacheSavedChallan\(saved\)/);
  assert.match(sales, /async function confirmVoid[\s\S]*cacheSavedChallan\(saved\)/);
  assert.doesNotMatch(expanded, />Refresh</);
  assert.match(
    expanded,
    /errorMessage[\s\S]*<Button variant="secondary" onClick=\{onRetry\}>\{ATLAS_UI_STRINGS\.actions\.retry\}<\/Button>/,
  );
  assert.match(sales, /onRetry=\{\(\) => \{ void challansQuery\.refetch\(\); \}\}/);
});

test("expanded desktop table and mobile cards expose the same authoritative context", () => {
  for (const heading of [
    "Challan / date",
    "Customer / location",
    "Vehicle / trip wage",
    "Total",
    "Lifecycle",
    "Financial lock",
    "Action",
  ]) assert.ok(expanded.includes(heading));
  assert.match(expanded, /className="hidden md:block"/);
  assert.match(expanded, /className="space-y-atlas-3 md:hidden"/);
  assert.match(expanded, /<TableHeader sticky>/);
  assert.match(expanded, /<TableRow hoverable selected=\{selected\}>/);
  assert.match(expanded, /formatDateOnly\(challan\.challanDate\)/);
  assert.match(expanded, /formatIndianCurrency\(challan\.challanTotal/);
  assert.match(expanded, /deliveryWageApplicableSnapshot/);
  assert.match(expanded, /<StatusPill label=\{lifecycleStatus\.label\}/);
  assert.match(expanded, /<StatusPill label=\{financialLockStatus\.label\}/);
});

test("expanded view has complete-history states and no invented pagination", () => {
  assert.match(expanded, /Loading Challans/);
  assert.match(expanded, /No Challans yet/);
  assert.match(expanded, /No matching Challans/);
  assert.match(expanded, /Showing \{formatIndianNumber\(filtered\.challans\.length\)\} of/);
  assert.doesNotMatch(expanded, /pagination|pageSize|nextPage|previousPage|load more/i);
});

test("expanded view uses V2 primitives and tokens without unrelated Sales work", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "Input", "Select", "FormField", "StatusPill", "TableContainer"]) {
    assert.match(expanded, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(
    expanded,
    /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i,
  );
  assert.doesNotMatch(expanded, /(?:p|m|gap|space-[xy]|rounded|shadow|max-h|min-w)-\[[^\]]+\]/);
  assert.doesNotMatch(expanded, /CustomerPayments|SalesRegister|createChallan|updateChallan|voidChallan/);
});
