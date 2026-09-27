import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const drawer = readFileSync(
  new URL("./components/staff-account-payment-drawer.tsx", import.meta.url),
  "utf8",
);
const officeSection = readFileSync(
  new URL("./components/staff-office-section.tsx", import.meta.url),
  "utf8",
);

test("Staff Account & payment opens as a focused responsive drawer", () => {
  assert.match(officeSection, /<StaffAccountPaymentDrawer/);
  assert.match(officeSection, /const \[accountWorkerId, setAccountWorkerId\]/);
  assert.match(officeSection, /onOpenAccount=\{openAccount\}/);
  assert.match(officeSection, /onManageWorker=\{openManagement\}/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("drawer uses only existing immutable Staff payment services and fields", () => {
  assert.match(drawer, /listStaffPayments\(\{/);
  assert.match(drawer, /recordStaffPayment\(input\)/);
  assert.match(drawer, /buildStaffPaymentInput\(\{/);
  assert.match(drawer, /paymentDate/);
  assert.match(drawer, /paymentAmount/);
  assert.match(drawer, /paymentNote/);
  assert.match(drawer, /insertStaffPaymentNewestFirst/);
  assert.doesNotMatch(drawer, /\.from\(|\.rpc\(/);
});

test("selected-period summary is derived only from real payment history", () => {
  for (const label of ["This week", "Last week", "This month", "Custom dates"]) {
    assert.match(drawer, new RegExp(label));
  }
  assert.match(drawer, /resolveWageEarningsDateRange/);
  assert.match(drawer, /sumStaffPaymentsInRange\(paymentsQuery\.data/);
  assert.match(drawer, /Paid in period/);
  assert.match(drawer, /Reference salary/);
  assert.match(drawer, /informational only and does not represent an automatic payable or accrued debt/);
  assert.doesNotMatch(drawer, /salary due|unpaid salary|accrued payroll|settlement balance|attendance/i);
});

test("payment form prevents duplicate submission and refreshes shared overview caches", () => {
  assert.match(drawer, /if \(isSubmitting\) return/);
  assert.match(drawer, /loading=\{isSubmitting\}/);
  assert.match(drawer, /inputMode="decimal"/);
  assert.match(drawer, /max=\{localToday\}/);
  assert.match(drawer, /staffPaymentSummaryQueryKey\(factoryId, worker\.id\)/);
  assert.match(drawer, /staffPaymentHistoryQueryKey\(factoryId, worker\.id\)/);
  assert.match(drawer, /queryClient\.setQueryData<StaffPaymentSummary>/);
  assert.match(drawer, /queryClient\.setQueryData<StaffPayment\[]>/);
});

test("archived Staff remain reviewable but cannot record payments", () => {
  assert.match(drawer, /This Staff member is archived/);
  assert.match(drawer, /disabled=\{isSubmitting \|\| !worker\.isActive\}/);
  assert.match(drawer, /disabled=\{!worker\.isActive\}/);
  assert.match(drawer, /View full payment history/);
  assert.match(drawer, /payment\.note/);
});

test("drawer follows Staff reference with Atlas V2 tokens and primitives", () => {
  for (const primitive of [
    "Button",
    "Card",
    "EmptyState",
    "Feedback",
    "FormField",
    "Input",
    "Select",
    "StatusPill",
    "TableContainer",
  ]) assert.match(drawer, new RegExp(`<${primitive}\\b`));
  assert.match(drawer, /Payment summary/);
  assert.match(drawer, /Record payment/);
  assert.match(drawer, /Recent payments/);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
});
