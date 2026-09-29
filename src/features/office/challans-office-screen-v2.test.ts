import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const salesSource = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const challansStart = salesSource.indexOf('<div hidden={salesArea !== "challans"}>');
const challansEnd = salesSource.indexOf(
  '<div hidden={salesArea !== "customer-payments"}>',
  challansStart,
);
const challansScreen = salesSource.slice(challansStart, challansEnd);

test("main Challans screen keeps the existing create, edit, detail, and history flows", () => {
  assert.ok(challansStart >= 0);
  assert.ok(challansEnd > challansStart);
  assert.match(challansScreen, /<ChallanEditor/);
  assert.match(challansScreen, /<ChallanDetail/);
  assert.match(challansScreen, /onClick=\{openCreate\} aria-label="Create Challan" title="Create Challan"/);
  assert.match(salesSource, /getCompactChallanHistory\(visibleChallans\)/);
  assert.match(challansScreen, /compactChallans\.map/);
  assert.match(challansScreen, /onClick=\{\(\) => openChallan\(challan\.id\)\}/);
});

test("opened Challan actions live in one compact row above the work card", () => {
  const actionRowIndex = challansScreen.indexOf('aria-label="Challan actions"');
  const workCardIndex = challansScreen.indexOf('<Card as="section" aria-label="Challan work area">');

  assert.ok(actionRowIndex >= 0);
  assert.ok(actionRowIndex < workCardIndex);
  assert.match(
    challansScreen,
    /mode === "detail" && selectedChallan && selectedChallanEligibility[\s\S]*variant="secondary"[\s\S]*setMode\("edit"\)[\s\S]*disabled=\{!selectedChallanEligibility\.canEdit\}[\s\S]*>\s*Edit\s*<\/Button>/,
  );
  assert.match(
    challansScreen,
    /variant="danger"[\s\S]*setIsConfirmingVoid\(true\)[\s\S]*disabled=\{!selectedChallanEligibility\.canVoid\}[\s\S]*>\s*Void\s*<\/Button>/,
  );
  assert.match(
    challansScreen,
    /<Button variant="primary" onClick=\{openCreate\} aria-label="Create Challan" title="Create Challan">\s*<span aria-hidden="true" className="text-atlas-xl leading-none">\+<\/span>/,
  );
  assert.match(salesSource, /selectedChallan\s*\? getChallanEligibility\(selectedChallan\)/);
  assert.equal((challansScreen.match(/aria-label="Create Challan"/g) ?? []).length, 1);
  assert.doesNotMatch(challansScreen, /New Challan|Correct Challan|Void Challan/);
});

test("main Challans screen follows the approved two-column V2 presentation", () => {
  assert.match(challansScreen, /grid gap-atlas-6 xl:grid-cols-3/);
  assert.match(challansScreen, /xl:col-span-2/);
  assert.match(challansScreen, /xl:sticky xl:top-atlas-8/);
  assert.match(challansScreen, /<Card as="section" aria-label="Challan work area">/);
  assert.match(challansScreen, /<Card as="section" aria-labelledby="challan-history-heading">/);
  assert.match(challansScreen, /<FormField label="Search Challan No\.">[\s\S]*<Input/);
  assert.match(challansScreen, /isChallanHistoryRowSelected\([\s\S]*selectedChallanId,[\s\S]*challan\.id/);
  assert.match(challansScreen, /bg-atlas-primary-surface/);
  assert.match(challansScreen, /border-l-4[\s\S]*isSelected \? "border-l-atlas-primary" : "border-l-transparent"/);
  assert.match(challansScreen, /hover:bg-atlas-surface-hover/);
});

test("history uses canonical statuses, formatting, and honest async states", () => {
  assert.match(challansScreen, /<StatusBadge status=\{challan\.status\} isLocked=\{challan\.isLocked\}/);
  assert.match(salesSource, /resolveStatusPresentation\(CHALLAN_STATUS, status\)/);
  assert.match(salesSource, /resolveBooleanStatusPresentation\(CHALLAN_FINANCIAL_LOCK_STATUS, true\)/);
  assert.match(salesSource, /<StatusPill label=\{lifecycleStatus\.label\} tone=\{lifecycleStatus\.tone\}/);
  assert.match(challansScreen, /formatDateOnly\(challan\.challanDate\)/);
  assert.match(challansScreen, /formatIndianCurrency\(challan\.challanTotal\)/);
  assert.match(challansScreen, /challan\.customerAddressSnapshot/);
  assert.match(challansScreen, /Loading Challans/);
  assert.match(challansScreen, /Could not load Challans/);
  assert.match(challansScreen, /No Challans yet/);
  assert.match(challansScreen, /No matching Challans/);
  assert.doesNotMatch(challansScreen, />Refresh<\/Button>/);
  assert.match(challansScreen, /challansQuery\.error[\s\S]*challansQuery\.refetch\(\); \}\}>\{ATLAS_UI_STRINGS\.actions\.retry\}/);
});

test("main Challans screen delegates expansion without changing its compact history", () => {
  assert.match(challansScreen, /View all Challans/);
  assert.match(challansScreen, /<AllChallansExpandedView[\s\S]*challans=\{challans\}/);
  assert.doesNotMatch(challansScreen, /<AllChallansExpandedView[\s\S]*challans=\{compactChallans\}/);
  assert.doesNotMatch(challansScreen, /<TableHeaderCell>Challan \/ date<\/TableHeaderCell>/);
});

test("compact history keeps its expansion action in the heading row", () => {
  const headingIndex = challansScreen.indexOf('id="challan-history-heading"');
  const viewAllIndex = challansScreen.indexOf(
    '<Button variant="ghost" onClick={() => setChallansView("all")}>View all Challans</Button>',
  );
  const searchIndex = challansScreen.indexOf('<FormField label="Search Challan No.">');

  assert.ok(headingIndex >= 0);
  assert.ok(viewAllIndex > headingIndex);
  assert.ok(viewAllIndex < searchIndex);
  assert.equal((challansScreen.match(/>View all Challans<\/Button>/g) ?? []).length, 1);
  assert.match(
    challansScreen,
    /flex items-start justify-between gap-atlas-3[\s\S]*Operational history, newest first\.[\s\S]*View all Challans/,
  );
});

test("main Challans shell introduces no legacy palette or arbitrary visual values", () => {
  assert.doesNotMatch(
    challansScreen,
    /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i,
  );
  assert.doesNotMatch(
    challansScreen,
    /(?:p|m|gap|space-[xy]|rounded|shadow|grid-cols|max-h)-\[[^\]]+\]/,
  );
});
