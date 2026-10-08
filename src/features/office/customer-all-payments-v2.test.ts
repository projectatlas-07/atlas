import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const expanded = readFileSync(
  new URL("./components/all-customer-payments-expanded-view.tsx", import.meta.url),
  "utf8",
);
const main = readFileSync(
  new URL("./components/customer-payments-section.tsx", import.meta.url),
  "utf8",
);
const sales = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const model = readFileSync(
  new URL("./customer-payment-office-model.ts", import.meta.url),
  "utf8",
);
const drawer = readFileSync(
  new URL("./components/customer-payment-detail-drawer.tsx", import.meta.url),
  "utf8",
);

test("Customer Payments opens and returns from one mounted All Payments view", () => {
  assert.match(main, /onClick=\{onViewAll\}>View all payments/);
  assert.match(sales, /useState<CustomerPaymentsWorkspaceView>\("main"\)/);
  assert.equal((sales.match(/<AllCustomerPaymentsExpandedView\b/g) ?? []).length, 1);
  assert.match(sales, /hidden=\{customerPaymentsView !== "main"\}/);
  assert.match(sales, /hidden=\{customerPaymentsView !== "all"\}/);
  assert.match(expanded, /← Back to Customer Payments/);
  assert.match(sales, /onBack=\{\(\) => showCustomerPaymentsView\("main"\)\}/);
  assert.match(model, /refreshCustomerPaymentQueries[\s\S]*office-factory-customer-payments/);
  assert.match(sales, /receivedNowAmount > 0[\s\S]*office-factory-customer-payments/);
});

test("All Payments reads the complete authoritative factory-wide payment model", () => {
  assert.match(expanded, /queryFn: \(\) => listFactoryCustomerPayments\(factoryId\)/);
  assert.match(expanded, /enabled: isActive/);
  assert.match(expanded, /const paymentsCurrent = isCustomerPaymentReadCurrent/);
  assert.match(expanded, /const payments = paymentsCurrent \? paymentsQuery\.data \?\? \[\] : \[\]/);
  assert.match(expanded, /getQueryState\(factoryPaymentsKey\(factoryId\)\)\?\.isInvalidated/);
  assert.doesNotMatch(expanded, /\blistCustomerPayments\b|supabase|\.from\(|\.rpc\(|\bfetch\(/);
  for (const value of [
    "payment.customerNameSnapshot",
    "payment.paymentDate",
    "payment.paymentMode",
    "payment.methods",
    "payment.amount",
    "payment.note",
    "payment.allocations",
  ]) assert.ok(expanded.includes(value));
});

test("All Payments filters only real payment fields and defaults to authoritative newest-first", () => {
  assert.match(expanded, /useState<CustomerPaymentHistorySort>\("newest"\)/);
  assert.match(expanded, /useState<CustomerDuesDatePreset>\("all"\)/);
  assert.match(model, /filterCustomerPaymentsForExpandedView/);
  assert.match(model, /payment\.customerNameSnapshot/);
  assert.match(model, /payment\.paymentDate < dateFilter\.range\.fromDate/);
  assert.match(model, /right\.paymentDate\.localeCompare\(left\.paymentDate\)/);
  assert.match(model, /right\.createdAt\.localeCompare\(left\.createdAt\)/);
  assert.match(model, /right\.id\.localeCompare\(left\.id\)/);
  for (const label of ["All time", "Today", "Yesterday", "This Week", "This Month", "Custom"]) {
    assert.ok(expanded.includes(`label: "${label}"`));
  }
});

test("desktop rows and mobile cards preserve UUID receipt identity and allocation context", () => {
  assert.match(expanded, /className="hidden md:block"/);
  assert.match(expanded, /className="space-y-atlas-3 md:hidden"/);
  assert.match(expanded, /<TableHeader sticky>/);
  assert.match(expanded, /<TableRow hoverable selected=\{selected\}>/);
  assert.match(expanded, /key=\{payment\.id\}/);
  assert.match(expanded, /href=\{`\/office\/payments\/\$\{paymentId\}`\}/);
  assert.match(expanded, /formatChallanLabel\(allocation\.challanNumber\)/);
  assert.match(expanded, /formatIndianCurrency\(allocation\.allocatedAmount/);
  assert.match(expanded, /payment\.allocations\.length/);
  assert.match(expanded, /selected=\{payment\.id === selectedPaymentId\}/);
  assert.match(expanded, /setSelectedPaymentId\(payment\.id\)/);
  assert.equal(
    (expanded.match(/formatCustomerPaymentMethods\(payment\.methods, payment\.paymentMode\)/g) ?? []).length,
    2,
  );
});

test("All Payments opens one loaded payment in a focused responsive detail drawer", () => {
  assert.match(expanded, /const \[selectedPaymentId, setSelectedPaymentId\] = useState<string \| null>\(null\)/);
  assert.match(expanded, /payments\.find\(\(payment\) => payment\.id === selectedPaymentId\)/);
  assert.match(expanded, /<CustomerPaymentDetailDrawer/);
  assert.match(expanded, /payment=\{selectedPayment\}/);
  assert.match(expanded, /onClose=\{\(\) => setSelectedPaymentId\(null\)\}/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /absolute inset-y-0 right-0/);
  assert.match(drawer, /w-full[\s\S]*sm:max-w-md/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /previouslyFocused\?\.focus\(\)/);
});

test("payment drawer uses immutable snapshots and UUID-safe allocation links without another read", () => {
  for (const value of [
    "payment.customerNameSnapshot",
    "payment.customerAddressSnapshot",
    "payment.customerMobileSnapshot",
    "payment.paymentDate",
    "payment.paymentMode",
    "payment.methods",
    "payment.amount",
    "payment.note",
    "payment.allocations",
  ]) assert.ok(drawer.includes(value));
  assert.match(drawer, /key=\{allocation\.id\}/);
  assert.match(drawer, /href=\{`\/office\/challans\/\$\{allocation\.challanId\}`\}/);
  assert.match(drawer, /formatChallanLabel\(allocation\.challanNumber\)/);
  assert.match(drawer, /formatDateOnly\(allocation\.challanDate\)/);
  assert.match(drawer, /formatIndianCurrency\(allocation\.allocatedAmount/);
  assert.match(drawer, /href=\{`\/office\/payments\/\$\{payment\.id\}`\}/);
  assert.doesNotMatch(drawer, /getCustomerPayment|useQuery|listFactoryCustomerPayments|\.from\(|\.rpc\(/);
  assert.match(drawer, /formatCustomerPaymentMethods\(payment\.methods, payment\.paymentMode\)/);
});

test("payment drawer follows the approved hierarchy but omits unsupported financial semantics", () => {
  for (const label of ["Payment receipt", "Amount received", "Customer", "Allocated Challans", "Open receipt", "Open Challan"]) {
    assert.ok(drawer.includes(label), `${label} remains visible`);
  }
  assert.match(drawer, /ATLAS_UI_STRINGS\.payment\.mode/);
  for (const primitive of ["Button", "Card"]) assert.match(drawer, new RegExp(`<${primitive}\\b`));
  assert.doesNotMatch(drawer, /receipt[- ]?(?:number|no\.)|REC-|remaining|settled|total allocated|balance|\bPaid\b|\bUnpaid\b|\bedit\b|\bdelete\b/i);
  assert.doesNotMatch(drawer, /Plus Jakarta|font-family|#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-/i);
  assert.doesNotMatch(drawer, /(?:p|m|gap|space-[xy]|rounded|shadow|max-h|min-w)-\[[^\]]+\]/);
});

test("All Payments has complete states and omits unsupported reference concepts", () => {
  assert.match(expanded, /Loading customer payments/);
  assert.match(expanded, /No customer payments yet/);
  assert.match(expanded, /No matching payments/);
  assert.match(expanded, /Could not load customer payments/);
  assert.doesNotMatch(expanded, /receipt[- ]?(?:number|no\.)|REC-|Paid customer|Unpaid customer|CSV Export|Ledger Synchronized|Document Vault/i);
  assert.doesNotMatch(expanded, /pagination|pageSize|load more/i);
});

test("All Payments uses V2 primitives and tokens without redesigning other Sales screens", () => {
  for (const primitive of ["Button", "Card", "EmptyState", "Feedback", "Input", "Select", "FormField", "TableContainer"]) {
    assert.match(expanded, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(
    expanded,
    /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i,
  );
  assert.doesNotMatch(expanded, /(?:p|m|gap|space-[xy]|rounded|shadow|max-h|min-w)-\[[^\]]+\]/);
  assert.doesNotMatch(expanded, /createCustomerPayment|CustomerSalesSummary|SalesRegister|ChallanEditor/);
});
