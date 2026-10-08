import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatIndianCurrency } from "../../lib/formatting.ts";

const screen = readFileSync(
  new URL("./components/customer-payments-section.tsx", import.meta.url),
  "utf8",
);

test("Customer Payments uses the approved V2 split workspace and shared primitives", () => {
  for (const primitive of ["Button", "Card", "Checkbox", "EmptyState", "Feedback", "FormField", "Input", "Select"]) {
    assert.match(screen, new RegExp(`\\b${primitive}\\b`));
  }
  assert.match(screen, /grid gap-atlas-6 xl:grid-cols-4 xl:items-start/);
  assert.match(screen, /space-y-atlas-4 xl:col-span-3/);
  assert.match(screen, /<aside className="xl:sticky xl:top-atlas-8">/);
  assert.match(screen, /Receipt parameters/);
  assert.match(screen, /Outstanding Challans/);
  assert.match(screen, /ATLAS_UI_STRINGS\.payment\.history/);
});

test("customer context and money continue to come from authoritative queries and helpers", () => {
  assert.match(screen, /getCustomerSalesSummary\(factoryId, customerId\)/);
  assert.match(screen, /listCustomerOutstandingChallans\([\s\S]*?duesDateFilter\.range \?\? undefined/);
  assert.match(screen, /listCustomerPayments\(factoryId, customerId\)/);
  assert.match(screen, /getCustomerPaymentFormStatus\(form, candidates\)/);
  assert.match(screen, /buildCustomerPaymentInput\(factoryId, customerId, form, candidates\)/);
  assert.match(screen, /saveCustomerPaymentAndRefresh\([\s\S]*input, createCustomerPaymentWithMethods,/);
  assert.match(screen, /formatIndianCurrency\(/);
  assert.match(screen, /formatDateOnly\(/);
  assert.match(screen, /formatIndianNumber\(/);
  assert.doesNotMatch(screen, /reduce\([\s\S]*?(?:outstanding|balance)/i);
});

test("customer selection is one accessible searchable combobox backed by customer IDs", () => {
  assert.match(
    screen,
    /<CustomerCombobox[\s\S]*customers=\{customers\}[\s\S]*selectedCustomerId=\{customerId\}[\s\S]*onSelect=\{selectCustomer\}/,
  );
  assert.match(screen, /role="combobox"/);
  assert.match(screen, /aria-autocomplete="list"/);
  assert.match(screen, /role="listbox"/);
  assert.match(screen, /role="option"/);
  assert.match(screen, /onFocus=\{openList\}/);
  assert.match(screen, /onClick=\{\(\) => selectCustomer\(customer\.id\)\}/);
  assert.match(screen, /onSelect\(customerId\)/);
  assert.match(screen, /value=\{isOpen \? searchText : selectedCustomer\?\.name \?\? ""\}/);
  assert.doesNotMatch(screen, /<Select value=\{customerId\}/);
});

test("customer searching does not change the selected customer until an option is chosen", () => {
  assert.match(
    screen,
    /onChange=\{\(event\) => \{\s*setSearchText\(event\.target\.value\);\s*setHighlightedIndex\(0\);\s*setIsOpen\(true\);\s*\}\}/,
  );
  assert.match(screen, /event\.key === "Escape"[\s\S]*setSearchText\(""\)[\s\S]*setIsOpen\(false\)/);
  assert.match(
    screen,
    /function selectCustomer\(nextCustomerId: string\) \{\s*setCustomerId\(nextCustomerId\);\s*setForm\(emptyCustomerPaymentForm\(localToday\)\);\s*setIsNoteOpen\(false\);\s*setError\(""\);\s*\}/,
  );
});

test("customer results remain touch-sized and contained on narrow screens", () => {
  assert.match(screen, /data-customer-combobox/);
  assert.match(screen, /max-h-64 w-full min-w-0 overflow-y-auto/);
  assert.match(screen, /flex min-h-atlas-12 w-full min-w-0 items-center/);
  assert.match(screen, /min-w-0 truncate font-atlas-semibold/);
  assert.match(screen, /shrink-0 text-atlas-xs tabular-nums/);
});

test("payment methods use one compact accessible multi-select without legacy options", () => {
  assert.match(screen, /<PaymentModeMultiSelect[\s\S]*selectedModes=\{form\.paymentModes\}/);
  assert.match(screen, /<div className="min-w-0 sm:col-span-2 lg:col-span-4">[\s\S]*<fieldset[\s\S]*aria-required="true"[\s\S]*className="min-w-0 flex-1"/);
  assert.match(screen, /NEW_CUSTOMER_PAYMENT_MODES\.map\(\(mode\)/);
  assert.match(screen, /aria-pressed=\{selected\}/);
  assert.match(screen, /variant=\{selected \? "primary" : "secondary"\}/);
  assert.match(screen, /toggleCustomerPaymentMode\(current, mode\)/);
  assert.doesNotMatch(screen, /value=\{form\.paymentMode\}/);
  assert.doesNotMatch(screen, /option[^>]+value="(?:multiple|unspecified)"/);
});

test("optional split fields stay hidden until two methods explicitly open them", () => {
  assert.match(screen, /splitAmounts=\{form\.paymentMethodAmounts\}/);
  assert.match(screen, /splitError=\{status\.methodSplitError\}/);
  assert.match(screen, /const \[isSplitMode, setIsSplitMode\] = useState\(false\)/);
  assert.match(screen, /selectedModes\.length >= 2 && \(/);
  assert.match(screen, /aria-expanded=\{isSplitMode\}/);
  assert.match(screen, /ATLAS_UI_STRINGS\.payment\.addSplit/);
  assert.match(screen, /isSplitMode && selectedModes\.length >= 2 && \(/);
  assert.match(screen, /selectedModes\.map\(\(mode\)/);
  assert.match(screen, /value=\{splitAmounts\[mode\] \?\? ""\}/);
  assert.match(screen, /setCustomerPaymentMethodAmount\(current, mode, amount\)/);
  assert.match(screen, /aria-invalid=\{Boolean\(splitError\)\}/);
  assert.match(screen, /id=\{splitErrorId\} role="alert"/);
  assert.doesNotMatch(screen, /infer(?:red)? remainder|remaining split/i);
});

test("Remove split clears amounts while compact chips keep the selected modes", () => {
  assert.match(screen, /ATLAS_UI_STRINGS\.payment\.removeSplit/);
  assert.match(screen, /onRemoveSplit\(\);\s*setIsSplitMode\(false\)/);
  assert.match(screen, /onRemoveSplit=\{\(\) => setForm\(\(current\) => clearCustomerPaymentMethodAmounts\(current\)\)\}/);
  assert.match(screen, /const next = toggleCustomerPaymentMode\(current, mode\);[\s\S]*next\.paymentModes\.length < 2[\s\S]*clearCustomerPaymentMethodAmounts\(next\)/);
  assert.match(screen, /flex flex-wrap items-center gap-atlas-1/);
  assert.match(screen, /sm:grid-cols-2 lg:grid-cols-6/);
  assert.match(screen, /grid gap-atlas-2 sm:grid-cols-2 lg:grid-cols-3/);
});

test("optional Note is collapsed by default without changing its form state", () => {
  assert.match(screen, /const \[isNoteOpen, setIsNoteOpen\] = useState\(false\)/);
  assert.match(screen, /aria-expanded=\{isNoteOpen\}/);
  assert.match(screen, /onClick=\{onToggleNote\}[\s\S]*ATLAS_UI_STRINGS\.fields\.note/);
  assert.match(screen, /onToggleNote=\{\(\) => setIsNoteOpen\(\(current\) => !current\)\}/);
  assert.match(screen, /\{isNoteOpen && \([\s\S]*ATLAS_UI_STRINGS\.fields\.noteOptional[\s\S]*value=\{form\.note\}/);
  assert.match(screen, /variant=\{isNoteOpen \|\| hasNote \? "secondary" : "ghost"\}/);
  assert.doesNotMatch(screen, /Reference \/ Note \(optional\)/);
  assert.doesNotMatch(screen, /Enter the saved receipt details before allocating the payment\./);
});

test("customer switching and successful save retain the existing full-form reset semantics", () => {
  assert.match(screen, /function selectCustomer\(nextCustomerId: string\)[\s\S]*setForm\(emptyCustomerPaymentForm\(localToday\)\);\s*setIsNoteOpen\(false\)/);
  assert.match(screen, /saveCustomerPaymentAndRefresh\([\s\S]*input, createCustomerPaymentWithMethods,[\s\S]*setForm\(emptyCustomerPaymentForm\(localToday\)\);\s*setIsNoteOpen\(false\)/);
});

test("standard payment save creates one multi-mode payment and resets the one form", () => {
  assert.equal((screen.match(/input, createCustomerPaymentWithMethods,/g) ?? []).length, 1);
  assert.doesNotMatch(screen, /createCustomerPayment\(input\)/);
  assert.match(screen, /saveCustomerPaymentAndRefresh\([\s\S]*setForm\(emptyCustomerPaymentForm\(localToday\)\)[\s\S]*onPaymentSaved,/);
  assert.match(screen, /formatCustomerPaymentMethods\(payment\.methods, payment\.paymentMode\)/);
});

test("allocation rows keep UUID identity, explicit selection, and the existing receipt route", () => {
  assert.match(screen, /key=\{challan\.challanId\}/);
  assert.match(screen, /form\.allocations, challan\.challanId/);
  assert.match(screen, /togglePaymentAllocation\(current, challan, event\.target\.checked\)/);
  assert.match(screen, /setPaymentAllocation\(current, challan\.challanId, event\.target\.value\)/);
  assert.match(screen, /Nothing is selected automatically\./);
  assert.match(screen, /history\.map\(\(payment\)/);
  assert.match(screen, /payment\.allocations\.map/);
  assert.match(screen, /\/office\/payments\/\$\{payment\.id\}/);
  assert.match(screen, /formatCustomerPaymentMethods\(payment\.methods, payment\.paymentMode\)/);
});

test("row body delegates UUID selection while nested controls keep their own handlers", () => {
  assert.match(screen, /onClick=\{\(event\) => \{\s*if \(isInteractivePaymentRowTarget\(event\.target\)\) return;/);
  assert.match(screen, /current\.allocations,\s*challan\.challanId/);
  assert.match(screen, /togglePaymentAllocation\(\s*current,\s*challan,\s*!isCurrentlySelected/);
  assert.match(screen, /target\.closest\([\s\S]*input[\s\S]*label[\s\S]*\[role='button'\]/);
  assert.match(screen, /cursor-pointer items-start gap-atlas-3/);

  assert.equal(
    (screen.match(/togglePaymentAllocation\(current, challan, event\.target\.checked\)/g) ?? []).length,
    1,
  );
  assert.match(screen, /setPaymentAllocation\(current, challan\.challanId, event\.target\.value\)/);
});

test("checkbox auto-allocation replaces the redundant row action", () => {
  assert.match(screen, /onChange=\{\(event\) => setForm\(\(current\) => togglePaymentAllocation\(current, challan, event\.target\.checked\)\)\}/);
  assert.match(screen, /value=\{form\.allocations\[challan\.challanId\] \?\? ""\}/);
  assert.match(screen, /onChange=\{\(event\) => setForm\(\(current\) => setPaymentAllocation\(current, challan\.challanId, event\.target\.value\)\)\}/);
  assert.doesNotMatch(screen, /Use outstanding|fillOutstandingAllocation/);
  assert.match(screen, /className="lg:col-span-6"/);
  assert.match(screen, /className="text-right lg:col-span-3"/);
  assert.match(screen, /className="lg:col-span-3"/);
});

test("due amounts use one right-aligned non-wrapping column at every row width", () => {
  assert.match(
    screen,
    /candidates\.map\(\(challan\)[\s\S]*className="text-right lg:col-span-3"[\s\S]*className="whitespace-nowrap font-atlas-semibold tabular-nums text-atlas-text"/,
  );
  assert.match(
    screen,
    /formatIndianCurrency\(challan\.outstandingAmount, MONEY_WITH_PAISE\)\} due/,
  );
  assert.doesNotMatch(
    screen,
    /formatIndianCurrency\(challan\.outstandingAmount, MONEY_WITH_PAISE\)[\s\S]{0,80}(?:truncate|overflow-hidden)/,
  );

  for (const [amount, expected] of [
    [2_000, "₹2,000.00"],
    [15_000, "₹15,000.00"],
    [96_000, "₹96,000.00"],
    [125_000, "₹1,25,000.00"],
  ] as const) {
    assert.equal(formatIndianCurrency(amount, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }), expected);
  }
});

test("selected rows, responsive stacking, and all real async states use V2 tokens", () => {
  assert.match(screen, /border-l-atlas-primary bg-atlas-primary-surface/);
  assert.match(screen, /hover:bg-atlas-surface-hover/);
  assert.match(screen, /sm:grid-cols-2 lg:grid-cols-6/);
  assert.match(screen, /lg:grid-cols-12 lg:items-end/);
  assert.match(screen, /Loading customer balances/);
  assert.match(screen, /Loading outstanding Challans/);
  assert.match(screen, /No outstanding Challans/);
  assert.match(screen, /role="alert" tone="danger"/);
  assert.match(screen, /role="status" tone="success"/);
  assert.doesNotMatch(
    screen,
    /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i,
  );
  assert.doesNotMatch(
    screen,
    /(?:p|m|gap|space-[xy]|rounded|shadow|grid-cols|max-h)-\[[^\]]+\]/,
  );
});

test("every UUID-selected Challan isolates its green indicator from row dividers", () => {
  assert.match(
    screen,
    /<ul className="divide-y divide-atlas-border">[\s\S]*const selected = Object\.prototype\.hasOwnProperty\.call\(form\.allocations, challan\.challanId\)/,
  );
  assert.match(
    screen,
    /<li key=\{challan\.challanId\}>\s*<div[\s\S]*className=\{`flex cursor-pointer items-start gap-atlas-3 border-l-4 p-atlas-4 transition-colors \$\{selected \? "border-l-atlas-primary bg-atlas-primary-surface" : "border-l-transparent bg-atlas-surface hover:bg-atlas-surface-hover"\}`\}/,
  );
  assert.doesNotMatch(screen, /<li key=\{challan\.challanId\} className=\{selected/);
});

test("one sticky payment footer uses the authoritative form state and submit handler", () => {
  assert.equal((screen.match(/<form onSubmit=\{savePayment\}/g) ?? []).length, 1);
  assert.equal((screen.match(/<PaymentReconciliation\b/g) ?? []).length, 1);
  assert.match(screen, /<PaymentReconciliation status=\{status\} isSaving=\{isSaving\} \/>/);
  assert.match(screen, /<MoneyTotal label="Payment" value=\{status\.paymentAmount\}/);
  assert.match(screen, /<MoneyTotal label="Allocated" value=\{status\.allocatedAmount\}/);
  assert.match(screen, /<MoneyTotal label="Remaining" value=\{status\.remainingAmount\}/);
  assert.match(screen, /type="submit" disabled=\{!status\.canSubmit\} loading=\{isSaving\}/);
  assert.equal((screen.match(/>Save payment<\/Button>/g) ?? []).length, 1);
  assert.equal((screen.match(/input, createCustomerPaymentWithMethods,/g) ?? []).length, 1);
});

test("the single footer follows Challan rows and sticks to the workspace bottom", () => {
  const challanRows = screen.indexOf("candidates.map((challan)");
  const footer = screen.indexOf(
    '<PaymentReconciliation status={status} isSaving={isSaving} />',
  );

  assert.ok(challanRows >= 0);
  assert.ok(footer > challanRows);
  assert.match(screen, /sticky bottom-atlas-0 z-20[\s\S]*border-t border-atlas-border-strong bg-atlas-surface/);
  assert.doesNotMatch(screen, /top-atlas-16|lg:top-atlas-0|sticky\s*\?/);
  assert.match(screen, /className="grid sm:block"/);
});

test("Customer Payments exposes the completed All Payments entry without a new payment lifecycle", () => {
  assert.match(screen, /onClick=\{onViewAll\}>View all payments/);
  assert.doesNotMatch(screen, /Paid customer|Unpaid customer|payment status/i);
  assert.doesNotMatch(screen, /Edit payment|Delete payment|Reverse payment/i);
});

test("Payment History owns the single compact All Payments action without descriptive copy", () => {
  const mainHeadingIndex = screen.indexOf('id="customer-payments-heading"');
  const historyHeadingIndex = screen.indexOf('id="customer-payment-history-heading"');
  const viewAllIndex = screen.indexOf(
    '<Button variant="ghost" onClick={onViewAll}>View all payments</Button>',
  );

  assert.ok(mainHeadingIndex >= 0);
  assert.ok(historyHeadingIndex > mainHeadingIndex);
  assert.ok(viewAllIndex > historyHeadingIndex);
  assert.equal((screen.match(/>View all payments<\/Button>/g) ?? []).length, 1);
  assert.match(
    screen,
    /flex flex-wrap items-start justify-between gap-atlas-3 border-b border-atlas-border pb-atlas-4[\s\S]*customer-payment-history-heading[\s\S]*onClick=\{onViewAll\}>View all payments/,
  );
  assert.doesNotMatch(screen, /Saved receipts and allocations for|Saved receipts and allocations are permanent/);
});
