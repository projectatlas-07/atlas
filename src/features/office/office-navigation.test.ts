import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  OFFICE_AREAS,
  resolveOfficeAreaFromHash,
} from "./office-navigation.ts";

const shell = readFileSync(
  new URL("./components/office-shell.tsx", import.meta.url),
  "utf8",
);

test("Office exposes exactly the eight approved top-level areas", () => {
  assert.deepEqual(OFFICE_AREAS, [
    { id: "dashboard", label: "Dashboard" },
    { id: "production", label: "Production" },
    { id: "workforce", label: "Workforce" },
    { id: "sales", label: "Sales" },
    { id: "purchases-expenses", label: "Purchases & Expenses" },
    { id: "cash-book", label: "Cash Book" },
    { id: "reports", label: "Reports" },
    { id: "settings", label: "Settings" },
  ]);

  for (const detailedModule of [
    "Soil Workers",
    "Chamber Transport",
    "Coal",
    "Fuel",
    "Maintenance",
    "Customer Dues",
    "Sales Register",
    "Vehicles",
    "Suppliers",
  ]) {
    assert.equal(OFFICE_AREAS.some((area) => area.label === detailedModule), false);
  }
});

test("Office area hashes are stable, safe, and retain the legacy Dashboard link", () => {
  for (const area of OFFICE_AREAS) {
    assert.equal(resolveOfficeAreaFromHash(`#${area.id}`), area.id);
  }
  assert.equal(resolveOfficeAreaFromHash("#office-dashboard-feature"), "dashboard");
  assert.equal(resolveOfficeAreaFromHash("#labour-wages"), "workforce");
  assert.equal(resolveOfficeAreaFromHash("#new-challan"), "sales");
  assert.equal(resolveOfficeAreaFromHash("#unknown"), "dashboard");
  assert.equal(resolveOfficeAreaFromHash(""), "dashboard");
});

test("desktop and mobile shells share one navigation source", () => {
  assert.match(shell, /OFFICE_AREAS\.map/);
  assert.match(shell, /fixed inset-y-0 left-0 hidden w-64[\s\S]*lg:flex/);
  assert.match(shell, /sticky top-0[\s\S]*lg:hidden/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /aria-controls="office-mobile-navigation"/);
  assert.match(shell, /event\.key !== "Escape"/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(shell, /querySelectorAll<HTMLElement>/);
  assert.match(shell, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(shell, /min-h-atlas-12/);
});

test("new shell presentation uses V2 tokens and shared actions", () => {
  assert.match(shell, /<Button/);
  assert.match(shell, /<LogoutButton v2 \/>/);
  assert.doesNotMatch(shell, /(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|indigo)-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(shell, /(?:insert|update|delete)\(|\.from\(|\.rpc\(/);
});
