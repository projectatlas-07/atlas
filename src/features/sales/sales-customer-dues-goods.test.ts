import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const office = readFileSync(
  new URL("../office/components/customer-payments-section.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("./services/customer-payment-service.ts", import.meta.url),
  "utf8",
);

test("dues entry renders every saved brick particulars snapshot and formatted quantity", () => {
  assert.match(office, /challan\.brickLines\.map/);
  assert.match(office, /line\.particularsSnapshot/);
  assert.match(office, /line\.quantity\.toLocaleString\("en-IN"\)/);
  assert.doesNotMatch(office, /brickType|brickTypes|current.*particular/i);
});

test("dues entry shows the current outstanding as due and removes payment-state labels", () => {
  assert.match(office, /formatSalesMoney\(challan\.outstandingAmount\)\} due/);
  assert.match(office, /Original \{formatSalesMoney\(challan\.saleTotal\)\} · Paid/);
  assert.doesNotMatch(office, /customerPaymentStateLabel|\{challan\.paymentState\}/);
  assert.doesNotMatch(office, />Unpaid</);
});

test("manual Challan number is conditional and NULL has no fabricated fallback", () => {
  const identityBlock = office.match(
    /<p className="text-xs text-slate-500">\{formatChallanDate[\s\S]*?No brick goods on this Challan\.<\/p>\}/,
  )?.[0] ?? "";
  assert.ok(identityBlock);
  assert.match(office, /\{challan\.challanNumber && <p[^>]*>Challan No\. \{challan\.challanNumber\}<\/p>\}/);
  assert.doesNotMatch(identityBlock, /N\/A|challan\.challanId|UUID|#\{.*challan/);
});

test("goods use one batched item query with the same factory and candidate IDs", () => {
  const outstandingFunction = service.match(
    /export async function listCustomerOutstandingChallans\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(outstandingFunction);
  assert.match(outstandingFunction, /\.from\("challan_items"\)/);
  assert.match(outstandingFunction, /\.eq\("factory_id", factoryId\)/);
  assert.match(outstandingFunction, /\.in\("challan_id", challanIds\)/);
  assert.equal((outstandingFunction.match(/\.from\("challan_items"\)/g) ?? []).length, 1);
  assert.match(outstandingFunction, /getChallanPaymentState\(factoryId, row\.id\)/);
});

test("goods summary does not read NOTE or EXTRA_CHARGE as brick quantities", () => {
  assert.doesNotMatch(office, /flexibleLines|EXTRA_CHARGE|NOTE/);
  assert.match(service, /brick_particulars_snapshot, quantity, line_position/);
  assert.match(service, /state\.outstandingAmount <= 0/);
});

test("fresh Customer Dues defaults to All plus Newest first without persistence", () => {
  assert.match(office, /useState<CustomerDuesDatePreset>\("all"\)/);
  assert.match(office, /useState<CustomerDuesSortOrder>\("newest"\)/);
  assert.match(office, /<option value="newest">Newest first<\/option>/);
  assert.match(office, /<option value="oldest">Oldest first<\/option>/);
  assert.match(office, /sortCustomerOutstandingChallans\([\s\S]*?duesSortOrder/);
  assert.doesNotMatch(office, /localStorage|sessionStorage/);
});

test("brick particulars, dash, and quantity form one compact visual pair", () => {
  const goodsLine = office.match(/<li key=\{line\.itemId\}[\s\S]*?<\/li>/)?.[0] ?? "";
  assert.ok(goodsLine);
  assert.match(goodsLine, /w-fit max-w-full/);
  assert.match(goodsLine, /line\.particularsSnapshot[\s\S]*?—[\s\S]*?line\.quantity\.toLocaleString/);
  assert.doesNotMatch(goodsLine, /justify-between/);
});

test("Customer Dues exposes only the six requested date filters and Custom inputs", () => {
  for (const [value, label] of [
    ["all", "All"],
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["week", "This Week"],
    ["month", "This Month"],
    ["custom", "Custom"],
  ]) {
    assert.match(office, new RegExp(`value: "${value}", label: "${label}"`));
  }
  assert.match(office, /aria-label="Customer Dues date filters"/);
  assert.match(office, /duesDatePreset === "custom"[\s\S]*?type="date"[\s\S]*?type="date"/);
  assert.doesNotMatch(office, /Last 7|Last 30|Quarter|Financial Year/i);
});

test("date range reaches only the candidate query while totals and saved history stay all-time", () => {
  assert.match(office, /candidatesKey\(factoryId, customerId\)[\s\S]*?duesDatePreset[\s\S]*?duesDateFilter\.range\?\.fromDate[\s\S]*?duesDateFilter\.range\?\.toDate/);
  assert.match(office, /listCustomerOutstandingChallans\([\s\S]*?duesDateFilter\.range \?\? undefined/);
  assert.match(service, /\.gte\("challan_date", dateRange\.fromDate\)[\s\S]*?\.lte\("challan_date", dateRange\.toDate\)/);
  assert.doesNotMatch(service, /\.gte\("created_at"|\.lte\("created_at"/);
  assert.match(office, /getCustomerSalesSummary\(factoryId, customerId\)/);
  assert.match(office, /listCustomerPayments\(factoryId, customerId\)/);
});

test("date changes clear draft allocations and invalid or empty filtered ranges are explicit", () => {
  assert.match(office, /setForm\(\(current\) => clearCustomerPaymentAllocations\(current\)\)/);
  assert.match(office, /changeDuesDatePreset[\s\S]*?clearDraftAllocations\(\)/);
  assert.match(office, /changeCustomFrom[\s\S]*?clearDraftAllocations\(\)/);
  assert.match(office, /changeCustomTo[\s\S]*?clearDraftAllocations\(\)/);
  assert.match(office, /duesDateFilter\.error && <p role="alert"/);
  assert.match(office, /No outstanding Challans in this date range\./);
});
