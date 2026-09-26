import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { STATUS_TONES, type StatusTone } from "../../lib/statuses.ts";
import { StatusPill } from "./status-pill.ts";

const EXPECTED_TONE_CLASSES = {
  neutral: [
    "border-atlas-border",
    "bg-atlas-surface-muted",
    "text-atlas-text-muted",
  ],
  success: [
    "border-atlas-success-border",
    "bg-atlas-success-surface",
    "text-atlas-success-text",
  ],
  warning: [
    "border-atlas-warning-border",
    "bg-atlas-warning-surface",
    "text-atlas-warning-text",
  ],
  danger: [
    "border-atlas-danger-border",
    "bg-atlas-danger-surface",
    "text-atlas-danger-text",
  ],
  info: [
    "border-atlas-info-border",
    "bg-atlas-info-surface",
    "text-atlas-info-text",
  ],
  archive: [
    "border-atlas-archive-border",
    "bg-atlas-archive-surface",
    "text-atlas-archive-text",
  ],
} as const satisfies Record<StatusTone, readonly string[]>;

function classNamesFromMarkup(markup: string) {
  const classAttribute = /class="([^"]+)"/.exec(markup)?.[1];
  assert.ok(classAttribute, "rendered pill must have a class attribute");
  return new Set(classAttribute.split(/\s+/));
}

test("every supported StatusTone renders its V2 semantic token classes", () => {
  for (const tone of STATUS_TONES) {
    const html = renderToStaticMarkup(
      createElement(StatusPill, { label: `${tone} state`, tone }),
    );
    const classNames = classNamesFromMarkup(html);

    assert.match(html, /^<span class="[^"]+">[^<]+<\/span>$/);
    for (const className of EXPECTED_TONE_CLASSES[tone]) {
      assert.ok(classNames.has(className), `${tone} must use ${className}`);
    }
  }
});

test("the visible status label is always rendered", () => {
  const html = renderToStaticMarkup(
    createElement(StatusPill, { label: "Ready for review", tone: "info" }),
  );

  assert.match(html, />Ready for review<\/span>$/);
  assert.throws(
    () => renderToStaticMarkup(
      createElement(StatusPill, { label: "   ", tone: "neutral" }),
    ),
    /requires a visible label/,
  );
});

test("the primitive uses compact Atlas V2 structure without raw styling", () => {
  const html = renderToStaticMarkup(
    createElement(StatusPill, { label: "Example", tone: "success" }),
  );
  const classNames = classNamesFromMarkup(html);

  for (const className of [
    "inline-flex",
    "items-center",
    "whitespace-nowrap",
    "rounded-atlas-pill",
    "border",
    "px-atlas-2",
    "py-atlas-1",
    "text-atlas-xs",
    "font-atlas-semibold",
  ]) {
    assert.ok(classNames.has(className), `pill must use ${className}`);
  }

  assert.doesNotMatch(html, /(?:#[0-9a-f]{3,8}|(?:bg|text|border)-(?:slate|stone|red|amber|emerald|blue|cyan)-|\[[^\]]+\])/i);
});

test("the primitive contains no domain-specific status decisions", () => {
  const source = readFileSync(
    new URL("./status-pill.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /(?:challan|payment|worker|wage|locked|archived|inactive|paid|unpaid|void)/i,
  );
  assert.doesNotMatch(source, /@\/features\//);
  assert.doesNotMatch(source, /onClick|<button|createElement\(\s*["']button/);
});
