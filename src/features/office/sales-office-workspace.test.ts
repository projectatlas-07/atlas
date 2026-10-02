import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("./components/sales-office-workspace.tsx", import.meta.url),
  "utf8",
);
const sales = readFileSync(
  new URL("./components/sales-office-section.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);

test("Sales exposes only the three existing working areas through one local navigation", () => {
  for (const [id, label] of [
    ["challans", "Challans"],
    ["customer-payments", "Customer Payments"],
    ["sales-register", "Sales Register"],
  ]) {
    assert.match(workspace, new RegExp(`id: "${id}", label: "${label}"`));
  }
  assert.match(workspace, /aria-label="Sales areas"/);
  assert.match(workspace, /aria-pressed=\{activeArea === area\.id\}/);
  assert.match(workspace, /activeArea === area\.id \? "primary" : "ghost"/);
});

test("Sales removes repeated workspace headings and starts with its navigation", () => {
  assert.doesNotMatch(workspace, /Orders, receipts and records/i);
  assert.doesNotMatch(workspace, /Sales workspace/);
  assert.doesNotMatch(workspace, /Create and review Challans/);
  assert.doesNotMatch(workspace, /<header/);
  assert.match(workspace, /<div className="space-y-atlas-4">\s*<nav aria-label="Sales areas"/);
  assert.match(
    shell,
    /activeArea !== "sales" && activeArea !== "workforce" && activeArea !== "production" && activeArea !== "purchases-expenses" && activeArea !== "cash-book" && \([\s\S]*Office workspace[\s\S]*\{activeAreaLabel\}/,
  );
});

test("existing Sales screens stay mounted once and switch through the workspace", () => {
  assert.equal((sales.match(/<SalesOfficeWorkspace\b/g) ?? []).length, 1);
  assert.equal((sales.match(/<CustomerPaymentsSection\b/g) ?? []).length, 1);
  assert.equal((sales.match(/<SalesRegisterSection\b/g) ?? []).length, 1);
  assert.match(sales, /useState<SalesWorkspaceArea>\("challans"\)/);
  assert.match(sales, /hidden=\{salesArea !== "challans"\}/);
  assert.match(sales, /hidden=\{salesArea !== "customer-payments"\}[\s\S]*<CustomerPaymentsSection/);
  assert.match(sales, /hidden=\{salesArea !== "sales-register"\}[\s\S]*<SalesRegisterSection/);
});

test("the legacy new-Challan hash returns to the Challans workspace", () => {
  assert.match(sales, /navigationTarget !== "new-challan"/);
  assert.match(sales, /setSalesArea\("challans"\)/);
  assert.match(sales, /setMode\("create"\)/);
  assert.match(sales, /setSelectedChallanId\(""\)/);
});

test("workspace navigation uses V2 primitives, tokens, and responsive overflow", () => {
  assert.match(workspace, /<Button/);
  assert.match(workspace, /overflow-x-auto/);
  assert.match(workspace, /min-w-max/);
  assert.doesNotMatch(
    workspace,
    /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i,
  );
  assert.doesNotMatch(workspace, /(?:p|m|gap|space-[xy]|rounded|shadow)-\[[^\]]+\]/);
  assert.doesNotMatch(workspace, /supabase|\.from\(|\.rpc\(|createChallan|createCustomerPayment/);
});
