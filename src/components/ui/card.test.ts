import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CARD_SURFACES, Card, type CardSurface } from "./card.ts";

const EXPECTED_SURFACE_CLASSES = {
  default: "bg-atlas-surface",
  muted: "bg-atlas-surface-muted",
} as const satisfies Record<CardSurface, string>;

function classNamesFromMarkup(markup: string) {
  const classAttribute = /class="([^"]+)"/.exec(markup)?.[1];
  assert.ok(classAttribute, "rendered Card must have a class attribute");
  return new Set(classAttribute.split(/\s+/));
}

test("the default Card uses the restrained V2 surface treatment", () => {
  const html = renderToStaticMarkup(createElement(Card, null, "Grouped content"));
  const classNames = classNamesFromMarkup(html);

  assert.match(html, /^<div class="[^"]+">Grouped content<\/div>$/);
  for (const className of [
    "rounded-atlas-card",
    "border",
    "border-atlas-border",
    "bg-atlas-surface",
    "p-atlas-4",
    "text-atlas-text",
  ]) {
    assert.ok(classNames.has(className), `default Card must use ${className}`);
  }
});

test("the only supported surface distinction is default or muted", () => {
  assert.deepEqual(CARD_SURFACES, ["default", "muted"]);

  for (const surface of CARD_SURFACES) {
    const html = renderToStaticMarkup(
      createElement(Card, { surface }, `${surface} content`),
    );
    const classNames = classNamesFromMarkup(html);

    assert.ok(
      classNames.has(EXPECTED_SURFACE_CLASSES[surface]),
      `${surface} Card must use ${EXPECTED_SURFACE_CLASSES[surface]}`,
    );
  }
});

test("Card preserves appropriate HTML attributes and semantic elements", () => {
  const sectionHtml = renderToStaticMarkup(
    createElement(
      Card,
      {
        as: "section",
        id: "payment-history",
        "aria-labelledby": "payment-history-heading",
        title: "Payment records",
      },
      createElement("h2", { id: "payment-history-heading" }, "Payment history"),
    ),
  );
  const articleHtml = renderToStaticMarkup(
    createElement(Card, { as: "article" }, "Record summary"),
  );

  assert.match(sectionHtml, /^<section /);
  assert.match(sectionHtml, / id="payment-history"/);
  assert.match(sectionHtml, / aria-labelledby="payment-history-heading"/);
  assert.match(sectionHtml, / title="Payment records"/);
  assert.match(sectionHtml, /<h2 id="payment-history-heading">Payment history<\/h2>/);
  assert.match(articleHtml, /^<article /);
});

test("Card adds no decorative elevation or interaction by default", () => {
  const html = renderToStaticMarkup(createElement(Card, null, "Static content"));
  const classNames = classNamesFromMarkup(html);

  assert.equal(
    [...classNames].some((className) => className.includes("shadow")),
    false,
  );
  assert.doesNotMatch(html, /(?:role|tabindex|onclick)=/i);
  assert.equal(html.startsWith("<button"), false);
  assert.equal(html.startsWith("<a "), false);
});

test("Card styling uses tokens and contains no domain or business logic", () => {
  const source = readFileSync(new URL("./card.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan|orange)-|-\[[^\]]+\])/i,
  );
  assert.doesNotMatch(source, /\bshadow(?:-|\b)/);
  assert.doesNotMatch(
    source,
    /(?:challan|wage|payment|customer|coal|fuel|maintenance|calculate|aggregate|fetch\()/i,
  );
  assert.doesNotMatch(source, /@\/features\/|@\/lib\/(?:formatting|statuses|strings)/);
});
