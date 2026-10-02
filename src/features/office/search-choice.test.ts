import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const searchChoice = readFileSync(
  new URL("./components/search-choice.tsx", import.meta.url),
  "utf8",
);
const coal = readFileSync(
  new URL("./components/coal-purchase-office-section.tsx", import.meta.url),
  "utf8",
);
const maintenance = readFileSync(
  new URL("./components/vehicle-maintenance-office-section.tsx", import.meta.url),
  "utf8",
);
const fuel = readFileSync(
  new URL("./components/vehicle-fuel-office-section.tsx", import.meta.url),
  "utf8",
);

test("SearchChoice opens normally and dismisses only an outside pointer interaction", () => {
  assert.match(searchChoice, /onFocus=\{\(\) => setOpen\(true\)\}/);
  assert.match(searchChoice, /const rootRef = useRef<HTMLLabelElement>\(null\)/);
  assert.match(searchChoice, /<label ref=\{rootRef\}/);
  assert.match(searchChoice, /if \(!open\) return/);
  assert.match(searchChoice, /if \(rootRef\.current\?\.contains\(event\.target as Node\)\) return/);
  assert.match(searchChoice, /document\.addEventListener\("pointerdown", closeOnOutsidePointerDown, true\)/);
  assert.match(searchChoice, /document\.removeEventListener\("pointerdown", closeOnOutsidePointerDown, true\)/);

  const outsideHandler = searchChoice.slice(
    searchChoice.indexOf("function closeOnOutsidePointerDown"),
    searchChoice.indexOf("document.addEventListener"),
  );
  assert.match(outsideHandler, /setOpen\(false\)/);
  assert.doesNotMatch(outsideHandler, /onSelect|setSearch/);
});

test("inside interaction and option selection retain the existing combobox behaviour", () => {
  assert.match(searchChoice, /role="combobox"/);
  assert.match(searchChoice, /aria-controls=\{listboxId\}/);
  assert.match(searchChoice, /aria-expanded=\{open\}/);
  assert.match(searchChoice, /aria-autocomplete="list"/);
  assert.match(searchChoice, /role="listbox"/);
  assert.match(searchChoice, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(searchChoice, /onClick=\{\(\) => \{ onSelect\(option\.id\); setSearch\(""\); setOpen\(false\); \}\}/);
});

test("all affected Purchases and Expenses selectors use the shared SearchChoice boundary", () => {
  for (const label of ["Seller", "Coal", "Source", "Coal Seller"]) {
    assert.match(coal, new RegExp(`<SearchChoice v2 label="${label}"`));
  }
  assert.equal((coal.match(/<SearchChoice v2/g) ?? []).length, 4);

  for (const label of ["Vehicle", "Garage \/ mechanic", "Garage"]) {
    assert.match(maintenance, new RegExp(`<SearchChoice v2 label="${label}"`));
  }
  assert.equal((maintenance.match(/<SearchChoice v2/g) ?? []).length, 3);

  assert.match(fuel, /<SearchChoice v2 label="Vehicle"/);
  assert.equal((fuel.match(/<SearchChoice v2 label="Fuel Pump"/g) ?? []).length, 2);
  assert.equal((fuel.match(/<SearchChoice v2/g) ?? []).length, 3);
});
