import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "./table.ts";

function renderExampleTable() {
  return renderToStaticMarkup(
    createElement(
      TableContainer,
      { "aria-label": "Scrollable example records" },
      createElement(
        Table,
        { wide: true },
        createElement(TableCaption, { visuallyHidden: true }, "Example records"),
        createElement(
          TableHeader,
          { sticky: true },
          createElement(
            TableRow,
            null,
            createElement(TableHeaderCell, null, "Name"),
            createElement(TableHeaderCell, { numeric: true }, "Amount"),
          ),
        ),
        createElement(
          TableBody,
          null,
          createElement(
            TableRow,
            { hoverable: true },
            createElement(TableCell, null, "Example"),
            createElement(TableCell, { numeric: true }, "₹1,23,456"),
          ),
        ),
      ),
    ),
  );
}

test("the primitives preserve semantic table structure and accessible captions", () => {
  const html = renderExampleTable();

  assert.match(
    html,
    /^<div[^>]+><table[^>]+><caption[^>]+>Example records<\/caption><thead[^>]+><tr><th[^>]+>Name<\/th><th[^>]+>Amount<\/th><\/tr><\/thead><tbody[^>]+><tr[^>]+><td[^>]+>Example<\/td><td[^>]+>₹1,23,456<\/td><\/tr><\/tbody><\/table><\/div>$/,
  );
  assert.match(html, /<caption class="sr-only">Example records<\/caption>/);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /tabindex=/i);
});

test("numeric headers and cells align right and use tabular figures", () => {
  const numericHeader = renderToStaticMarkup(
    createElement(TableHeaderCell, { numeric: true }, "Amount"),
  );
  const numericCell = renderToStaticMarkup(
    createElement(TableCell, { numeric: true }, "1,23,456"),
  );
  const textCell = renderToStaticMarkup(
    createElement(TableCell, null, "Example"),
  );

  for (const html of [numericHeader, numericCell]) {
    assert.match(html, /\btext-right\b/);
    assert.match(html, /\btabular-nums\b/);
    assert.match(html, /\bwhitespace-nowrap\b/);
  }

  assert.match(textCell, /\btext-left\b/);
  assert.doesNotMatch(textCell, /\b(?:text-right|tabular-nums)\b/);
});

test("the container supports wide tables and headers opt into sticky positioning", () => {
  const html = renderExampleTable();

  assert.match(html, /\boverflow-x-auto\b/);
  assert.match(html, /\bmin-w-max\b/);
  assert.match(html, /<thead class="[^"]*\bsticky\b[^"]*\btop-0\b[^"]*\bz-10\b/);
  assert.match(html, /<tr class="[^"]*\bhover:bg-atlas-surface-hover\b/);
  assert.doesNotMatch(html, /\bcursor-pointer\b/);
});

test("the container can bound both table axes for an internally scrolling archive", () => {
  const html = renderToStaticMarkup(
    createElement(TableContainer, { bounded: true }, "Archive"),
  );

  assert.match(html, /\bmax-h-96\b/);
  assert.match(html, /\boverflow-auto\b/);
  assert.doesNotMatch(html, /\boverflow-x-auto\b/);
});

test("rows can expose a selected presentation without becoming interactive", () => {
  const html = renderToStaticMarkup(
    createElement(TableRow, { selected: true }, createElement(TableCell, null, "Selected")),
  );

  assert.match(html, /<tr class="bg-atlas-primary-surface">/);
  assert.doesNotMatch(html, /tabindex=|role="button"|cursor-pointer/);
});

test("all primitive styling uses the Atlas V2 token vocabulary", () => {
  const html = renderExampleTable();
  const source = readFileSync(new URL("./table.ts", import.meta.url), "utf8");

  for (const className of [
    "border-atlas-border",
    "bg-atlas-surface",
    "bg-atlas-surface-muted",
    "text-atlas-text",
    "text-atlas-text-muted",
    "rounded-atlas-card",
    "px-atlas-3",
    "py-atlas-2",
    "py-atlas-3",
    "text-atlas-base",
    "text-atlas-xs",
    "font-atlas-semibold",
    "tracking-atlas-wide",
  ]) {
    assert.match(html, new RegExp(`\\b${className}\\b`));
  }

  assert.doesNotMatch(
    source,
    /(?:#[0-9a-f]{3,8}|(?:bg|text|border|divide)-(?:slate|stone|red|amber|emerald|blue|cyan)-|-\[[^\]]+\])/i,
  );
  assert.doesNotMatch(source, /border-[lr](?:-|\b)/);
});

test("the primitives contain no domain, formatting, status, or data logic", () => {
  const source = readFileSync(new URL("./table.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /(?:challan|wage|payment|customer|coal|fuel|maintenance|currency|date|statuspill)/i,
  );
  assert.doesNotMatch(source, /@\/features\/|@\/lib\/(?:formatting|statuses)/);
  assert.doesNotMatch(
    source,
    /(?:onSort|onFilter|onPage|onSelect|pagination|selection|fetch\()/i,
  );
});
