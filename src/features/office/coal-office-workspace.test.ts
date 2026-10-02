import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/coal-office-workspace.tsx", import.meta.url),
  "utf8",
);
const coal = readFileSync(
  new URL("./components/coal-purchase-office-section.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./office-navigation.ts", import.meta.url),
  "utf8",
);

test("Coal exposes exactly its two approved operational areas", () => {
  assert.match(workspace, /OFFICE_COAL_AREAS\.map/);
  assert.match(navigation, /id: "coal-purchases", label: "Coal Purchases"/);
  assert.match(navigation, /id: "seller-payments", label: "Seller Payments"/);
  assert.match(workspace, /aria-label="Coal areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
});

test("Coal Purchases is the default and only the selected Coal area is visible", () => {
  assert.match(coal, /useState<OfficeCoalAreaId>\("coal-purchases"\)/);
  assert.match(coal, /activeArea === "coal-purchases" && !showPurchaseArchive && <>/);
  assert.doesNotMatch(coal, /showForm|setShowForm/);
  assert.match(coal, /<form onSubmit=\{savePurchase\}>/);
  assert.match(coal, /Recent Coal Purchases/);
  assert.match(coal, /activeArea === "seller-payments" && !showPaymentArchive && <>/);
  assert.doesNotMatch(coal, /\[showPayment, setShowPayment\]/);
  assert.match(coal, /Recent Seller Payments/);
  assert.match(coal, /selected && !editingId && <CoalPurchaseDetail/);
});

test("Coal sub-view refresh and browser history reuse the Office hash router", () => {
  assert.match(coal, /resolveOfficeCoalAreaFromHash\(window\.location\.hash\)/);
  assert.match(coal, /window\.addEventListener\("hashchange", syncCoalAreaFromHash\)/);
  assert.match(coal, /window\.removeEventListener\("hashchange", syncCoalAreaFromHash\)/);
  assert.match(coal, /window\.location\.hash = getOfficeCoalHash\(area\)/);
  assert.match(coal, /<CoalOfficeWorkspace activeArea=\{activeArea\} onAreaChange=\{selectCoalArea\}>/);
  assert.match(coal, /setPaymentForm\(next\);[\s\S]*selectCoalArea\("seller-payments"\)/);
});

test("existing purchase and seller payment state stays in one authoritative component", () => {
  assert.equal((coal.match(/useQueryClient\(\)/g) ?? []).length, 1);
  assert.equal((coal.match(/listCoalPurchases\(factoryId\)/g) ?? []).length, 1);
  assert.equal((coal.match(/listCoalPayments\(factoryId\)/g) ?? []).length, 1);
  assert.match(coal, /buildCreateCoalPurchaseInput/);
  assert.match(coal, /buildCoalSelectivePaymentInput/);
  assert.match(coal, /createCoalSelectivePayment/);
  assert.match(coal, /toggleCoalSettlementPurchase/);
  assert.match(coal, /\["office-cash-book-day", factoryId\]/);
});

test("contextual navigation is compact, token-based, and horizontally scrollable", () => {
  assert.match(workspace, /<Button/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /flex min-w-max gap-atlas-2/);
  assert.doesNotMatch(workspace, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|payment|allocation|Cash Book/i);
});
