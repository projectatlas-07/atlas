import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Checkbox, Input, Select } from "./form-controls.ts";

function classNamesFromMarkup(markup: string) {
  const classAttribute = /class="([^"]+)"/.exec(markup)?.[1];
  assert.ok(classAttribute, "control must have a class attribute");
  return new Set(classAttribute.split(/\s+/));
}

test("Input and Select render the normal native control contract", () => {
  const inputHtml = renderToStaticMarkup(
    createElement(Input, { id: "name", name: "name" }),
  );
  const selectHtml = renderToStaticMarkup(
    createElement(
      Select,
      { id: "mode", name: "mode", defaultValue: "cash" },
      createElement("option", { value: "cash" }, "Cash"),
      createElement("option", { value: "bank" }, "Bank transfer"),
    ),
  );

  assert.match(inputHtml, /^<input [^>]+\/>$/);
  assert.match(inputHtml, / id="name"/);
  assert.match(inputHtml, / name="name"/);
  assert.match(inputHtml, / type="text"/);
  assert.match(
    selectHtml,
    /^<select [^>]+><option value="cash" selected="">Cash<\/option><option value="bank">Bank transfer<\/option><\/select>$/,
  );
  assert.match(selectHtml, / id="mode"/);
  assert.match(selectHtml, / name="mode"/);

  for (const html of [inputHtml, selectHtml]) {
    const classNames = classNamesFromMarkup(html);
    for (const className of [
      "min-h-atlas-12",
      "rounded-atlas-control",
      "border-atlas-border-strong",
      "bg-atlas-surface",
      "px-atlas-3",
      "py-atlas-2",
      "text-atlas-base",
      "font-atlas-regular",
      "text-atlas-text",
      "hover:border-atlas-primary-border",
    ]) {
      assert.ok(classNames.has(className), `control must use ${className}`);
    }
  }
});

test("both controls use the shared focus-visible treatment", () => {
  for (const html of [
    renderToStaticMarkup(createElement(Input)),
    renderToStaticMarkup(
      createElement(Select, null, createElement("option", null, "Choose")),
    ),
  ]) {
    const classNames = classNamesFromMarkup(html);
    for (const className of [
      "focus-visible:outline-none",
      "focus-visible:ring-atlas-focus",
      "focus-visible:ring-offset-atlas-focus",
    ]) {
      assert.ok(classNames.has(className), `control must use ${className}`);
    }
  }
});

test("disabled Input and Select preserve native disabled semantics", () => {
  for (const html of [
    renderToStaticMarkup(createElement(Input, { disabled: true })),
    renderToStaticMarkup(
      createElement(
        Select,
        { disabled: true },
        createElement("option", null, "Unavailable"),
      ),
    ),
  ]) {
    const classNames = classNamesFromMarkup(html);
    assert.match(html, / disabled=""/);
    for (const className of [
      "cursor-not-allowed",
      "border-atlas-border",
      "bg-atlas-surface-disabled",
      "text-atlas-text-disabled",
    ]) {
      assert.ok(classNames.has(className), `disabled control must use ${className}`);
    }
    assert.ok(!classNames.has("hover:border-atlas-primary-border"));
  }
});

test("read-only Input remains focusable and visually distinct", () => {
  const html = renderToStaticMarkup(
    createElement(Input, { readOnly: true, value: "Locked value" }),
  );
  const classNames = classNamesFromMarkup(html);

  assert.match(html, / readOnly=""/);
  assert.doesNotMatch(html, / disabled=""/);
  for (const className of [
    "cursor-default",
    "bg-atlas-surface-muted",
    "text-atlas-text-muted",
    "focus-visible:ring-atlas-focus",
  ]) {
    assert.ok(classNames.has(className), `read-only Input must use ${className}`);
  }
});

test("ARIA-invalid controls use danger tokens and retain error references", () => {
  for (const html of [
    renderToStaticMarkup(
      createElement(Input, {
        "aria-invalid": true,
        "aria-describedby": "amount-error",
      }),
    ),
    renderToStaticMarkup(
      createElement(
        Select,
        {
          "aria-invalid": true,
          "aria-describedby": "mode-error",
        },
        createElement("option", null, "Choose"),
      ),
    ),
  ]) {
    const classNames = classNamesFromMarkup(html);
    assert.match(html, / aria-invalid="true"/);
    assert.match(html, / aria-describedby="[^"]+-error"/);
    assert.ok(classNames.has("border-atlas-danger"));
    assert.ok(classNames.has("bg-atlas-danger-surface"));
    assert.ok(!classNames.has("hover:border-atlas-primary-border"));
  }
});

test("Input preserves mobile keyboard, type, and autocomplete attributes", () => {
  const decimalHtml = renderToStaticMarkup(
    createElement(Input, {
      type: "text",
      inputMode: "decimal",
      autoComplete: "off",
      name: "amount",
    }),
  );
  const telephoneHtml = renderToStaticMarkup(
    createElement(Input, {
      type: "tel",
      inputMode: "tel",
      autoComplete: "tel",
    }),
  );
  const numericHtml = renderToStaticMarkup(
    createElement(Input, { type: "text", inputMode: "numeric" }),
  );
  const dateHtml = renderToStaticMarkup(createElement(Input, { type: "date" }));
  const timeHtml = renderToStaticMarkup(createElement(Input, { type: "time" }));

  assert.match(decimalHtml, / inputMode="decimal"/);
  assert.match(decimalHtml, / autoComplete="off"/);
  assert.match(decimalHtml, / type="text"/);
  assert.doesNotMatch(decimalHtml, / type="number"/);
  assert.match(telephoneHtml, / type="tel"/);
  assert.match(telephoneHtml, / inputMode="tel"/);
  assert.match(telephoneHtml, / autoComplete="tel"/);
  assert.match(numericHtml, / type="text"/);
  assert.match(numericHtml, / inputMode="numeric"/);
  assert.match(dateHtml, / type="date"/);
  assert.match(timeHtml, / type="time"/);
});

test("Checkbox preserves native selection semantics with Atlas focus tokens", () => {
  const html = renderToStaticMarkup(
    createElement(Checkbox, {
      name: "workers",
      value: "worker-1",
      defaultChecked: true,
      "aria-label": "Select worker",
    }),
  );
  const classNames = classNamesFromMarkup(html);

  assert.match(html, / type="checkbox"/);
  assert.match(html, / checked=""/);
  assert.match(html, / aria-label="Select worker"/);
  for (const className of [
    "h-atlas-5",
    "w-atlas-5",
    "accent-atlas-primary",
    "focus-visible:ring-atlas-focus",
  ]) {
    assert.ok(classNames.has(className), `Checkbox must use ${className}`);
  }
});

test("the primitives use token styling and contain no value or domain logic", () => {
  const source = readFileSync(
    new URL("./form-controls.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
  );
  assert.doesNotMatch(
    source,
    /(?:challan|wage|payment|customer|coal|fuel|maintenance|parseFloat|parseInt|Number\()/i,
  );
  assert.doesNotMatch(source, /@\/features\/|@\/lib\/(?:formatting|statuses|strings)/);
  assert.doesNotMatch(source, /role:\s*["']combobox|aria-autocomplete|role:\s*["']listbox/);
});
