import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BUTTON_VARIANTS,
  Button,
  type ButtonVariant,
} from "./button.ts";

const EXPECTED_VARIANT_CLASSES = {
  primary: [
    "border-atlas-primary",
    "bg-atlas-primary",
    "text-atlas-primary-foreground",
    "hover:bg-atlas-primary-hover",
  ],
  secondary: [
    "border-atlas-border-strong",
    "bg-atlas-surface",
    "text-atlas-text",
    "hover:bg-atlas-surface-hover",
  ],
  ghost: [
    "border-transparent",
    "bg-transparent",
    "text-atlas-text",
    "hover:bg-atlas-surface-hover",
  ],
  danger: [
    "border-atlas-danger-border",
    "bg-atlas-danger-surface",
    "text-atlas-danger-text",
    "hover:border-atlas-danger",
  ],
} as const satisfies Record<ButtonVariant, readonly string[]>;

function classNamesFromMarkup(markup: string) {
  const classAttribute = /class="([^"]+)"/.exec(markup)?.[1];
  assert.ok(classAttribute, "rendered button must have a class attribute");
  return new Set(classAttribute.split(/\s+/));
}

test("all four core variants render their Atlas token classes", () => {
  for (const variant of BUTTON_VARIANTS) {
    const html = renderToStaticMarkup(
      createElement(Button, { variant }, `${variant} action`),
    );
    const classNames = classNamesFromMarkup(html);

    assert.match(html, /^<button type="button" class="[^"]+"><span>[^<]+<\/span><\/button>$/);
    for (const className of EXPECTED_VARIANT_CLASSES[variant]) {
      assert.ok(classNames.has(className), `${variant} must use ${className}`);
    }
  }
});

test("disabled and loading buttons cannot dispatch their click handler", () => {
  const disabledHtml = renderToStaticMarkup(
    createElement(Button, { disabled: true, onClick: () => undefined }, "Save changes"),
  );
  const loadingHtml = renderToStaticMarkup(
    createElement(
      Button,
      { loading: true, loadingLabel: "Saving changes…", onClick: () => undefined },
      "Save changes",
    ),
  );

  assert.match(disabledHtml, / disabled=""/);
  assert.match(loadingHtml, / disabled=""/);
  assert.match(disabledHtml, /disabled:cursor-not-allowed/);
  assert.match(disabledHtml, /disabled:bg-atlas-surface-disabled/);
});

test("the shared button forwards a DOM ref for managed focus flows", () => {
  const source = readFileSync(new URL("./button.ts", import.meta.url), "utf8");

  assert.match(source, /forwardRef<HTMLButtonElement, ButtonProps>/);
  assert.match(source, /\.\.\.props,\s*ref,/);
});

test("loading exposes busy state and preserves the original content width", () => {
  const html = renderToStaticMarkup(
    createElement(
      Button,
      { loading: true, loadingLabel: "Saving changes…" },
      "Save changes",
    ),
  );

  assert.match(html, / disabled=""/);
  assert.match(html, / aria-busy="true"/);
  assert.match(html, /<span class="invisible">Save changes<\/span>/);
  assert.match(
    html,
    /<span class="absolute inset-atlas-0 flex items-center justify-center px-atlas-4" aria-live="polite">Saving changes…<\/span>/,
  );
});

test("focus-visible and touch-target treatments use V2 tokens", () => {
  const html = renderToStaticMarkup(
    createElement(Button, { variant: "primary" }, "Continue"),
  );
  const classNames = classNamesFromMarkup(html);

  for (const className of [
    "min-h-atlas-12",
    "rounded-atlas-button",
    "px-atlas-4",
    "py-atlas-2",
    "text-atlas-base",
    "font-atlas-semibold",
    "focus-visible:outline-none",
    "focus-visible:ring-atlas-focus",
    "focus-visible:ring-offset-atlas-focus",
  ]) {
    assert.ok(classNames.has(className), `button must use ${className}`);
  }
});

test("icon-only buttons require an accessible label", () => {
  const icon = createElement(
    "svg",
    { "aria-hidden": "true" },
    createElement("path", { d: "M0 0" }),
  );

  assert.throws(
    () => renderToStaticMarkup(createElement(Button, null, icon)),
    /requires an accessible label/,
  );

  const html = renderToStaticMarkup(
    createElement(Button, { "aria-label": "Close" }, icon),
  );
  assert.match(html, / aria-label="Close"/);
  assert.match(html, /<svg aria-hidden="true">/);
});

test("full-width buttons opt into form-width layout without caller styling", () => {
  const html = renderToStaticMarkup(
    createElement(Button, { fullWidth: true }, "Continue"),
  );

  assert.match(html, /class="[^"]*\bw-full\b[^"]*"/);
  assert.doesNotMatch(html, /fullWidth=/);
});

test("the primitive uses no raw styling or domain logic", () => {
  const source = readFileSync(new URL("./button.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
  );
  assert.doesNotMatch(
    source,
    /(?:challan|wage|payment|customer|coal|fuel|maintenance|saveChallan|submitPayment)/i,
  );
  assert.doesNotMatch(source, /@\/features\/|@\/lib\/(?:formatting|statuses|strings)/);
});
